# Spec 47: Pagination Refactor

**Phase:** Marketing-Tool tech-debt resolution (Backlog B-008)
**Estimated Effort:** 4-5 hours (1 session, structured into 6 sections)
**Dependencies:** Spec 44+45 (imported articles), Spec 38 (cost dashboard reference pattern)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (focused endpoint + store refactor, no new logic)
**Repos affected:** marketing-tool (api + web)

---

## Context

Several endpoints currently load all rows without `limit` — fine in dev with tiny data, breaks with real-world data. After Spec 44 import, **toolwiki has 268+ articles**. Other endpoints that affect performance:

- `/articles` — loads all articles per project (Kanban board)
- `/articles/imported` — loads all imported articles + groups into pairs in-memory
- `/articles/across-projects` — loads across all projects (cross-project Inbox view)
- `/clusters` — loads all clusters per project
- `/notifications` — has `limit` only, no `offset` or `total`
- `/projects/:slug/astro-import-runs` — loads up to 20 (hardcoded, no pagination)
- `/pipeline-runs/project/:projectId` — loads recent runs (no count visible)

**Existing reference pattern**: `/cost/logs` (Spec 38) already uses `limit` + `offset` + `total` with Zod-validated query schema and parallel `count(*)` query. We reuse this pattern.

## Goal

After this spec:
- **Articles (Kanban)**: per-lane pagination — top 50 most-recent per status, `?lane=<status>&offset=<n>` for "show more"
- **Imported Articles**: classical `limit`/`offset`/`total` with pair-grouping preserved
- **Clusters**: classical pagination with `?limit=50&offset=0`, defaults reasonable
- **Notifications**: complete the pattern — add `offset` and `total`
- **Astro-Import-Runs**: paginated with default 10, max 50
- **Across-Projects**: same `limit`/`offset` as `/articles`
- **Frontend stores**: track pagination state per resource type, support "load more" or page navigation
- **All endpoints**: consistent response envelope `{ ok, data: { items, total, limit, offset } }`

## Non-Goals

- **No cursor-based pagination** — offset/limit is good enough for now; switch to cursor only when datasets grow >100k (not imminent).
- **No infinite-scroll changes** — current Kanban "show all in lane" UX is preserved; pagination kicks in only when lane > 50 items.
- **No filtering/sorting overhaul** — existing filters stay as-is; we only add pagination dimensions.
- **No search-index integration** — full-text search is future work; pagination ≠ search.
- **No client-side virtual-scroll** — server-side pagination is cleaner; q-table handles 50 rows trivially without virtualization.
- **No re-pagination for `/clusters/:id`** — single-cluster detail is small; no need.
- **No pagination for cornerstone-specs list** — currently <100 per project, threshold not reached.

## Pre-flight

```bash
cd <marketing-tool-repo>
git status --porcelain  # clean
git checkout -b feature/47-pagination
bun test 2>&1 | tail -3  # green baseline
```

## Architecture Overview

**Reference pattern** (already implemented in `/cost/logs`):

```typescript
const querySchema = z.object({
  // ... filters ...
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const [items, countRows] = await Promise.all([
  db.select({ ... }).from(...).where(whereClause)
    .orderBy(desc(...)).limit(q.limit).offset(q.offset),
  db.select({ count: sql<number>`count(*)::int` }).from(...).where(whereClause),
]);

return c.json({
  ok: true,
  data: { items, total: countRows[0]?.count ?? 0, limit: q.limit, offset: q.offset },
});
```

Every paginated endpoint adopts this exact shape. Frontend stores standardize on the same response.

**Articles Kanban exception**: needs **per-lane** pagination because users want to see all status-groups at once. Solution: when querying `?lane=<status>`, return paginated items for that status. Default (no `lane` param): return top 50 across all statuses with status grouping done client-side. Empty/sparse lanes show all; full lanes show "+N more, load more →".

## Splitting Plan

6 sections for `/start-task /review-task` workflow:

