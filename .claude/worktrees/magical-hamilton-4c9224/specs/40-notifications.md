# Spec 40: Notifications System (In-App + Web Push)

**Phase:** 4 (Welle 4 — nach Spec 42 Stabilization)
**Estimated Effort:** 2.5-3 days (3 sessions)
**Dependencies:** Spec 42 (clean codebase + DB), Spec 41 (cost enforcement triggers notifications), Spec 30/31 (auth + shell)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (cross-cutting: backend SSE + Web Push + frontend service-worker; multiple integration points)

---

## Goal

Build a **two-channel notifications system**:

1. **In-App Panel** (primary, always-on): bell icon in MainLayout header, dropdown panel with notifications list. Live-updates via Server-Sent Events when the tab is open. Source of truth.
2. **Web Push** (secondary, opt-in): browser-native push notifications for critical events even when tab is closed. User opts in via Settings. Subscription management UI shows active devices.

Both channels read from a single `notifications` table. Backend `createNotification()` helper writes to DB → optionally fans out to SSE-connected clients + Web Push subscribers based on event severity.

After this spec:
- Marcel sees pipeline failures, cost-limit alerts, and completion events the moment they happen
- He can keep his browser tab closed and still get push notifications for critical issues (cost-limit-pause)
- He can manage push subscriptions per device (active devices listed, can revoke individual ones)

## Architecture Decisions

**Decision 1: Single `notifications` table as source of truth.**
All events — pipeline failures, cost alerts, sync completions — write to one table. Both UI channels (in-app panel, Web Push) read from this table. Web Push is just an additional fan-out target, not a separate event stream.

**Decision 2: SSE (Server-Sent Events) for in-app live updates.**
WebSocket alternatives considered and rejected:
- WebSocket needs bidirectional protocol — overkill (we only push from server)
- SSE works over plain HTTPS, no upgrade dance, automatic reconnect built-in
- SSE plays nicely with Hono via `streamSSE` helper

The `/api/notifications/stream` endpoint streams events to the connected user's tab. When Marcel has multiple tabs open, each gets its own stream. No shared worker.

**Decision 3: Web Push only for `severity = 'critical'` events.**
Not every notification deserves a browser push. Default rule:
- `info` (pipeline completion, sync success) → in-app only
- `warning` (cost alert at 80%) → in-app only by default, opt-in for push per type later
- `critical` (cost-limit pause, pipeline failure, sync failure) → in-app + Web Push (if user has subscribed)

Severity is a column on `notifications`. The fan-out logic checks severity before calling `web-push`.

**Decision 4: Subscription is per-device, not per-user.**
Each browser instance (laptop Chrome, phone Safari, etc.) creates its own subscription with its own endpoint URL. The `push_subscriptions` table already exists in the schema with `userId` + `endpoint` + `userAgent`.

The Settings UI lists subscriptions with their UA-derived device label ("Chrome on macOS", "Safari on iPhone") and a per-row revoke button.

**Decision 5: VAPID keys generated once, stored in env.**
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:marcel@...
```

Generated via `bunx web-push generate-vapid-keys` once during deploy. Public key is exposed to the frontend (it's safe). Private key stays server-side.

**Decision 6: `web-push` library on backend.**
Mature, well-maintained, handles VAPID auth + payload encryption. No reason to roll our own.

**Decision 7: Service Worker registers on Settings-toggle, not at app boot.**
The SW file (`public/push-service-worker.js`) exists in the build. It's only registered when the user explicitly enables push notifications in Settings. Avoids unwanted permission prompts.

**Decision 8: Notification click navigates to the relevant page.**
Each notification has a `link` field (e.g., `/articles/abc-123`, `/cost`, `/projects/ki-wissensraum/clusters`). Click in panel → navigate. Click on Web Push → focus existing tab + navigate, or open new tab.

**Decision 9: Auto-mark-as-read on click; mark-all-as-read button in panel.**
Read state lives on the notification row (`readAt` timestamp). Unread count is computed on the fly.

**Decision 10: Notifications pruned after 30 days.**
A daily cron deletes notifications older than 30 days. Keeps the table small. Read notifications are pruned at 7 days, unread at 30 days.

**Decision 11: SSE polling-fallback if connection drops.**
SSE has built-in auto-reconnect. If reconnect fails (server down for >30s), the in-app panel falls back to polling `/api/notifications?since=...` every 30s. When SSE is back, polling stops. Done via the composable's internal state.

**Decision 12: Local development works with `localhost`.**
Browsers permit Service Workers + Push Subscriptions on `localhost` even without HTTPS. No special setup. Web Push from local server to Mozilla/Google/Apple push services works as long as outbound HTTPS is allowed (typical).

**Important caveat: subscription endpoints created on `localhost` are tied to that origin. When Marcel deploys to production:**
- All localhost-created subscriptions become invalid
- DB cleanup: `DELETE FROM push_subscriptions WHERE endpoint LIKE '%localhost%'` (or just truncate table on first deploy)
- Documented in deploy-checklist (added to CLAUDE.md by this spec)

## Non-Goals

- **No notification grouping / digest** — one notification per event, no "5 articles ready" rollups (defer if it becomes noisy)
- **No notification settings beyond on/off** — no per-event-type opt-in (e.g., "only push for cost alerts, not failures"). Single toggle for v1.
- **No email fallback** — if Web Push fails or user doesn't subscribe, it's just in-app
- **No notification sound customization** — browser default
- **No notification badge for app icon** (PWA Badging API) — out of scope
- **No `push_events` debug log** — keeping table count small. If push delivery debugging becomes needed later, add then.
- **No SSE for cross-user / broadcast notifications** — single-user system, every notification is for `userId`
- **No mark-as-read pagination** — list endpoint returns last 50, that's enough

## Detailed Implementation

### Schema Migration

The `push_subscriptions` table already exists from earlier specs. We add the `notifications` table.

`packages/db/migrations/000Z_notifications.sql`:

```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  type text NOT NULL,              -- e.g., 'cost_limit_pause', 'pipeline_failure', 'sync_success'
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

  title text NOT NULL,
  message text NOT NULL,

  link text,                       -- e.g., '/articles/abc-123', '/cost', null = no navigation
  metadata jsonb DEFAULT '{}'::jsonb,  -- per-type extra data (article_id, project_id, etc.)

  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
```

Update `packages/db/src/schema/operations.ts` (or new `notifications.ts` file in schema) to export the new table.

### Backend: Core Notification Module

`packages/core/src/notifications/index.ts`:

```typescript
import { eq, and, isNull, lt, gte, desc, inArray, sql } from 'drizzle-orm';
import { db, notifications, pushSubscriptions, users } from '@marketing-auto/db';
import webpush from 'web-push';

