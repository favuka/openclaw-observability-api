import type { RunEvent } from "../types/observability.js";
import { sanitizeMetadata, sanitizeText } from "../security/sanitize.js";
import { toIso } from "./time.js";

export function normalizeCronEvent(runId: string, raw: Record<string, unknown>, index: number): RunEvent {
  const status = typeof raw.status === "string" ? raw.status : undefined;
  const kind = status === "error" || raw.error ? "error" : status === "ok" || raw.action === "finished" ? "completion" : "info";
  return {
    id: `${runId}:${index}`,
    runId,
    ts: toIso(raw.ts ?? raw.runAtMs),
    kind,
    label: sanitizeText(raw.action ?? "cron event", 80),
    message:
      kind === "error"
        ? sanitizeText(raw.error ?? "Erro registrado no cron.", 180)
        : sanitizeText(raw.summary ?? status ?? "Evento de cron registrado. Conteudo sensivel oculto.", 180),
    metadata: sanitizeMetadata({
      status,
      durationMs: raw.durationMs,
      deliveryStatus: raw.deliveryStatus,
      source: "cron"
    })
  };
}
