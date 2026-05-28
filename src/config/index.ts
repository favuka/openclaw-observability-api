import path from "node:path";

const DEFAULT_OPENCLAW_HOME = "/root/.openclaw";

export const config = {
  host: process.env.OBS_HOST ?? "127.0.0.1",
  port: Number(process.env.OBS_PORT ?? 4317),
  openclawHome: process.env.OPENCLAW_HOME
    ? path.resolve(process.env.OPENCLAW_HOME)
    : DEFAULT_OPENCLAW_HOME,
  cacheTtlMs: Number(process.env.OBS_CACHE_TTL_MS ?? 2000),
  inactiveThresholdMs: Number(process.env.OBS_INACTIVE_THRESHOLD_MS ?? 10 * 60 * 1000),
  waitingThresholdMs: Number(process.env.OBS_WAITING_THRESHOLD_MS ?? 2 * 60 * 1000),
  maxRuns: Number(process.env.OBS_MAX_RUNS ?? 250),
  maxEventsPerRun: Number(process.env.OBS_MAX_EVENTS_PER_RUN ?? 400),
  maxJsonlBytes: Number(process.env.OBS_MAX_JSONL_BYTES ?? 2 * 1024 * 1024)
};

export const paths = {
  agentsDir: path.join(config.openclawHome, "agents"),
  cronDir: path.join(config.openclawHome, "cron")
};
