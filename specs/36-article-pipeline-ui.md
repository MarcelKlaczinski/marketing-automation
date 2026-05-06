# Spec 36: Article Pipeline UI

**Phase:** 4 (Welle 3, zentrale Spec)
**Estimated Effort:** 4-5 days (4-5 sessions)
**Dependencies:** Spec 34 (Project hub), Spec 34.5 (MarkdownEditor improvements), Spec 35 (Polling Composable + Cold-Start UI)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (architectural complexity: Kanban layout, multi-status pipeline, change-tracking)

---

## Goal

Build the **Article Pipeline UI** — the centerpiece of the web app. Marcel's daily workflow goes from "CLI-only Article generation" to "everything in the browser":

- `/projects/:slug?tab=articles` — Kanban-style board with cluster lanes and status columns
- Toggle between **flat by Cluster** view and **grouped by Pillar** view
- Article cards show status, title, cornerstone keyword, last-updated, error indicators
- `/articles/:id` — full Article detail page with body editor, metadata, pipeline-action buttons, version history
- Article-Body editing with **change-tracking via `article_versions`** table (each save creates a version)
- Pipeline triggers (Generate Outline → Outline Review → Generate Draft → Final Review → Publish → Sync → PageSpeed-Validation) all callable from UI
- Status auto-cascades visualized (clicking Sync → status flows through `validating` → `published`/`blocked_by_pagespeed` automatically)

After this spec: **Marcel can run KI-Wissensraum end-to-end without touching the CLI for Article generation**. The CLI remains usable but optional.

This is the largest spec in Phase 4. Splitting plan ensures each session is well-defined.

## Architecture Decisions

**Decision 1: Two-axis Kanban — Lanes (Pillars/Clusters) × Columns (Status groups).**

```
                  To Review    In Progress    Ready       Issues
  Pillar: AI-Basics
   ├─ Cluster A    [Card][Card]  [Card]        [Card]
   └─ Cluster B    [Card]        [Card][Card]  [Card][Card]
  Pillar: ML
   └─ Cluster C    [Card]        [Card]
```

Vertical: Pillars (collapsible) → Clusters (always visible inside pillar). Horizontal: 4 status columns. View toggle: "Pillar-grouped" (default) vs. "Flat" (no pillar headers, all clusters in flat list).

**Decision 2: 4 status columns** matching Marcel's workflow:

| Column | Statuses |
|---|---|
| **To Review** | `proposed`, `outline_review`, `final_review` |
| **In Progress** | `approved`, `generating`, `drafting`, `schema_extending`, `validating` |
| **Ready** | `ready_to_publish`, `published` |
| **Issues** | `blocked_by_pagespeed`, `failed`, `rejected` |

**Decision 3: Cornerstones distinguished via card border + badge.**
Every article card has the same baseline. Cornerstones get a primary-colored left border + small "Cornerstone" badge in card header. No different sizes / sub-lanes.

**Decision 4: View toggle persists in localStorage.**
User preference, doesn't need to roundtrip the API. Same pattern as theme preference.

**Decision 5: Article cards do NOT support drag-and-drop.**
Status is a derived consequence of pipeline runs, not a manual flag. Dragging a card from "In Progress" to "Ready" wouldn't actually do anything safe. Cards are read-only positions; the column layout is purely for display.

**Decision 6: Article detail page is its own route — `/articles/:id`.**
Already in routes from Spec 30. Detail page hosts: header (title, status, project link), tabs (Body, Metadata, History, Validation), action panel (right sidebar with all pipeline triggers).

**Decision 7: Body editing creates `article_versions` rows on every save.**
The schema has `articleVersions` table with `version`, `bodyMd`, `changeReason`. Each save:
1. Increments `version` (max+1 for the article)
2. Inserts new row with current bodyMd + optional changeReason
3. Updates `articles.bodyMd` with new content

The "History" tab shows all versions with diff view between them.

**Decision 8: Re-syncing after body edit is automatic (with confirmation).**
Editing an article's body in DB without re-syncing to Astro creates inconsistency. After save, the UI prompts: "Re-sync to Astro now?" If yes → triggers `enqueueArticleSync` (existing pipeline). If no → article gets a "modified, not synced" badge.

**Decision 9: Pipeline triggers all use the preRunId pattern from Spec 35 lessons.**
All HTTP endpoints that enqueue pipelines:
1. INSERT pipeline_runs row with `status='queued'`, get its ID
2. Call enqueue helper with `preRunId` in job data
3. Return `{ runId, jobId }` to UI for immediate polling

This is the canonical pattern now. New trigger endpoints in this spec follow it without exception.

**Decision 10: Cards show terminal-state errors as red badges, not as separate UI.**
If `pipeline_runs.status=failed` for the latest run, the article card shows a red error icon. Clicking the icon shows the `errorMessage` in a tooltip/dialog. The Issues column is still where these articles live — the badge just makes it visible from any column.

**Decision 11: Run-status overlays use existing polling composable + table-specific runs.**
For per-article state (e.g., "is sync running right now?"), we query the latest row in `astroSyncRuns`, `pagespeedRuns`, etc. — these tables track per-operation status better than `pipelineRuns` alone. The detail page subscribes to these specifically.

**Decision 12: No bulk operations in this spec.**
Selecting multiple articles + bulk-approve / bulk-sync would be useful, but adds significant UX complexity (selection state, modal confirmations). Defer to a future enhancement.

## Non-Goals

- **No drag-and-drop** between status columns (status is not a user-controllable field)
- **No cluster editing UI** in this spec — Spec 37 (Welle 4) handles cluster CRUD
- **No new article creation form** — articles are created via Cold-Start (Spec 35) or via existing CLI scripts. The detail page is for **existing** articles only.
- **No bulk operations** (multi-select + bulk action)
- **No real-time collaborative editing** (single user)
- **No approval workflow** beyond status enum transitions — `approvals` table exists but is not surfaced in UI yet
- **No social-post management** — articles only, no `socialPosts` UI
- **No filters / search** in the Kanban view (with 5-50 articles per project, scrolling is fine)
- **No global "all articles" view** across projects — articles are always project-scoped
- **No version restoration** — version history is shown but reverting requires manual copy-paste from history view (full version-restoration UX is its own UI investment)

## Detailed Implementation

### Backend: Article List Endpoint

`apps/api/src/routes/articles.ts` (extend existing or create):

