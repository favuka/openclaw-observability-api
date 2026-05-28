import cors from "@fastify/cors";
import Fastify from "fastify";
import { config } from "./config/index.js";
import { registerObservabilityRoutes } from "./routes/observabilityRoutes.js";

export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export async function buildServer() {
  const app = Fastify({ logger: true });

  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (typeof origin === "string" && !isAllowedOrigin(origin)) {
      await reply.code(403).send({ error: "cors_origin_denied" });
    }
  });

  await app.register(cors, {
    origin(origin, cb) {
      if (!origin || isAllowedOrigin(origin)) cb(null, true);
      else cb(null, false);
    }
  });

  await registerObservabilityRoutes(app);
  return app;
}

export async function startServer(): Promise<void> {
  assertLocalBind(config.host);

  const app = await buildServer();
  await app.listen({ host: config.host, port: config.port });
}

export function assertLocalBind(host: string): void {
  if (host !== "127.0.0.1") {
    throw new Error("Refusing to bind OpenClaw Observability API outside 127.0.0.1");
  }
}
