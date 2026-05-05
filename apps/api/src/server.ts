import { createLogger, getEnv } from "@marketing-auto/shared";
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { healthRoutes } from "./routes/health.js";

const env = getEnv();
const log = createLogger("api");

const app = new Hono();

app.use(
  "*",
  honoLogger((message) => log.info(message))
);

app.route("/health", healthRoutes);

app.notFound((c) => c.json({ ok: false, error: "Not Found" }, 404));

app.onError((err, c) => {
  log.error({ err }, "Unhandled error");
  return c.json({ ok: false, error: "Internal Server Error" }, 500);
});

declare global {
  var __startTime: number;
}
globalThis.__startTime = Date.now();

log.info({ port: env.API_PORT, host: env.API_HOST }, "Starting API server");

export default {
  port: env.API_PORT,
  hostname: env.API_HOST,
  fetch: app.fetch,
};
