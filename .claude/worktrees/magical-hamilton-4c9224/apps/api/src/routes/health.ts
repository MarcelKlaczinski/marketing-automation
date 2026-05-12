import { Hono } from "hono";

export const healthRoutes = new Hono();

const VERSION = "0.1.0";

healthRoutes.get("/", (c) => {
  const uptimeMs = Date.now() - (globalThis.__startTime ?? Date.now());
  return c.json({
    ok: true,
    version: VERSION,
    uptimeSec: Math.floor(uptimeMs / 1000),
    timestamp: new Date().toISOString(),
  });
});
