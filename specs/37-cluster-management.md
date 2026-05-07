# Spec 37: Clusters & Pillars Management UI

**Phase:** 4 (Welle 4)
**Estimated Effort:** 2-2.5 days (3 sessions)
**Dependencies:** Spec 30 (shell), Spec 34 (project hub), Spec 36 (article store + types)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (CRUD UI + minor backend logic; no novel architectural patterns)

---

## Goal

Build the **Clusters & Pillars management page** at `/projects/:slug/clusters`. After Cold-Start auto-generates an initial taxonomy (Pillars → Clusters → Cornerstones), Marcel needs to evolve it over time:

- Rename pillars and clusters as content strategy changes
- Create new pillars/clusters when new themes emerge
- Delete or merge pillars/clusters that didn't pan out
- Move articles between clusters when classification was wrong
- Reorder pillars (defines display order in Spec 36 Kanban)
- See a clear at-a-glance view of "what taxonomy do I have"

This page replaces the implicit assumption that the Cold-Start-generated taxonomy is permanent. It also keeps `clusters.pillarArticleId` automatically maintained by the backend (auto-detect: first cornerstone of the cluster).

This spec also fills a gap from Spec 36: the Kanban renders cluster lanes but offers no way to manage them. Marcel currently can only modify them via direct DB queries — unacceptable for ongoing operation.

## Architecture Decisions

**Decision 1: Dedicated route at `/projects/:slug/clusters`.**
Not a tab in Project Hub — Cluster management is a focused workflow. The hub already has 5 tabs (Articles, Settings, Cold-Start, ...) and adding a 6th makes the header cluttered. The Project Hub gets a "Manage clusters →" link that navigates here. Page has its own breadcrumb back to the project.

**Decision 2: Page layout — pillars as expandable sections, clusters as cards within.**

```
┌─ Pillar A ──────────────────────────────────────── [⋮] ┐
│  ┌─ Cluster A1 ─────┐  ┌─ Cluster A2 ─────┐            │
│  │ 5 articles       │  │ 3 articles       │            │
│  │ Cornerstones: 2  │  │ Cornerstones: 1  │            │
│  │ Pillar: How AI…  │  │ Pillar: ML 101…  │            │
│  └──────────────────┘  └──────────────────┘            │
│  + New cluster                                          │
└─────────────────────────────────────────────────────────┘
┌─ Pillar B ───────────────────────────────────── [⋮] ┐
│  ...                                                 │
└──────────────────────────────────────────────────────┘
+ New pillar
```

Each pillar header has a `[⋮]` menu (rename, delete, move up, move down). Each cluster card has its own context menu (rename, delete, move to other pillar, view articles).

**Decision 3: All edits inline; no separate detail pages.**
Click cluster name → it becomes editable input → blur or Enter to save. Same pattern for pillar names. This is faster than navigating to a detail page for a one-line rename.

**Decision 4: Reorder via "Move up/down" buttons, not drag-and-drop.**
Drag-and-drop in Vue without a library = significant UX work and edge cases. Two buttons (`↑` / `↓`) achieve the same outcome with 90% less code. Defer drag-and-drop to a future polish pass.

**Decision 5: Articles-move uses an "Article Picker" dialog.**
Click "Move articles" on a cluster → modal opens with a list of articles in the cluster, multi-select, "Move to" dropdown of other clusters → confirm. Server-side updates `articles.clusterId` for selected rows.

**Decision 6: Pillar deletion is gated.**
A pillar with clusters cannot be deleted (FK on `clusters.pillarId` is `onDelete: "restrict"`). UI catches this client-side: Delete button shows confirmation dialog if cluster count is 0; otherwise shows a "Cannot delete — move clusters first" warning. Server validates regardless.

**Decision 7: Cluster deletion is allowed and cascades articles to "Uncategorized".**
The schema has `articles.clusterId` with `onDelete: "set null"`. A deleted cluster's articles become unclustered. UI confirms: "Delete cluster X? All N articles will become uncategorized." Hard delete; no undo.

**Decision 8: `pillarArticleId` is auto-managed by the backend.**

A new helper `recalcPillarArticleId(clusterId)` runs after these triggers:
- Cluster created (no articles yet → null)
- Article moved into the cluster
- Article moved out of the cluster
- Article deleted
- Cornerstone-status changes (a regular article promoted to cornerstone, or vice versa)

Logic: pick the article in the cluster where `cornerstoneSpecId IS NOT NULL`, ordered by `created_at` ASC, take the first. Fall back to null if no cornerstones exist.

This runs synchronously in the same request that triggered the change. No separate worker. Simple SQL: one SELECT, one UPDATE.

**Decision 9: All changes are immediate; no draft/save state.**
Like the project settings (Spec 34), changes commit on blur/confirm. No "Save changes" button at page level. Keeps mental model simple.

**Decision 10: Cluster `position` field added to the schema.**
The schema has `contentPillars.position` but `clusters` lacks it. We add a `position` column to `clusters` for ordering within a pillar. Migration needed.

## Non-Goals

- **No drag-and-drop reordering** — buttons only
- **No bulk operations across pillars** (e.g., "merge all clusters with name containing X")
- **No cluster duplication** ("clone this cluster as starting point for another")
- **No cluster history / version log** — changes are immediate, no audit trail
- **No undo** — confirmations only
- **No keyword editing** in this spec — `cornerstoneKeywords` and `satelliteKeywords` are still managed by the Cold-Start pipeline. Keyword CRUD is a future spec if needed.
- **No `pillarArticleId` UI editing** — auto-managed only, displayed as read-only badge
- **No cluster-status workflow** — `clusters.status` field stays at `'proposed'`, no UI surfaces it

## Detailed Implementation

### Schema Migration

`packages/db/migrations/000X_clusters_position.sql`:

```sql
ALTER TABLE clusters
  ADD COLUMN position integer NOT NULL DEFAULT 0;

-- Backfill: order existing clusters within each pillar by created_at
UPDATE clusters SET position = sub.row_num - 1
FROM (
  SELECT id, row_number() OVER (PARTITION BY pillar_id ORDER BY created_at) AS row_num
  FROM clusters
) sub
WHERE clusters.id = sub.id;

CREATE INDEX clusters_pillar_position_idx ON clusters (pillar_id, position);
```

Update `packages/db/src/schema/identity.ts`:

```typescript
export const clusters = pgTable("clusters", {
  // ... existing fields ...
  position: integer("position").notNull().default(0),
  // ... rest ...
}, (t) => ({
  projectIdx: index("clusters_project_idx").on(t.projectId),
  pillarIdx: index("clusters_pillar_idx").on(t.pillarId),
  pillarPositionIdx: index("clusters_pillar_position_idx").on(t.pillarId, t.position),
}));
```

### Backend: Pillar Routes

`apps/api/src/routes/pillars.ts`:

