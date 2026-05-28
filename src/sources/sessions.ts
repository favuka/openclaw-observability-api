import fs from "node:fs";
import path from "node:path";
import { paths } from "../config/index.js";
import type { SourceSessionRecord, TrajectoryEvent } from "../types/observability.js";
import { readJsonlLimited } from "./jsonl.js";

async function readJson(filePath: string): Promise<unknown> {
  const text = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(text) as unknown;
}

export async function listSessionRecords(): Promise<SourceSessionRecord[]> {
  const agentEntries = await fs.promises.readdir(paths.agentsDir, { withFileTypes: true }).catch(() => []);
  const records: SourceSessionRecord[] = [];

  for (const entry of agentEntries) {
    if (!entry.isDirectory()) continue;
    const agentId = entry.name;
    const sessionDir = path.join(paths.agentsDir, agentId, "sessions");
    const indexPath = path.join(sessionDir, "sessions.json");
    const index = await readJson(indexPath).catch(() => null);
    if (!index || typeof index !== "object") continue;

    for (const [sessionKey, raw] of Object.entries(index as Record<string, unknown>)) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as Record<string, unknown>;
      const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : sessionKey;
      const trajectoryFile = path.join(sessionDir, `${sessionId}.trajectory.jsonl`);
      const hasTrajectory = await fs.promises.access(trajectoryFile).then(() => true).catch(() => false);
      records.push({
        agentId,
        sessionKey,
        sessionId,
        sessionDir,
        trajectoryFile: hasTrajectory ? trajectoryFile : null,
        raw: obj
      });
    }
  }

  return records;
}

export async function readTrajectory(record: SourceSessionRecord, maxEvents: number, maxBytes: number): Promise<TrajectoryEvent[]> {
  if (!record.trajectoryFile) return [];
  return readJsonlLimited<TrajectoryEvent>(record.trajectoryFile, { maxLines: maxEvents, maxBytes });
}