```
A — Shared pagination helpers + types        ~30min   [task: 47.1-helpers]
B — Articles endpoints (kanban + imported)   ~1.5h    [task: 47.2-articles]
C — Clusters + remaining list endpoints      ~45min   [task: 47.3-clusters-misc]
D — Frontend stores update                   ~1h      [task: 47.4-stores]
E — UI: "Load more" buttons + page controls  ~1h      [task: 47.5-ui]
F — Tests + verification                     ~30min   [task: 47.6-tests]
```

---

## Section A — Shared Pagination Helpers

### A.1 Files to create

- `apps/api/src/lib/pagination.ts` (new) — Zod schemas + types
- (no frontend changes in this section)

### A.2 Helper module

```typescript
// apps/api/src/lib/pagination.ts
import { z } from "zod";

/**
 * Standard pagination query parameters.
 *
 * Use `.extend(...)` to add endpoint-specific filters:
 *   const articlesQuerySchema = paginationQuerySchema.extend({
 *     projectSlug: z.string(),
 *     status: z.string().optional(),
 *   });
 */
export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Standard pagination response envelope. Items field is generic.
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Helper to build a PaginatedResponse from drizzle query results.
 *
 * Usage:
 *   const [rows, countRows] = await Promise.all([
 *     db.select(...).where(...).limit(q.limit).offset(q.offset),
 *     db.select({ count: sql<number>`count(*)::int` }).from(...).where(...),
 *   ]);
 *   return c.json({ ok: true, data: paginated(rows, countRows, q) });
 */
export function paginated<T>(
  items: T[],
  countRows: Array<{ count: number }>,
  q: PaginationQuery
): PaginatedResponse<T> {
  return {
    items,
    total: countRows[0]?.count ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}
```

### A.3 Section A Acceptance

- [ ] `apps/api/src/lib/pagination.ts` exists with `paginationQuerySchema`, `PaginationQuery`, `PaginatedResponse`, `paginated()` helper
- [ ] Type-check passes: `bun --filter @marketing-auto/api tsc --noEmit`
- [ ] Commit: `feat(api): pagination helpers (47.1)`

---

## Section B — Articles Endpoints (Kanban + Imported)

### B.1 Files modified

- `apps/api/src/routes/articles.ts` — three endpoints reworked

### B.2 `/articles` — Kanban per-lane mode

Two query modes:

**Mode 1 (default, no `lane` param)**: returns top 50 most-recently-updated articles per project, with `total` count. Client groups by status into Kanban lanes. Suitable for projects with <50 articles in any lane.

**Mode 2 (`?lane=<status>&offset=<n>`)**: returns paginated articles for ONE status (for "Load more" within a lane). Limit defaults 50, max 200.

```typescript
// apps/api/src/routes/articles.ts (replace existing GET /articles handler)

import { paginated, paginationQuerySchema } from "../lib/pagination.ts";

const articlesListQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  /** When set, returns articles only for that status (Kanban lane "load more"). */
  lane: z.string().optional(),
});

articleRoutes.get(
  "/",
  zValidator("query", articlesListQuerySchema),
  async (c) => {
    const q = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, q.projectSlug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const conditions = [eq(articles.projectId, project.id)];
    if (q.lane) conditions.push(eq(articles.status, q.lane as ArticleStatus));
    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      db
        .select({
          id: articles.id,
          slug: articles.slug,
          title: articles.title,
          cornerstoneKeyword: articles.cornerstoneKeyword,
          status: articles.status,
          cornerstoneSpecId: articles.cornerstoneSpecId,
          clusterId: articles.clusterId,
          clusterName: clusters.name,
          pillarId: clusters.pillarId,
          pillarName: contentPillars.name,
          pillarPosition: contentPillars.position,
          wordCount: articles.wordCount,
          publishedAt: articles.publishedAt,
          astroSyncedAt: articles.astroSyncedAt,
          createdAt: articles.createdAt,
          updatedAt: articles.updatedAt,
          locale: articles.locale,
          source: articles.source,
        })
        .from(articles)
        .leftJoin(clusters, eq(articles.clusterId, clusters.id))
        .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
        .where(whereClause)
        .orderBy(desc(articles.updatedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(articles)
        .where(whereClause),
    ]);

    return c.json({ ok: true, data: paginated(rows, countRows, q) });
  }
);
```

