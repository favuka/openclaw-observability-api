import { cache } from "../cache/memoryCache.js";
import { config } from "../config/index.js";
import { normalizeCronEvent } from "../normalizers/cronEvents.js";
import { normalizeTrajectoryEvent } from "../normalizers/events.js";
import { normalizeCronRun, normalizeSessionRun } from "../normalizers/runs.js";
import { listCronRuns, readCronRunEvents } from "../sources/cron.js";
import { listSessionRecords, readTrajectory } from "../sources/sessions.js";
import type { AgentSummary, EventPageOptions, RunDetail, RunEvent, RunFilters, RunSummary, StatusSummary } from "../types/observability.js";

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LIMIT = 500;
const MAX_RUN_LIMIT = 500;

async function buildSessionRuns(): Promise<RunSummary[]> {
  const records = await listSessionRecords();
  const limited = records.slice(-config.maxRuns);
  const runs = await Promise.all(
    limited.map(async (record) => {
      const trajectory = await readTrajectory(record, config.maxEventsPerRun, config.maxJsonlBytes);
      const events = trajectory.map((event, index) => normalizeTrajectoryEvent(event, index, record.sessionId));
      return normalizeSessionRun(record, events);
    })
  );
  return runs;
}

async function buildAllRuns(): Promise<RunSummary[]> {
  const [sessionRuns, cronRuns] = await Promise.all([
    buildSessionRuns(),
    listCronRuns().then((records) => records.map(normalizeCronRun))
  ]);

  return [...sessionRuns, ...cronRuns]
    .sort((a, b) => Date.parse(b.updatedAt ?? b.startedAt ?? "0") - Date.parse(a.updatedAt ?? a.startedAt ?? "0"))
    .slice(0, config.maxRuns);
}

function normalizeTextFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function normalizeRunPage(filters: RunFilters): { limit: number; offset: number } {
  const rawLimit = Number.isFinite(filters.limit) ? Math.trunc(filters.limit ?? config.maxRuns) : config.maxRuns;
  const rawOffset = Number.isFinite(filters.offset) ? Math.trunc(filters.offset ?? 0) : 0;
  return {
    limit: Math.min(Math.max(rawLimit, 0), MAX_RUN_LIMIT),
    offset: Math.max(rawOffset, 0)
  };
}

function safeOriginText(run: RunSummary): string {
  return [run.origin.source, run.origin.channel, run.origin.chatType].filter(Boolean).join(" ");
}

function applyFilters(runs: RunSummary[], filters: RunFilters): RunSummary[] {
  const agent = normalizeTextFilter(filters.agent);
  const agentId = normalizeTextFilter(filters.agentId);
  const q = normalizeTextFilter(filters.q);
  const page = normalizeRunPage(filters);
  return runs
    .filter((run) => !agentId || run.agentId.toLowerCase() === agentId)
    .filter((run) => !agent || run.agentId.toLowerCase() === agent || run.agentName.toLowerCase().includes(agent))
    .filter((run) => !filters.status || run.status === filters.status)
    .filter((run) => !q || `${run.agentName} ${run.summary} ${safeOriginText(run)}`.toLowerCase().includes(q))
    .slice(page.offset, page.offset + page.limit);
}

export async function getRuns(filters: RunFilters = {}): Promise<RunSummary[]> {
  const runs = await cache.getOrSet("runs", config.cacheTtlMs, buildAllRuns);
  return applyFilters(runs, filters);
}

export async function getRunById(id: string): Promise<RunDetail | null> {
  const runs = await getRuns();
  const run = runs.find((item) => item.id === id);
  if (!run) return null;
  return run;
}

function normalizeEventPageOptions(options: EventPageOptions = {}): Required<EventPageOptions> {
  const limit = Number.isFinite(options.limit) ? Math.trunc(options.limit ?? DEFAULT_EVENT_LIMIT) : DEFAULT_EVENT_LIMIT;
  const offset = Number.isFinite(options.offset) ? Math.trunc(options.offset ?? 0) : 0;
  return {
    limit: Math.min(Math.max(limit, 0), MAX_EVENT_LIMIT),
    offset: Math.max(offset, 0)
  };
}

function eventOrderValue(event: RunEvent, originalIndex: number): number {
  return event.ts ? Date.parse(event.ts) || originalIndex : originalIndex;
}

function eventDedupeKey(event: RunEvent): string {
  return JSON.stringify({
    ts: event.ts,
    kind: event.kind,
    label: event.label,
    message: event.message,
    metadata: event.metadata
  });
}

function orderAndDedupeEvents(events: RunEvent[]): RunEvent[] {
  const seen = new Set<string>();
  return events
    .map((event, originalIndex) => ({ event, originalIndex }))
    .sort((a, b) => {
      const byTime = eventOrderValue(a.event, a.originalIndex) - eventOrderValue(b.event, b.originalIndex);
      return byTime === 0 ? a.originalIndex - b.originalIndex : byTime;
    })
    .filter(({ event }) => {
      const key = eventDedupeKey(event);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ event }) => event);
}

export async function getRunEvents(id: string, options: EventPageOptions = {}): Promise<RunEvent[]> {
  const page = normalizeEventPageOptions(options);
  let events: RunEvent[];

  if (id.startsWith("cron:")) {
    const jobId = id.slice("cron:".length);
    const rawEvents = await readCronRunEvents(jobId, config.maxEventsPerRun, config.maxJsonlBytes);
    events = rawEvents.map((event, index) => normalizeCronEvent(id, event, index));
  } else {
    const records = await cache.getOrSet("session-records", config.cacheTtlMs, listSessionRecords);
    const record = records.find((item) => item.sessionId === id);
    if (!record) return [];
    const trajectory = await readTrajectory(record, config.maxEventsPerRun, config.maxJsonlBytes);
    events = trajectory.map((event, index) => normalizeTrajectoryEvent(event, index, id));
  }

  return orderAndDedupeEvents(events).slice(page.offset, page.offset + page.limit);
}

export async function getAgents(): Promise<AgentSummary[]> {
  const runs = await getRuns();
  const grouped = new Map<string, AgentSummary>();

  for (const run of runs) {
    const existing = grouped.get(run.agentId);
    const currentTs = Date.parse(run.updatedAt ?? run.startedAt ?? "0");
    const existingTs = Date.parse(existing?.lastActivityAt ?? "0");
    grouped.set(run.agentId, {
      id: run.agentId,
      name: run.agentName,
      status: !existing || currentTs >= existingTs ? run.status : existing.status,
      running: (existing?.running ?? 0) + (run.status === "running" ? 1 : 0),
      lastActivityAt: !existing || currentTs >= existingTs ? run.updatedAt : existing.lastActivityAt
    });
  }

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getStatusSummary(): Promise<StatusSummary> {
  const runs = await getRuns();
  const summary: StatusSummary = {
    running: 0,
    completed: 0,
    error: 0,
    waiting: 0,
    inactive: 0,
    total: runs.length,
    generatedAt: new Date().toISOString()
  };

  for (const run of runs) summary[run.status] += 1;
  return summary;
}