```typescript
import { Hono } from 'hono';
import { eq, and, desc, asc, sql, ne } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, contentPillars, clusters, projects } from '@marketing-auto/db';
import { requireAuth } from '../middleware/require-auth';

export const pillarRoutes = new Hono();
pillarRoutes.use(requireAuth);

// ───── GET /api/pillars?projectSlug=foo ──────────────────────────────────
// Returns all pillars for a project, ordered by position, with cluster counts.

pillarRoutes.get('/', async (c) => {
  const projectSlug = c.req.query('projectSlug');
  if (!projectSlug) return c.json({ ok: false, error: 'projectSlug required' }, 400);

  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, projectSlug)).limit(1);
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  const rows = await db.select({
    id: contentPillars.id,
    name: contentPillars.name,
    description: contentPillars.description,
    position: contentPillars.position,
    createdAt: contentPillars.createdAt,
    clusterCount: sql<number>`coalesce(count(${clusters.id}), 0)::int`,
  })
    .from(contentPillars)
    .leftJoin(clusters, eq(clusters.pillarId, contentPillars.id))
    .where(eq(contentPillars.projectId, project.id))
    .groupBy(contentPillars.id)
    .orderBy(asc(contentPillars.position), asc(contentPillars.createdAt));

  return c.json({ ok: true, data: rows });
});

// ───── POST /api/pillars ─────────────────────────────────────────────────

const createPillarSchema = z.object({
  projectSlug: z.string(),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
});

pillarRoutes.post('/', zValidator('json', createPillarSchema), async (c) => {
  const input = c.req.valid('json');

  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, input.projectSlug)).limit(1);
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  // Determine new position: max + 1 within this project
  const [maxPos] = await db.select({
    max: sql<number>`coalesce(max(${contentPillars.position}), -1)::int`,
  })
    .from(contentPillars)
    .where(eq(contentPillars.projectId, project.id));

  const [created] = await db.insert(contentPillars).values({
    projectId: project.id,
    name: input.name,
    description: input.description ?? null,
    position: (maxPos?.max ?? -1) + 1,
  }).returning();

  return c.json({ ok: true, data: created }, 201);
});

// ───── PATCH /api/pillars/:id ────────────────────────────────────────────

const updatePillarSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
});

pillarRoutes.patch('/:id', zValidator('json', updatePillarSchema), async (c) => {
  const id = c.req.param('id');
  const input = c.req.valid('json');

  const [existing] = await db.select({ id: contentPillars.id })
    .from(contentPillars).where(eq(contentPillars.id, id)).limit(1);
  if (!existing) return c.json({ ok: false, error: 'Pillar not found' }, 404);

  await db.update(contentPillars)
    .set(input)
    .where(eq(contentPillars.id, id));

  const [updated] = await db.select().from(contentPillars).where(eq(contentPillars.id, id)).limit(1);
  return c.json({ ok: true, data: updated });
});

// ───── DELETE /api/pillars/:id ───────────────────────────────────────────
// Returns 409 if pillar has clusters.

pillarRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const [pillar] = await db.select().from(contentPillars).where(eq(contentPillars.id, id)).limit(1);
  if (!pillar) return c.json({ ok: false, error: 'Pillar not found' }, 404);

  const [{ count }] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(clusters).where(eq(clusters.pillarId, id));

  if (count > 0) {
    return c.json({
      ok: false,
      error: 'pillar_has_clusters',
      data: { clusterCount: count },
    }, 409);
  }

  await db.delete(contentPillars).where(eq(contentPillars.id, id));
  return c.json({ ok: true, data: { id } });
});

// ───── POST /api/pillars/:id/move ────────────────────────────────────────
// Moves a pillar up or down by swapping `position` with its neighbour.

const movePillarSchema = z.object({
  direction: z.enum(['up', 'down']),
});

pillarRoutes.post('/:id/move', zValidator('json', movePillarSchema), async (c) => {
  const id = c.req.param('id');
  const { direction } = c.req.valid('json');

  const [pillar] = await db.select().from(contentPillars).where(eq(contentPillars.id, id)).limit(1);
  if (!pillar) return c.json({ ok: false, error: 'Pillar not found' }, 404);

  // Find neighbour to swap with
  const neighbour = direction === 'up'
    ? await db.select().from(contentPillars)
        .where(and(
          eq(contentPillars.projectId, pillar.projectId),
          sql`${contentPillars.position} < ${pillar.position}`,
        ))
        .orderBy(desc(contentPillars.position))
        .limit(1)
    : await db.select().from(contentPillars)
        .where(and(
          eq(contentPillars.projectId, pillar.projectId),
          sql`${contentPillars.position} > ${pillar.position}`,
        ))
        .orderBy(asc(contentPillars.position))
        .limit(1);

  if (neighbour.length === 0) {
    // Already at the boundary; no-op
    return c.json({ ok: true, data: { changed: false } });
  }

  // Swap positions atomically
  const targetPos = neighbour[0]!.position;
  const sourcePos = pillar.position;

  await db.transaction(async (tx) => {
    // Use a sentinel value to avoid the unique constraint conflict
    // (we don't have a unique constraint on position currently, but defensively use -1)
    await tx.update(contentPillars).set({ position: -1 }).where(eq(contentPillars.id, pillar.id));
    await tx.update(contentPillars).set({ position: sourcePos }).where(eq(contentPillars.id, neighbour[0]!.id));
    await tx.update(contentPillars).set({ position: targetPos }).where(eq(contentPillars.id, pillar.id));
  });

  return c.json({ ok: true, data: { changed: true } });
});
```

### Backend: Cluster Routes

`apps/api/src/routes/clusters.ts`:

```typescript
import { Hono } from 'hono';
import { eq, and, asc, desc, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, clusters, contentPillars, articles, projects } from '@marketing-auto/db';
import { requireAuth } from '../middleware/require-auth';

export const clusterRoutes = new Hono();
clusterRoutes.use(requireAuth);

// ───── GET /api/clusters?projectSlug=foo ─────────────────────────────────
// Returns clusters with article counts and pillar info, ordered by position.

clusterRoutes.get('/', async (c) => {
  const projectSlug = c.req.query('projectSlug');
  const pillarId = c.req.query('pillarId');

  if (!projectSlug) return c.json({ ok: false, error: 'projectSlug required' }, 400);

  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, projectSlug)).limit(1);
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  const filters = [eq(clusters.projectId, project.id)];
  if (pillarId) filters.push(eq(clusters.pillarId, pillarId));

  const rows = await db.select({
    id: clusters.id,
    name: clusters.name,
    pillarId: clusters.pillarId,
    pillarName: contentPillars.name,
    primaryKeyword: clusters.primaryKeyword,
    cornerstoneKeywords: clusters.cornerstoneKeywords,
    pillarArticleId: clusters.pillarArticleId,
    position: clusters.position,
    createdAt: clusters.createdAt,
    articleCount: sql<number>`coalesce((select count(*) from ${articles} where ${articles.clusterId} = ${clusters.id})::int, 0)`,
    cornerstoneCount: sql<number>`coalesce((select count(*) from ${articles} where ${articles.clusterId} = ${clusters.id} and ${articles.cornerstoneSpecId} is not null)::int, 0)`,
  })
    .from(clusters)
    .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
    .where(and(...filters))
    .orderBy(asc(clusters.position), asc(clusters.createdAt));

  // Fetch pillar-article titles for clusters that have one
  const pillarArticleIds = rows
    .map((r) => r.pillarArticleId)
    .filter((id): id is string => id !== null);

  const titleMap = new Map<string, string>();
  if (pillarArticleIds.length > 0) {
    const titles = await db.select({
      id: articles.id,
      title: articles.title,
      cornerstoneKeyword: articles.cornerstoneKeyword,
    })
      .from(articles)
      .where(inArray(articles.id, pillarArticleIds));
    for (const t of titles) {
      titleMap.set(t.id, t.title ?? t.cornerstoneKeyword);
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    pillarArticleTitle: r.pillarArticleId ? titleMap.get(r.pillarArticleId) ?? null : null,
  }));

  return c.json({ ok: true, data: enriched });
});

// ───── POST /api/clusters ────────────────────────────────────────────────

const createClusterSchema = z.object({
  projectSlug: z.string(),
  pillarId: z.string().uuid(),
  name: z.string().min(2).max(200),
  primaryKeyword: z.string().max(200).optional(),
});

clusterRoutes.post('/', zValidator('json', createClusterSchema), async (c) => {
  const input = c.req.valid('json');

  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, input.projectSlug)).limit(1);
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  // Verify pillar belongs to this project
  const [pillar] = await db.select({ id: contentPillars.id, name: contentPillars.name })
    .from(contentPillars)
    .where(and(eq(contentPillars.id, input.pillarId), eq(contentPillars.projectId, project.id)))
    .limit(1);
  if (!pillar) return c.json({ ok: false, error: 'Pillar not found in this project' }, 404);

  // Determine position: max + 1 within pillar
  const [maxPos] = await db.select({
    max: sql<number>`coalesce(max(${clusters.position}), -1)::int`,
  })
    .from(clusters)
    .where(eq(clusters.pillarId, input.pillarId));

  const [created] = await db.insert(clusters).values({
    projectId: project.id,
    pillarId: input.pillarId,
    name: input.name,
    pillar: pillar.name, // denormalized
    primaryKeyword: input.primaryKeyword ?? null,
    position: (maxPos?.max ?? -1) + 1,
    cornerstoneKeywords: [],
    satelliteKeywords: [],
  }).returning();

  return c.json({ ok: true, data: created }, 201);
});

// ───── PATCH /api/clusters/:id ───────────────────────────────────────────

const updateClusterSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  primaryKeyword: z.string().max(200).nullable().optional(),
  pillarId: z.string().uuid().optional(),
});

clusterRoutes.patch('/:id', zValidator('json', updateClusterSchema), async (c) => {
  const id = c.req.param('id');
  const input = c.req.valid('json');

  const [existing] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
  if (!existing) return c.json({ ok: false, error: 'Cluster not found' }, 404);

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.primaryKeyword !== undefined) updates.primaryKeyword = input.primaryKeyword;

  if (input.pillarId && input.pillarId !== existing.pillarId) {
    // Verify new pillar exists and belongs to same project
    const [newPillar] = await db.select({ name: contentPillars.name })
      .from(contentPillars)
      .where(and(eq(contentPillars.id, input.pillarId), eq(contentPillars.projectId, existing.projectId)))
      .limit(1);
    if (!newPillar) return c.json({ ok: false, error: 'Target pillar not found in this project' }, 404);

    // Reset position to end of new pillar
    const [maxPos] = await db.select({
      max: sql<number>`coalesce(max(${clusters.position}), -1)::int`,
    })
      .from(clusters)
      .where(eq(clusters.pillarId, input.pillarId));

    updates.pillarId = input.pillarId;
    updates.pillar = newPillar.name; // denormalized
    updates.position = (maxPos?.max ?? -1) + 1;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ ok: true, data: existing });
  }

  await db.update(clusters).set(updates).where(eq(clusters.id, id));

  const [updated] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
  return c.json({ ok: true, data: updated });
});

// ───── DELETE /api/clusters/:id ──────────────────────────────────────────
// Hard delete; articles cascade to clusterId=null via FK.

clusterRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const [cluster] = await db.select({ id: clusters.id }).from(clusters).where(eq(clusters.id, id)).limit(1);
  if (!cluster) return c.json({ ok: false, error: 'Cluster not found' }, 404);

  const [{ count }] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(articles).where(eq(articles.clusterId, id));

  await db.delete(clusters).where(eq(clusters.id, id));

  return c.json({
    ok: true,
    data: { id, articlesUncategorized: count },
  });
});

// ───── POST /api/clusters/:id/move ───────────────────────────────────────

const moveClusterSchema = z.object({
  direction: z.enum(['up', 'down']),
});

clusterRoutes.post('/:id/move', zValidator('json', moveClusterSchema), async (c) => {
  const id = c.req.param('id');
  const { direction } = c.req.valid('json');

  const [cluster] = await db.select().from(clusters).where(eq(clusters.id, id)).limit(1);
  if (!cluster) return c.json({ ok: false, error: 'Cluster not found' }, 404);

  const neighbour = direction === 'up'
    ? await db.select().from(clusters)
        .where(and(
          eq(clusters.pillarId, cluster.pillarId),
          sql`${clusters.position} < ${cluster.position}`,
        ))
        .orderBy(desc(clusters.position))
        .limit(1)
    : await db.select().from(clusters)
        .where(and(
          eq(clusters.pillarId, cluster.pillarId),
          sql`${clusters.position} > ${cluster.position}`,
        ))
        .orderBy(asc(clusters.position))
        .limit(1);

  if (neighbour.length === 0) {
    return c.json({ ok: true, data: { changed: false } });
  }

  const targetPos = neighbour[0]!.position;
  const sourcePos = cluster.position;

  await db.transaction(async (tx) => {
    await tx.update(clusters).set({ position: -1 }).where(eq(clusters.id, cluster.id));
    await tx.update(clusters).set({ position: sourcePos }).where(eq(clusters.id, neighbour[0]!.id));
    await tx.update(clusters).set({ position: targetPos }).where(eq(clusters.id, cluster.id));
  });

  return c.json({ ok: true, data: { changed: true } });
});

// ───── POST /api/clusters/:id/move-articles ──────────────────────────────
// Move multiple articles from this cluster to another (or to null = uncategorized).

const moveArticlesSchema = z.object({
  articleIds: z.array(z.string().uuid()).min(1).max(100),
  toClusterId: z.string().uuid().nullable(),
});

clusterRoutes.post('/:id/move-articles', zValidator('json', moveArticlesSchema), async (c) => {
  const fromClusterId = c.req.param('id');
  const { articleIds, toClusterId } = c.req.valid('json');

  // Verify all articles belong to fromCluster (security: prevent cross-tenant article moves)
  const matches = await db.select({ id: articles.id })
    .from(articles)
    .where(and(
      inArray(articles.id, articleIds),
      eq(articles.clusterId, fromClusterId),
    ));

  if (matches.length !== articleIds.length) {
    return c.json({ ok: false, error: 'Some articles do not belong to this cluster' }, 400);
  }

  // If moving to a cluster, verify it exists in same project
  if (toClusterId) {
    const [fromCluster] = await db.select({ projectId: clusters.projectId })
      .from(clusters).where(eq(clusters.id, fromClusterId)).limit(1);
    const [toCluster] = await db.select({ projectId: clusters.projectId })
      .from(clusters).where(eq(clusters.id, toClusterId)).limit(1);
    if (!fromCluster || !toCluster) return c.json({ ok: false, error: 'Cluster not found' }, 404);
    if (fromCluster.projectId !== toCluster.projectId) {
      return c.json({ ok: false, error: 'Cannot move articles across projects' }, 400);
    }
  }

  await db.update(articles)
    .set({ clusterId: toClusterId, updatedAt: new Date() })
    .where(inArray(articles.id, articleIds));

  // Recalc pillarArticleId for both source and target clusters
  await recalcPillarArticleId(fromClusterId);
  if (toClusterId) await recalcPillarArticleId(toClusterId);

  return c.json({ ok: true, data: { movedCount: articleIds.length } });
});

// ───── Helper: pillarArticleId auto-detect ───────────────────────────────

export async function recalcPillarArticleId(clusterId: string): Promise<void> {
  // First cornerstone in cluster, ordered by created_at ASC
  const [first] = await db.select({ id: articles.id })
    .from(articles)
    .where(and(
      eq(articles.clusterId, clusterId),
      sql`${articles.cornerstoneSpecId} IS NOT NULL`,
    ))
    .orderBy(asc(articles.createdAt))
    .limit(1);

  await db.update(clusters)
    .set({ pillarArticleId: first?.id ?? null })
    .where(eq(clusters.id, clusterId));
}
```