**Note**: `paginated()` returns `{ items, total, limit, offset }`. Frontend renames `items` to `articles` if helpful via destructuring.

### B.3 `/articles/across-projects`

```typescript
const acrossProjectsQuerySchema = paginationQuerySchema.extend({
  statuses: z.string(),  // CSV
});

articleRoutes.get(
  "/across-projects",
  zValidator("query", acrossProjectsQuerySchema),
  async (c) => {
    const q = c.req.valid("query");

    const requested = q.statuses.split(",").map((s) => s.trim());
    const statuses = requested.filter((s): s is ArticleStatus =>
      (VALID_ARTICLE_STATUSES as readonly string[]).includes(s)
    );
    if (statuses.length === 0) {
      return c.json({ ok: false, error: "no valid statuses" }, 400);
    }

    const whereClause = inArray(articles.status, statuses);

    const [rows, countRows] = await Promise.all([
      db
        .select({ /* ... existing select ... */ })
        .from(articles)
        // ... existing joins ...
        .where(whereClause)
        .orderBy(desc(articles.updatedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(articles)
        .where(whereClause),
    ]);

    return c.json({ ok: true, data: paginated(rows, countRows, q) });
  }
);
```

### B.4 `/articles/imported` — preserved pair grouping

Tricky case: imported articles are returned **grouped into translation pairs**. Pagination must happen at the **pair level**, not per-article, otherwise pairs get split across pages.

**Strategy**:
1. Query distinct `translationKey` values (paginated) for the project + collection
2. For each translationKey, load all article-rows that share it (1 or 2 rows per pair)
3. Group into `{ de, en }` pairs
4. Count total distinct translationKeys for `total`

```typescript
const importedQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  collection: z.string().optional(),
});

articleRoutes.get(
  "/imported",
  zValidator("query", importedQuerySchema),
  async (c) => {
    const q = c.req.valid("query");
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, q.projectSlug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const conditions = [
      eq(articles.projectId, project.id),
      eq(articles.source, "imported"),
    ];
    if (q.collection) conditions.push(eq(articles.collection, q.collection));
    const whereClause = and(...conditions);

    // Step 1: get distinct translationKeys, ordered by most recent update,
    //         paginated.
    const [keyRows, countRows] = await Promise.all([
      db
        .selectDistinct({
          translationKey: articles.translationKey,
          maxUpdated: sql<string>`MAX(${articles.updatedAt})`.as("max_updated"),
        })
        .from(articles)
        .where(whereClause)
        .groupBy(articles.translationKey)
        .orderBy(desc(sql`max_updated`))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({
          count: sql<number>`count(DISTINCT ${articles.translationKey})::int`,
        })
        .from(articles)
        .where(whereClause),
    ]);

    const keys = keyRows.map((r) => r.translationKey).filter((k): k is string => !!k);

    // Step 2: load all articles for these translationKeys
    const articleRows = keys.length > 0
      ? await db
          .select({
            id: articles.id,
            slug: articles.slug,
            title: articles.title,
            locale: articles.locale,
            translationKey: articles.translationKey,
            collection: articles.collection,
            // ... rest of imported article fields ...
          })
          .from(articles)
          .where(
            and(
              eq(articles.projectId, project.id),
              eq(articles.source, "imported"),
              inArray(articles.translationKey, keys)
            )
          )
      : [];

    // Step 3: group into pairs
    const pairs = keys.map((key) => {
      const members = articleRows.filter((a) => a.translationKey === key);
      return {
        translationKey: key,
        de: members.find((m) => m.locale === "de") ?? null,
        en: members.find((m) => m.locale === "en") ?? null,
      };
    });

    return c.json({
      ok: true,
      data: paginated(pairs, countRows, q),
    });
  }
);
```

### B.5 Section B Acceptance