```typescript
import { Hono } from 'hono';
import { eq, desc, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  db, articles, clusters, contentPillars, projects,
  pipelineRuns, astroSyncRuns, pagespeedRuns, schemaExtensionRuns, articleVersions,
} from '@marketing-auto/db';
import { requireAuth } from '../middleware/require-auth';

export const articleRoutes = new Hono();
articleRoutes.use(requireAuth);

// ───── GET /api/articles?projectSlug=foo ────────────────────────────────
// Returns ALL articles for a project, with denormalized fields the Kanban needs.

articleRoutes.get('/', async (c) => {
  const projectSlug = c.req.query('projectSlug');
  if (!projectSlug) return c.json({ ok: false, error: 'projectSlug required' }, 400);

  const [project] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, projectSlug)).limit(1);
  if (!project) return c.json({ ok: false, error: 'Project not found' }, 404);

  // Single query joining article + cluster + pillar
  const rows = await db.select({
    id: articles.id,
    slug: articles.slug,
    title: articles.title,
    cornerstoneKeyword: articles.cornerstoneKeyword,
    status: articles.status,
    cornerstoneSpecId: articles.cornerstoneSpecId, // nullable; non-null = cornerstone article
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
  })
    .from(articles)
    .leftJoin(clusters, eq(articles.clusterId, clusters.id))
    .leftJoin(contentPillars, eq(clusters.pillarId, contentPillars.id))
    .where(eq(articles.projectId, project.id))
    .orderBy(desc(articles.updatedAt));

  // For each article, fetch latest pipeline run (any kind) to determine "in-flight" state
  // and latest error if status === 'failed' / 'blocked_by_pagespeed'.
  // We do this in a second query using IN clause for efficiency.
  const articleIds = rows.map((r) => r.id);
  const latestRuns = articleIds.length === 0 ? [] : await db
    .select({
      articleId: pipelineRuns.input,
      status: pipelineRuns.status,
      pipelineName: pipelineRuns.pipelineName,
      startedAt: pipelineRuns.startedAt,
      errorMessage: pipelineRuns.errorMessage,
    })
    .from(pipelineRuns)
    .where(/* JSON path: input->>'articleId' = any of articleIds. Implementation depends on Drizzle JSON ops support. */
      sql`${pipelineRuns.input}->>'articleId' = ANY(${articleIds})`
    )
    .orderBy(desc(pipelineRuns.startedAt));

  // ... join latest run per article to enrich the response
  // Simpler approach: send raw rows; let the frontend do its own latest-run fetch
  // if needed for in-flight indicator. For Spec 36, the article.status alone is enough.

  return c.json({ ok: true, data: rows });
});

// ───── GET /api/articles/:id ────────────────────────────────────────────
// Full article detail including all related run history.

articleRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  const [cluster] = article.clusterId
    ? await db.select().from(clusters).where(eq(clusters.id, article.clusterId)).limit(1)
    : [null];

  const [pillar] = cluster?.pillarId
    ? await db.select().from(contentPillars).where(eq(contentPillars.id, cluster.pillarId)).limit(1)
    : [null];

  // Recent runs across all run tables for this article
  const recentSyncRuns = await db.select().from(astroSyncRuns)
    .where(eq(astroSyncRuns.articleId, id))
    .orderBy(desc(astroSyncRuns.startedAt))
    .limit(5);

  const recentPagespeedRuns = await db.select().from(pagespeedRuns)
    .where(eq(pagespeedRuns.articleId, id))
    .orderBy(desc(pagespeedRuns.startedAt))
    .limit(5);

  const recentSchemaRuns = await db.select().from(schemaExtensionRuns)
    .where(eq(schemaExtensionRuns.articleId, id))
    .orderBy(desc(schemaExtensionRuns.startedAt))
    .limit(5);

  return c.json({
    ok: true,
    data: {
      article,
      cluster,
      pillar,
      recentRuns: {
        sync: recentSyncRuns,
        pagespeed: recentPagespeedRuns,
        schema: recentSchemaRuns,
      },
    },
  });
});

// ───── PATCH /api/articles/:id ──────────────────────────────────────────
// Update article fields (title, metaDescription, cornerstoneKeyword, slug, status manually).
// Body editing has its own endpoint (creates a version) — see below.

const articleUpdateSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  metaDescription: z.string().max(500).optional(),
  cornerstoneKeyword: z.string().min(2).max(200).optional(),
  slug: z.string().min(2).max(200).regex(/^[a-z0-9-]+$/).optional(),
  status: z.enum([
    'proposed', 'approved', 'generating', 'outline_review', 'drafting',
    'final_review', 'schema_extending', 'ready_to_publish', 'validating',
    'published', 'blocked_by_pagespeed', 'failed', 'rejected',
  ]).optional(),
});

articleRoutes.patch('/:id', zValidator('json', articleUpdateSchema), async (c) => {
  const id = c.req.param('id');
  const input = c.req.valid('json');

  const [existing] = await db.select({ id: articles.id })
    .from(articles).where(eq(articles.id, id)).limit(1);
  if (!existing) return c.json({ ok: false, error: 'Article not found' }, 404);

  await db.update(articles)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(articles.id, id));

  const [updated] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  return c.json({ ok: true, data: updated });
});

// ───── POST /api/articles/:id/body ──────────────────────────────────────
// Body update: persists a new article_versions row + updates articles.bodyMd.

const bodyUpdateSchema = z.object({
  bodyMd: z.string().max(500_000),
  changeReason: z.string().max(500).optional(),
});

articleRoutes.post('/:id/body', zValidator('json', bodyUpdateSchema), async (c) => {
  const id = c.req.param('id');
  const input = c.req.valid('json');

  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  // Determine next version number
  const [maxVersion] = await db.select({ max: sql<number>`coalesce(max(version), 0)::int` })
    .from(articleVersions).where(eq(articleVersions.articleId, id));
  const nextVersion = (maxVersion?.max ?? 0) + 1;

  // Insert version + update article
  await db.insert(articleVersions).values({
    articleId: id,
    version: nextVersion,
    bodyMd: input.bodyMd,
    changeReason: input.changeReason ?? null,
  });

  await db.update(articles)
    .set({
      bodyMd: input.bodyMd,
      wordCount: input.bodyMd.trim().split(/\s+/).length,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, id));

  return c.json({ ok: true, data: { version: nextVersion } });
});

// ───── GET /api/articles/:id/versions ───────────────────────────────────
// List all versions for an article (no body content — just metadata).

articleRoutes.get('/:id/versions', async (c) => {
  const id = c.req.param('id');
  const versions = await db.select({
    id: articleVersions.id,
    version: articleVersions.version,
    changeReason: articleVersions.changeReason,
    createdAt: articleVersions.createdAt,
  })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, id))
    .orderBy(desc(articleVersions.version));

  return c.json({ ok: true, data: versions });
});

// ───── GET /api/articles/:id/versions/:version ──────────────────────────
// Get one specific version's body for diff view.

articleRoutes.get('/:id/versions/:version', async (c) => {
  const id = c.req.param('id');
  const version = parseInt(c.req.param('version'), 10);
  if (isNaN(version)) return c.json({ ok: false, error: 'Invalid version' }, 400);

  const [row] = await db.select().from(articleVersions)
    .where(and(eq(articleVersions.articleId, id), eq(articleVersions.version, version)))
    .limit(1);
  if (!row) return c.json({ ok: false, error: 'Version not found' }, 404);

  return c.json({ ok: true, data: row });
});

// ───── Pipeline trigger endpoints ──────────────────────────────────────
// All use the preRunId pattern (Spec 35 lessons): pre-INSERT a pipeline_runs row
// with status='queued', pass its ID through to the worker.

import { randomUUID } from 'crypto';
import {
  enqueueArticleOutlinePipeline,
  enqueueArticleDraftPipeline,
  enqueueArticleSyncPipeline,
  enqueuePagespeedValidationPipeline,
  enqueueSchemaExtensionPipeline,
} from '@marketing-auto/pipelines';

interface TriggerOptions {
  pipelineName: string;
  articleId: string;
  projectId: string;
  enqueue: (input: { preRunId: string; articleId: string; projectId: string }) => Promise<{ jobId: string }>;
}

async function triggerWithPreRunId(opts: TriggerOptions): Promise<{ runId: string; jobId: string }> {
  const preRunId = randomUUID();
  await db.insert(pipelineRuns).values({
    id: preRunId,
    pipelineName: opts.pipelineName,
    projectId: opts.projectId,
    status: 'queued',
    input: { articleId: opts.articleId, preRunId },
  });
  const { jobId } = await opts.enqueue({
    preRunId,
    articleId: opts.articleId,
    projectId: opts.projectId,
  });

  // Update jobId on the pipeline_runs row for cross-reference
  await db.update(pipelineRuns)
    .set({ jobId })
    .where(eq(pipelineRuns.id, preRunId));

  return { runId: preRunId, jobId };
}

// Generate Outline (status: approved → generating → outline_review)
articleRoutes.post('/:id/generate-outline', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: 'article:outline',
    articleId: id,
    projectId: article.projectId,
    enqueue: enqueueArticleOutlinePipeline,
  });
  return c.json({ ok: true, data: result }, 202);
});

// Generate Draft (status: outline_review → drafting → final_review)
articleRoutes.post('/:id/generate-draft', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: 'article:draft',
    articleId: id,
    projectId: article.projectId,
    enqueue: enqueueArticleDraftPipeline,
  });
  return c.json({ ok: true, data: result }, 202);
});

// Sync to Astro (status: ready_to_publish → validating → published / blocked_by_pagespeed)
articleRoutes.post('/:id/sync', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: 'article:sync',
    articleId: id,
    projectId: article.projectId,
    enqueue: enqueueArticleSyncPipeline,
  });
  return c.json({ ok: true, data: result }, 202);
});

// Validate PageSpeed (manual re-run, e.g., after fixing an issue)
articleRoutes.post('/:id/validate-pagespeed', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: 'article:validate-pagespeed',
    articleId: id,
    projectId: article.projectId,
    enqueue: enqueuePagespeedValidationPipeline,
  });
  return c.json({ ok: true, data: result }, 202);
});

// Re-extract schema.org (manual re-run if needed)
articleRoutes.post('/:id/extend-schema', async (c) => {
  const id = c.req.param('id');
  const [article] = await db.select().from(articles).where(eq(articles.id, id)).limit(1);
  if (!article) return c.json({ ok: false, error: 'Article not found' }, 404);

  const result = await triggerWithPreRunId({
    pipelineName: 'article:extend-schema',
    articleId: id,
    projectId: article.projectId,
    enqueue: enqueueSchemaExtensionPipeline,
  });
  return c.json({ ok: true, data: result }, 202);
});
```