Mount in `apps/api/src/index.ts`:
```typescript
app.route('/api/pillars', pillarRoutes);
app.route('/api/clusters', clusterRoutes);
```

### Backend: Wire `recalcPillarArticleId` Into Article Lifecycle

This is critical — without it, `pillarArticleId` becomes stale.

Update `apps/api/src/routes/articles.ts` to call the helper after relevant changes:

```typescript
import { recalcPillarArticleId } from './clusters';

// In PATCH /api/articles/:id, when status or cluster changes:
articleRoutes.patch('/:id', zValidator('json', articleUpdateSchema), async (c) => {
  const id = c.req.param('id');
  const input = c.req.valid('json');

  const [existing] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!existing) return c.json({ ok: false, error: 'Article not found' }, 404);

  await db.update(articles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(articles.id, id));

  // Recalc if cluster changed (article-move-via-edit path)
  if (existing.clusterId) await recalcPillarArticleId(existing.clusterId);

  const [updated] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  return c.json({ ok: true, data: updated });
});
```

Also wire into the article-creation flow in `packages/pipelines/src/cold-start/cluster-plan` (where Cold-Start creates new clusters): after each cornerstone-spec is materialized into an article, call `recalcPillarArticleId(clusterId)`. **Note for implementer:** find the existing article-create function in pipelines and add the call. If not yet present, defer to a future Spec — the auto-detect still works during normal operation since article creation goes through `enqueueArticleOutlinePipeline` → article writes happen in pipeline workers, which would also need to call the helper.

**Decision: For this spec, only the HTTP layer calls `recalcPillarArticleId`.** Pipeline-created articles will trigger a recalc the first time the article is interacted with via API (status change, cluster move, etc.). For the initial Cold-Start, run a one-time backfill: `UPDATE clusters SET pillarArticleId = (SELECT articles.id FROM articles WHERE cluster_id = clusters.id AND cornerstone_spec_id IS NOT NULL ORDER BY created_at LIMIT 1)`.

Add a backfill script: `apps/api/src/scripts/backfill-pillar-articles.ts`:

```typescript
import { db, clusters, articles } from '@marketing-auto/db';
import { recalcPillarArticleId } from '../routes/clusters';

async function main(): Promise<void> {
  const allClusters = await db.select({ id: clusters.id }).from(clusters);
  for (const c of allClusters) {
    await recalcPillarArticleId(c.id);
  }
  console.log(`Backfilled pillarArticleId for ${allClusters.length} clusters`);
}

void main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run once after schema migration: `bun run apps/api/src/scripts/backfill-pillar-articles.ts`.

### Frontend: Pillars + Clusters Stores

`apps/web/src/stores/pillars.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';
import { HttpError } from 'src/lib/http-error';

export interface Pillar {
  id: string;
  name: string;
  description: string | null;
  position: number;
  createdAt: string;
  clusterCount: number;
}

interface PillarsState {
  byProject: Record<string, Pillar[]>;
  loading: boolean;
}