- [ ] `/articles` accepts `limit`, `offset`, `lane` query params
- [ ] `/articles?lane=published&limit=50` returns at most 50 published articles + `total`
- [ ] `/articles?limit=50` (no lane) returns top 50 across all statuses + `total`
- [ ] `/articles/across-projects?statuses=...&limit=50&offset=0` paginated
- [ ] `/articles/imported?projectSlug=toolwiki&collection=blog&limit=50&offset=0` returns 50 PAIRS (not 50 articles), with `total` = pair count
- [ ] Sample query against toolwiki produces correct counts (blog: 28 pairs, tools: 54 pairs, etc.)
- [ ] Type-check passes
- [ ] Commit: `feat(api): articles endpoints paginated (47.2)`

---

## Section C — Clusters + Remaining Endpoints

### C.1 Files modified

- `apps/api/src/routes/clusters.ts` — `GET /clusters` paginated
- `apps/api/src/routes/notifications.ts` — `GET /` adds offset + total
- `apps/api/src/routes/projects.ts` — `GET /:slug/astro-import-runs` paginated
- `apps/api/src/routes/pipeline-runs.ts` — `GET /project/:projectId` paginated
- `packages/core/src/notifications/index.ts` — `listNotifications()` signature gets offset

### C.2 Clusters

```typescript
const clustersListQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  pillarId: z.string().uuid().optional(),
}).extend({
  limit: z.coerce.number().int().min(1).max(200).default(100),  // higher default — fewer clusters than articles
});

clusterRoutes.get("/", zValidator("query", clustersListQuerySchema), async (c) => {
  const q = c.req.valid("query");
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, q.projectSlug))
    .limit(1);
  if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

  const conditions = [eq(clusters.projectId, project.id)];
  if (q.pillarId) conditions.push(eq(clusters.pillarId, q.pillarId));
  const whereClause = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({ /* ... existing select ... */ })
      .from(clusters)
      // ... existing joins ...
      .where(whereClause)
      .orderBy(/* ... existing order ... */)
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(clusters)
      .where(whereClause),
  ]);

  return c.json({ ok: true, data: paginated(rows, countRows, q) });
});
```

### C.3 Notifications

```typescript
// packages/core/src/notifications/index.ts
export interface ListNotificationsOptions {
  limit: number;
  offset?: number;          // NEW
  unreadOnly?: boolean;
  since?: Date;
}

export async function listNotifications(
  userId: string,
  opts: ListNotificationsOptions
): Promise<{ notifications: NotificationRow[]; total: number }> {
  const conditions = [eq(notifications.userId, userId)];
  if (opts.unreadOnly) conditions.push(isNull(notifications.readAt));
  if (opts.since) conditions.push(gte(notifications.createdAt, opts.since));
  const whereClause = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit)
      .offset(opts.offset ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(whereClause),
  ]);

  return { notifications: rows, total: countRows[0]?.count ?? 0 };
}
```

```typescript
// apps/api/src/routes/notifications.ts
const listQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().optional().default(false),
  since: z.string().datetime().optional(),
});

notificationRoutes.get("/", zValidator("query", listQuerySchema), async (c) => {
  const user = c.get("user")!;
  const q = c.req.valid("query");

  const listOpts: ListNotificationsOptions = {
    limit: q.limit,
    offset: q.offset,
    unreadOnly: q.unreadOnly,
  };
  if (q.since) listOpts.since = new Date(q.since);

  const [{ notifications: list, total }, unreadCount] = await Promise.all([
    listNotifications(user.id, listOpts),
    getUnreadCount(user.id),
  ]);

  return c.json({
    ok: true,
    data: {
      notifications: list,
      unreadCount,
      total,
      limit: q.limit,
      offset: q.offset,
    },
  });
});
```

### C.4 Astro-Import-Runs

```typescript
// apps/api/src/routes/projects.ts
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";

const importRunsQuerySchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

projectRoutes.get(
  "/:slug/astro-import-runs",
  zValidator("query", importRunsQuerySchema),
  async (c) => {
    const slug = c.req.param("slug");
    const q = c.req.valid("query");

    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    if (!project) return c.json({ ok: false, error: "Project not found" }, 404);

    const whereClause = eq(astroImportRuns.projectId, project.id);

    const [runs, countRows] = await Promise.all([
      db
        .select()
        .from(astroImportRuns)
        .where(whereClause)
        .orderBy(desc(astroImportRuns.startedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(astroImportRuns)
        .where(whereClause),
    ]);

    return c.json({ ok: true, data: paginated(runs, countRows, q) });
  }
);
```

