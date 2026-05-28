import fs from "node:fs";
import readline from "node:readline";

export async function readJsonlLimited<T>(
  filePath: string,
  options: { maxLines?: number; maxBytes?: number } = {}
): Promise<T[]> {
  const maxLines = options.maxLines ?? 500;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat || stat.size <= 0) return [];

  const start = Math.max(0, stat.size - maxBytes);
  const stream = fs.createReadStream(filePath, { encoding: "utf8", start });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows: T[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
      if (rows.length >= maxLines) break;
    } catch {
      continue;
    }
  }

  return rows;
}