export const usePillarsStore = defineStore('pillars', {
  state: (): PillarsState => ({
    byProject: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Pillar[] }>(
          `/pillars?projectSlug=${encodeURIComponent(slug)}`,
        );
        this.byProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async create(slug: string, name: string, description?: string): Promise<Pillar> {
      const res = await api.post<{ ok: boolean; data: Pillar }>(`/pillars`, {
        projectSlug: slug,
        name,
        description,
      });
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async update(slug: string, id: string, patch: { name?: string; description?: string | null }): Promise<void> {
      await api.patch(`/pillars/${id}`, patch);
      await this.fetchForProject(slug);
    },

    /**
     * Returns true if deleted, false if blocked (clusters exist).
     */
    async delete(slug: string, id: string): Promise<{ deleted: boolean; clusterCount?: number }> {
      try {
        await api.delete(`/pillars/${id}`);
        await this.fetchForProject(slug);
        return { deleted: true };
      } catch (e) {
        if (e instanceof HttpError && e.body && typeof e.body === 'object' && 'error' in e.body) {
          const body = e.body as { error: string; data?: { clusterCount: number } };
          if (body.error === 'pillar_has_clusters') {
            return { deleted: false, clusterCount: body.data?.clusterCount };
          }
        }
        throw e;
      }
    },

    async move(slug: string, id: string, direction: 'up' | 'down'): Promise<void> {
      await api.post(`/pillars/${id}/move`, { direction });
      await this.fetchForProject(slug);
    },
  },
});
```

`apps/web/src/stores/clusters.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface Cluster {
  id: string;
  name: string;
  pillarId: string;
  pillarName: string | null;
  primaryKeyword: string | null;
  cornerstoneKeywords: string[];
  pillarArticleId: string | null;
  pillarArticleTitle: string | null;
  position: number;
  createdAt: string;
  articleCount: number;
  cornerstoneCount: number;
}

interface ClustersState {
  byProject: Record<string, Cluster[]>;
  loading: boolean;
}

export const useClustersStore = defineStore('clusters', {
  state: (): ClustersState => ({
    byProject: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: Cluster[] }>(
          `/clusters?projectSlug=${encodeURIComponent(slug)}`,
        );
        this.byProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async create(slug: string, pillarId: string, name: string, primaryKeyword?: string): Promise<Cluster> {
      const res = await api.post<{ ok: boolean; data: Cluster }>(`/clusters`, {
        projectSlug: slug,
        pillarId,
        name,
        primaryKeyword,
      });
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async update(slug: string, id: string, patch: { name?: string; primaryKeyword?: string | null; pillarId?: string }): Promise<void> {
      await api.patch(`/clusters/${id}`, patch);
      await this.fetchForProject(slug);
    },

    async delete(slug: string, id: string): Promise<{ articlesUncategorized: number }> {
      const res = await api.delete<{ ok: boolean; data: { articlesUncategorized: number } }>(`/clusters/${id}`);
      await this.fetchForProject(slug);
      return res.data.data;
    },

    async move(slug: string, id: string, direction: 'up' | 'down'): Promise<void> {
      await api.post(`/clusters/${id}/move`, { direction });
      await this.fetchForProject(slug);
    },

    async moveArticles(slug: string, fromClusterId: string, articleIds: string[], toClusterId: string | null): Promise<void> {
      await api.post(`/clusters/${fromClusterId}/move-articles`, {
        articleIds,
        toClusterId,
      });
      await this.fetchForProject(slug);
    },
  },
});
```

### Frontend: ClustersManagementPage

`apps/web/src/pages/ClustersManagementPage.vue`:

```vue
<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <div class="col">
        <q-breadcrumbs class="text-body2 q-mb-xs">
          <q-breadcrumbs-el :label="$t('projects.title')" :to="{ name: 'projects' }" />
          <q-breadcrumbs-el :label="projectName ?? slug" :to="{ name: 'project-detail', params: { slug } }" />
          <q-breadcrumbs-el :label="$t('clusters.pageTitle')" />
        </q-breadcrumbs>
        <h1 class="text-h5 q-my-none">{{ $t('clusters.pageTitle') }}</h1>
      </div>
      <div class="col-auto">
        <q-btn
          color="primary"
          icon="add"
          :label="$t('clusters.actions.newPillar')"
          @click="onCreatePillar"
        />
      </div>
    </div>

    <div v-if="loading && pillars.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="pillars.length === 0" class="empty-state">
      <q-icon name="account_tree" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md">{{ $t('clusters.empty') }}</p>
      <p class="text-caption text-grey-7">{{ $t('clusters.emptyHint') }}</p>
    </div>

    <div v-else class="pillar-list">
      <PillarSection
        v-for="(pillar, idx) in pillars"
        :key="pillar.id"
        :pillar="pillar"
        :clusters="clustersByPillar[pillar.id] ?? []"
        :all-clusters="allClusters"
        :is-first="idx === 0"
        :is-last="idx === pillars.length - 1"
        :slug="slug"
        @rename="onRenamePillar"
        @delete="onDeletePillar"
        @move="onMovePillar"
        @cluster-create="onCreateCluster"
        @cluster-rename="onRenameCluster"
        @cluster-delete="onDeleteCluster"
        @cluster-move="onMoveCluster"
        @cluster-change-pillar="onChangeClusterPillar"
        @cluster-move-articles="onMoveArticlesDialog"
      />
    </div>

    <ClusterCreateDialog
      v-model="createPillarDialog.open"
      :title="$t('clusters.dialogs.createPillar')"
      :name-label="$t('clusters.fields.pillarName')"
      :description-field="true"
      @confirm="confirmCreatePillar"
    />

    <ClusterCreateDialog
      v-model="createClusterDialog.open"
      :title="$t('clusters.dialogs.createCluster')"
      :name-label="$t('clusters.fields.clusterName')"
      :extra-field-label="$t('clusters.fields.primaryKeyword')"
      :extra-field-optional="true"
      @confirm="confirmCreateCluster"
    />

    <ConfirmDeleteDialog
      v-model="deletePillarDialog.open"
      :title="$t('clusters.dialogs.deletePillar')"
      :message="$t('clusters.dialogs.deletePillarMessage', { name: deletePillarDialog.pillarName })"
      :loading="deletePillarDialog.loading"
      @confirm="confirmDeletePillar"
    />

    <ConfirmDeleteDialog
      v-model="deleteClusterDialog.open"
      :title="$t('clusters.dialogs.deleteCluster')"
      :message="deleteClusterDialog.message"
      :loading="deleteClusterDialog.loading"
      @confirm="confirmDeleteCluster"
    />

    <ArticleMoveDialog
      v-model="moveArticlesDialog.open"
      :slug="slug"
      :from-cluster="moveArticlesDialog.cluster"
      :all-clusters="allClusters"
      @confirm="confirmMoveArticles"
    />
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { usePillarsStore, type Pillar } from 'src/stores/pillars';
import { useClustersStore, type Cluster } from 'src/stores/clusters';
import { useProjectsStore } from 'src/stores/projects';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import PillarSection from 'src/components/clusters/PillarSection.vue';
import ClusterCreateDialog from 'src/components/clusters/ClusterCreateDialog.vue';
import ConfirmDeleteDialog from 'src/components/common/ConfirmDeleteDialog.vue';
import ArticleMoveDialog from 'src/components/clusters/ArticleMoveDialog.vue';

export default defineComponent({
  name: 'ClustersManagementPage',

  components: { PillarSection, ClusterCreateDialog, ConfirmDeleteDialog, ArticleMoveDialog },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return {
      pillarsStore: usePillarsStore(),
      clustersStore: useClustersStore(),
      projectsStore: useProjectsStore(),
      notify: useNotify(),
    };
  },

  data: () => ({
    createPillarDialog: { open: false },
    createClusterDialog: { open: false, pillarId: null as string | null },
    deletePillarDialog: { open: false, pillarId: null as string | null, pillarName: '', loading: false },
    deleteClusterDialog: { open: false, clusterId: null as string | null, message: '', loading: false },
    moveArticlesDialog: { open: false, cluster: null as Cluster | null },
  }),

  computed: {
    pillars(): Pillar[] {
      return this.pillarsStore.byProject[this.slug] ?? [];
    },
    allClusters(): Cluster[] {
      return this.clustersStore.byProject[this.slug] ?? [];
    },
    clustersByPillar(): Record<string, Cluster[]> {
      const result: Record<string, Cluster[]> = {};
      for (const c of this.allClusters) {
        if (!result[c.pillarId]) result[c.pillarId] = [];
        result[c.pillarId]!.push(c);
      }
      return result;
    },
    loading(): boolean {
      return this.pillarsStore.loading || this.clustersStore.loading;
    },
    projectName(): string | null {
      return this.projectsStore.list.find((p) => p.slug === this.slug)?.name ?? null;
    },
  },

  async created() {
    if (this.projectsStore.list.length === 0) {
      await this.projectsStore.fetchList();
    }
    await Promise.all([
      this.pillarsStore.fetchForProject(this.slug),
      this.clustersStore.fetchForProject(this.slug),
    ]);
  },

  methods: {
    onCreatePillar(): void {
      this.createPillarDialog = { open: true };
    },

    async confirmCreatePillar(payload: { name: string; description?: string }): Promise<void> {
      try {
        await this.pillarsStore.create(this.slug, payload.name, payload.description);
        this.notify.success(this.$t('clusters.notify.pillarCreated') as string);
        this.createPillarDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async onRenamePillar(payload: { id: string; name: string; description: string | null }): Promise<void> {
      try {
        await this.pillarsStore.update(this.slug, payload.id, {
          name: payload.name,
          description: payload.description,
        });
        this.notify.success(this.$t('clusters.notify.pillarUpdated') as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onDeletePillar(pillar: Pillar): void {
      if (pillar.clusterCount > 0) {
        this.notify.warning(
          this.$t('clusters.notify.cannotDeletePillarWithClusters', { count: pillar.clusterCount }) as string,
        );
        return;
      }
      this.deletePillarDialog = { open: true, pillarId: pillar.id, pillarName: pillar.name, loading: false };
    },

    async confirmDeletePillar(): Promise<void> {
      if (!this.deletePillarDialog.pillarId) return;
      this.deletePillarDialog.loading = true;
      try {
        const result = await this.pillarsStore.delete(this.slug, this.deletePillarDialog.pillarId);
        if (result.deleted) {
          this.notify.success(this.$t('clusters.notify.pillarDeleted') as string);
          this.deletePillarDialog.open = false;
        } else {
          this.notify.warning(
            this.$t('clusters.notify.cannotDeletePillarWithClusters', { count: result.clusterCount ?? 0 }) as string,
          );
          this.deletePillarDialog.open = false;
        }
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.deletePillarDialog.loading = false;
      }
    },

    async onMovePillar(payload: { id: string; direction: 'up' | 'down' }): Promise<void> {
      try {
        await this.pillarsStore.move(this.slug, payload.id, payload.direction);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onCreateCluster(pillarId: string): void {
      this.createClusterDialog = { open: true, pillarId };
    },

    async confirmCreateCluster(payload: { name: string; extra?: string }): Promise<void> {
      if (!this.createClusterDialog.pillarId) return;
      try {
        await this.clustersStore.create(
          this.slug,
          this.createClusterDialog.pillarId,
          payload.name,
          payload.extra,
        );
        this.notify.success(this.$t('clusters.notify.clusterCreated') as string);
        this.createClusterDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async onRenameCluster(payload: { id: string; name: string; primaryKeyword: string | null }): Promise<void> {
      try {
        await this.clustersStore.update(this.slug, payload.id, {
          name: payload.name,
          primaryKeyword: payload.primaryKeyword,
        });
        this.notify.success(this.$t('clusters.notify.clusterUpdated') as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onDeleteCluster(cluster: Cluster): void {
      this.deleteClusterDialog = {
        open: true,
        clusterId: cluster.id,
        message: cluster.articleCount > 0
          ? this.$t('clusters.dialogs.deleteClusterWithArticles', {
              name: cluster.name,
              count: cluster.articleCount,
            }) as string
          : this.$t('clusters.dialogs.deleteClusterMessage', { name: cluster.name }) as string,
        loading: false,
      };
    },

    async confirmDeleteCluster(): Promise<void> {
      if (!this.deleteClusterDialog.clusterId) return;
      this.deleteClusterDialog.loading = true;
      try {
        await this.clustersStore.delete(this.slug, this.deleteClusterDialog.clusterId);
        this.notify.success(this.$t('clusters.notify.clusterDeleted') as string);
        this.deleteClusterDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.deleteClusterDialog.loading = false;
      }
    },

    async onMoveCluster(payload: { id: string; direction: 'up' | 'down' }): Promise<void> {
      try {
        await this.clustersStore.move(this.slug, payload.id, payload.direction);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    async onChangeClusterPillar(payload: { id: string; pillarId: string }): Promise<void> {
      try {
        await this.clustersStore.update(this.slug, payload.id, { pillarId: payload.pillarId });
        this.notify.success(this.$t('clusters.notify.clusterMoved') as string);
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },

    onMoveArticlesDialog(cluster: Cluster): void {
      this.moveArticlesDialog = { open: true, cluster };
    },

    async confirmMoveArticles(payload: { fromClusterId: string; articleIds: string[]; toClusterId: string | null }): Promise<void> {
      try {
        await this.clustersStore.moveArticles(
          this.slug,
          payload.fromClusterId,
          payload.articleIds,
          payload.toClusterId,
        );
        this.notify.success(
          this.$t('clusters.notify.articlesMoved', { count: payload.articleIds.length }) as string,
        );
        this.moveArticlesDialog.open = false;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.pillar-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-state {
  text-align: center;
  padding: 80px 0;
}
</style>
```

### Frontend: PillarSection

`apps/web/src/components/clusters/PillarSection.vue`:

```vue
<template>
  <div class="pillar-section">
    <div class="pillar-section__header">
      <q-icon name="account_tree" size="20px" color="primary" class="q-mr-sm" />
      <InlineEdit
        :value="pillar.name"
        :max-length="120"
        class="pillar-section__name"
        @save="onRenameName"
      />
      <span class="pillar-section__count">{{ pillar.clusterCount }} {{ $t('clusters.fields.clusters') }}</span>

      <q-space />

      <q-btn flat dense icon="arrow_upward" :disable="isFirst" size="sm" @click="$emit('move', { id: pillar.id, direction: 'up' })">
        <q-tooltip>{{ $t('clusters.actions.moveUp') }}</q-tooltip>
      </q-btn>
      <q-btn flat dense icon="arrow_downward" :disable="isLast" size="sm" @click="$emit('move', { id: pillar.id, direction: 'down' })">
        <q-tooltip>{{ $t('clusters.actions.moveDown') }}</q-tooltip>
      </q-btn>

      <q-btn flat dense icon="more_vert" size="sm">
        <q-menu>
          <q-list>
            <q-item clickable v-close-popup @click="onEditDescription">
              <q-item-section avatar><q-icon name="description" /></q-item-section>
              <q-item-section>{{ $t('clusters.actions.editDescription') }}</q-item-section>
            </q-item>
            <q-separator />
            <q-item clickable v-close-popup class="text-negative" @click="$emit('delete', pillar)">
              <q-item-section avatar><q-icon name="delete" /></q-item-section>
              <q-item-section>{{ $t('clusters.actions.delete') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <p v-if="pillar.description" class="pillar-section__description">{{ pillar.description }}</p>

    <div class="pillar-section__clusters">
      <ClusterCard
        v-for="(cluster, idx) in clusters"
        :key="cluster.id"
        :cluster="cluster"
        :all-clusters="allClusters"
        :is-first="idx === 0"
        :is-last="idx === clusters.length - 1"
        @rename="(p) => $emit('cluster-rename', p)"
        @delete="(c) => $emit('cluster-delete', c)"
        @move="(p) => $emit('cluster-move', p)"
        @change-pillar="(p) => $emit('cluster-change-pillar', p)"
        @move-articles="(c) => $emit('cluster-move-articles', c)"
      />

      <button class="add-cluster-btn" @click="$emit('cluster-create', pillar.id)">
        <q-icon name="add" size="18px" />
        {{ $t('clusters.actions.newCluster') }}
      </button>
    </div>

    <q-dialog v-model="descriptionDialogOpen">
      <q-card style="min-width: 480px;">
        <q-card-section>
          <div class="text-h6">{{ $t('clusters.dialogs.editPillarDescription') }}</div>
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="descriptionDraft"
            outlined
            type="textarea"
            autogrow
            :label="$t('clusters.fields.description')"
            :hint="$t('clusters.fields.descriptionHint')"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
          <q-btn color="primary" :label="$t('common.save') as string" @click="confirmDescription" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { Pillar } from 'src/stores/pillars';
import type { Cluster } from 'src/stores/clusters';
import InlineEdit from 'src/components/common/InlineEdit.vue';
import ClusterCard from './ClusterCard.vue';

export default defineComponent({
  name: 'PillarSection',

  components: { InlineEdit, ClusterCard },

  props: {
    pillar: { type: Object as PropType<Pillar>, required: true },
    clusters: { type: Array as PropType<Cluster[]>, required: true },
    allClusters: { type: Array as PropType<Cluster[]>, required: true },
    isFirst: { type: Boolean, default: false },
    isLast: { type: Boolean, default: false },
    slug: { type: String, required: true },
  },

  emits: [
    'rename', 'delete', 'move',
    'cluster-create', 'cluster-rename', 'cluster-delete', 'cluster-move',
    'cluster-change-pillar', 'cluster-move-articles',
  ],

  data() {
    return {
      descriptionDialogOpen: false,
      descriptionDraft: '',
    };
  },

  methods: {
    onRenameName(name: string): void {
      this.$emit('rename', { id: this.pillar.id, name, description: this.pillar.description });
    },
    onEditDescription(): void {
      this.descriptionDraft = this.pillar.description ?? '';
      this.descriptionDialogOpen = true;
    },
    confirmDescription(): void {
      this.$emit('rename', {
        id: this.pillar.id,
        name: this.pillar.name,
        description: this.descriptionDraft.trim() || null,
      });
      this.descriptionDialogOpen = false;
    },
  },
});
</script>

<style lang="scss" scoped>
.pillar-section {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px 20px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.pillar-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.pillar-section__name {
  font-size: 16px;
  font-weight: 600;
  flex-grow: 0;
}

.pillar-section__count {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-left: 8px;
}

.pillar-section__description {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.7));
  margin: 0 0 12px;
}

.pillar-section__clusters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.add-cluster-btn {
  border: 1.5px dashed var(--q-grey-4, #ccc);
  background: none;
  border-radius: 6px;
  padding: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  min-height: 100px;
  transition: all 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.15);
  }

  &:hover {
    border-color: var(--q-primary);
    color: var(--q-primary);
  }
}
</style>
```

### Frontend: ClusterCard

`apps/web/src/components/clusters/ClusterCard.vue`:

```vue
<template>
  <div class="cluster-card">
    <div class="cluster-card__header">
      <InlineEdit
        :value="cluster.name"
        :max-length="200"
        class="cluster-card__name"
        @save="onRenameName"
      />

      <q-btn flat dense round icon="more_vert" size="sm">
        <q-menu>
          <q-list dense>
            <q-item clickable v-close-popup @click="$emit('move-articles', cluster)">
              <q-item-section avatar><q-icon name="swap_horiz" /></q-item-section>
              <q-item-section>{{ $t('clusters.actions.moveArticles') }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup>
              <q-item-section avatar><q-icon name="arrow_upward" /></q-item-section>
              <q-item-section @click="$emit('move', { id: cluster.id, direction: 'up' })">{{ $t('clusters.actions.moveUp') }}</q-item-section>
            </q-item>
            <q-item clickable v-close-popup>
              <q-item-section avatar><q-icon name="arrow_downward" /></q-item-section>
              <q-item-section @click="$emit('move', { id: cluster.id, direction: 'down' })">{{ $t('clusters.actions.moveDown') }}</q-item-section>
            </q-item>
            <q-item clickable>
              <q-item-section avatar><q-icon name="account_tree" /></q-item-section>
              <q-item-section>{{ $t('clusters.actions.changePillar') }}</q-item-section>
              <q-item-section side><q-icon name="chevron_right" /></q-item-section>
              <q-menu anchor="top end" self="top start">
                <q-list dense>
                  <q-item
                    v-for="otherPillar in availablePillars"
                    :key="otherPillar.id"
                    clickable
                    v-close-popup
                    @click="$emit('change-pillar', { id: cluster.id, pillarId: otherPillar.id })"
                  >
                    <q-item-section>{{ otherPillar.name }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-item>
            <q-separator />
            <q-item clickable v-close-popup class="text-negative" @click="$emit('delete', cluster)">
              <q-item-section avatar><q-icon name="delete" /></q-item-section>
              <q-item-section>{{ $t('clusters.actions.delete') }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </div>

    <div class="cluster-card__stats">
      <span class="stat">
        <q-icon name="article" size="14px" />
        {{ cluster.articleCount }} {{ $t('clusters.fields.articles') }}
      </span>
      <span class="stat">
        <q-icon name="star" size="14px" />
        {{ cluster.cornerstoneCount }} {{ $t('clusters.fields.cornerstones') }}
      </span>
    </div>

    <div v-if="cluster.primaryKeyword" class="cluster-card__keyword">
      <q-icon name="search" size="12px" class="q-mr-xs" />
      <code>{{ cluster.primaryKeyword }}</code>
    </div>

    <div v-if="cluster.pillarArticleTitle" class="cluster-card__pillar-article">
      <q-icon name="bookmark" size="12px" class="q-mr-xs" />
      <span>{{ $t('clusters.fields.pillarArticle') }}: <strong>{{ cluster.pillarArticleTitle }}</strong></span>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { Cluster } from 'src/stores/clusters';
import InlineEdit from 'src/components/common/InlineEdit.vue';

export default defineComponent({
  name: 'ClusterCard',

  components: { InlineEdit },

  props: {
    cluster: { type: Object as PropType<Cluster>, required: true },
    allClusters: { type: Array as PropType<Cluster[]>, required: true },
    isFirst: { type: Boolean, default: false },
    isLast: { type: Boolean, default: false },
  },

  emits: ['rename', 'delete', 'move', 'change-pillar', 'move-articles'],

  computed: {
    availablePillars() {
      // Other pillars in same project (excluding current pillar)
      const otherPillarIds = new Set<string>();
      const result: Array<{ id: string; name: string }> = [];
      for (const c of this.allClusters) {
        if (c.pillarId === this.cluster.pillarId) continue;
        if (otherPillarIds.has(c.pillarId)) continue;
        otherPillarIds.add(c.pillarId);
        if (c.pillarName) result.push({ id: c.pillarId, name: c.pillarName });
      }
      return result;
    },
  },

  methods: {
    onRenameName(name: string): void {
      this.$emit('rename', {
        id: this.cluster.id,
        name,
        primaryKeyword: this.cluster.primaryKeyword,
      });
    },
  },
});
</script>

<style lang="scss" scoped>
.cluster-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 12px;
  background: var(--q-grey-1, #fafafa);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
  }
}

.cluster-card__header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.cluster-card__name {
  flex-grow: 1;
  font-weight: 500;
  font-size: 14px;
}

.cluster-card__stats {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-bottom: 6px;
}

.stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.cluster-card__keyword {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  display: flex;
  align-items: center;
  margin-top: 4px;

  code {
    background: rgba(0, 0, 0, 0.05);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10.5px;

    body.body--dark & {
      background: rgba(255, 255, 255, 0.05);
    }
  }
}

.cluster-card__pillar-article {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.6));
  display: flex;
  align-items: center;
  margin-top: 4px;
  padding: 4px 0;
  border-top: 1px dashed var(--q-grey-3, #e0e0e0);

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.08);
  }
}
</style>
```

### Frontend: InlineEdit (Reusable)

`apps/web/src/components/common/InlineEdit.vue`:

```vue
<template>
  <span class="inline-edit">
    <input
      v-if="editing"
      ref="inputEl"
      v-model="draft"
      :maxlength="maxLength"
      :class="['inline-edit__input', { 'inline-edit__input--invalid': !isValid }]"
      type="text"
      @blur="onBlur"
      @keydown.enter.prevent="onConfirm"
      @keydown.escape.prevent="onCancel"
    />
    <span v-else class="inline-edit__display" tabindex="0" @click="onActivate" @keydown.enter="onActivate">
      {{ value }}
      <q-icon name="edit" size="11px" class="inline-edit__icon" />
    </span>
  </span>
</template>

<script lang="ts">
import { defineComponent, nextTick } from 'vue';

export default defineComponent({
  name: 'InlineEdit',

  props: {
    value: { type: String, required: true },
    maxLength: { type: Number, default: 200 },
    minLength: { type: Number, default: 2 },
  },

  emits: ['save'],

  data() {
    return {
      editing: false,
      draft: '',
    };
  },

  computed: {
    isValid(): boolean {
      const trimmed = this.draft.trim();
      return trimmed.length >= this.minLength && trimmed.length <= this.maxLength;
    },
  },

  methods: {
    async onActivate(): Promise<void> {
      this.draft = this.value;
      this.editing = true;
      await nextTick();
      const input = this.$refs.inputEl as HTMLInputElement | undefined;
      if (input) {
        input.focus();
        input.select();
      }
    },

    onBlur(): void {
      // Save on blur if valid and changed
      this.onConfirm();
    },

    onConfirm(): void {
      const trimmed = this.draft.trim();
      if (!this.isValid) {
        this.editing = false;
        return;
      }
      if (trimmed !== this.value) {
        this.$emit('save', trimmed);
      }
      this.editing = false;
    },

    onCancel(): void {
      this.editing = false;
      this.draft = '';
    },
  },
});
</script>

<style lang="scss" scoped>
.inline-edit {
  display: inline-flex;
  align-items: center;
}

.inline-edit__display {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: text;
  padding: 2px 4px;
  margin: -2px -4px;
  border-radius: 4px;
  outline: none;

  &:hover, &:focus {
    background: rgba(0, 0, 0, 0.04);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.04);
    }

    .inline-edit__icon {
      opacity: 0.6;
    }
  }
}

.inline-edit__icon {
  opacity: 0;
  transition: opacity 0.15s;
}

.inline-edit__input {
  font: inherit;
  color: inherit;
  background: var(--q-card-bg, #fff);
  border: 1.5px solid var(--q-primary);
  border-radius: 4px;
  padding: 1px 4px;
  outline: none;
  min-width: 100px;

  body.body--dark & {
    background: rgba(0, 0, 0, 0.3);
  }

  &--invalid {
    border-color: var(--q-negative);
  }
}
</style>
```

### Frontend: ArticleMoveDialog

`apps/web/src/components/clusters/ArticleMoveDialog.vue`:

```vue
<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" persistent>
    <q-card style="min-width: 600px; max-width: 720px;">
      <q-card-section>
        <div class="text-h6">{{ $t('clusters.dialogs.moveArticles') }}</div>
        <div v-if="fromCluster" class="text-caption text-grey-7 q-mt-xs">
          {{ $t('clusters.dialogs.moveArticlesFrom', { name: fromCluster.name }) }}
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section v-if="loading" class="text-center q-pa-xl">
        <q-spinner size="2em" color="primary" />
      </q-card-section>

      <q-card-section v-else-if="articles.length === 0" class="text-center q-pa-xl">
        <p class="text-body2 text-grey-7">{{ $t('clusters.dialogs.noArticlesInCluster') }}</p>
      </q-card-section>

      <q-card-section v-else>
        <div class="article-list">
          <label
            v-for="article in articles"
            :key="article.id"
            class="article-row"
          >
            <q-checkbox v-model="selected" :val="article.id" />
            <span class="article-row__title">{{ article.title || article.cornerstoneKeyword }}</span>
            <span v-if="article.cornerstoneSpecId" class="article-row__cornerstone-badge">
              {{ $t('articles.card.cornerstone') }}
            </span>
          </label>
        </div>

        <q-separator class="q-my-md" />

        <q-select
          v-model="targetClusterId"
          :options="targetOptions"
          emit-value
          map-options
          outlined
          dense
          :label="$t('clusters.dialogs.moveTo')"
        />
      </q-card-section>

      <q-separator />

      <q-card-actions align="right">
        <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
        <q-btn
          color="primary"
          :label="$t('clusters.dialogs.moveSelectedCount', { count: selected.length }) as string"
          :disable="selected.length === 0 || targetClusterId === undefined"
          @click="onConfirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useArticlesStore, type ArticleListItem } from 'src/stores/articles';
import type { Cluster } from 'src/stores/clusters';

export default defineComponent({
  name: 'ArticleMoveDialog',

  props: {
    modelValue: { type: Boolean, default: false },
    slug: { type: String, required: true },
    fromCluster: { type: Object as PropType<Cluster | null>, default: null },
    allClusters: { type: Array as PropType<Cluster[]>, required: true },
  },

  emits: ['update:modelValue', 'confirm'],

  setup() {
    return { articlesStore: useArticlesStore() };
  },

  data() {
    return {
      selected: [] as string[],
      targetClusterId: undefined as string | null | undefined,
      loading: false,
    };
  },

  computed: {
    articles(): ArticleListItem[] {
      if (!this.fromCluster) return [];
      const all = this.articlesStore.byProject[this.slug] ?? [];
      return all.filter((a) => a.clusterId === this.fromCluster!.id);
    },
    targetOptions() {
      const otherClusters = this.allClusters.filter((c) => c.id !== this.fromCluster?.id);
      return [
        { label: this.$t('clusters.dialogs.uncategorized') as string, value: null },
        ...otherClusters.map((c) => ({
          label: `${c.pillarName ? c.pillarName + ' › ' : ''}${c.name}`,
          value: c.id,
        })),
      ];
    },
  },

  watch: {
    modelValue(open: boolean): void {
      if (open) {
        this.selected = [];
        this.targetClusterId = undefined;
        if (this.articlesStore.byProject[this.slug] === undefined) {
          this.loading = true;
          void this.articlesStore.fetchForProject(this.slug).finally(() => {
            this.loading = false;
          });
        }
      }
    },
  },

  methods: {
    onConfirm(): void {
      if (!this.fromCluster || this.selected.length === 0 || this.targetClusterId === undefined) return;
      this.$emit('confirm', {
        fromClusterId: this.fromCluster.id,
        articleIds: this.selected,
        toClusterId: this.targetClusterId,
      });
    },
  },
});
</script>

<style lang="scss" scoped>
.article-list {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.article-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  &:last-child {
    border-bottom: none;
  }

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }

  &:hover {
    background: rgba(0, 0, 0, 0.03);

    body.body--dark & {
      background: rgba(255, 255, 255, 0.03);
    }
  }
}

.article-row__title {
  flex-grow: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-row__cornerstone-badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(63, 81, 181, 0.1);
  color: var(--q-primary);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 600;
}
</style>
```

### Frontend: ClusterCreateDialog + ConfirmDeleteDialog

`apps/web/src/components/clusters/ClusterCreateDialog.vue`:

```vue
<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)">
    <q-card style="min-width: 420px;">
      <q-card-section>
        <div class="text-h6">{{ title }}</div>
      </q-card-section>
      <q-card-section class="q-gutter-md">
        <q-input
          v-model="name"
          outlined
          dense
          autofocus
          :label="nameLabel"
          :rules="[
            (v: string) => (v && v.trim().length >= 2) || $t('clusters.validation.nameTooShort') as string,
          ]"
        />
        <q-input
          v-if="extraFieldLabel"
          v-model="extra"
          outlined
          dense
          :label="extraFieldLabel + (extraFieldOptional ? ' (' + ($t('common.optional') as string) + ')' : '')"
        />
        <q-input
          v-if="descriptionField"
          v-model="description"
          outlined
          type="textarea"
          autogrow
          :label="$t('clusters.fields.description') + ' (' + ($t('common.optional') as string) + ')'"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
        <q-btn
          color="primary"
          :label="$t('common.create') as string"
          :disable="!isValid"
          @click="onConfirm"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'ClusterCreateDialog',

  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, required: true },
    nameLabel: { type: String, required: true },
    extraFieldLabel: { type: String, default: '' },
    extraFieldOptional: { type: Boolean, default: false },
    descriptionField: { type: Boolean, default: false },
  },

  emits: ['update:modelValue', 'confirm'],

  data: () => ({
    name: '',
    extra: '',
    description: '',
  }),

  computed: {
    isValid(): boolean {
      return this.name.trim().length >= 2;
    },
  },

  watch: {
    modelValue(open: boolean): void {
      if (open) {
        this.name = '';
        this.extra = '';
        this.description = '';
      }
    },
  },

  methods: {
    onConfirm(): void {
      if (!this.isValid) return;
      const payload: { name: string; extra?: string; description?: string } = { name: this.name.trim() };
      if (this.extra.trim()) payload.extra = this.extra.trim();
      if (this.description.trim()) payload.description = this.description.trim();
      this.$emit('confirm', payload);
    },
  },
});
</script>
```

`apps/web/src/components/common/ConfirmDeleteDialog.vue`:

```vue
<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" persistent>
    <q-card style="min-width: 420px;">
      <q-card-section class="row items-center">
        <q-icon name="warning" color="negative" size="32px" class="q-mr-md" />
        <div>
          <div class="text-h6">{{ title }}</div>
          <div class="text-body2 text-grey-7 q-mt-xs">{{ message }}</div>
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat :label="$t('common.cancel') as string" v-close-popup />
        <q-btn color="negative" :label="$t('common.delete') as string" :loading="loading" @click="$emit('confirm')" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'ConfirmDeleteDialog',

  props: {
    modelValue: { type: Boolean, default: false },
    title: { type: String, required: true },
    message: { type: String, required: true },
    loading: { type: Boolean, default: false },
  },

  emits: ['update:modelValue', 'confirm'],
});
</script>
```

### Routing

Add route in `apps/web/src/router/routes.ts`:

```typescript
{
  path: '/projects/:slug/clusters',
  name: 'project-clusters',
  component: () => import('pages/ClustersManagementPage.vue'),
  props: true,
  meta: { requiresAuth: true },
}
```

Add link in Project Hub (`ArticlesPanel.vue` or main project page) to navigate here:

```vue
<q-btn
  flat
  icon="account_tree"
  :label="$t('clusters.actions.manage') as string"
  :to="{ name: 'project-clusters', params: { slug } }"
/>
```

### i18n keys

`apps/web/src/i18n/de/clusters.ts`:

```typescript
export default {
  pageTitle: 'Cluster & Pillars',
  empty: 'Noch keine Pillars angelegt.',
  emptyHint: 'Lege einen Pillar an, um Cluster zu organisieren.',

  fields: {
    pillarName: 'Pillar-Name',
    clusterName: 'Cluster-Name',
    description: 'Beschreibung',
    descriptionHint: 'Kurze Beschreibung der inhaltlichen Säule',
    primaryKeyword: 'Primäres Keyword',
    clusters: 'Cluster',
    articles: 'Artikel',
    cornerstones: 'Cornerstones',
    pillarArticle: 'Pillar-Artikel',
  },

  actions: {
    manage: 'Cluster verwalten',
    newPillar: 'Neuer Pillar',
    newCluster: 'Neuer Cluster',
    moveUp: 'Nach oben',
    moveDown: 'Nach unten',
    editDescription: 'Beschreibung bearbeiten',
    delete: 'Löschen',
    moveArticles: 'Artikel verschieben…',
    changePillar: 'Pillar ändern',
  },

  dialogs: {
    createPillar: 'Neuer Pillar',
    createCluster: 'Neuer Cluster',
    deletePillar: 'Pillar löschen?',
    deletePillarMessage: 'Pillar "{name}" wirklich löschen? Diese Aktion ist nicht rückgängig zu machen.',
    deleteCluster: 'Cluster löschen?',
    deleteClusterMessage: 'Cluster "{name}" wirklich löschen?',
    deleteClusterWithArticles: 'Cluster "{name}" wirklich löschen? Die {count} enthaltenen Artikel werden zu "Ohne Cluster" verschoben.',
    editPillarDescription: 'Pillar-Beschreibung bearbeiten',
    moveArticles: 'Artikel verschieben',
    moveArticlesFrom: 'Aus Cluster: {name}',
    moveTo: 'Verschieben nach',
    uncategorized: '— Ohne Cluster —',
    noArticlesInCluster: 'Dieser Cluster enthält keine Artikel.',
    moveSelectedCount: '{count} verschieben',
  },

  notify: {
    pillarCreated: 'Pillar angelegt',
    pillarUpdated: 'Pillar aktualisiert',
    pillarDeleted: 'Pillar gelöscht',
    clusterCreated: 'Cluster angelegt',
    clusterUpdated: 'Cluster aktualisiert',
    clusterDeleted: 'Cluster gelöscht',
    clusterMoved: 'Cluster verschoben',
    articlesMoved: '{count} Artikel verschoben',
    cannotDeletePillarWithClusters: 'Pillar kann nicht gelöscht werden — enthält noch {count} Cluster. Verschiebe oder lösche sie zuerst.',
  },

  validation: {
    nameTooShort: 'Mindestens 2 Zeichen',
  },
};
```

`apps/web/src/i18n/de/common.ts` — add if missing:

```typescript
// existing keys
optional: 'optional',
create: 'Anlegen',
delete: 'Löschen',
save: 'Speichern',
cancel: 'Abbrechen',
```

Mirror in `en/`.

## Acceptance Criteria

### Schema + Backend

- [ ] Migration adds `clusters.position` column with backfill
- [ ] `GET /api/pillars?projectSlug=foo` returns pillars ordered by position with cluster counts
- [ ] `POST /api/pillars` creates a pillar with auto-incremented position
- [ ] `PATCH /api/pillars/:id` updates name and/or description
- [ ] `DELETE /api/pillars/:id` returns 409 with `{error: "pillar_has_clusters"}` when clusters exist
- [ ] `DELETE /api/pillars/:id` succeeds when 0 clusters
- [ ] `POST /api/pillars/:id/move` swaps positions; no-op at boundary
- [ ] `GET /api/clusters?projectSlug=foo` returns clusters with article + cornerstone counts + pillarArticleTitle
- [ ] `GET /api/clusters?projectSlug=foo&pillarId=...` filters to one pillar
- [ ] `POST /api/clusters` creates a cluster with denormalized pillar name + auto position
- [ ] `PATCH /api/clusters/:id` updates name, primaryKeyword, or pillarId (with denormalized pillar name update + position reset)
- [ ] `DELETE /api/clusters/:id` cascades articles.clusterId to null
- [ ] `POST /api/clusters/:id/move` swaps positions within same pillar
- [ ] `POST /api/clusters/:id/move-articles` validates source ownership + same-project + updates clusterId
- [ ] `recalcPillarArticleId(clusterId)` correctly sets first cornerstone or null
- [ ] `recalcPillarArticleId` is called after move-articles, after article PATCH (cluster change)
- [ ] Backfill script runs once after migration
- [ ] All endpoints require auth

### Page + Navigation

- [ ] `/projects/:slug/clusters` route renders the page
- [ ] Breadcrumb: Projects › Project Name › Clusters
- [ ] Link from Project Hub Articles panel: "Cluster verwalten" navigates here
- [ ] Empty state when no pillars

### PillarSection

- [ ] Inline-edit on pillar name (click → edit → blur/Enter saves)
- [ ] Description editable via menu → dialog
- [ ] Move up/down buttons disabled at boundaries
- [ ] Delete blocks if clusters > 0 (toast warning)
- [ ] Cluster count shown next to name
- [ ] "+ New cluster" button at end of cluster grid

### ClusterCard

- [ ] Inline-edit on cluster name
- [ ] Stats: article count + cornerstone count
- [ ] Primary keyword shown if set
- [ ] PillarArticle title shown if set, with bookmark icon, read-only
- [ ] Menu: Move articles, Move up/down, Change pillar (sub-menu lists other pillars), Delete
- [ ] Change pillar sub-menu only shows pillars different from current

### ArticleMoveDialog

- [ ] Lists articles in source cluster
- [ ] Multi-select via checkboxes
- [ ] Cornerstones distinguished with badge
- [ ] Target dropdown shows all other clusters + "Uncategorized"
- [ ] Confirm button disabled when 0 selected or target undefined
- [ ] Confirm calls API and closes dialog on success

### Notifications

- [ ] All success actions show success toast
- [ ] Pillar-deletion-with-clusters shows warning with cluster count
- [ ] HTTP errors via `e.userMessage`

## Testing Strategy

Manual smoke tests:

1. **Empty project**: Visit page on project with no Cold-Start. See empty state, "New pillar" button visible.
2. **Create pillar**: Click "New pillar", enter name, confirm. Pillar appears in list.
3. **Rename pillar**: Click pillar name, edit, blur. Verify update.
4. **Description edit**: Open pillar menu → Edit description → enter text → save. Verify display.
5. **Move pillar up/down**: Multiple pillars; click ↑/↓ buttons. Verify reorder.
6. **Delete empty pillar**: Confirm dialog → delete. Pillar gone.
7. **Delete pillar with clusters**: Try to delete a pillar with clusters. See warning.
8. **Create cluster**: Click "New cluster" within a pillar. Enter name + primary keyword. Cluster appears.
9. **Rename cluster**: Inline-edit cluster name.
10. **Move cluster between pillars**: Menu → Change pillar → select target. Cluster moves.
11. **Delete cluster with articles**: Confirm with article count message. Articles become uncategorized in Spec 36 Kanban.
12. **Move articles between clusters**: Open Move articles dialog → multi-select 3 articles → choose target cluster → confirm. Verify counts update on both clusters.
13. **PillarArticle auto-update**: After moving articles, verify the pillarArticleTitle reflects current first cornerstone.
14. **Backfill verification**: Run `bun run apps/api/src/scripts/backfill-pillar-articles.ts`; verify all clusters with cornerstones have a pillarArticleId.

## Open Questions / Decisions Made

**Decision 1: Inline edit triggers on click, not double-click.**
Faster UX. Loss of single-click selection (which doesn't matter here) is negligible.

**Decision 2: Description is in a separate dialog, not inline.**
Multi-line text in inline-edit feels janky. Dialog is cleaner.

**Decision 3: "Move up/down" instead of drag-and-drop.**
Easier to get right. Drag-and-drop is a fast-follow.

**Decision 4: pillarArticleId auto-detect runs on every change.**
Keeps it consistent without manual trigger. The performance cost is one tiny SELECT + one UPDATE per change — negligible.

**Decision 5: Pipeline-created articles do NOT auto-trigger pillarArticleId recalc.**
This is a deliberate gap to avoid coupling pipelines/article-creation logic to cluster routes. The first HTTP interaction with such an article (status change, etc.) will trigger recalc. The backfill script covers initial Cold-Start outputs.

**Decision 6: Cluster move resets position to end of new pillar.**
Alternative would be to preserve relative position. End-of-list is simpler and predictable.

**Decision 7: No cluster archival flag.**
The schema's `clusters.status` column already exists with default `'proposed'`. We don't surface it. Hard delete is sufficient for now.

**Decision 8: `pillar` denormalized field on clusters is updated on pillar change.**
Critical for `TopicIntakeStep` consumers that read this without joining.

**Decision 9: Backend transaction wraps position swap, not whole pillar/cluster lifecycle.**
Position-swap requires atomicity (otherwise one row could end up at -1 sentinel forever). Other operations are single-statement and don't need transactions.

**Decision 10: `availablePillars` computed from `allClusters` rather than a separate pillars list prop.**
Simplifies the component API; clusters carry pillarName/pillarId already. Side effect: a pillar with zero clusters won't appear in the "Change pillar" sub-menu. This is acceptable — moving a cluster to an empty pillar is a rare action, and the page UI shows empty pillars (you'd just create a placeholder cluster first if needed).

**However**, if Marcel wants to move a cluster INTO an empty pillar, this is a gap. **Fix:** pass `pillars` as a prop alongside `allClusters` to ClusterCard, derive `availablePillars` from the actual pillars list, not from clusters. Implementer should make this adjustment.

## Implementation Order

**Recommend 3 sessions.**

**Session 1: Schema + Backend (~5h)**

1. Migration for `clusters.position` (~30 min)
2. `pillarRoutes` (CRUD + move) (~1.5h)
3. `clusterRoutes` (CRUD + move + move-articles) (~1.5h)
4. `recalcPillarArticleId` helper + wiring into article PATCH (~30 min)
5. Backfill script (~15 min)
6. Test endpoints with curl + verify edge cases (~45 min)
7. Commit: `feat(api,db): pillars + clusters CRUD + position (spec 37)`

**Session 2: Stores + Page Shell + PillarSection (~5h)**

1. `pillars.ts` + `clusters.ts` Pinia stores (~1h)
2. `ClustersManagementPage.vue` shell (~1h)
3. `InlineEdit.vue` reusable component (~45 min)
4. `PillarSection.vue` (~1h)
5. `ConfirmDeleteDialog.vue` + `ClusterCreateDialog.vue` (~45 min)
6. Routing + Project Hub link (~15 min)
7. i18n keys (~30 min)
8. Manual test create/rename/move/delete pillars (~45 min)
9. Commit: `feat(web): cluster management page + pillar CRUD (spec 37)`

**Session 3: ClusterCard + ArticleMoveDialog (~4h)**

1. `ClusterCard.vue` with menu and sub-menu (~1.5h)
2. `ArticleMoveDialog.vue` (~1.5h)
3. Wire all event emits in page (~30 min)
4. End-to-end test full flow (~45 min)
5. Commit: `feat(web): cluster card + article move dialog (spec 37)`

Total: ~14 hours.

## Splitting Plan

See "Implementation Order" — 3 sessions with `/clear` between.

## Discovered During Implementation

- **`requireAuth` import path gotcha**: The middleware is in `src/middleware/auth.ts`, not a separate `require-auth.ts`. Importing from `"../middleware/require-auth"` compiles silently but crashes the server at startup. Added to `apps/api/CLAUDE.md` Common Mistakes.
- **`clusters.position` already in schema?**: The Drizzle schema file (`identity.ts`) did NOT have `position` on `clusters` (only on `contentPillars`). The initial migration SQL also lacked it. Migration `0011_clusters_position.sql` was written manually and added to `_journal.json` (drizzle-kit interactive mode stalls in non-TTY — existing DB CLAUDE.md documents this).
- **`InlineEdit.vue` and `ConfirmDeleteDialog.vue`** added as reusable components in `src/components/common/`. Future specs that need inline editing or delete confirmations should reuse these.

## Deviations

- **`.trim()` added to all name/keyword inputs before DB insert/update** (not in spec): Prevents whitespace-only names from passing Zod's `min(2)` check while still storing as blank. Both pillars and clusters routes apply this.
- **Description PATCH normalizes empty string to null** (`input.description?.trim() || null`): The spec passed the value through directly; this ensures empty descriptions are stored as NULL rather than `""`.
- **Implemented in one session** instead of the planned 3: All backend + frontend written together. No functional impact; the 3-session plan was a human-pacing estimate.
