import { config } from "../config/index.js";
import { publicAgentName, sanitizeMetadata, sanitizeText } from "../security/sanitize.js";
import type { RunEvent, RunStatus, RunSummary, SourceCronRun, SourceSessionRecord } from "../types/observability.js";
import { toIso, toMs } from "./time.js";

function firstMs(...values: unknown[]): number | null {
  for (const value of values) {
    const ms = toMs(value);
    if (ms !== null) return ms;
  }
  return null;
}

function hasError(raw: Record<string, unknown>, events: RunEvent[]): boolean {
  return Boolean(
    raw.timedOut ||
      raw.aborted ||
      raw.externalAbort ||
      raw.abortedLastRun ||
      raw.promptErrorSource ||
      raw.error ||
      events.some((event) => event.kind === "error" || event.metadata.status === "error")
  );
}

function hasOpenToolCall(events: RunEvent[]): boolean {
  const lastToolCall = [...events].reverse().find((event) => event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "error");
  return lastToolCall?.kind === "tool_call";
}

function inferStatus(raw: Record<string, unknown>, events: RunEvent[], updatedAtMs: number | null, endedAtMs: number | null): RunStatus {
  const rawStatus = typeof raw.status === "string" ? raw.status.toLowerCase() : "";
  const now = Date.now();
  const ageMs = updatedAtMs ? now - updatedAtMs : null;

  if (hasError(raw, events)) return "error";
  if (endedAtMs || ["done", "completed", "ok"].includes(rawStatus)) return "completed";
  if (ageMs !== null && ageMs > config.inactiveThresholdMs) return "inactive";
  if (hasOpenToolCall(events)) return "waiting";
  if (rawStatus === "running" || events.some((event) => event.label === "Sessao iniciada")) return "running";
  if (ageMs !== null && ageMs > config.waitingThresholdMs) return "waiting";
  return "running";
}

export function normalizeSessionRun(record: SourceSessionRecord, events: RunEvent[]): RunSummary {
  const raw = record.raw;
  const startedAtMs = firstMs(raw.startedAt, raw.sessionStartedAt, events[0]?.ts);
  const updatedAtMs = firstMs(raw.updatedAt, raw.lastInteractionAt, events.at(-1)?.ts, startedAtMs);
  const endedAtMs = firstMs(raw.endedAt, raw.sessionEndedAt);
  const status = inferStatus(raw, events, updatedAtMs, endedAtMs);
  const errorCount = events.filter((event) => event.kind === "error").length + (hasError(raw, []) ? 1 : 0);
  const durationMs =
    typeof raw.runtimeMs === "number"
      ? raw.runtimeMs
      : startedAtMs && (endedAtMs || updatedAtMs)
        ? (endedAtMs ?? updatedAtMs ?? startedAtMs) - startedAtMs
        : null;

  const waitingReason =
    status === "waiting"
      ? events.at(-1)?.kind === "tool_call"
        ? "Aguardando resultado de ferramenta"
        : "Sessao ativa sem avanco recente"
      : undefined;

  return {
    id: record.sessionId,
    agentId: record.agentId,
    agentName: publicAgentName(record.agentId),
    status,
    summary: sanitizeText(raw.summary ?? raw.title ?? `Sessao ${record.agentId}`, 160),
    startedAt: toIso(startedAtMs),
    updatedAt: toIso(updatedAtMs),
    endedAt: toIso(endedAtMs),
    durationMs,
    lastActivityAgeMs: updatedAtMs ? Date.now() - updatedAtMs : null,
    eventCount: events.length,
    errorCount,
    waitingReason,
    errorMessage: errorCount > 0 ? sanitizeText(raw.promptErrorSource ?? raw.error ?? events.find((event) => event.kind === "error")?.message, 160) : undefined,
    origin: {
      source: "session",
      channel: typeof raw.lastChannel === "string" ? sanitizeText(raw.lastChannel, 40) : undefined,
      chatType: typeof raw.chatType === "string" ? sanitizeText(raw.chatType, 40) : undefined
    },
    metadata: sanitizeMetadata({
      provider: raw.provider,
      model: raw.model,
      modelId: raw.modelId,
      status: raw.status,
      source: "sessions.json"
    })
  };
}

export function normalizeCronRun(record: SourceCronRun): RunSummary {
  const raw = record.raw;
  const jobState = raw.jobState && typeof raw.jobState === "object" ? (raw.jobState as Record<string, unknown>) : {};
  const state = jobState.state && typeof jobState.state === "object" ? (jobState.state as Record<string, unknown>) : {};
  const lastRunAtMs = firstMs(state.lastRunAtMs, raw.createdAtMs);
  const updatedAtMs = firstMs(jobState.updatedAtMs, state.lastRunAtMs, raw.createdAtMs);
  const lastStatus = typeof state.lastRunStatus === "string" ? state.lastRunStatus : typeof state.lastStatus === "string" ? state.lastStatus : "";
  const status: RunStatus =
    lastStatus === "error"
      ? "error"
      : lastStatus === "ok"
        ? "completed"
        : Boolean(raw.enabled)
          ? "waiting"
          : "inactive";

  return {
    id: record.id,
    agentId: "cron",
    agentName: "Cron",
    status,
    summary: sanitizeText(raw.name ?? raw.description ?? "Cron job", 160),
    startedAt: toIso(lastRunAtMs),
    updatedAt: toIso(updatedAtMs),
    endedAt: null,
    durationMs: typeof state.lastDurationMs === "number" ? state.lastDurationMs : null,
    lastActivityAgeMs: updatedAtMs ? Date.now() - updatedAtMs : null,
    eventCount: 0,
    errorCount: typeof state.consecutiveErrors === "number" ? state.consecutiveErrors : status === "error" ? 1 : 0,
    waitingReason: status === "waiting" ? "Aguardando proxima agenda" : undefined,
    errorMessage: status === "error" ? sanitizeText((state.lastDiagnostics as Record<string, unknown> | undefined)?.summary ?? "Erro no ultimo run", 160) : undefined,
    origin: { source: "cron" },
    metadata: sanitizeMetadata({
      enabled: raw.enabled,
      scheduleKind: (raw.schedule as Record<string, unknown> | undefined)?.kind,
      scheduleTz: (raw.schedule as Record<string, unknown> | undefined)?.tz,
      consecutiveErrors: state.consecutiveErrors,
      deliveryStatus: state.lastDeliveryStatus,
      sessionTarget: raw.sessionTarget
    })
  };
}