### C.5 Pipeline-Runs by project

```typescript
// apps/api/src/routes/pipeline-runs.ts
const projectRunsQuerySchema = paginationQuerySchema.extend({
  status: z.string().optional(),
});

pipelineRunsRoutes.get(
  "/project/:projectId",
  zValidator("query", projectRunsQuerySchema),
  async (c) => {
    const projectId = c.req.param("projectId");
    const q = c.req.valid("query");

    const conditions = [eq(pipelineRuns.projectId, projectId)];
    if (q.status) conditions.push(eq(pipelineRuns.status, q.status as any));
    const whereClause = and(...conditions);

    const [rows, countRows] = await Promise.all([
      db
        .select()
        .from(pipelineRuns)
        .where(whereClause)
        .orderBy(desc(pipelineRuns.startedAt))
        .limit(q.limit)
        .offset(q.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(pipelineRuns)
        .where(whereClause),
    ]);

    return c.json({ ok: true, data: paginated(rows, countRows, q) });
  }
);
```

### C.6 Section C Acceptance

- [ ] `/clusters?projectSlug=...&limit=100&offset=0` paginated
- [ ] `/notifications?limit=50&offset=0` returns `total`
- [ ] `/projects/:slug/astro-import-runs?limit=10` paginated
- [ ] `/pipeline-runs/project/:projectId?limit=50&offset=0` paginated
- [ ] `listNotifications()` signature accepts `offset`, returns `{ notifications, total }`
- [ ] Type-check passes
- [ ] Commit: `feat(api): clusters/notifications/runs paginated (47.3)`

---

## Section D — Frontend Stores

### D.1 Files modified

- `apps/web/src/stores/articles.ts` — pagination state per project + per lane
- `apps/web/src/stores/clusters.ts` — pagination state
- `apps/web/src/stores/notifications.ts` — pagination state
- `apps/web/src/stores/cost.ts` — already has pagination, verify only

### D.2 Articles store

```typescript
// apps/web/src/stores/articles.ts (extend existing)

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface ArticlesState {
  byProject: Record<string, ArticleListItem[]>;
  paginationByProject: Record<string, PaginationState>;             // NEW
  paginationByLane: Record<string, Record<string, PaginationState>>; // NEW: project → lane → state
  detailById: Record<string, ArticleDetail | null>;
  versionsByArticle: Record<string, ArticleVersion[]>;
  loading: boolean;
}

export const useArticlesStore = defineStore("articles", {
  state: (): ArticlesState => ({
    byProject: {},
    paginationByProject: {},
    paginationByLane: {},
    detailById: {},
    versionsByArticle: {},
    loading: false,
  }),

  actions: {
    /** Initial fetch — Kanban default mode, top 50 articles across all lanes */
    async fetchForProject(slug: string, opts: { reset?: boolean } = {}): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{
          ok: boolean;
          data: { items: ArticleListItem[]; total: number; limit: number; offset: number };
        }>(`/articles?projectSlug=${slug}&limit=50&offset=0`);

        const { items, total, limit, offset } = res.data.data;
        this.byProject[slug] = items;
        this.paginationByProject[slug] = {
          total,
          limit,
          offset,
          hasMore: offset + items.length < total,
        };
        // Reset per-lane state when fetching project-wide
        if (opts.reset !== false) this.paginationByLane[slug] = {};
      } finally {
        this.loading = false;
      }
    },

    /** Load more articles for a specific lane (status group). Appends to byProject. */
    async loadMoreForLane(slug: string, lane: string): Promise<void> {
      const laneState = this.paginationByLane[slug]?.[lane];
      const offset = laneState ? laneState.offset + laneState.limit : 0;

      const res = await api.get<{
        ok: boolean;
        data: { items: ArticleListItem[]; total: number; limit: number; offset: number };
      }>(`/articles?projectSlug=${slug}&lane=${lane}&limit=50&offset=${offset}`);

      const { items, total, limit: rLimit, offset: rOffset } = res.data.data;
      const current = this.byProject[slug] ?? [];
      // Merge — deduplicate by id
      const existingIds = new Set(current.map((a) => a.id));
      const newOnes = items.filter((a) => !existingIds.has(a.id));
      this.byProject[slug] = [...current, ...newOnes];

      this.paginationByLane[slug] = this.paginationByLane[slug] ?? {};
      this.paginationByLane[slug][lane] = {
        total,
        limit: rLimit,
        offset: rOffset,
        hasMore: rOffset + items.length < total,
      };
    },
  },
});
```