// Configure VAPID at module load
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
} else {
  console.warn('[notifications] VAPID keys missing — Web Push disabled');
}

export type NotificationSeverity = 'info' | 'warning' | 'critical';

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
 * Creates a notification, persists it, and dispatches to live channels:
 *   - SSE subscribers (always)
 *   - Web Push subscribers (only if severity === 'critical')
 *
 * Non-blocking from caller's perspective: returns once DB row is written.
 * Live dispatch happens in the background; failures are logged but don't throw.
 */
export async function createNotification(opts: CreateNotificationOptions): Promise<NotificationRow> {
  const [row] = await db.insert(notifications).values({
    userId: opts.userId,
    type: opts.type,
    severity: opts.severity,
    title: opts.title,
    message: opts.message,
    link: opts.link ?? null,
    metadata: opts.metadata ?? {},
  }).returning();

  if (!row) throw new Error('notification_insert_failed');

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

  // Fire-and-forget live dispatch
  void dispatchToSseSubscribers(result);
  if (result.severity === 'critical') {
    void dispatchToWebPushSubscribers(result);
  }

  return result;
}

/**
 * In-memory registry of SSE subscribers per userId.
 * For multi-process deployments, this would need Redis pub/sub — out of scope for this spec
 * (Marcel runs single-process locally and on the planned single-server deploy).
 */
const sseSubscribers = new Map<string, Set<(data: NotificationRow) => void>>();

export function subscribeSse(userId: string, callback: (data: NotificationRow) => void): () => void {
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
      console.error('[notifications] SSE dispatch error:', e);
    }
  }
}

async function dispatchToWebPushSubscribers(notification: NotificationRow): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const subs = await db.select()
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

  await Promise.allSettled(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
      );
      // Update last-used timestamp
      await db.update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
    } catch (e) {
      const statusCode = (e as { statusCode?: number }).statusCode;
      if (statusCode === 410 || statusCode === 404) {
        // Subscription expired or invalid — remove from DB
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        console.info('[notifications] Removed expired push subscription:', sub.id);
      } else {
        console.error('[notifications] Push send error:', e);
      }
    }
  }));
}

/**
 * List recent notifications for a user, optionally filtered by since timestamp.
 */
export async function listNotifications(
  userId: string,
  opts: { limit?: number; since?: Date; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const limit = opts.limit ?? 50;
  const filters = [eq(notifications.userId, userId)];
  if (opts.since) filters.push(gte(notifications.createdAt, opts.since));
  if (opts.unreadOnly) filters.push(isNull(notifications.readAt));

  const rows = await db.select()
    .from(notifications)
    .where(and(...filters))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((r) => ({
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
  }));
}

export async function markAsRead(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId),
      inArray(notifications.id, ids),
      isNull(notifications.readAt),
    ));
  return result.rowCount ?? 0;
}

export async function markAllAsRead(userId: string): Promise<number> {
  const result = await db.update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
    ));
  return result.rowCount ?? 0;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      isNull(notifications.readAt),
    ));
  return row?.count ?? 0;
}

/**
 * Prune old notifications. Run via daily cron.
 * - Read notifications: 7+ days
 * - Unread: 30+ days
 */
export async function pruneOldNotifications(): Promise<{ readPruned: number; unreadPruned: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const readResult = await db.delete(notifications)
    .where(and(
      // readAt non-null and old
      sql`${notifications.readAt} IS NOT NULL`,
      lt(notifications.readAt, sevenDaysAgo),
    ));

  const unreadResult = await db.delete(notifications)
    .where(and(
      isNull(notifications.readAt),
      lt(notifications.createdAt, thirtyDaysAgo),
    ));

  return {
    readPruned: readResult.rowCount ?? 0,
    unreadPruned: unreadResult.rowCount ?? 0,
  };
}
```

### Backend: HTTP Routes for Notifications

`apps/api/src/routes/notifications.ts`:

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  subscribeSse,
} from '@marketing-auto/core/notifications';
import { requireAuth } from '../middleware/auth';

export const notificationRoutes = new Hono();
notificationRoutes.use(requireAuth);

notificationRoutes.get('/', async (c) => {
  const user = c.get('user') as { id: string };
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const since = c.req.query('since') ? new Date(c.req.query('since')!) : undefined;
  const unreadOnly = c.req.query('unreadOnly') === 'true';

  const list = await listNotifications(user.id, { limit, since, unreadOnly });
  const unreadCount = await getUnreadCount(user.id);

  return c.json({
    ok: true,
    data: { notifications: list, unreadCount },
  });
});

notificationRoutes.get('/unread-count', async (c) => {
  const user = c.get('user') as { id: string };
  const count = await getUnreadCount(user.id);
  return c.json({ ok: true, data: { count } });
});

const markReadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

notificationRoutes.post('/mark-read', zValidator('json', markReadSchema), async (c) => {
  const user = c.get('user') as { id: string };
  const { ids } = c.req.valid('json');
  const updated = await markAsRead(user.id, ids);
  return c.json({ ok: true, data: { updated } });
});

notificationRoutes.post('/mark-all-read', async (c) => {
  const user = c.get('user') as { id: string };
  const updated = await markAllAsRead(user.id);
  return c.json({ ok: true, data: { updated } });
});

notificationRoutes.get('/stream', async (c) => {
  const user = c.get('user') as { id: string };

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ type: 'connected' }), event: 'connected' });

    const queue: Array<{ data: string; event: string }> = [];
    const unsubscribe = subscribeSse(user.id, (notification) => {
      queue.push({
        data: JSON.stringify(notification),
        event: 'notification',
      });
    });

    let lastHeartbeat = Date.now();
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        while (queue.length > 0) {
          const item = queue.shift()!;
          await stream.writeSSE(item);
        }

        if (Date.now() - lastHeartbeat > 30_000) {
          await stream.writeSSE({ data: JSON.stringify({ ts: Date.now() }), event: 'heartbeat' });
          lastHeartbeat = Date.now();
        }

        await stream.sleep(500);
      }
    } finally {
      unsubscribe();
    }
  });
});
```

Mount in `apps/api/src/server.ts`:
```typescript
app.route('/api/notifications', notificationRoutes);
```

### Backend: HTTP Routes for Push Subscriptions

`apps/api/src/routes/push-subscriptions.ts`:

```typescript
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, pushSubscriptions } from '@marketing-auto/db';
import { requireAuth } from '../middleware/auth';

export const pushSubscriptionRoutes = new Hono();
pushSubscriptionRoutes.use(requireAuth);

pushSubscriptionRoutes.get('/vapid-public-key', (c) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return c.json({ ok: false, error: 'web_push_not_configured' }, 503);
  }
  return c.json({ ok: true, data: { publicKey: key } });
});

pushSubscriptionRoutes.get('/subscriptions', async (c) => {
  const user = c.get('user') as { id: string };
  const subs = await db.select({
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

pushSubscriptionRoutes.post('/subscriptions', zValidator('json', createSubSchema), async (c) => {
  const user = c.get('user') as { id: string };
  const input = c.req.valid('json');

  const [existing] = await db.select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, input.endpoint))
    .limit(1);

  if (existing) {
    await db.update(pushSubscriptions)
      .set({
        userId: user.id,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      })
      .where(eq(pushSubscriptions.id, existing.id));
    return c.json({ ok: true, data: { id: existing.id, updated: true } });
  }

  const [created] = await db.insert(pushSubscriptions).values({
    userId: user.id,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    userAgent: input.userAgent ?? null,
  }).returning({ id: pushSubscriptions.id });

  return c.json({ ok: true, data: { id: created!.id, updated: false } }, 201);
});

pushSubscriptionRoutes.delete('/subscriptions/:id', async (c) => {
  const user = c.get('user') as { id: string };
  const id = c.req.param('id');

  const result = await db.delete(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.id, id),
      eq(pushSubscriptions.userId, user.id),
    ));

  if ((result.rowCount ?? 0) === 0) {
    return c.json({ ok: false, error: 'subscription_not_found' }, 404);
  }
  return c.json({ ok: true, data: { id } });
});

pushSubscriptionRoutes.post('/test', async (c) => {
  const user = c.get('user') as { id: string };
  const { createNotification } = await import('@marketing-auto/core/notifications');
  await createNotification({
    userId: user.id,
    type: 'test',
    severity: 'critical',
    title: 'Test-Push',
    message: 'Wenn du das siehst, funktionieren Push-Notifications korrekt.',
  });
  return c.json({ ok: true, data: { sent: true } });
});
```

Mount in `apps/api/src/server.ts`:
```typescript
app.route('/api/push', pushSubscriptionRoutes);
```

### Backend: Wire Notification Triggers Into Existing Code

#### Cost-limit pause notification (replaces F-008 TODO)

`packages/core/src/cost/pause.ts` — extend `pauseProjectQueues`:

```typescript
import { createNotification } from '../notifications';
import { eq } from 'drizzle-orm';
import { db, projects, users } from '@marketing-auto/db';

export async function pauseProjectQueues(
  projectId: string,
  reason: string,
  reasonDetails: Record<string, unknown>,
  service: string | null,
  pausedBy?: string,
): Promise<void> {
  // ... existing pause logic (UPSERT pause-state, queue.pause()) ...

  // After pausing, notify all owners of the project
  const owners = await db.select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'owner'));

  const [project] = await db.select({ slug: projects.slug, name: projects.name })
    .from(projects).where(eq(projects.id, projectId)).limit(1);

  for (const owner of owners) {
    await createNotification({
      userId: owner.id,
      type: 'cost_limit_pause',
      severity: 'critical',
      title: 'Projekt-Pipeline pausiert',
      message: `${project?.name ?? 'Projekt'} pausiert wegen Kostenlimit (${service ?? 'unbekannt'}).`,
      link: project?.slug ? `/projects/${project.slug}` : '/cost',
      metadata: { projectId, reason, service, ...reasonDetails },
    });
  }
}
```

This **replaces** the `// TODO Spec 41: send Web Push notification` at `packages/cost-tracker/src/tracker.ts:43`. Remove the TODO comment.

#### Cost-alert notification (warning level)

`packages/core/src/cost/enforcement.ts` — extend `maybeRecordAlert`:

```typescript
async function maybeRecordAlert(
  projectId: string,
  service: string,
  thresholdType: 'daily' | 'monthly',
  limitEur: number,
  spentEur: number,
  percent: number,
): Promise<void> {
  // ... existing dedup + insert logic ...

  // Notify owner (warning level — in-app only, not Web Push)
  const [project] = await db.select({ slug: projects.slug, name: projects.name })
    .from(projects).where(eq(projects.id, projectId)).limit(1);

  const owners = await db.select({ id: users.id })
    .from(users).where(eq(users.role, 'owner'));

  for (const owner of owners) {
    await createNotification({
      userId: owner.id,
      type: 'cost_alert',
      severity: 'warning',
      title: `Kostenwarnung ${Math.round(percent)}%`,
      message: `${service} ${thresholdType}: € ${spentEur.toFixed(2)} von € ${limitEur.toFixed(2)} (${project?.name ?? projectId})`,
      link: `/cost?projectId=${projectId}`,
      metadata: { projectId, service, thresholdType, percent },
    });
  }
}
```

#### Pipeline failure notification

`packages/pipelines/src/engine/worker.ts` (or wherever the BullMQ `failed` handler lives):

```typescript
import { createNotification } from '@marketing-auto/core/notifications';

queue.on('failed', async (job, err) => {
  // ... existing pipeline_runs status update ...

  // Skip cost-limit failures (already covered by pause notification)
  if (err.message?.startsWith('cost_limit_exceeded')) return;

  const projectId = job.data.projectId;
  if (!projectId) return;

  const owners = await db.select({ id: users.id })
    .from(users).where(eq(users.role, 'owner'));

  const articleId = job.data.articleId;
  const link = articleId ? `/articles/${articleId}` : `/activity`;

  for (const owner of owners) {
    await createNotification({
      userId: owner.id,
      type: 'pipeline_failure',
      severity: 'critical',
      title: 'Pipeline fehlgeschlagen',
      message: `${job.data.pipelineName ?? 'Pipeline'}: ${err.message?.slice(0, 200) ?? 'Unbekannter Fehler'}`,
      link,
      metadata: { pipelineName: job.data.pipelineName, articleId, error: err.message },
    });
  }
});
```

#### Pipeline completion notification (info level)

