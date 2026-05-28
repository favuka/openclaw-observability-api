import { startServer } from "./server.js";

startServer().catch((error) => {
  console.error(error instanceof Error ? error.message : "OpenClaw Observability API failed to start");
  process.exit(1);
});
