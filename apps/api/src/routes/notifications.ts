import { zValidator } from "@hono/zod-validator";
import {
  getUnreadCount,
  listNotifications,
  markAllAsRead,
  markAsRead,
  subscribeSse,
} from "@marketing-auto/core/notifications";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";

export const notificationRoutes = new Hono();
notificationRoutes.use(requireAuth);

notificationRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const sinceRaw = c.req.query("since");
  const since = sinceRaw ? new Date(sinceRaw) : undefined;
  const unreadOnly = c.req.query("unreadOnly") === "true";

  const listOpts: { limit: number; unreadOnly: boolean; since?: Date } = { limit, unreadOnly };
  if (since !== undefined) listOpts.since = since;

  const [list, unreadCount] = await Promise.all([
    listNotifications(user.id, listOpts),
    getUnreadCount(user.id),
  ]);

  return c.json({ ok: true, data: { notifications: list, unreadCount } });
});

notificationRoutes.get("/unread-count", async (c) => {
  const user = c.get("user")!;
  const count = await getUnreadCount(user.id);
  return c.json({ ok: true, data: { count } });
});

const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

notificationRoutes.post("/mark-read", zValidator("json", markReadSchema), async (c) => {
  const user = c.get("user")!;
  const { ids } = c.req.valid("json");
  const updated = await markAsRead(user.id, ids);
  return c.json({ ok: true, data: { updated } });
});

notificationRoutes.post("/mark-all-read", async (c) => {
  const user = c.get("user")!;
  const updated = await markAllAsRead(user.id);
  return c.json({ ok: true, data: { updated } });
});

notificationRoutes.get("/stream", async (c) => {
  const user = c.get("user")!;

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: "connected" }), event: "connected" });

    const queue: Array<{ data: string; event: string }> = [];
    const unsubscribe = subscribeSse(user.id, (notification) => {
      queue.push({ data: JSON.stringify(notification), event: "notification" });
    });

    let lastHeartbeat = Date.now();
    try {
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          await stream.writeSSE(item);
        }

        if (Date.now() - lastHeartbeat > 30_000) {
          await stream.writeSSE({
            data: JSON.stringify({ ts: Date.now() }),
            event: "heartbeat",
          });
          lastHeartbeat = Date.now();
        }

        await stream.sleep(500);
      }
    } finally {
      unsubscribe();
    }
  });
});
