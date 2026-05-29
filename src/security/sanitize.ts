import path from "node:path";

const SENSITIVE_KEY_PATTERN =
  /^(token|secret|password|authorization|cookie|api[_-]?key|private|credential|auth|prompt|systemPrompt|output|result|arguments|args|url|uri|file|path|workspaceDir|sessionFile|thread[_-]?id|chat[_-]?id|channel[_-]?id|attachment|image|media|raw)$/i;

const SAFE_METADATA_KEYS = new Set([
  "provider",
  "model",
  "modelId",
  "modelApi",
  "tool",
  "toolName",
  "name",
  "status",
  "exitCode",
  "errorClass",
  "commandSummary",
  "stderr",
  "stack",
  "cause",
  "payloadSummary",
  "toolStatus",
  "durationMs",
  "source",
  "severity",
  "enabled",
  "scheduleKind",
  "scheduleTz",
  "consecutiveErrors",
  "deliveryStatus",
  "sessionTarget"
]);

export function sanitizeText(value: unknown, maxLength = 160): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  text = text.replace(
    /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|KEYRING)[A-Z0-9_]*)\s*=\s*\S+/g,
    "$1=[redacted]"
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  text = text.replace(/\b(?:sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[redacted]");
  text = text.replace(/\b(?:token|api[_-]?key|secret|password)=\S+/gi, "$1=[redacted]");
  text = text.replace(/https?:\/\/\S+/g, "[url]");
  text = text.replace(/\b(?:telegram|discord|whatsapp|slack):[^\s,)]+/gi, "[channel-id]");
  text = text.replace(/\b(?:chat|channel)[_-]?id[:=]\s*-?\d{5,}\b/gi, "$1_id=[redacted]");
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
  text = text.replace(/\/(?:[\w.-]+\/)+[\w .-]+/g, "[path]");
  text = text.replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[redacted]");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function sanitizeMetadata(input: Record<string, unknown> = {}): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_METADATA_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      output[key] = value;
    } else if (typeof value === "string") {
      output[key] = sanitizeText(value, 80);
    }
  }

  return output;
}

export function publicAgentName(agentId: string): string {
  return agentId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function basenameSafe(filePath: unknown): string | null {
  if (typeof filePath !== "string" || !filePath) return null;
  return path.basename(filePath);
}

export function sanitizeResponse<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeResponse(item)) as T;
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    if (typeof rawValue === "string") {
      output[key] = ["id", "runId", "agentId"].includes(key)
        ? rawValue
        : sanitizeText(rawValue, key === "summary" || key === "message" ? 220 : 120);
    } else if (Array.isArray(rawValue) || (rawValue && typeof rawValue === "object")) {
      output[key] = sanitizeResponse(rawValue);
    } else {
      output[key] = rawValue;
    }
  }

  return output as T;
}