```typescript
queue.on('completed', async (job) => {
  // Only notify for "user-meaningful" completions
  const meaningful = [
    'article:outline',
    'article:draft',
    'article:sync',
    'cold-start:cluster-plan',
    'cold-start:cornerstone-spec',
  ];
  if (!meaningful.includes(job.data.pipelineName)) return;

  const projectId = job.data.projectId;
  if (!projectId) return;

  const owners = await db.select({ id: users.id })
    .from(users).where(eq(users.role, 'owner'));

  const articleId = job.data.articleId;
  const link = articleId ? `/articles/${articleId}` : `/activity`;

  for (const owner of owners) {
    await createNotification({
      userId: owner.id,
      type: 'pipeline_completion',
      severity: 'info',
      title: notificationTitleFor(job.data.pipelineName),
      message: notificationMessageFor(job.data.pipelineName),
      link,
      metadata: { pipelineName: job.data.pipelineName, articleId },
    });
  }
});

function notificationTitleFor(pipelineName: string): string {
  const map: Record<string, string> = {
    'article:outline': 'Outline fertig',
    'article:draft': 'Draft fertig',
    'article:sync': 'Astro-Sync abgeschlossen',
    'cold-start:cluster-plan': 'Cluster-Plan fertig',
    'cold-start:cornerstone-spec': 'Cornerstone-Specs fertig',
  };
  return map[pipelineName] ?? 'Pipeline fertig';
}

function notificationMessageFor(pipelineName: string): string {
  return `${pipelineName} erfolgreich abgeschlossen.`;
}
```

#### Sync + PageSpeed failure notifications

`packages/pipelines/src/article/sync.ts`:

```typescript
import { createNotification } from '@marketing-auto/core/notifications';

// In the catch / error path:
const owners = await db.select({ id: users.id })
  .from(users).where(eq(users.role, 'owner'));

for (const owner of owners) {
  await createNotification({
    userId: owner.id,
    type: 'sync_failure',
    severity: 'critical',
    title: 'Astro-Sync fehlgeschlagen',
    message: errorMessage.slice(0, 200),
    link: `/articles/${articleId}`,
    metadata: { articleId, errorStage },
  });
}
```

PageSpeed failure is `severity: 'warning'` (in-app only) since failed PageSpeed isn't catastrophic — Marcel can review and re-run.

### Backend: Daily Pruning Endpoint

`apps/api/src/routes/admin.ts` (extend if exists, otherwise create):

```typescript
import { pruneOldNotifications } from '@marketing-auto/core/notifications';

// admin auth middleware required — assumes you have one
adminRoutes.post('/prune-notifications', async (c) => {
  const result = await pruneOldNotifications();
  return c.json({ ok: true, data: result });
});
```

For initial deploy, run manually weekly. Cron-ify in a future spec when BullMQ scheduled jobs are introduced.

### Frontend: Service Worker

`apps/web/public/push-service-worker.js`:

```javascript
// Service Worker for Web Push notifications
// Served at /push-service-worker.js by Quasar's static asset handling

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Notification', message: event.data.text() };
  }

  const title = payload.title || 'Notification';
  const options = {
    body: payload.message,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: payload.id || payload.type, // dedupe
    data: {
      link: payload.link,
      id: payload.id,
      type: payload.type,
    },
    requireInteraction: payload.severity === 'critical',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const link = event.notification.data?.link;
  if (!link) return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(link);
      }
    }),
  );
});
```

Generate placeholder icons at `apps/web/public/icons/icon-192.png` (192x192 px, primary-color circle) and `badge-72.png` (72x72 px). Replace with proper branding later.

### Frontend: Notifications Store

`apps/web/src/stores/notifications.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface NotificationRow {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  link: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsState {
  list: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  sseConnected: boolean;
}

export const useNotificationsStore = defineStore('notifications', {
  state: (): NotificationsState => ({
    list: [],
    unreadCount: 0,
    loading: false,
    sseConnected: false,
  }),

  actions: {
    async fetchList(): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: { notifications: NotificationRow[]; unreadCount: number } }>(
          '/notifications?limit=50',
        );
        this.list = res.data.data.notifications;
        this.unreadCount = res.data.data.unreadCount;
      } finally {
        this.loading = false;
      }
    },

    async fetchUnreadCount(): Promise<void> {
      const res = await api.get<{ ok: boolean; data: { count: number } }>('/notifications/unread-count');
      this.unreadCount = res.data.data.count;
    },

    async markAsRead(ids: string[]): Promise<void> {
      await api.post('/notifications/mark-read', { ids });
      for (const id of ids) {
        const n = this.list.find((x) => x.id === id);
        if (n && !n.readAt) {
          n.readAt = new Date().toISOString();
        }
      }
      await this.fetchUnreadCount();
    },

    async markAllAsRead(): Promise<void> {
      await api.post('/notifications/mark-all-read');
      const now = new Date().toISOString();
      for (const n of this.list) {
        if (!n.readAt) n.readAt = now;
      }
      this.unreadCount = 0;
    },

    /** Called by SSE composable when new notification arrives */
    addLive(n: NotificationRow): void {
      this.list.unshift(n);
      if (this.list.length > 100) this.list.pop();
      if (!n.readAt) this.unreadCount += 1;
    },

    setSseConnected(connected: boolean): void {
      this.sseConnected = connected;
    },
  },
});
```

### Frontend: SSE Composable

`apps/web/src/composables/useNotificationStream.ts`:

```typescript
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useNotificationsStore, type NotificationRow } from 'src/stores/notifications';

export function useNotificationStream(): { connected: ReturnType<typeof ref<boolean>> } {
  const store = useNotificationsStore();
  const connected = ref(false);

  let eventSource: EventSource | null = null;
  let pollingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectAttempts = 0;
  let stopped = false;

  function startSse(): void {
    if (stopped) return;
    if (eventSource) return;

    eventSource = new EventSource('/api/notifications/stream', { withCredentials: true });

    eventSource.addEventListener('connected', () => {
      connected.value = true;
      store.setSseConnected(true);
      reconnectAttempts = 0;
      stopPolling();
    });

    eventSource.addEventListener('notification', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as NotificationRow;
        store.addLive(data);
      } catch (e) {
        console.error('[notifications] Failed to parse SSE message:', e);
      }
    });

    eventSource.addEventListener('heartbeat', () => {
      // Connection healthy
    });

    eventSource.addEventListener('error', () => {
      connected.value = false;
      store.setSseConnected(false);
      reconnectAttempts += 1;
      if (reconnectAttempts >= 3) {
        eventSource?.close();
        eventSource = null;
        startPolling();
      }
    });
  }

  function startPolling(): void {
    if (pollingTimer) return;
    pollingTimer = setInterval(() => {
      void store.fetchList();
      if (!eventSource && reconnectAttempts < 10) {
        reconnectAttempts = 0;
        startSse();
      }
    }, 30_000);
  }

  function stopPolling(): void {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  }

  function stopAll(): void {
    stopped = true;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    stopPolling();
    connected.value = false;
    store.setSseConnected(false);
  }

  onMounted(() => {
    void store.fetchList();
    startSse();
  });

  onBeforeUnmount(() => {
    stopAll();
  });

  return { connected };
}
```

### Frontend: NotificationBell + MainLayout Integration