Mount in `apps/api/src/index.ts`:
```typescript
app.route('/api/articles', articleRoutes);
```

### Frontend: Articles Store

`apps/web/src/stores/articles.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface ArticleListItem {
  id: string;
  slug: string;
  title: string | null;
  cornerstoneKeyword: string;
  status: string;
  cornerstoneSpecId: string | null;
  clusterId: string | null;
  clusterName: string | null;
  pillarId: string | null;
  pillarName: string | null;
  pillarPosition: number | null;
  wordCount: number | null;
  publishedAt: string | null;
  astroSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleDetail {
  article: Record<string, unknown>; // full article row
  cluster: Record<string, unknown> | null;
  pillar: Record<string, unknown> | null;
  recentRuns: {
    sync: Record<string, unknown>[];
    pagespeed: Record<string, unknown>[];
    schema: Record<string, unknown>[];
  };
}

export interface ArticleVersion {
  id: string;
  version: number;
  changeReason: string | null;
  createdAt: string;
}

interface ArticlesState {
  byProject: Record<string, ArticleListItem[]>;
  detailById: Record<string, ArticleDetail | null>;
  versionsByArticle: Record<string, ArticleVersion[]>;
  loading: boolean;
}

export const useArticlesStore = defineStore('articles', {
  state: (): ArticlesState => ({
    byProject: {},
    detailById: {},
    versionsByArticle: {},
    loading: false,
  }),

  actions: {
    async fetchForProject(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: ArticleListItem[] }>(
          `/articles?projectSlug=${encodeURIComponent(slug)}`,
        );
        this.byProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async fetchDetail(articleId: string): Promise<ArticleDetail | null> {
      try {
        const res = await api.get<{ ok: boolean; data: ArticleDetail }>(`/articles/${articleId}`);
        this.detailById[articleId] = res.data.data;
        return res.data.data;
      } catch {
        return null;
      }
    },

    async updateMetadata(articleId: string, patch: Record<string, unknown>): Promise<void> {
      await api.patch(`/articles/${articleId}`, patch);
      // Invalidate detail
      delete this.detailById[articleId];
      await this.fetchDetail(articleId);
    },

    async saveBody(articleId: string, bodyMd: string, changeReason?: string): Promise<number> {
      const payload: Record<string, unknown> = { bodyMd };
      if (changeReason) payload.changeReason = changeReason;
      const res = await api.post<{ ok: boolean; data: { version: number } }>(
        `/articles/${articleId}/body`,
        payload,
      );
      delete this.detailById[articleId];
      delete this.versionsByArticle[articleId];
      return res.data.data.version;
    },

    async fetchVersions(articleId: string): Promise<ArticleVersion[]> {
      const res = await api.get<{ ok: boolean; data: ArticleVersion[] }>(`/articles/${articleId}/versions`);
      this.versionsByArticle[articleId] = res.data.data;
      return res.data.data;
    },

    async fetchVersionBody(articleId: string, version: number): Promise<string | null> {
      try {
        const res = await api.get<{ ok: boolean; data: { bodyMd: string } }>(
          `/articles/${articleId}/versions/${version}`,
        );
        return res.data.data.bodyMd;
      } catch {
        return null;
      }
    },

    async triggerOutline(articleId: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/articles/${articleId}/generate-outline`,
      );
      return res.data.data;
    },

    async triggerDraft(articleId: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/articles/${articleId}/generate-draft`,
      );
      return res.data.data;
    },

    async triggerSync(articleId: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/articles/${articleId}/sync`,
      );
      return res.data.data;
    },

    async triggerPagespeedValidation(articleId: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/articles/${articleId}/validate-pagespeed`,
      );
      return res.data.data;
    },

    async triggerSchemaExtension(articleId: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/articles/${articleId}/extend-schema`,
      );
      return res.data.data;
    },
  },
});
```

### Frontend: Status-Group Mapping Helper

`apps/web/src/lib/article-status.ts`:

```typescript
export type StatusGroup = 'to_review' | 'in_progress' | 'ready' | 'issues';

export const STATUS_TO_GROUP: Record<string, StatusGroup> = {
  proposed: 'to_review',
  outline_review: 'to_review',
  final_review: 'to_review',
  approved: 'in_progress',
  generating: 'in_progress',
  drafting: 'in_progress',
  schema_extending: 'in_progress',
  validating: 'in_progress',
  ready_to_publish: 'ready',
  published: 'ready',
  blocked_by_pagespeed: 'issues',
  failed: 'issues',
  rejected: 'issues',
};

export const GROUP_ORDER: StatusGroup[] = ['to_review', 'in_progress', 'ready', 'issues'];

export const STATUS_GROUP_COLORS: Record<StatusGroup, string> = {
  to_review: '#f2c037',     // warning yellow
  in_progress: '#3f51b5',   // primary indigo
  ready: '#21ba45',         // positive green
  issues: '#c10015',        // negative red
};

export function isInFlightStatus(status: string): boolean {
  return ['generating', 'drafting', 'schema_extending', 'validating'].includes(status);
}

export function isCornerstone(article: { cornerstoneSpecId: string | null }): boolean {
  return article.cornerstoneSpecId !== null;
}
```

### Frontend: ArticlesPanel (replaces stub in Project Hub)

`apps/web/src/components/projects/ArticlesPanel.vue`:

```vue
<template>
  <div class="articles-panel">
    <div class="articles-panel__toolbar">
      <div class="view-toggle">
        <button
          :class="['toggle-btn', { 'toggle-btn--active': groupBy === 'pillar' }]"
          @click="setGroupBy('pillar')"
          type="button"
        >
          <q-icon name="account_tree" size="14px" class="q-mr-xs" />
          {{ $t('articles.toolbar.byPillar') }}
        </button>
        <button
          :class="['toggle-btn', { 'toggle-btn--active': groupBy === 'cluster' }]"
          @click="setGroupBy('cluster')"
          type="button"
        >
          <q-icon name="hub" size="14px" class="q-mr-xs" />
          {{ $t('articles.toolbar.byCluster') }}
        </button>
      </div>

      <q-space />

      <div class="article-count">
        {{ $t('articles.toolbar.totalCount', { count: articles.length }) }}
      </div>
    </div>

    <div v-if="articlesStore.loading && articles.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="articles.length === 0" class="text-center q-pa-xl">
      <q-icon name="article" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md text-grey-7">{{ $t('articles.empty') }}</p>
      <p class="text-caption text-grey-7">{{ $t('articles.emptyHint') }}</p>
    </div>

    <div v-else class="kanban">
      <ArticleKanbanLane
        v-for="lane in lanes"
        :key="lane.id"
        :lane="lane"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { LocalStorage } from 'quasar';
