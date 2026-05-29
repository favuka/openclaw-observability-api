import type { EventKind, RunEvent, TrajectoryEvent } from "../types/observability.js";
import { sanitizeMetadata, sanitizeText } from "../security/sanitize.js";
import { toIso } from "./time.js";

type PublicDiagnostic = Record<string, string | number | boolean | null | undefined>;

function eventKind(type: string | undefined, data: Record<string, unknown>): EventKind {
  if (!type) return "info";
  if (type.includes("tool.call")) return "tool_call";
  if (type.includes("tool.result")) return data.isError === true || hasFailureStatus(data) ? "error" : "tool_result";
  if (type.includes("error") || data.isError === true) return "error";
  if (type.includes("ended") || type.includes("completed") || type.includes("finished")) return "completion";
  if (type.includes("waiting") || type.includes("yield")) return "waiting";
  if (type.includes("thought") || type.includes("reasoning")) return "thought";
  if (type.includes("prompt") || type.includes("message")) return "message";
  return "info";
}

function hasFailureStatus(data: Record<string, unknown>): boolean {
  const details = recordValue(data.details);
  const status = (stringValue(data.status) ?? stringValue(details?.status))?.toLowerCase();
  const exitCode = numberValue(data.exitCode) ?? numberValue(details?.exitCode);
  return status === "failed" || status === "error" || (typeof exitCode === "number" && exitCode !== 0);
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function contentText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((item) => {
      const record = recordValue(item);
      return record?.type === "text" ? stringValue(record.text) : undefined;
    })
    .filter((item): item is string => Boolean(item));
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function firstText(data: Record<string, unknown>, paths: string[]): string | undefined {
  for (const path of paths) {
    const parts = path.split(".");
    let value: unknown = data;
    for (const part of parts) value = recordValue(value)?.[part];
    const text = stringValue(value) ?? contentText(value);
    if (text) return text;
  }
  return undefined;
}

function commandSummary(tool: string | undefined, data: Record<string, unknown>): string | undefined {
  const raw =
    firstText(data, ["command", "cmd", "input", "arguments.command", "args.command", "args.cmd", "details.command"]) ??
    firstText(data, ["details.cwd"]);
  if (!raw && !tool) return undefined;

  const command = sanitizeText(raw ?? "", 140);
  const baseTool = sanitizeText(tool ?? command.split(/\s+/)[0] ?? "tool", 40);
  const compact = command
    .replace(/\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|KEYRING)[A-Z0-9_]*=[^\s]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (baseTool === "bash") {
    const first = compact.split(/\s*(?:&&|\|\||;|\n)\s*/)[0]?.trim();
    return first ? sanitizeText(first, 120) : "bash command failed";
  }
  if (baseTool === "gog") return sanitizeText(`${compact || "gog command"} failed`, 120);
  if (compact && compact !== baseTool) return sanitizeText(compact, 120);
  return `${baseTool} failed`;
}

function classifyError(type: string | undefined, data: Record<string, unknown>, diagnosticText: string): string {
  const haystack = `${type ?? ""} ${diagnosticText}`.toLowerCase();
  if (/\bmodule_not_found\b|err_module_not_found|cannot find module/.test(haystack)) return "MODULE_NOT_FOUND";
  if (/\benoent\b|no such file|missing file|file not found/.test(haystack)) return "MISSING_FILE";
  if (/auth|unauthorized|forbidden|permission denied|credential|keyring|password|401|403/.test(haystack)) return "AUTH_FAILED";
  if (String(type ?? "").includes("tool.result") || hasFailureStatus(data)) return "TOOL_EXECUTION_FAILED";
  return "AGENT_RUNTIME_ERROR";
}

function errorDiagnostic(type: string | undefined, data: Record<string, unknown>, kind: EventKind): PublicDiagnostic {
  if (kind !== "error") return {};

  const details = recordValue(data.details);
  const tool = stringValue(data.name) ?? stringValue(data.toolName) ?? stringValue(data.tool);
  const exitCode = numberValue(data.exitCode) ?? numberValue(details?.exitCode);
  const stderr = firstText(data, ["stderr", "details.stderr"]);
  const stack = firstText(data, ["stack", "error.stack", "details.stack"]);
  const cause = firstText(data, ["cause", "error.cause", "details.cause"]);
  const payloadSummary = firstText(data, ["message", "error", "details.aggregated", "content", "output"]);
  const diagnosticText = [stderr, stack, cause, payloadSummary].filter(Boolean).join("\n");

  return {
    tool,
    commandSummary: commandSummary(tool, data),
    stderr: stderr ? sanitizeText(stderr, 220) : undefined,
    exitCode,
    stack: stack ? sanitizeText(stack, 220) : undefined,
    cause: cause ? sanitizeText(cause, 180) : undefined,
    payloadSummary: payloadSummary ? sanitizeText(payloadSummary, 220) : undefined,
    errorClass: classifyError(type, data, diagnosticText),
    toolStatus: stringValue(data.status) ?? stringValue(details?.status)
  };
}

function eventMessage(type: string | undefined, data: Record<string, unknown>, kind: EventKind): string {
  if (kind === "tool_call") return "Chamada de ferramenta registrada. Argumentos ocultos.";
  if (kind === "tool_result") return "Resultado de ferramenta registrado. Conteudo oculto.";
  if (kind === "error") {
    const diagnostic = errorDiagnostic(type, data, kind);
    return sanitizeText(
      diagnostic.stderr ?? diagnostic.cause ?? diagnostic.payloadSummary ?? data.error ?? data.message ?? "Erro registrado na execucao.",
      180
    );
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
    severity: data.severity,
    ...errorDiagnostic(event.type, data, kind)
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