### D.3 Imported articles store extension

```typescript
// Either extend articles store or in ImportedArticlesPanel.vue:
interface ImportedPair {
  translationKey: string;
  de: ImportedArticleRow | null;
  en: ImportedArticleRow | null;
}

interface ImportedPanelState {
  pairs: ImportedPair[];
  total: number;
  limit: number;
  offset: number;
  collection: string;
  loading: boolean;
}

// fetchImported(projectSlug, collection, offset=0):
const res = await api.get(`/articles/imported`, {
  params: { projectSlug, collection, limit: 50, offset },
});
this.pairs = res.data.data.items;
this.total = res.data.data.total;
// etc.
```

Note: ImportedArticlesPanel currently fetches and caches in-component. Keep that pattern; just add `total`/`offset`/`limit` to local state.

### D.4 Clusters + Notifications stores

Analog to articles — add `total`/`limit`/`offset`/`hasMore` to state, add `loadMore()` actions.

### D.5 Section D Acceptance

- [ ] `articles` store has `paginationByProject` + `paginationByLane`
- [ ] `loadMoreForLane(slug, lane)` works, appends, dedupes
- [ ] `clusters`, `notifications` stores have analog pagination state
- [ ] `cost` store already has pattern, just verify shape consistency
- [ ] Type-check passes: `bun --filter @marketing-auto/web vue-tsc --noEmit`
- [ ] Commit: `feat(web): pagination state in stores (47.4)`

---

## Section E — UI: Load More Buttons + Page Controls

### E.1 Files modified

- `apps/web/src/components/articles/ArticleKanbanLane.vue` — "Load more" footer button
- `apps/web/src/components/articles/ImportedArticlesPanel.vue` — q-table pagination prop
- `apps/web/src/pages/ClustersManagementPage.vue` — "Load more" or page controls
- `apps/web/src/components/notifications/NotificationsList.vue` — "Load more" button
- `apps/web/src/components/cost/CostLogsTable.vue` — verify existing pagination still works

### E.2 ArticleKanbanLane "Load more"

```vue
<!-- apps/web/src/components/articles/ArticleKanbanLane.vue -->
<template>
  <div class="kanban-lane">
    <div class="lane-header">
      <span class="lane-title">{{ lane.label }}</span>
      <q-badge color="grey-5" outline>
        {{ visibleCount }}<span v-if="totalForLane > visibleCount">/{{ totalForLane }}</span>
      </q-badge>
    </div>

    <div class="lane-cards">
      <ArticleKanbanCard
        v-for="article in lane.articles"
        :key="article.id"
        :article="article"
      />
    </div>

    <q-btn
      v-if="hasMore"
      flat
      dense
      class="lane-load-more"
      :label="$t('articles.kanban.loadMore', { remaining: totalForLane - visibleCount })"
      :loading="loadingMore"
      @click="$emit('load-more', lane.status)"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface KanbanLane {
  status: string;
  label: string;
  articles: ArticleListItem[];
}

export default defineComponent({
  name: "ArticleKanbanLane",
  emits: ["load-more"],
  props: {
    lane: { type: Object as PropType<KanbanLane>, required: true },
    totalForLane: { type: Number, default: 0 },
    hasMore: { type: Boolean, default: false },
    loadingMore: { type: Boolean, default: false },
  },
  computed: {
    visibleCount(): number {
      return this.lane.articles.length;
    },
  },
});
</script>
```

ArticlesPage passes `totalForLane` and `hasMore` from store's `paginationByLane[slug][status]`. On `load-more` event, calls `store.loadMoreForLane(slug, status)`.