import { useArticlesStore, type ArticleListItem } from 'src/stores/articles';
import ArticleKanbanLane from 'src/components/articles/ArticleKanbanLane.vue';

type GroupBy = 'pillar' | 'cluster';

interface KanbanLane {
  id: string;
  type: GroupBy;
  pillarName?: string | null;
  clusterName?: string | null;
  articles: ArticleListItem[];
}

const STORAGE_KEY_GROUP_BY = 'articles.groupBy';

export default defineComponent({
  name: 'ArticlesPanel',

  components: { ArticleKanbanLane },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { articlesStore: useArticlesStore() };
  },

  data: () => ({
    groupBy: (LocalStorage.getItem(STORAGE_KEY_GROUP_BY) as GroupBy | null) ?? 'pillar' as GroupBy,
  }),

  computed: {
    articles(): ArticleListItem[] {
      return this.articlesStore.byProject[this.slug] ?? [];
    },

    lanes(): KanbanLane[] {
      if (this.groupBy === 'pillar') {
        return this.computeLanesByPillar();
      } else {
        return this.computeLanesByCluster();
      }
    },
  },

  async created() {
    await this.articlesStore.fetchForProject(this.slug);
  },

  methods: {
    setGroupBy(value: GroupBy): void {
      this.groupBy = value;
      LocalStorage.set(STORAGE_KEY_GROUP_BY, value);
    },

    computeLanesByPillar(): KanbanLane[] {
      // Group by pillar, then within each pillar list each cluster
      const byPillarThenCluster = new Map<
        string,
        { pillarName: string | null; pillarPosition: number; clusters: Map<string, { name: string | null; articles: ArticleListItem[] }> }
      >();

      for (const article of this.articles) {
        const pillarKey = article.pillarId ?? '__no_pillar__';
        if (!byPillarThenCluster.has(pillarKey)) {
          byPillarThenCluster.set(pillarKey, {
            pillarName: article.pillarName,
            pillarPosition: article.pillarPosition ?? 9999,
            clusters: new Map(),
          });
        }
        const pillarBucket = byPillarThenCluster.get(pillarKey)!;
        const clusterKey = article.clusterId ?? '__no_cluster__';
        if (!pillarBucket.clusters.has(clusterKey)) {
          pillarBucket.clusters.set(clusterKey, {
            name: article.clusterName,
            articles: [],
          });
        }
        pillarBucket.clusters.get(clusterKey)!.articles.push(article);
      }

      // Sort pillars by position, clusters alphabetically by name
      const lanes: KanbanLane[] = [];
      const sortedPillars = Array.from(byPillarThenCluster.entries())
        .sort((a, b) => a[1].pillarPosition - b[1].pillarPosition);

      for (const [pillarKey, pillarBucket] of sortedPillars) {
        const sortedClusters = Array.from(pillarBucket.clusters.entries())
          .sort((a, b) => (a[1].name ?? 'zzz').localeCompare(b[1].name ?? 'zzz'));
        for (const [clusterKey, clusterBucket] of sortedClusters) {
          lanes.push({
            id: `${pillarKey}::${clusterKey}`,
            type: 'pillar',
            pillarName: pillarBucket.pillarName,
            clusterName: clusterBucket.name,
            articles: clusterBucket.articles,
          });
        }
      }
      return lanes;
    },

    computeLanesByCluster(): KanbanLane[] {
      // Group by cluster only, ignoring pillar entirely
      const byCluster = new Map<string, { clusterName: string | null; articles: ArticleListItem[] }>();
      for (const article of this.articles) {
        const clusterKey = article.clusterId ?? '__no_cluster__';
        if (!byCluster.has(clusterKey)) {
          byCluster.set(clusterKey, {
            clusterName: article.clusterName,
            articles: [],
          });
        }
        byCluster.get(clusterKey)!.articles.push(article);
      }

      const sorted = Array.from(byCluster.entries())
        .sort((a, b) => (a[1].clusterName ?? 'zzz').localeCompare(b[1].clusterName ?? 'zzz'));
      return sorted.map(([key, bucket]) => ({
        id: key,
        type: 'cluster',
        clusterName: bucket.clusterName,
        articles: bucket.articles,
      }));
    },
  },
});
</script>

<style lang="scss" scoped>
.articles-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.articles-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);
  margin-bottom: 16px;

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.view-toggle {
  display: inline-flex;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 2px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.toggle-btn {
  background: none;
  border: none;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
  transition: all 0.15s;

  &:hover {
    color: var(--q-primary);
  }

  &--active {
    background: var(--q-primary);
    color: white;

    &:hover {
      color: white;
    }
  }
}

.article-count {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.kanban {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
```

### Frontend: ArticleKanbanLane (one row of the Kanban — pillar/cluster + 4 status columns)

`apps/web/src/components/articles/ArticleKanbanLane.vue`:

```vue
<template>
  <div class="lane">
    <div class="lane__header">
      <div class="lane__title">
        <span v-if="lane.pillarName" class="lane__pillar">{{ lane.pillarName }} ›</span>
        <span class="lane__cluster">{{ lane.clusterName ?? $t('articles.lane.uncategorized') }}</span>
      </div>
      <div class="lane__count">{{ lane.articles.length }}</div>
    </div>

    <div class="lane__columns">
      <div
        v-for="group in groups"
        :key="group"
        class="status-column"
        :style="{ '--column-color': STATUS_GROUP_COLORS[group] }"
      >
        <div class="status-column__header">
          <div class="status-column__indicator" />
          <div class="status-column__label">{{ $t(`articles.statusGroup.${group}`) }}</div>
          <div class="status-column__count">{{ articlesByGroup[group]?.length ?? 0 }}</div>
        </div>

        <div class="status-column__cards">
          <ArticleCard
            v-for="article in (articlesByGroup[group] ?? [])"
            :key="article.id"
            :article="article"
          />
          <div v-if="!articlesByGroup[group]?.length" class="status-column__empty">
            {{ $t('articles.lane.empty') }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import {
  STATUS_TO_GROUP,
  GROUP_ORDER,
  STATUS_GROUP_COLORS,
  type StatusGroup,
} from 'src/lib/article-status';
import type { ArticleListItem } from 'src/stores/articles';
import ArticleCard from './ArticleCard.vue';

interface KanbanLane {
  id: string;
  type: 'pillar' | 'cluster';
  pillarName?: string | null;
  clusterName?: string | null;
  articles: ArticleListItem[];
}

export default defineComponent({
  name: 'ArticleKanbanLane',

  components: { ArticleCard },

  props: {
    lane: { type: Object as PropType<KanbanLane>, required: true },
  },

  data: () => ({
    groups: GROUP_ORDER,
    STATUS_GROUP_COLORS,
  }),

  computed: {
    articlesByGroup(): Record<StatusGroup, ArticleListItem[]> {
      const result: Record<StatusGroup, ArticleListItem[]> = {
        to_review: [],
        in_progress: [],
        ready: [],
        issues: [],
      };
      for (const article of this.lane.articles) {
        const group = STATUS_TO_GROUP[article.status];
        if (group) result[group].push(article);
      }
      return result;
    },
  },
});
</script>

<style lang="scss" scoped>
.lane {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.lane__header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    border-bottom-color: rgba(255, 255, 255, 0.06);
  }
}

.lane__title {
  flex-grow: 1;
  font-size: 13px;
  font-weight: 600;
}

.lane__pillar {
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-weight: 400;
  margin-right: 4px;
}

.lane__count {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.lane__columns {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.04);
  }
}

.status-column {
  background: var(--q-card-bg, #fff);
  padding: 8px 10px 12px;
  min-height: 80px;

  body.body--dark & {
    background: var(--q-card-bg, #1d1d1d);
  }
}

.status-column__header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.status-column__indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--column-color);
  margin-right: 6px;
}

.status-column__label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
  flex-grow: 1;
}

.status-column__count {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
}

.status-column__cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-column__empty {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.4));
  font-style: italic;
  padding: 6px 0;
}
</style>
```

### Frontend: ArticleCard

`apps/web/src/components/articles/ArticleCard.vue`:

```vue
<template>
  <div
    :class="['article-card', { 'article-card--cornerstone': cornerstone }]"
    @click="onClick"
  >
    <div v-if="cornerstone" class="article-card__cornerstone-bar" />

    <div class="article-card__main">
      <div class="article-card__title">
        {{ article.title || article.cornerstoneKeyword }}
      </div>

      <div v-if="article.title && article.cornerstoneKeyword !== article.title" class="article-card__keyword">
        {{ article.cornerstoneKeyword }}
      </div>

      <div class="article-card__footer">
        <span v-if="cornerstone" class="article-card__badge">{{ $t('articles.card.cornerstone') }}</span>
        <span v-if="article.wordCount" class="article-card__meta">
          {{ article.wordCount }} {{ $t('articles.card.words') }}
        </span>
        <q-spinner v-if="isInFlight" size="14px" color="primary" />
        <q-icon v-if="isFailed" name="error" size="14px" color="negative" />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { isCornerstone, isInFlightStatus } from 'src/lib/article-status';
