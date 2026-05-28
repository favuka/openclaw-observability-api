import fs from "node:fs";
import path from "node:path";
import { paths } from "../config/index.js";
import type { SourceCronRun } from "../types/observability.js";
import { readJsonlLimited } from "./jsonl.js";

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function listCronRuns(): Promise<SourceCronRun[]> {
  const jobs = await readJson(path.join(paths.cronDir, "jobs.json"));
  const state = await readJson(path.join(paths.cronDir, "jobs-state.json"));
  const jobList = Array.isArray(jobs?.jobs) ? (jobs.jobs as Record<string, unknown>[]) : [];
  const stateById =
    state?.jobs && typeof state.jobs === "object" ? (state.jobs as Record<string, unknown>) : {};

  return jobList.map((job) => {
    const id = typeof job.id === "string" ? job.id : "unknown";
    const jobState = stateById[id] && typeof stateById[id] === "object" ? (stateById[id] as Record<string, unknown>) : {};
    return {
      id: `cron:${id}`,
      jobId: id,
      raw: { ...job, jobState }
    };
  });
}

export async function readCronRunEvents(jobId: string, maxEvents: number, maxBytes: number): Promise<Record<string, unknown>[]> {
  const runFile = path.join(paths.cronDir, "runs", `${jobId}.jsonl`);
  return readJsonlLimited<Record<string, unknown>>(runFile, { maxLines: maxEvents, maxBytes });
}
