export type RunStatus = "running" | "completed" | "error" | "waiting" | "inactive";

export type EventKind =
  | "message"
  | "thought"
  | "tool_call"
  | "tool_result"
  | "waiting"
  | "error"
  | "completion"
  | "info";

export interface AgentSummary {
  id: string;
  name: string;
  status: RunStatus | "unknown";
  running: number;
  lastActivityAt: string | null;
}

export interface RunSummary {
  id: string;
  agentId: string;
  agentName: string;
  status: RunStatus;
  summary: string;
  startedAt: string | null;
  updatedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  lastActivityAgeMs: number | null;
  eventCount: number;
  errorCount: number;
  waitingReason?: string;
  errorMessage?: string;
  origin: {
    source: "session" | "cron";
    channel?: string;
    chatType?: string;
  };
  metadata: Record<string, string | number | boolean | null>;
}

export type RunDetail = RunSummary;

export interface RunEvent {
  id: string;
  runId: string;
  ts: string | null;
  kind: EventKind;
  label: string;
  message: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface StatusSummary {
  running: number;
  completed: number;
  error: number;
  waiting: number;
  inactive: number;
  total: number;
  generatedAt: string;
}

export interface RunFilters {
  agent?: string;
  agentId?: string;
  status?: RunStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface EventPageOptions {
  limit?: number;
  offset?: number;
}

export interface SourceSessionRecord {
  agentId: string;
  sessionKey: string;
  sessionId: string;
  sessionDir: string;
  trajectoryFile: string | null;
  raw: Record<string, unknown>;
}

export interface SourceCronRun {
  id: string;
  jobId: string;
  raw: Record<string, unknown>;
}

export interface TrajectoryEvent {
  type?: string;
  ts?: string | number;
  seq?: number;
  sessionId?: string;
  runId?: string;
  provider?: string;
  modelId?: string;
  modelApi?: string;
  data?: Record<string, unknown>;
}