import type { ArticleListItem } from 'src/stores/articles';

export default defineComponent({
  name: 'ArticleCard',

  props: {
    article: { type: Object as PropType<ArticleListItem>, required: true },
  },

  computed: {
    cornerstone(): boolean {
      return isCornerstone(this.article);
    },
    isInFlight(): boolean {
      return isInFlightStatus(this.article.status);
    },
    isFailed(): boolean {
      return ['failed', 'blocked_by_pagespeed'].includes(this.article.status);
    },
  },

  methods: {
    onClick(): void {
      void this.$router.push({ name: 'article-detail', params: { id: this.article.id } });
    },
  },
});
</script>

<style lang="scss" scoped>
.article-card {
  display: flex;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 0;
  cursor: pointer;
  background: var(--q-card-bg, #fff);
  font-size: 12px;
  transition: border-color 0.15s, transform 0.15s;
  overflow: hidden;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }

  &:hover {
    border-color: var(--q-primary);
    transform: translateY(-1px);
  }

  &--cornerstone {
    border-left: 0;
  }
}

.article-card__cornerstone-bar {
  width: 3px;
  background: var(--q-primary, #3f51b5);
  flex-shrink: 0;
}

.article-card__main {
  padding: 8px 10px;
  flex-grow: 1;
  min-width: 0;
}

.article-card__title {
  font-weight: 500;
  font-size: 12.5px;
  line-height: 1.35;
  margin-bottom: 4px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.article-card__keyword {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.55);
  }
}

.article-card__footer {
  display: flex;
  align-items: center;
  gap: 6px;
}

.article-card__badge {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(63, 81, 181, 0.1);
  color: var(--q-primary, #3f51b5);
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.article-card__meta {
  font-size: 10px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
}
</style>
```

### Frontend: ArticleDetailPage

`apps/web/src/pages/ArticleDetailPage.vue`:

```vue
<template>
  <q-page padding>
    <div v-if="!detail && articlesStore.loading" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="!detail" class="text-center q-pa-xl">
      <q-icon name="error_outline" size="64px" color="negative" />
      <p class="text-body1 q-mt-md">{{ $t('articles.detail.notFound') }}</p>
    </div>

    <template v-else>
      <ArticleDetailHeader :detail="detail" @back="onBack" />

      <div class="row q-col-gutter-lg q-mt-md">
        <div class="col-12 col-lg-8">
          <q-tabs
            v-model="activeTab"
            align="left"
            class="text-grey-8 q-mb-md"
            indicator-color="primary"
            active-color="primary"
            narrow-indicator
            @update:model-value="onTabChange"
          >
            <q-tab name="body" :label="$t('articles.detail.tabs.body')" icon="article" />
            <q-tab name="metadata" :label="$t('articles.detail.tabs.metadata')" icon="label" />
            <q-tab name="history" :label="$t('articles.detail.tabs.history')" icon="history" />
            <q-tab name="validation" :label="$t('articles.detail.tabs.validation')" icon="task_alt" />
          </q-tabs>

          <q-tab-panels v-model="activeTab" animated class="bg-transparent">
            <q-tab-panel name="body" class="q-px-none">
              <ArticleBodyPanel :detail="detail" @saved="onBodySaved" />
            </q-tab-panel>
            <q-tab-panel name="metadata" class="q-px-none">
              <ArticleMetadataPanel :detail="detail" @updated="onUpdated" />
            </q-tab-panel>
            <q-tab-panel name="history" class="q-px-none">
              <ArticleHistoryPanel :article-id="id" />
            </q-tab-panel>
            <q-tab-panel name="validation" class="q-px-none">
              <ArticleValidationPanel :detail="detail" />
            </q-tab-panel>
          </q-tab-panels>
        </div>

        <div class="col-12 col-lg-4">
          <ArticleActionPanel :detail="detail" @action-triggered="onUpdated" />
        </div>
      </div>
    </template>
  </q-page>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useArticlesStore } from 'src/stores/articles';
import ArticleDetailHeader from 'src/components/articles/ArticleDetailHeader.vue';
import ArticleBodyPanel from 'src/components/articles/ArticleBodyPanel.vue';
import ArticleMetadataPanel from 'src/components/articles/ArticleMetadataPanel.vue';
import ArticleHistoryPanel from 'src/components/articles/ArticleHistoryPanel.vue';
import ArticleValidationPanel from 'src/components/articles/ArticleValidationPanel.vue';
import ArticleActionPanel from 'src/components/articles/ArticleActionPanel.vue';

type TabName = 'body' | 'metadata' | 'history' | 'validation';

export default defineComponent({
  name: 'ArticleDetailPage',

  components: {
    ArticleDetailHeader,
    ArticleBodyPanel,
    ArticleMetadataPanel,
    ArticleHistoryPanel,
    ArticleValidationPanel,
    ArticleActionPanel,
  },

  props: {
    id: { type: String, required: true },
  },

  setup() {
    return { articlesStore: useArticlesStore() };
  },

  data: () => ({
    activeTab: 'body' as TabName,
  }),

  computed: {
    detail() {
      return this.articlesStore.detailById[this.id];
    },
  },

  async created() {
    const tabFromQuery = this.$route.query.tab;
    if (typeof tabFromQuery === 'string' && ['body', 'metadata', 'history', 'validation'].includes(tabFromQuery)) {
      this.activeTab = tabFromQuery as TabName;
    }
    await this.articlesStore.fetchDetail(this.id);
  },

  methods: {
    onTabChange(newTab: string | number | null): void {
      if (typeof newTab !== 'string') return;
      void this.$router.replace({ query: { ...this.$route.query, tab: newTab } });
    },

    async onUpdated(): Promise<void> {
      await this.articlesStore.fetchDetail(this.id);
    },

    onBodySaved(): void {
      void this.onUpdated();
    },

    onBack(): void {
      // Navigate back to project detail with articles tab
      const projectSlug = (this.detail?.article as { projectId?: string })?.projectId;
      if (projectSlug) {
        // We don't have slug, only projectId — workaround: use browser back
        this.$router.back();
      } else {
        this.$router.back();
      }
    },
  },
});
</script>
```

### Frontend: ArticleActionPanel (right sidebar)

This is the most-touched component. It contains all pipeline triggers + status info.

`apps/web/src/components/articles/ArticleActionPanel.vue`:

```vue
<template>
  <div class="action-panel">
    <div class="action-panel__section">
      <div class="action-panel__title">{{ $t('articles.actions.pipelineActions') }}</div>

      <div class="action-list">
        <PipelineActionRow
          v-for="action in availableActions"
          :key="action.id"
          :action="action"
          :loading="loadingAction === action.id"
          @click="onAction(action)"
        />
      </div>
    </div>

    <div class="action-panel__section">
      <div class="action-panel__title">{{ $t('articles.actions.lastRunStatus') }}</div>
      <ArticleRecentRunsList :detail="detail" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useArticlesStore } from 'src/stores/articles';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import PipelineActionRow from './PipelineActionRow.vue';
