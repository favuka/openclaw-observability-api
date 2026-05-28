import type { EventKind, RunEvent, TrajectoryEvent } from "../types/observability.js";
import { sanitizeMetadata, sanitizeText } from "../security/sanitize.js";
import { toIso } from "./time.js";

function eventKind(type: string | undefined, data: Record<string, unknown>): EventKind {
  if (!type) return "info";
  if (type.includes("tool.call")) return "tool_call";
  if (type.includes("tool.result")) return data.isError === true ? "error" : "tool_result";
  if (type.includes("error") || data.isError === true) return "error";
  if (type.includes("ended") || type.includes("completed") || type.includes("finished")) return "completion";
  if (type.includes("waiting") || type.includes("yield")) return "waiting";
  if (type.includes("thought") || type.includes("reasoning")) return "thought";
  if (type.includes("prompt") || type.includes("message")) return "message";
  return "info";
}

function eventLabel(type: string | undefined, data: Record<string, unknown>): string {
  if (!type) return "Evento";
  const tool = typeof data.name === "string" ? sanitizeText(data.name, 40) : null;
  if (type.includes("tool.call")) return tool ? `Tool chamada: ${tool}` : "Tool chamada";
  if (type.includes("tool.result")) return tool ? `Tool resultado: ${tool}` : "Tool resultado";
  if (type === "session.started") return "Sessao iniciada";
  if (type === "session.ended") return "Sessao concluida";
  if (type === "prompt.submitted") return "Mensagem recebida";
  return sanitizeText(type.replaceAll(".", " "), 80);
}

function eventMessage(type: string | undefined, data: Record<string, unknown>, kind: EventKind): string {
  if (kind === "tool_call") return "Chamada de ferramenta registrada. Argumentos ocultos.";
  if (kind === "tool_result") return "Resultado de ferramenta registrado. Conteudo oculto.";
  if (kind === "error") {
    return sanitizeText(data.error ?? data.message ?? "Erro registrado na execucao.", 180);
  }
  if (type === "prompt.submitted") return "Prompt recebido. Conteudo oculto.";
  if (type === "context.compiled") return "Contexto compilado. Conteudo oculto.";
  return sanitizeText(data.summary ?? data.status ?? type ?? "Evento tecnico", 180);
}

export function normalizeTrajectoryEvent(event: TrajectoryEvent, index: number, fallbackRunId: string): RunEvent {
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const kind = eventKind(event.type, data);
  const metadata = sanitizeMetadata({
    provider: event.provider,
    modelId: event.modelId,
    modelApi: event.modelApi,
    source: event.type,
    tool: data.name,
    status: data.status,
    exitCode: data.exitCode,
    durationMs: data.durationMs,
    severity: data.severity
  });

  return {
    id: `${fallbackRunId}:${event.seq ?? index}`,
    runId: fallbackRunId,
    ts: toIso(event.ts),
    kind,
    label: eventLabel(event.type, data),
    message: eventMessage(event.type, data, kind),
    metadata
  };
}