### E.3 ImportedArticlesPanel — q-table pagination

```vue
<!-- apps/web/src/components/articles/ImportedArticlesPanel.vue -->
<q-table
  :rows="pairs"
  :columns="columns"
  row-key="translationKey"
  v-model:pagination="tablePagination"
  :rows-number="total"
  @request="onPaginationRequest"
  :loading="loading"
  flat
  dense
/>

<script lang="ts">
// Data:
tablePagination: {
  page: 1,
  rowsPerPage: 50,
  rowsNumber: 0,
  sortBy: "frontmatterUpdatedAt",
  descending: true,
},

// Method:
async onPaginationRequest(props: { pagination: any }): Promise<void> {
  const { page, rowsPerPage } = props.pagination;
  const offset = (page - 1) * rowsPerPage;
  await this.fetchPairs({ limit: rowsPerPage, offset });
  this.tablePagination = props.pagination;
  this.tablePagination.rowsNumber = this.total;
},
</script>
```

### E.4 i18n keys

```typescript
// apps/web/src/i18n/de/articles.ts (extend)
export const articlesDe = {
  // ...
  kanban: {
    loadMore: "Mehr laden ({remaining} weitere)",
  },
};
// EN analog
```

### E.5 Section E Acceptance

- [ ] Kanban lanes show count + "load more" when total > visible
- [ ] Click "load more" appends without losing existing cards
- [ ] Imported articles q-table has pagination footer (page X of Y)
- [ ] Page navigation in q-table triggers correct offset/limit calls
- [ ] Clusters page has "load more" or pagination
- [ ] Notifications page has "load more"
- [ ] Cost-logs continues working (existing pagination)
- [ ] i18n strings exist DE+EN
- [ ] Commit: `feat(web): UI controls for paginated lists (47.5)`

---

## Section F — Tests + Final Verification

### F.1 Files to create

- `apps/api/test/pagination.test.ts` (new) — integration test against real DB

### F.2 Pagination integration test

```typescript
// apps/api/test/pagination.test.ts
import { describe, expect, test, beforeAll } from "bun:test";
import { articles, db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

// This test assumes toolwiki project exists with imported articles.
// Skip if not present.
const run = process.env.RUN_PAGINATION_TESTS === "1";
const describePagination = run ? describe : describe.skip;

describePagination("Articles pagination", () => {
  let projectId: string;

  beforeAll(async () => {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.slug, "toolwiki"))
      .limit(1);
    if (!p) throw new Error("toolwiki project not found — run setup first");
    projectId = p.id;
  });

  test("imported articles endpoint returns paginated pairs", async () => {
    const res = await fetch(
      `http://localhost:3050/api/articles/imported?projectSlug=toolwiki&collection=blog&limit=10&offset=0`,
      { headers: { cookie: process.env.TEST_SESSION_COOKIE ?? "" } }
    );
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.items.length).toBeLessThanOrEqual(10);
    expect(json.data.limit).toBe(10);
    expect(json.data.offset).toBe(0);
    expect(json.data.total).toBeGreaterThanOrEqual(json.data.items.length);
  });

  test("offset shifts results", async () => {
    const a = await (await fetch(`/* limit=10 offset=0 */`)).json();
    const b = await (await fetch(`/* limit=10 offset=10 */`)).json();
    const aIds = a.data.items.map((p: any) => p.translationKey);
    const bIds = b.data.items.map((p: any) => p.translationKey);
    expect(aIds).not.toEqual(bIds);
  });
});
```

(Pseudocode-ish; actual fetch URLs and auth need real test setup. If existing test infrastructure exists for `/cost/logs`, reuse it.)

### F.3 Final manual verification

```bash
# Type check all packages
bun --filter @marketing-auto/api tsc --noEmit
bun --filter @marketing-auto/core tsc --noEmit
bun --filter @marketing-auto/web vue-tsc --noEmit

# All tests
bun test

# Manual smoke flow:
# 1. Start API + web
bun run dev

# 2. Curl smoke for each endpoint:
curl 'http://localhost:3050/api/articles?projectSlug=toolwiki&limit=50&offset=0' | jq '.data | {total, limit, offset, items: (.items | length)}'
# Expected: { total: <large>, limit: 50, offset: 0, items: <=50 }

