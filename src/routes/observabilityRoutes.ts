import type { FastifyInstance } from "fastify";
import { sanitizeResponse } from "../security/sanitize.js";
import { getAgents, getRunById, getRunEvents, getRuns, getStatusSummary } from "../services/observabilityService.js";
import type { RunFilters, RunStatus } from "../types/observability.js";

const RUN_STATUSES = new Set<RunStatus>(["running", "completed", "error", "waiting", "inactive"]);

export async function registerObservabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () =>
    sanitizeResponse({
      ok: true,
      version: "mvp2",
      source: "local-readonly",
      ts: new Date().toISOString()
    })
  );

  app.get("/api/agents", async () => sanitizeResponse(await getAgents()));

  app.get("/api/runs", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const q = query.q ?? query.search;
    const filters: RunFilters = {
      agent: query.agent,
      agentId: query.agentId,
      status: query.status && RUN_STATUSES.has(query.status as RunStatus) ? (query.status as RunStatus) : undefined,
      q,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined
    };
    return sanitizeResponse(await getRuns(filters));
  });

  app.get("/api/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await getRunById(id);
    if (!run) return reply.code(404).send(sanitizeResponse({ error: "run_not_found" }));
    return sanitizeResponse(run);
  });

  app.get("/api/runs/:id/events", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string | undefined>;
    return sanitizeResponse(
      await getRunEvents(id, {
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined
      })
    );
  });

  app.get("/api/status-summary", async () => sanitizeResponse(await getStatusSummary()));
}
