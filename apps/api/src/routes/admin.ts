import { pruneOldNotifications } from "@marketing-auto/core/notifications";
import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.ts";

export const adminRoutes = new Hono();
adminRoutes.use(requireAuth);

adminRoutes.post("/prune-notifications", async (c) => {
  const result = await pruneOldNotifications();
  return c.json({ ok: true, data: result });
});