curl 'http://localhost:3050/api/articles/imported?projectSlug=toolwiki&collection=blog&limit=10&offset=0' | jq '.data | {total, limit, offset, items: (.items | length)}'
# Expected: { total: 28, limit: 10, offset: 0, items: 10 }

curl 'http://localhost:3050/api/clusters?projectSlug=toolwiki&limit=50&offset=0' | jq '.data | {total, limit, offset, items: (.items | length)}'

curl 'http://localhost:3050/api/notifications?limit=20&offset=0' | jq '.data | {total, unreadCount, notifications: (.notifications | length)}'

# 3. Open UI:
# - Articles page (toolwiki): Kanban renders, no lane should exceed 50 cards
# - Click "Load more" on any lane → cards append, total counter visible
# - Imported tab → q-table shows page 1 of N, navigation works
# - Clusters page → load more works
# - Notifications → load more works
# - Cost dashboard → continues working (regression check)
```

### F.4 Section F Acceptance

- [ ] All curl smoke checks return correct shape
- [ ] UI smoke flow works (Kanban load-more, q-table pagination, etc.)
- [ ] Existing cost-dashboard pagination not broken
- [ ] `bun test` green
- [ ] Commit: `test(pagination): integration tests + smoke (47.6)`

---

## Final Acceptance Criteria (combined)

- [ ] All 6 sections committed on `feature/47-pagination`
- [ ] All paginated endpoints use the `paginated()` helper for consistency
- [ ] Response shape: `{ ok, data: { items, total, limit, offset } }` everywhere (notifications keeps `unreadCount` too)
- [ ] Frontend stores track pagination state per resource
- [ ] UI provides "load more" or page navigation where appropriate
- [ ] Kanban board with 268 toolwiki imported articles renders <1s
- [ ] Imported-articles q-table loads page 1 in <500ms

## Reporting Back

After implementation:

1. **Endpoint diff** — list of paginated endpoints + their query schemas
2. **Curl smoke output** — paste 3 sample responses showing shape
3. **Toolwiki test** — counts per collection (`{ blog: 28, tools: 54, ... }`)
4. **UI verification** — does the Articles Kanban render fast now? Imported q-table?
5. **Test output** — `bun test` results
6. **Commit hashes** — 6 commits, one per section
7. **Deviations** — any endpoint that didn't fit cleanly

## Discovered During Implementation

- **`z.enum()` required for enum-constrained query params**: The `lane` param was initially typed as `z.string().optional()`. An invalid value (e.g. `lane=typo`) passes validation and produces a silent empty result. Changed to `z.enum(VALID_ARTICLE_STATUSES).optional()` so invalid values return 400 at the boundary. Added to `apps/api/CLAUDE.md` Common Mistakes.

- **Pair-level pagination needs 3 queries, not 1**: `/articles/imported` groups articles into DE/EN pairs by `translationKey`. Naively applying `LIMIT/OFFSET` to the article rows splits pairs across pages. The correct approach: (1) paginate `DISTINCT translationKey` ordered by `MAX(frontmatterUpdatedAt)`, (2) count distinct keys for `total`, (3) fetch all article rows for that page's keys and group in memory.

- **`ArticleListItem` needed `locale` and `source` fields**: The articles store typed individual list items without `locale` and `source`, which the paginated GET `/articles` select now returns. Added to the store interface to keep the type consistent with the API response.

## Deviations

- **"Load more" is project-level, not per-lane**: The spec described a "Load more" button inside each `ArticleKanbanLane` (per status). The kanban component groups articles by cluster, not by status, making per-status pagination require multiple API calls or a schema change. Implemented a single project-level "Load more" button in `ArticlesPanel.vue` below the kanban board instead. `ArticleKanbanLane` receives the props (`totalForLane`, `hasMore`) but `hasMore` is always `false` there — the project button drives append.

- **`lane` schema uses `z.enum(VALID_ARTICLE_STATUSES)` not `z.string()`**: See discovery above. This is strictly better — enforces boundary validation.
