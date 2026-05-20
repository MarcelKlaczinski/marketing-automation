import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import webpush from "web-push";
import { db, notifications, pushSubscriptions } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";

const log = createLogger("notifications");

const env = getEnv();
const VAPID_PUBLIC = env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = env.VAPID_SUBJECT;

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  log.warn("VAPID keys missing — Web Push disabled");
}

export type NotificationSeverity = "info" | "warning" | "critical";

export interface CreateNotificationOptions {
  userId: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationRow {
  id: string;
  userId: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  link: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

/**
 * Creates a notification, persists it to DB, and dispatches live:
 *   - SSE subscribers (always)
 *   - Web Push subscribers (only if severity === 'critical')
 * Returns immediately after the DB write; live dispatch is fire-and-forget.
 */
export async function createNotification(
  opts: CreateNotificationOptions
): Promise<NotificationRow> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: opts.userId,
      type: opts.type,
      severity: opts.severity,
      title: opts.title,
      message: opts.message,
      link: opts.link ?? null,
      metadata: opts.metadata ?? {},
    })
    .returning();

  if (!row) throw new Error("notification_insert_failed");

  const result: NotificationRow = {
    id: row.id,
    userId: row.userId,
    type: row.type,
    severity: row.severity as NotificationSeverity,
    title: row.title,
    message: row.message,
    link: row.link,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };

  void dispatchToSseSubscribers(result);
  if (result.severity === "critical") {
    void dispatchToWebPushSubscribers(result);
  }

  return result;
}

/**
 * In-memory SSE subscriber registry, keyed by userId.
 * Single-process assumption — multi-process would need Redis pub/sub.
 */
const sseSubscribers = new Map<string, Set<(data: NotificationRow) => void>>();

export function subscribeSse(
  userId: string,
  callback: (data: NotificationRow) => void
): () => void {
  if (!sseSubscribers.has(userId)) sseSubscribers.set(userId, new Set());
  sseSubscribers.get(userId)!.add(callback);
  return () => {
    const set = sseSubscribers.get(userId);
    if (set) {
      set.delete(callback);
      if (set.size === 0) sseSubscribers.delete(userId);
    }
  };
}

async function dispatchToSseSubscribers(notification: NotificationRow): Promise<void> {
  const subscribers = sseSubscribers.get(notification.userId);
  if (!subscribers) return;
  for (const cb of subscribers) {
    try {
      cb(notification);
    } catch (e) {
      log.error({ err: e }, "SSE dispatch error");
    }
  }
}

async function dispatchToWebPushSubscribers(notification: NotificationRow): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, notification.userId));

  if (subs.length === 0) return;

  const payload = JSON.stringify({
    id: notification.id,
    type: notification.type,
    severity: notification.severity,
    title: notification.title,
    message: notification.message,
    link: notification.link,
  });

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date() })
          .where(eq(pushSubscriptions.id, sub.id));
      } catch (e) {
        const statusCode = (e as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          log.info({ subscriptionId: sub.id }, "Removed expired push subscription");
        } else {
          log.error({ err: e }, "Web Push send error");
        }
      }
    })
  );
}

export interface ListNotificationsOptions {
  limit?: number;
  offset?: number;
  since?: Date;
  unreadOnly?: boolean;
}

export async function listNotifications(
  userId: string,
  opts: ListNotificationsOptions = {}
): Promise<{ notifications: NotificationRow[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const filters = [eq(notifications.userId, userId)];
  if (opts.since) filters.push(gte(notifications.createdAt, opts.since));
  if (opts.unreadOnly) filters.push(isNull(notifications.readAt));
  const whereClause = and(...filters);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(whereClause),
  ]);

  return {
    notifications: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      type: r.type,
      severity: r.severity as NotificationSeverity,
      title: r.title,
      message: r.message,
      link: r.link,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    total: countRows[0]?.count ?? 0,
  };
}

export async function markAsRead(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        inArray(notifications.id, ids),
        isNull(notifications.readAt)
      )
    )
    .returning({ id: notifications.id });
  return rows.length;
}

export async function markAllAsRead(userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return result[0]?.count ?? 0;
}

/**
 * Prune old notifications. Intended for daily cron or manual admin trigger.
 * - Read notifications older than 7 days → delete
 * - Unread notifications older than 30 days → delete
 */
export async function pruneOldNotifications(): Promise<{
  readPruned: number;
  unreadPruned: number;
}> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const readRows = await db
    .delete(notifications)
    .where(
      and(
        sql`${notifications.readAt} IS NOT NULL`,
        lt(notifications.readAt, sevenDaysAgo)
      )
    )
    .returning({ id: notifications.id });

  const unreadRows = await db
    .delete(notifications)
    .where(and(isNull(notifications.readAt), lt(notifications.createdAt, thirtyDaysAgo)))
    .returning({ id: notifications.id });

  return {
    readPruned: readRows.length,
    unreadPruned: unreadRows.length,
  };
}

// Spec 62.0a: step-pause notification helper + canonical type constant.
export { notifyStepPaused, STEP_PAUSED_NOTIFICATION_TYPE } from "./step-pause.ts";