import ArticleRecentRunsList from './ArticleRecentRunsList.vue';
import type { ArticleDetail } from 'src/stores/articles';

interface PipelineAction {
  id: 'outline' | 'draft' | 'sync' | 'validate-pagespeed' | 'extend-schema';
  i18nKey: string;
  icon: string;
  enabledWhen: (status: string) => boolean;
  triggerFn: (articleId: string) => Promise<{ runId: string; jobId: string }>;
}

export default defineComponent({
  name: 'ArticleActionPanel',

  components: { PipelineActionRow, ArticleRecentRunsList },

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ['action-triggered'],

  setup() {
    return {
      articlesStore: useArticlesStore(),
      notify: useNotify(),
    };
  },

  data() {
    const store = useArticlesStore();
    return {
      loadingAction: null as string | null,
      actions: [
        {
          id: 'outline',
          i18nKey: 'articles.actions.generateOutline',
          icon: 'list',
          enabledWhen: (status: string) => ['proposed', 'approved', 'failed'].includes(status),
          triggerFn: store.triggerOutline,
        },
        {
          id: 'draft',
          i18nKey: 'articles.actions.generateDraft',
          icon: 'description',
          enabledWhen: (status: string) => ['outline_review'].includes(status),
          triggerFn: store.triggerDraft,
        },
        {
          id: 'sync',
          i18nKey: 'articles.actions.syncToAstro',
          icon: 'cloud_upload',
          enabledWhen: (status: string) => ['ready_to_publish', 'published', 'blocked_by_pagespeed'].includes(status),
          triggerFn: store.triggerSync,
        },
        {
          id: 'validate-pagespeed',
          i18nKey: 'articles.actions.validatePagespeed',
          icon: 'speed',
          enabledWhen: (status: string) => ['published', 'blocked_by_pagespeed', 'ready_to_publish'].includes(status),
          triggerFn: store.triggerPagespeedValidation,
        },
        {
          id: 'extend-schema',
          i18nKey: 'articles.actions.extendSchema',
          icon: 'data_object',
          enabledWhen: (status: string) => ['final_review', 'ready_to_publish', 'published'].includes(status),
          triggerFn: store.triggerSchemaExtension,
        },
      ] as PipelineAction[],
    };
  },

  computed: {
    article() {
      return this.detail.article as { id: string; status: string };
    },

    availableActions(): Array<PipelineAction & { enabled: boolean }> {
      return this.actions.map((a) => ({
        ...a,
        enabled: a.enabledWhen(this.article.status),
      }));
    },
  },

  methods: {
    async onAction(action: PipelineAction & { enabled: boolean }): Promise<void> {
      if (!action.enabled) return;
      this.loadingAction = action.id;
      try {
        const { runId } = await action.triggerFn(this.article.id);
        this.notify.success(this.$t('articles.actions.triggered', { action: this.$t(action.i18nKey) }));
        // Note: polling is set up in the Recent Runs list; UI auto-refreshes
        this.$emit('action-triggered', { actionId: action.id, runId });
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.loadingAction = null;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.action-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.action-panel__section {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  padding: 16px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.action-panel__title {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));
  margin-bottom: 12px;
}

.action-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
```

(Subcomponents `PipelineActionRow`, `ArticleRecentRunsList`, `ArticleDetailHeader`, `ArticleBodyPanel`, `ArticleMetadataPanel`, `ArticleHistoryPanel`, `ArticleValidationPanel` follow patterns from previous specs. Key behaviors documented in Acceptance Criteria.)

### Frontend: ArticleBodyPanel (with change-tracking)

`apps/web/src/components/articles/ArticleBodyPanel.vue`:

```vue
<template>
  <div class="body-panel">
    <div class="body-panel__toolbar">
      <span v-if="hasUnsavedChanges" class="unsaved-indicator">
        <q-icon name="edit_note" size="14px" class="q-mr-xs" />
        {{ $t('common.unsavedChanges') }}
      </span>
      <q-space />
      <q-btn
        outline
        size="sm"
        :label="$t('articles.body.discard')"
        :disable="!hasUnsavedChanges || saving"
        @click="onDiscard"
      />
      <q-btn
        color="primary"
        size="sm"
        :label="$t('articles.body.save')"
        :disable="!hasUnsavedChanges"
        :loading="saving"
        @click="onSaveClick"
      />
    </div>

    <MarkdownEditor
      v-model="bodyDraft"
      :height="600"
    />

    <q-dialog v-model="saveDialogOpen" persistent>
      <q-card style="min-width: 420px;">
        <q-card-section>
          <div class="text-h6">{{ $t('articles.body.saveDialog.title') }}</div>
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="changeReason"
            outlined
            :label="$t('articles.body.saveDialog.changeReason')"
            type="textarea"
            autogrow
            :placeholder="$t('articles.body.saveDialog.changeReasonPlaceholder')"
          />
          <q-checkbox
            v-model="resyncAfterSave"
            class="q-mt-md"
            :label="$t('articles.body.saveDialog.resyncAfterSave')"
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="$t('common.cancel')" v-close-popup />
          <q-btn
            color="primary"
            :label="$t('articles.body.saveDialog.confirm')"
            :loading="saving"
            @click="onSaveConfirm"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import { useArticlesStore } from 'src/stores/articles';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import MarkdownEditor from 'src/components/common/MarkdownEditor.vue';
import type { ArticleDetail } from 'src/stores/articles';

export default defineComponent({
  name: 'ArticleBodyPanel',

  components: { MarkdownEditor },

  props: {
    detail: { type: Object as PropType<ArticleDetail>, required: true },
  },

  emits: ['saved'],

  setup() {
    return {
      articlesStore: useArticlesStore(),
      notify: useNotify(),
    };
  },

  data() {
    const article = this.detail.article as { bodyMd?: string };
    return {
      bodyDraft: article.bodyMd ?? '',
      lastSaved: article.bodyMd ?? '',
      saveDialogOpen: false,
      saving: false,
      changeReason: '',
      resyncAfterSave: true,
    };
  },

  computed: {
    article() {
      return this.detail.article as { id: string; bodyMd?: string; status: string };
    },
    hasUnsavedChanges(): boolean {
      return this.bodyDraft !== this.lastSaved;
    },
  },

  watch: {
    'detail.article.bodyMd'(newVal: string | undefined): void {
      // Re-sync when detail re-fetched externally
      if (newVal !== undefined && newVal !== this.lastSaved) {
        this.bodyDraft = newVal;
        this.lastSaved = newVal;
      }
    },
  },

  methods: {
    onDiscard(): void {
      this.bodyDraft = this.lastSaved;
    },

    onSaveClick(): void {
      this.saveDialogOpen = true;
    },

    async onSaveConfirm(): Promise<void> {
      this.saving = true;
      try {
        await this.articlesStore.saveBody(
          this.article.id,
          this.bodyDraft,
          this.changeReason.trim() || undefined,
        );
        this.lastSaved = this.bodyDraft;
        this.saveDialogOpen = false;
        this.notify.success(this.$t('articles.body.saveSuccess'));

        // Optionally re-trigger sync
        if (this.resyncAfterSave && this.canResync()) {
          await this.articlesStore.triggerSync(this.article.id);
          this.notify.info(this.$t('articles.body.resyncTriggered'));
        }

        this.changeReason = '';
        this.$emit('saved');
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.saving = false;
      }
    },

    canResync(): boolean {
      return ['ready_to_publish', 'published', 'blocked_by_pagespeed'].includes(this.article.status);
    },
  },
});
</script>

<style lang="scss" scoped>
.body-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.body-panel__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.unsaved-indicator {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: var(--q-warning, #f2c037);
  font-weight: 500;
}
</style>
```

(`ArticleHistoryPanel`, `ArticleValidationPanel`, `ArticleMetadataPanel`, `ArticleDetailHeader`, `PipelineActionRow`, `ArticleRecentRunsList` follow analogous structure. Code outlines below.)

### Frontend: Other Detail-Page Components (Outlines)

**`ArticleDetailHeader.vue`**: Top section with breadcrumb (Project › Cluster › Article), title, status pill, last-updated.

**`ArticleMetadataPanel.vue`**: Editable form for title, slug, cornerstoneKeyword, metaDescription. Save button. Uses `articlesStore.updateMetadata()`.

**`ArticleHistoryPanel.vue`**: Calls `articlesStore.fetchVersions()`. Lists versions with version number, change reason, timestamp. Click on a version → shows diff modal comparing it to the current body. (Diff view: simple side-by-side rendering, no full diff library needed for v1; show two `<pre>` blocks with bodies. Future: integrate `diff` package.)

**`ArticleValidationPanel.vue`**: Shows latest pagespeedRun results: scores per category, pass/fail, threshold comparison. Shows latest schemaExtensionRun: detected types, FAQ question count, etc. Read-only.

**`PipelineActionRow.vue`**: Single action row in the sidebar. Icon, label, click handler. Disabled state when action not allowed for current status. Tooltip explains why disabled.

**`ArticleRecentRunsList.vue`**: Lists last 3-5 runs across pipelineRuns, astroSyncRuns, pagespeedRuns, schemaExtensionRuns, sorted by startedAt desc. Each row: icon (per pipeline type), status badge, timestamp. Updates via polling for in-flight runs.

### i18n keys

`apps/web/src/i18n/de/articles.ts`:

```typescript
export default {
  empty: 'Noch keine Artikel.',
  emptyHint: 'Artikel werden über den Cold-Start (Phase 4) oder per CLI erstellt.',

  toolbar: {
    byPillar: 'Nach Pillar',
    byCluster: 'Nach Cluster',
    totalCount: '{count} Artikel',
  },

  lane: {
    uncategorized: 'Ohne Cluster',
    empty: '—',
  },

  statusGroup: {
    to_review: 'Review',
    in_progress: 'In Arbeit',
    ready: 'Fertig',
    issues: 'Probleme',
  },

  card: {
    cornerstone: 'Cornerstone',
    words: 'Wörter',
  },

  detail: {
    notFound: 'Artikel nicht gefunden',
    tabs: {
      body: 'Inhalt',
      metadata: 'Metadaten',
      history: 'Versionen',
      validation: 'Validierung',
    },
  },

  body: {
    save: 'Speichern',
    discard: 'Verwerfen',
    saveSuccess: 'Inhalt gespeichert',
    resyncTriggered: 'Re-Sync zu Astro gestartet',
    saveDialog: {
      title: 'Änderungen speichern',
      changeReason: 'Änderungsgrund (optional)',
      changeReasonPlaceholder: 'z.B. "Intro überarbeitet" oder "Faktencheck korrigiert"',
      resyncAfterSave: 'Nach dem Speichern automatisch zu Astro re-syncen',
      confirm: 'Speichern',
    },
  },

  actions: {
    pipelineActions: 'Pipeline-Aktionen',
    lastRunStatus: 'Letzte Runs',
    generateOutline: 'Outline generieren',
    generateDraft: 'Draft generieren',
    syncToAstro: 'Zu Astro syncen',
    validatePagespeed: 'PageSpeed validieren',
    extendSchema: 'Schema.org erweitern',
    triggered: 'Aktion gestartet: {action}',
    notAvailable: 'Aktion nicht verfügbar im aktuellen Status',
  },
};
```

Mirror in `en/`.

## Acceptance Criteria

### Backend Endpoints

- [ ] `GET /api/articles?projectSlug=foo` returns array with denormalized cluster/pillar fields
- [ ] `GET /api/articles/:id` returns article + cluster + pillar + recent runs
- [ ] `PATCH /api/articles/:id` updates editable fields, validates status enum
- [ ] `POST /api/articles/:id/body` creates `article_versions` row + updates `articles.bodyMd` + recomputes wordCount
- [ ] `GET /api/articles/:id/versions` lists versions (no body content)
- [ ] `GET /api/articles/:id/versions/:version` returns one version's body
- [ ] All 5 trigger endpoints (`/generate-outline`, `/generate-draft`, `/sync`, `/validate-pagespeed`, `/extend-schema`) use preRunId pattern
- [ ] Trigger endpoints return `{ runId, jobId }` with status 202
- [ ] All endpoints require auth

### Kanban View

- [ ] Toggle button switches between "Pillar-grouped" and "Cluster-flat" views
- [ ] Toggle preference persists in localStorage
- [ ] Pillar-grouped: lanes show `Pillar › Cluster` in header
- [ ] Cluster-flat: lanes show only `Cluster` in header
- [ ] Articles without cluster show in "Uncategorized" lane
- [ ] Each lane has 4 status columns: To Review / In Progress / Ready / Issues
- [ ] Articles correctly grouped per status mapping
- [ ] Empty status columns show "—" placeholder

### Article Cards

- [ ] Cornerstones have left primary-color border + "Cornerstone" badge
- [ ] Cards show title (or cornerstoneKeyword if title null) and word count
- [ ] In-flight statuses (generating, drafting, etc.) show spinner
- [ ] Failed/blocked statuses show red error icon
- [ ] Click on card navigates to `/articles/:id`

### Article Detail Page

- [ ] Page renders with header + 4 tabs + right action sidebar
- [ ] URL reflects active tab via `?tab=`
- [ ] Direct links work (`/articles/:id?tab=history`)
- [ ] 404 state for unknown article ID

### Body Tab + Editing

- [ ] MarkdownEditor (with toolbar from Spec 34.5) renders article body
- [ ] Edit triggers "unsaved changes" indicator
- [ ] Save button opens dialog
- [ ] Dialog has change-reason field + "re-sync after save" checkbox
- [ ] Confirm save creates new version + updates body + (optionally) triggers sync
- [ ] Discard button reverts to last-saved state

### Metadata Tab

- [ ] Editable fields: title, slug, cornerstoneKeyword, metaDescription
- [ ] Slug validation: `[a-z0-9-]+`
- [ ] Save updates fields without creating a version
- [ ] Status field is editable with dropdown (cautious — only for manual recovery scenarios)

### History Tab

- [ ] Lists all versions with version number, change reason, timestamp
- [ ] Click version → modal shows diff (side-by-side bodies)

### Validation Tab

- [ ] Shows latest pagespeed scores (or "not validated" state)
- [ ] Shows latest schema extension types (faq, howto, breadcrumb)
- [ ] Read-only display

### Action Sidebar

- [ ] Lists 5 actions with icons
- [ ] Actions disabled when not applicable to current status (greyed out + tooltip)
- [ ] Click triggers backend endpoint, shows success notification
- [ ] Recent Runs list shows latest 3-5 runs across all run tables

## Testing Strategy

End-to-end manual test:

1. **Fresh project after Cold-Start**: Visit `/projects/ki-wissensraum/articles`. See cornerstones in proposed/approved status in "To Review" or "In Progress" columns.
2. **Toggle views**: Switch between Pillar/Cluster views, verify localStorage persists.
3. **Generate outline**: Click on a `proposed` cornerstone → detail page → action sidebar → "Outline generieren" → see status flip to `generating` → polling shows progress → final state `outline_review`.
4. **Generate draft**: From `outline_review` state, trigger draft → status flips to `drafting` → eventually `final_review` (with auto-cascade through schema_extending → ready_to_publish).
5. **Edit body**: On a `final_review` article, edit body, save with reason "Test edit". Verify version 2 created. History tab shows both versions. Diff view works.
6. **Resync flow**: Save with "re-sync after save" checked. Verify sync pipeline triggered.
7. **Failed state**: Trigger an action that will fail (e.g., sync without astroRepo configured). Verify card shows error icon and Issues column. Click error → dialog shows error message.
8. **PageSpeed validation**: After sync, verify validation runs auto-cascade. Manually trigger re-validation from action sidebar. Validation tab shows updated scores.

## Open Questions / Decisions Made

**Decision 1: Status field is editable in Metadata tab.**
This is for manual recovery only — e.g., if a pipeline crashes mid-run, Marcel can reset status to `approved` manually. Risky but necessary for emergency overrides.

**Decision 2: Diff view is simple side-by-side, no library.**
Adding a diff lib (`diff`, `diff2html`) costs ~50KB. For occasional version comparison, plain side-by-side is enough. Upgrade if Marcel asks.

**Decision 3: Re-sync after body edit is opt-in via checkbox, default ON.**
ON because most edits should immediately reflect on the live site. Opt-out for cases where Marcel wants to batch multiple edits.

**Decision 4: No `articleVersions` retention policy.**
Versions accumulate. For 30 articles × 5 edits each = 150 rows, no problem. If it grows to 10,000+, prune. Out of scope.

**Decision 5: Recent Runs list polls only when in-flight runs exist.**
If all visible runs are terminal, no polling. Saves bandwidth. Implementation: composable checks `if (anyInFlight) start polling` else `stop`.

**Decision 6: Trigger endpoints all live in `articleRoutes`, not split per pipeline.**
Cohesion: all article-related triggers in one file. If needed later, refactor by feature.

**Decision 7: ArticleListItem omits bodyMd for performance.**
Articles list could have 100+ entries with 5000-word bodies → 500KB+ payload per request. List endpoint excludes bodyMd; detail endpoint includes it. Standard pattern.

**Decision 8: No filtering / search in v1.**
At 5-50 articles per project, scrolling works. Add filters when projects grow past 50 articles.

**Decision 9: Click "Outline" from `failed` status auto-resets it.**
Pipeline triggers don't strictly check current status server-side beyond enabling the button. The pipeline workers handle re-runs gracefully. UI just guides what's "appropriate."

**Decision 10: ArticleListItem types use snake_case-ish camelCase from DB.**
Server returns Drizzle's camelCased fields directly — no field renaming. UI consumes as-is.

## Implementation Order

**Recommend 5 sessions.**

**Session 1: Backend (~5h)**
1. `articleRoutes` extension: list, detail, patch, body update, versions endpoints
2. Trigger endpoints with preRunId pattern (5 trigger endpoints)
3. Test each endpoint with curl
4. Verify trigger helpers in `packages/pipelines/` exist or create thin wrappers
5. Commit: `feat(api): article routes + pipeline triggers (spec 36)`

**Session 2: Articles store + Kanban (~5h)**
1. `articles.ts` Pinia store
2. `article-status.ts` helpers
3. `ArticlesPanel.vue` (replaces stub)
4. `ArticleKanbanLane.vue`
5. `ArticleCard.vue`
6. i18n keys for kanban view
7. Manual test: KI-Wissensraum articles render correctly grouped
8. Commit: `feat(web): article kanban view (spec 36)`

**Session 3: Detail page shell + Body tab (~5h)**
1. `ArticleDetailPage.vue` (replaces stub)
2. `ArticleDetailHeader.vue`
3. `ArticleBodyPanel.vue` with save dialog + change-reason
4. `ArticleMetadataPanel.vue`
5. i18n keys for detail tabs
6. Manual test: edit + save creates version
7. Commit: `feat(web): article detail body+metadata (spec 36)`

**Session 4: History + Validation tabs (~3h)**
1. `ArticleHistoryPanel.vue` with diff modal
2. `ArticleValidationPanel.vue`
3. i18n keys
4. Manual test: history shows versions, diff works
5. Commit: `feat(web): article history+validation tabs (spec 36)`

**Session 5: Action panel + polling integration (~4h)**
1. `ArticleActionPanel.vue`
2. `PipelineActionRow.vue`
3. `ArticleRecentRunsList.vue` with smart polling
4. i18n keys for actions
5. End-to-end test: trigger outline → poll → status update reflects
6. Commit: `feat(web): article action panel + polling (spec 36)`

Total: ~22 hours.

## Splitting Plan

See "Implementation Order" — 5 sessions with `/clear` between.

## Discovered During Implementation

**Session 1 (Backend)**

- `enqueueArticleSyncPipeline` must pre-create an `astroSyncRuns` row with `status='pending'` before calling `enqueuePipeline`, because the astro-sync pipeline's `afterError` hook finds and settles the pending row on failure. If we only created the `pipelineRuns` row (via `triggerWithPreRunId`), error recovery would leave no `astroSyncRuns` trace. Same pattern applies to pagespeed.

- The old adapter enqueue helpers (`enqueueArticleSync` from `@marketing-auto/adapter-astro-sync`, `enqueueArticleValidation` from `@marketing-auto/adapter-pagespeed`) are **no longer called from HTTP routes**. All 5 trigger endpoints now go through thin wrappers in `packages/pipelines/src/article/trigger.ts`. The adapter helpers may still be useful for programmatic (non-HTTP) callers.

## Deviations

**Session 1 (Backend)**

1. **`triggerWithPreRunId` uses DB-generated UUID instead of `randomUUID()` pre-generation.** The spec shows `const preRunId = randomUUID(); await db.insert(pipelineRuns).values({ id: preRunId, ... })`. The implementation uses `.returning({ id: pipelineRuns.id })` to let the DB generate the UUID, then reads it back. Functionally identical. Side effect: `pipelineRuns.input` stores only `{ articleId }` (not `{ articleId, preRunId }` as spec shows), since `preRunId` equals the row's own `id`.

2. **`sync` and `validate-pagespeed` trigger routes no longer call adapter-package enqueue helpers.** The spec's `triggerWithPreRunId` takes an `enqueue` function. We implemented new `enqueueArticleSyncPipeline` / `enqueuePagespeedValidationPipeline` wrappers in `packages/pipelines/src/article/trigger.ts` rather than routing through `@marketing-auto/adapter-astro-sync` / `@marketing-auto/adapter-pagespeed`. Both wrappers replicate the relevant side effects (astroSyncRuns insert, article status update).

3. **Server-side status guards removed from all 5 trigger endpoints.** The old adapter enqueue helpers rejected requests unless the article was in a specific status. The new wrappers don't check article status — per spec Decision 9, the UI controls what actions appear enabled; the server trusts the pipeline workers to handle state gracefully.
