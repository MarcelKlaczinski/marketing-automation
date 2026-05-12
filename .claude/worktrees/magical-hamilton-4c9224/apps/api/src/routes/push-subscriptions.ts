import { zValidator } from "@hono/zod-validator";
import { createNotification } from "@marketing-auto/core/notifications";
import { db, pushSubscriptions } from "@marketing-auto/db";
import { getEnv } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.ts";

export const pushSubscriptionRoutes = new Hono();
pushSubscriptionRoutes.use(requireAuth);

pushSubscriptionRoutes.get("/vapid-public-key", (c) => {
  const key = getEnv().VAPID_PUBLIC_KEY;
  if (!key) return c.json({ ok: false, error: "web_push_not_configured" }, 503);
  return c.json({ ok: true, data: { publicKey: key } });
});

pushSubscriptionRoutes.get("/subscriptions", async (c) => {
  const user = c.get("user")!;
  const subs = await db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      userAgent: pushSubscriptions.userAgent,
      createdAt: pushSubscriptions.createdAt,
      lastUsedAt: pushSubscriptions.lastUsedAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id));

  return c.json({ ok: true, data: subs });
});

const createSubSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().max(512),
    auth: z.string().max(512),
  }),
  userAgent: z.string().max(512).optional(),
});

pushSubscriptionRoutes.post(
  "/subscriptions",
  zValidator("json", createSubSchema),
  async (c) => {
    const user = c.get("user")!;
    const input = c.req.valid("json");

    const existing = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint))
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      await db
        .update(pushSubscriptions)
        .set({
          userId: user.id,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent ?? null,
        })
        .where(eq(pushSubscriptions.id, existing.id));
      return c.json({ ok: true, data: { id: existing.id, updated: true } });
    }

    const insertValues: typeof pushSubscriptions.$inferInsert = {
      userId: user.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent ?? null,
    };
    const [created] = await db
      .insert(pushSubscriptions)
      .values(insertValues)
      .returning({ id: pushSubscriptions.id });

    return c.json({ ok: true, data: { id: created!.id, updated: false } }, 201);
  }
);

pushSubscriptionRoutes.delete("/subscriptions/:id", async (c) => {
  const user = c.get("user")!;
  const id = c.req.param("id");

  const deleted = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, user.id)))
    .returning({ id: pushSubscriptions.id });

  if (deleted.length === 0) {
    return c.json({ ok: false, error: "subscription_not_found" }, 404);
  }
  return c.json({ ok: true, data: { id } });
});

pushSubscriptionRoutes.post("/test", async (c) => {
  const user = c.get("user")!;
  await createNotification({
    userId: user.id,
    type: "test",
    severity: "critical",
    title: "Test-Push",
    message: "Wenn du das siehst, funktionieren Push-Notifications korrekt.",
  });
  return c.json({ ok: true, data: { sent: true } });
});