Add `<NotificationBell />` to `MainLayout.vue` header before user menu.

`apps/web/src/components/notifications/NotificationBell.vue`:

```vue
<template>
  <q-btn flat round dense :icon="bellIcon">
    <q-badge v-if="unreadCount > 0" color="negative" floating>
      {{ displayCount }}
    </q-badge>

    <q-menu anchor="bottom right" self="top right" max-height="600px">
      <div class="bell-menu">
        <div class="bell-menu__header">
          <span class="text-subtitle1">{{ $t('notifications.title') }}</span>
          <q-space />
          <q-btn
            v-if="unreadCount > 0"
            flat
            dense
            size="sm"
            :label="$t('notifications.markAllRead') as string"
            @click="onMarkAllRead"
          />
        </div>

        <q-separator />

        <div v-if="loading && list.length === 0" class="text-center q-pa-md">
          <q-spinner size="2em" />
        </div>

        <div v-else-if="list.length === 0" class="text-center q-pa-xl text-grey-7">
          <q-icon name="notifications_off" size="48px" color="grey-5" />
          <div class="q-mt-md">{{ $t('notifications.empty') }}</div>
        </div>

        <q-list v-else separator>
          <q-item
            v-for="n in list"
            :key="n.id"
            clickable
            :class="['notification-item', { 'notification-item--unread': !n.readAt }]"
            @click="onClickItem(n)"
          >
            <q-item-section avatar>
              <q-icon :name="iconFor(n)" :color="colorFor(n)" size="20px" />
            </q-item-section>
            <q-item-section>
              <q-item-label>{{ n.title }}</q-item-label>
              <q-item-label caption lines="2">{{ n.message }}</q-item-label>
              <q-item-label caption class="notification-item__time">
                {{ relativeTime(n.createdAt) }}
              </q-item-label>
            </q-item-section>
            <q-item-section v-if="!n.readAt" side>
              <div class="unread-dot" />
            </q-item-section>
          </q-item>
        </q-list>

        <q-separator />

        <div class="bell-menu__footer">
          <q-btn flat size="sm" :label="$t('notifications.viewSettings') as string" :to="{ name: 'settings', query: { tab: 'notifications' } }" />
          <q-space />
          <span v-if="!sseConnected" class="text-caption text-warning">
            <q-icon name="sync_problem" size="14px" />
            {{ $t('notifications.disconnected') }}
          </span>
        </div>
      </div>
    </q-menu>
  </q-btn>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useNotificationsStore, type NotificationRow } from 'src/stores/notifications';
import { useNotificationStream } from 'src/composables/useNotificationStream';

const SEVERITY_ICONS: Record<string, string> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
};
const SEVERITY_COLORS: Record<string, string> = {
  info: 'primary',
  warning: 'warning',
  critical: 'negative',
};

export default defineComponent({
  name: 'NotificationBell',

  setup() {
    const stream = useNotificationStream();
    return {
      store: useNotificationsStore(),
      sseConnected: stream.connected,
    };
  },

  computed: {
    list(): NotificationRow[] {
      return this.store.list;
    },
    unreadCount(): number {
      return this.store.unreadCount;
    },
    loading(): boolean {
      return this.store.loading;
    },
    bellIcon(): string {
      return this.unreadCount > 0 ? 'notifications_active' : 'notifications';
    },
    displayCount(): string {
      return this.unreadCount > 99 ? '99+' : String(this.unreadCount);
    },
  },

  methods: {
    iconFor(n: NotificationRow): string {
      return SEVERITY_ICONS[n.severity] ?? 'notifications';
    },
    colorFor(n: NotificationRow): string {
      return SEVERITY_COLORS[n.severity] ?? 'grey';
    },
    relativeTime(iso: string): string {
      const ms = Date.now() - new Date(iso).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return this.$t('notifications.relative.justNow') as string;
      const m = Math.round(s / 60);
      if (m < 60) return this.$t('notifications.relative.minutesAgo', { n: m }) as string;
      const h = Math.round(m / 60);
      if (h < 24) return this.$t('notifications.relative.hoursAgo', { n: h }) as string;
      const d = Math.round(h / 24);
      return this.$t('notifications.relative.daysAgo', { n: d }) as string;
    },
    async onClickItem(n: NotificationRow): Promise<void> {
      if (!n.readAt) {
        await this.store.markAsRead([n.id]);
      }
      if (n.link) {
        void this.$router.push(n.link);
      }
    },
    async onMarkAllRead(): Promise<void> {
      await this.store.markAllAsRead();
    },
  },
});
</script>

<style lang="scss" scoped>
.bell-menu {
  width: 380px;
  display: flex;
  flex-direction: column;
}

.bell-menu__header,
.bell-menu__footer {
  display: flex;
  align-items: center;
  padding: 10px 16px;
}

.notification-item {
  &--unread {
    background: rgba(63, 81, 181, 0.04);

    body.body--dark & {
      background: rgba(63, 81, 181, 0.12);
    }
  }
}

.notification-item__time {
  margin-top: 2px;
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.45));
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--q-primary);
}
</style>
```

### Frontend: Push Subscription Composable

`apps/web/src/composables/usePushSubscription.ts`:

```typescript
import { ref, onMounted } from 'vue';
import { api } from 'src/lib/api-client';

export interface PushSubscriptionInfo {
  id: string;
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export type PushPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function usePushSubscription() {
  const supported = ref(false);
  const permission = ref<PushPermissionState>('default');
  const isSubscribed = ref(false);
  const subscriptions = ref<PushSubscriptionInfo[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function checkSupport(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function refresh(): Promise<void> {
    if (!checkSupport()) {
      supported.value = false;
      permission.value = 'unsupported';
      return;
    }
    supported.value = true;
    permission.value = Notification.permission as PushPermissionState;

    const reg = await navigator.serviceWorker.getRegistration('/push-service-worker.js');
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      isSubscribed.value = sub !== null;
    } else {
      isSubscribed.value = false;
    }

    try {
      const res = await api.get<{ ok: boolean; data: PushSubscriptionInfo[] }>('/push/subscriptions');
      subscriptions.value = res.data.data;
    } catch (e) {
      console.error('[push] Failed to fetch subscriptions:', e);
    }
  }

  async function subscribe(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await Notification.requestPermission();
      permission.value = result as PushPermissionState;
      if (result !== 'granted') {
        error.value = 'permission_denied';
        return;
      }

      const reg = await navigator.serviceWorker.register('/push-service-worker.js');
      await navigator.serviceWorker.ready;

      const keyRes = await api.get<{ ok: boolean; data: { publicKey: string } }>('/push/vapid-public-key');
      const vapidPublicKey = keyRes.data.data.publicKey;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subJson = sub.toJSON();
      await api.post('/push/subscriptions', {
        endpoint: subJson.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        },
        userAgent: navigator.userAgent,
      });

      isSubscribed.value = true;
      await refresh();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'subscribe_failed';
      console.error('[push] Subscribe failed:', e);
    } finally {
      loading.value = false;
    }
  }

  async function unsubscribeCurrent(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const reg = await navigator.serviceWorker.getRegistration('/push-service-worker.js');
      if (!reg) {
        isSubscribed.value = false;
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        isSubscribed.value = false;
        return;
      }

      const endpoint = sub.endpoint;
      await sub.unsubscribe();

      const matching = subscriptions.value.find((s) => s.endpoint === endpoint);
      if (matching) {
        await api.delete(`/push/subscriptions/${matching.id}`);
      }

      isSubscribed.value = false;
      await refresh();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'unsubscribe_failed';
    } finally {
      loading.value = false;
    }
  }

  async function deleteSubscription(id: string): Promise<void> {
    loading.value = true;
    try {
      await api.delete(`/push/subscriptions/${id}`);
      await refresh();
    } finally {
      loading.value = false;
    }
  }

  async function sendTest(): Promise<void> {
    await api.post('/push/test');
  }

  onMounted(() => {
    void refresh();
  });

  return {
    supported,
    permission,
    isSubscribed,
    subscriptions,
    loading,
    error,
    refresh,
    subscribe,
    unsubscribeCurrent,
    deleteSubscription,
    sendTest,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}
```

### Frontend: NotificationsTab in Settings

Add a new tab in the Settings page (Spec 33). The tab content lives in:

`apps/web/src/components/settings/NotificationsTab.vue`:

```vue
<template>
  <div class="notifications-tab">
    <h3 class="text-h6">{{ $t('settings.notifications.title') }}</h3>
    <p class="text-body2 q-mb-md">{{ $t('settings.notifications.intro') }}</p>

    <q-card flat bordered class="q-mb-lg">
      <q-card-section>
        <div v-if="!supported">
          <q-icon name="block" color="grey" size="24px" />
          <div class="text-body2 q-mt-sm">{{ $t('settings.notifications.unsupported') }}</div>
        </div>

        <div v-else>
          <div class="row items-center">
            <q-icon
              :name="isSubscribed ? 'notifications_active' : 'notifications_off'"
              :color="isSubscribed ? 'positive' : 'grey'"
              size="24px"
            />
            <div class="q-ml-md">
              <div class="text-body2">
                {{ isSubscribed ? $t('settings.notifications.enabled') : $t('settings.notifications.disabled') }}
              </div>
              <div v-if="permission === 'denied'" class="text-caption text-negative">
                {{ $t('settings.notifications.permissionDenied') }}
              </div>
            </div>

            <q-space />

            <q-btn
              v-if="!isSubscribed && permission !== 'denied'"
              color="primary"
              :label="$t('settings.notifications.enable') as string"
              :loading="loading"
              @click="onEnable"
            />
            <q-btn
              v-else-if="isSubscribed"
              outline
              :label="$t('settings.notifications.disable') as string"
              :loading="loading"
              @click="onDisable"
            />
          </div>

          <div v-if="isSubscribed" class="q-mt-md">
            <q-btn flat size="sm" icon="campaign" :label="$t('settings.notifications.sendTest') as string" @click="onSendTest" />
          </div>
        </div>
      </q-card-section>
    </q-card>

    <h4 class="text-subtitle1">{{ $t('settings.notifications.activeDevices') }}</h4>

    <q-list bordered separator>
      <q-item v-for="sub in subscriptions" :key="sub.id">
        <q-item-section avatar>
          <q-icon :name="deviceIcon(sub.userAgent)" size="24px" />
        </q-item-section>
        <q-item-section>
          <q-item-label>{{ deviceLabel(sub.userAgent) }}</q-item-label>
          <q-item-label caption>
            {{ $t('settings.notifications.subscribedAt', { time: formatTime(sub.createdAt) }) }}
            <span v-if="sub.lastUsedAt">
              · {{ $t('settings.notifications.lastUsed', { time: formatTime(sub.lastUsedAt) }) }}
            </span>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-btn flat dense icon="delete" color="negative" @click="onDelete(sub.id)">
            <q-tooltip>{{ $t('settings.notifications.revoke') }}</q-tooltip>
          </q-btn>
        </q-item-section>
      </q-item>

      <q-item v-if="subscriptions.length === 0">
        <q-item-section class="text-grey-7 text-center q-pa-md">
          {{ $t('settings.notifications.noDevices') }}
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { usePushSubscription } from 'src/composables/usePushSubscription';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';

export default defineComponent({
  name: 'NotificationsTab',

  setup() {
    return { ...usePushSubscription(), notify: useNotify() };
  },

  methods: {
    deviceIcon(ua: string | null): string {
      if (!ua) return 'devices';
      if (/iPhone|iPad/.test(ua)) return 'phone_iphone';
      if (/Android/.test(ua)) return 'phone_android';
      if (/Mac/.test(ua)) return 'laptop_mac';
      if (/Windows/.test(ua)) return 'laptop_windows';
      return 'computer';
    },
    deviceLabel(ua: string | null): string {
      if (!ua) return this.$t('settings.notifications.unknownDevice') as string;
      let browser = 'Browser';
      if (/Edg\//.test(ua)) browser = 'Edge';
      else if (/Chrome\//.test(ua)) browser = 'Chrome';
      else if (/Firefox\//.test(ua)) browser = 'Firefox';
      else if (/Safari\//.test(ua)) browser = 'Safari';

      let os = '';
      if (/iPhone|iPad/.test(ua)) os = ' on iOS';
      else if (/Android/.test(ua)) os = ' on Android';
      else if (/Mac OS/.test(ua)) os = ' on macOS';
      else if (/Windows/.test(ua)) os = ' on Windows';
      else if (/Linux/.test(ua)) os = ' on Linux';

      return `${browser}${os}`;
    },
    formatTime(iso: string): string {
      return new Date(iso).toLocaleString(this.$i18n.locale);
    },
    async onEnable(): Promise<void> {
      await this.subscribe();
      if (this.error === 'permission_denied') {
        this.notify.warning(this.$t('settings.notifications.permissionDeniedToast') as string);
      } else if (this.error) {
        this.notify.error(this.error);
      } else {
        this.notify.success(this.$t('settings.notifications.enabledSuccess') as string);
      }
    },
    async onDisable(): Promise<void> {
      await this.unsubscribeCurrent();
      this.notify.success(this.$t('settings.notifications.disabledSuccess') as string);
    },
    async onDelete(id: string): Promise<void> {
      try {
        await this.deleteSubscription(id);
        this.notify.success(this.$t('settings.notifications.deviceRevoked') as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },
    async onSendTest(): Promise<void> {
      try {
        await this.sendTest();
        this.notify.info(this.$t('settings.notifications.testSent') as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.notifications-tab {
  max-width: 720px;
}
</style>
```

Add the tab to the SettingsPage tab list (location depends on Spec 33's structure — find the tabs definition and add an entry).

### i18n keys

`apps/web/src/i18n/de/notifications.ts`:

```typescript
export default {
  title: 'Benachrichtigungen',
  empty: 'Keine Benachrichtigungen',
  markAllRead: 'Alle als gelesen markieren',
  viewSettings: 'Einstellungen',
  disconnected: 'Verbindung unterbrochen',

  relative: {
    justNow: 'gerade eben',
    minutesAgo: 'vor {n} Min',
    hoursAgo: 'vor {n} Std',
    daysAgo: 'vor {n} Tagen',
  },
};
```

`apps/web/src/i18n/de/settings.ts` (extend):

```typescript
notifications: {
  title: 'Browser-Benachrichtigungen',
  intro: 'Erhalte Push-Benachrichtigungen für kritische Events (Pipeline-Fehler, Kostenlimits) auch wenn der Tab geschlossen ist.',
  enabled: 'Aktiviert auf diesem Gerät',
  disabled: 'Nicht aktiviert auf diesem Gerät',
  enable: 'Aktivieren',
  disable: 'Deaktivieren',
  unsupported: 'Push-Notifications werden in diesem Browser nicht unterstützt.',
  permissionDenied: 'Berechtigung abgelehnt. Aktiviere sie in den Browser-Einstellungen.',
  permissionDeniedToast: 'Berechtigung verweigert. Aktiviere sie in den Browser-Einstellungen.',
  enabledSuccess: 'Push-Notifications aktiviert',
  disabledSuccess: 'Push-Notifications deaktiviert',
  sendTest: 'Test-Notification senden',
  testSent: 'Test-Notification gesendet',
  activeDevices: 'Aktive Geräte',
  noDevices: 'Keine Geräte registriert',
  unknownDevice: 'Unbekanntes Gerät',
  subscribedAt: 'Registriert {time}',
  lastUsed: 'Zuletzt {time}',
  revoke: 'Widerrufen',
  deviceRevoked: 'Gerät widerrufen',
},
```

Mirror in `en/`.

### Environment Variables

Generate VAPID keys once:

```bash
bunx web-push generate-vapid-keys
```

Add to `.env`:
```
VAPID_PUBLIC_KEY=BJxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAPID_PRIVATE_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VAPID_SUBJECT=mailto:marcel@example.com
```

Add to `.env.example` with placeholder values + comment explaining how to generate.

### Deploy Documentation

Add to root `CLAUDE.md` or `apps/api/CLAUDE.md`:

```markdown
## Notifications Deploy Checklist

When deploying to production for the first time (after local development):

1. **Generate fresh VAPID keys** for production. Don't re-use localhost keys:
   \`\`\`
   bunx web-push generate-vapid-keys
   \`\`\`
   Update prod env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

2. **Truncate localhost-created subscriptions** (they're tied to dev origin):
   \`\`\`sql
   DELETE FROM push_subscriptions WHERE endpoint LIKE '%localhost%' OR endpoint LIKE '%127.0.0.1%';
   \`\`\`

3. **Service worker file accessible at `/push-service-worker.js`** — verify reachable in prod build.

4. **HTTPS required in production.** Service Worker registration on non-localhost requires HTTPS.

5. **Daily cron**: schedule `pruneOldNotifications()` to run daily. For now, manual run weekly:
   \`\`\`
   curl -X POST -H "Cookie: ..." https://your-domain/api/admin/prune-notifications
   \`\`\`
```

## Acceptance Criteria

### Backend
- [ ] Migration creates `notifications` table with severity enum + indexes
- [ ] `createNotification()` inserts row + dispatches to SSE + Web Push (if critical)
- [ ] `subscribeSse()` registers in-memory subscriber, returns unsubscribe function
- [ ] Web Push uses VAPID, handles 410/404 by deleting expired subscriptions
- [ ] `listNotifications()` supports limit, since, unreadOnly filters
- [ ] `markAsRead()` only marks own user's notifications
- [ ] `pruneOldNotifications()` deletes per retention rules

### HTTP Routes
- [ ] All `/api/notifications/*` endpoints require auth
- [ ] `GET /api/notifications` returns list + unreadCount
- [ ] `POST /api/notifications/mark-read` validates UUID array, ignores foreign IDs
- [ ] `GET /api/notifications/stream` streams SSE with heartbeat every 30s
- [ ] SSE cleans up subscriber on disconnect
- [ ] `GET /api/push/vapid-public-key` returns key, 503 if not configured
- [ ] `POST /api/push/subscriptions` upserts by endpoint
- [ ] `DELETE /api/push/subscriptions/:id` only deletes own
- [ ] `POST /api/push/test` triggers test notification

### Trigger Integration
- [ ] Cost-limit pause creates critical notification
- [ ] Cost alert (warning) creates warning notification
- [ ] Pipeline failure creates critical notification (excluding cost-limit failures)
- [ ] Pipeline completion creates info notification (only meaningful pipelines)
- [ ] Astro-sync failure creates critical notification
- [ ] PageSpeed failure creates warning notification
- [ ] F-008 TODO removed from `tracker.ts:43` — `createNotification` called instead

### Service Worker
- [ ] `apps/web/public/push-service-worker.js` exists with push + notificationclick handlers
- [ ] Critical severity uses `requireInteraction: true`

### Frontend Components
- [ ] NotificationBell in MainLayout header with badge
- [ ] Bell shows unread count, max "99+"
- [ ] Click opens panel with last 50 notifications
- [ ] SSE connects on app load
- [ ] SSE fallback to polling when reconnect fails ≥ 3 times
- [ ] Click on notification: marks read + navigates to link
- [ ] Settings notifications tab shows enable/disable + active devices list
- [ ] Subscribe flow works on localhost
- [ ] Per-device revoke button works
- [ ] Test-Notification button triggers a real browser notification

### i18n
- [ ] All strings in de + en

### Local Dev
- [ ] Service worker registers on localhost without HTTPS
- [ ] Push notifications arrive even with browser tab closed (browser still running)

## Testing Strategy

### Manual smoke tests

1. **Generate VAPID keys**, add to .env, restart API
2. **Bell appears in header**, count = 0
3. **Trigger notification via SQL**:
   ```sql
   INSERT INTO notifications (user_id, type, severity, title, message, link)
   VALUES ((SELECT id FROM users LIMIT 1), 'test', 'info', 'Test', 'Hello', '/cost');
   ```
  - SSE delivers immediately, badge → 1
4. **Click notification**: navigates, marks read, badge clears
5. **Settings → Notifications tab**: shows "Not enabled"
6. **Click Enable**: permission prompt → grant → "Enabled" + 1 device listed
7. **Test-Notification**: browser shows native push
8. **Critical event** (synthetic cost-limit pause from Spec 42 E.1): in-app + Web Push both fire
9. **Tab closed test**: close tab → trigger critical → Web Push appears as system notification → click → opens new tab to link
10. **Multi-tab**: 2 tabs → both receive SSE events live
11. **Unsubscribe**: Settings → Disable → no Web Push (in-app still works)
12. **Per-device revoke**: trash icon → DB row deleted, that browser stops getting push
13. **SSE reconnect**: kill API → bell shows "disconnected" → restart → SSE reconnects → next notification arrives live

### Edge cases

14. **100+ notifications**: panel caps at 100 in store
15. **Notification without link**: click is no-op, just marks read
16. **VAPID missing**: `/push/vapid-public-key` returns 503; Settings shows error gracefully
17. **Permission denied**: Settings shows "Permission denied" message
18. **Subscription expires**: 410 from push service → DB row auto-deleted, no error to user

## Open Questions / Decisions Made

**Decision 1: SSE chosen over WebSocket.**
Server-only push, simpler protocol, native EventSource API.

**Decision 2: In-memory SSE subscriber registry.**
Single-process assumption. Multi-process needs Redis pub/sub — out of scope.

**Decision 3: Web Push only for critical severity by default.**
Avoids notification fatigue.

**Decision 4: Daily prune as admin endpoint, not cron.**
No cron infrastructure yet. Manual weekly is acceptable.

**Decision 5: Notification link is a frontend route.**
Backend independent of frontend routing.

**Decision 6: SSE polling fallback after 3 reconnect failures.**
Degraded but reliable when SSE fails persistently.

**Decision 7: Per-device subscription, not per-user single.**
Honest about reality — each browser × device gets its own.

**Decision 8: User-Agent string parsed client-side.**
Privacy-respectful — no UA sent to third parties.

**Decision 9: No notification snoozing or per-event mute.**
v1 is binary on/off.

**Decision 10: Test-button triggers real `createNotification`.**
Easy to debug — same flow as production.

**Decision 11: SSE heartbeat every 30s.**
Keeps proxies from killing idle connections (nginx default 60s).

**Decision 12: Local-dev subscription invalidation on deploy is documented, not automated.**
Manual SQL cleanup is fine. Automation only worth it if multi-deploy-per-week.

## Implementation Order

**Recommend 3 sessions.**

**Session 1: Backend Foundation (~5h)**

1. Migration for `notifications` table (~30 min)
2. `packages/core/src/notifications/index.ts` — full module (~2h)
3. SSE registry + dispatch (~30 min)
4. Web Push integration with `web-push` library (~45 min)
5. HTTP routes for notifications + push (~1h)
6. VAPID key generation + .env update (~15 min)
7. Test all endpoints with curl (~30 min)
8. Commit: `feat(api,core,db): notifications backend (spec 40 part 1)`

**Session 2: Trigger Integration + Service Worker (~4h)**

1. Wire `createNotification` into cost-pause flow (replaces F-008) (~30 min)
2. Wire into cost-alert flow (~15 min)
3. Wire into pipeline `failed`/`completed` worker hooks (~1h)
4. Wire into astro-sync, pagespeed-validation failure paths (~30 min)
5. `apps/web/public/push-service-worker.js` + icons (~45 min)
6. Manual test: trigger each event type, verify notifications fire (~1h)
7. Commit: `feat(pipelines,worker): notification trigger integration (spec 40 part 2)`

**Session 3: Frontend UI (~5h)**

1. `notifications.ts` Pinia store (~30 min)
2. `useNotificationStream` SSE composable with polling fallback (~1h)
3. `NotificationBell` component + MainLayout integration (~1.5h)
4. `usePushSubscription` composable (~1h)
5. `NotificationsTab` for Settings page (~1h)
6. i18n keys de + en (~30 min)
7. End-to-end test (~30 min)
8. Commit: `feat(web): notification bell + push settings (spec 40 part 3)`

Total: ~14 hours.

## Splitting Plan

3 sessions with `/clear` between. Backend → Triggers → UI is the natural ordering — each session validates before the next builds on it.

## Discovered During Implementation

- **`.rowCount` doesn't exist on Drizzle update/delete results.** `RowList<never[]>` has no `rowCount` property. Must use `.returning({ id: table.id }).length` instead. Added to root CLAUDE.md Common Mistakes.

- **Drizzle index `.where()` requires an SQL expression, not a bare column.** `index().on(...).where(t.readAt)` throws TS2345. Must use `isNull(t.readAt)` (imported from `drizzle-orm`).

- **`bun add <pkg> --filter <workspace>` doesn't work.** Bun treats `--filter` as an npm package name, not a workspace selector. Use `bun add <pkg> --cwd packages/foo` instead.

- **`@marketing-auto/core/notifications` subpath needs explicit `paths` in API's `tsconfig.json`.** The existing wildcard `"@marketing-auto/core/*": ["*.ts"]` resolves `*/index.ts` only under bundler resolution — TSC still needs `"@marketing-auto/core/notifications": ["../../packages/core/src/notifications/index.ts"]` added before the wildcard entry.

- **SSE `EventSource` requires an absolute URL.** Passing `/api/notifications/stream` directly fails in some environments. The composable must prefix with `import.meta.env.VITE_API_BASE_URL`.

- **Spec code examples used `process.env`, `console.*`, and German user-facing strings** — all three violate CLAUDE.md rules (`getEnv()`, pino logger, English-only code). Fixed during implementation.

## Deviations

- **Component named `NotificationsPanel.vue`, not `NotificationsTab.vue`.** The spec called for `NotificationsTab.vue`, but all existing Settings components use the `*Panel.vue` suffix (`SystemPanel.vue`, `ProfilePanel.vue`, etc.). Named consistently to match the established convention.

- **`POST /api/admin/prune-notifications` uses `requireAuth`, not a separate admin secret.** The spec said "admin auth middleware required — assumes you have one" but no admin middleware exists. The endpoint is protected by `requireAuth` (session cookie), which is sufficient for a single-operator system.
