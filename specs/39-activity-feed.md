# Spec 39: Activity Feed

**Phase:** 4 (Welle 3, Abschluss)
**Estimated Effort:** 1.5 days (2 sessions)
**Dependencies:** Spec 30 (shell), Spec 35 (existing per-run polling), Spec 36 (article pipeline triggers)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (read-only feed, list polling, no architectural complexity)

---

## Goal

Build the **Activity Feed** at `/activity`. A unified, real-time view of **everything happening across all projects**:

- Currently in-flight pipeline runs (queued + running) — top of the list, live-updating
- Recent terminated runs (completed/failed/cancelled in the last 24h or 7d depending on filter) — below in-flight section
- Cross-project view by default; filter to a single project optional
- Filter by type (article, cold-start, sync, pagespeed, etc.) and by status

Why this matters:
- After Spec 35/36 there are many places where pipelines can be triggered (Cold-Start, Article-Detail, Cluster auto-rebuild, manual sync)
- Without a central feed, Marcel has to navigate to each detail page to check status
- The feed is the **"is anything broken?"** dashboard — at a glance, see all failures and in-flight work

This spec also introduces a **list-polling composable** (`useActiveRunsPolling`) that's distinct from the per-run polling composable from Spec 35. Both will coexist:
- `usePipelineRunPolling(runId)` — single-run, used in Cold-Start phase pages and Article-Detail RecentRuns
- `useActiveRunsPolling()` — fetches the entire active-runs list, used in Activity Feed (and potentially as a global indicator in the header later)

## Architecture Decisions

**Decision 1: One unified backend endpoint that aggregates across all run tables.**

```
GET /api/pipeline-runs/active?projectId=...&since=...
```

Returns a single response combining:
- `pipelineRuns` (all kinds — generic table)
- `astroSyncRuns` (with denormalized article info)
- `pagespeedRuns` (with denormalized article info)
- `schemaExtensionRuns` (with denormalized article info)
- `linkRebuildRuns`

All normalized into a single `ActivityEntry` shape that the frontend renders uniformly.

**Decision 2: "Active" means status IN ('queued', 'running', 'pending')** plus a configurable lookback window for terminated runs.

The endpoint takes `?since=ISO_DATETIME` parameter. Returns:
- All runs with non-terminal status, regardless of date
- All runs with terminal status that finished `>= since`

Default `since` = 24 hours ago.

**Decision 3: List-polling composable replaces per-run polling on this page.**

Activity Feed never polls individual runs. It polls the list endpoint at 2.5s interval when document is visible. Page Visibility API pauses polling when tab hidden.

**Decision 4: Source of truth for `pipelineRuns` correlation IDs.**

The Article-related run tables (`astroSyncRuns`, etc.) all have `pipelineRunId` foreign-key reference. This is the join key. We don't need to merge pipelineRuns + per-table runs — we just decide which is the primary source per run-type:

| Source | Type label | Used for |
|---|---|---|
| `pipelineRuns` (cold-start:*) | `cold_start` | All cold-start phases (these don't have specific tables) |
| `pipelineRuns` (article:outline) | `article_outline` | Outline generation |
| `pipelineRuns` (article:draft) | `article_draft` | Draft generation |
| `astroSyncRuns` | `astro_sync` | Sync to Astro repo |
| `pagespeedRuns` | `pagespeed` | PageSpeed validation |
| `schemaExtensionRuns` | `schema_extension` | Schema.org extension |
| `linkRebuildRuns` | `link_rebuild` | Internal linking rebuild |

Backend reads from `pipelineRuns` for outline/draft/cold-start, and from per-tables for ops with their own table. This avoids double-reporting when both sources exist.

**Decision 5: Status normalization — different tables use different status values.**

| Source | Native statuses | Normalized status |
|---|---|---|
| `pipelineRuns` | queued, running, completed, failed, cancelled | (passes through) |
| `astroSyncRuns` | pending, succeeded, failed | pending → running, succeeded → completed |
| `pagespeedRuns` | pending, succeeded, failed, errored | pending → running, succeeded → completed, errored → failed |
| `schemaExtensionRuns` | pending, succeeded, failed | pending → running, succeeded → completed |
| `linkRebuildRuns` | pending, succeeded, failed, budget_exceeded | pending → running, succeeded → completed, budget_exceeded → failed |

The frontend works with a unified status: `queued | running | completed | failed | cancelled`.

**Decision 6: Each entry shows context on what it's working on.**
- For article runs: article title (or cornerstoneKeyword as fallback)
- For cold-start runs: project name + phase name
- For link-rebuild: cluster name + count of articles affected

**Decision 7: No drill-down from Activity Feed.**
Each entry has a link icon. Clicking navigates to the article detail page (or project hub if cold-start). Activity Feed itself is read-only; it never modifies state.

**Decision 8: Filter UI is sparse.**
Project dropdown + Type dropdown + Status dropdown. No date-range picker (covered by `since` query param, fixed to 24h/7d/30d preset).

**Decision 9: Polling pauses when nothing is in-flight.**
If all entries are terminal, no polling. Saves CPU/network. Resumes when user manually refreshes or filter changes.

**Decision 10: List-polling composable handles ALL state internally — the page is purely reactive.**

```typescript
const { entries, isPolling, refresh } = useActiveRunsPolling({ projectId, since });
```

Activity Feed page is a thin shell calling this composable.

## Non-Goals

- **No global header indicator** ("3 runs in progress") — could come later as a separate spec; Activity Feed page is enough for v1
- **No notifications / push** when a run completes — push is Spec 40
- **No bulk cancel actions** — cancel is per-run, available on detail pages only
- **No diff/log viewer for a single run** — clicking goes to article-detail or project-hub, not a dedicated run detail page
- **No infinite scroll / pagination** — the list is bounded by the `since` window (24h-30d). With a few hundred runs max per window, just render all.
- **No live duration ticker** that increments seconds in real-time on each row — duration is computed on render, naturally updated by 2.5s polling
- **No "all-time" view** — `since` is bounded; for older runs Marcel queries DB directly

## Detailed Implementation

### Backend: Activity Endpoint

`apps/api/src/routes/pipeline-runs.ts` (new file or extend existing):

```typescript
import { Hono } from 'hono';
import { eq, and, gte, desc, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  db, pipelineRuns, astroSyncRuns, pagespeedRuns,
  schemaExtensionRuns, linkRebuildRuns,
  projects, articles, clusters, contentPillars,
} from '@marketing-auto/db';
import { requireAuth } from '../middleware/require-auth';

export const pipelineRunRoutes = new Hono();
pipelineRunRoutes.use(requireAuth);

export type ActivityType =
  | 'cold_start'
  | 'article_outline'
  | 'article_draft'
  | 'astro_sync'
  | 'pagespeed'
  | 'schema_extension'
  | 'link_rebuild'
  | 'other';

export type NormalizedStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ActivityEntry {
  id: string;
  source: 'pipeline_runs' | 'astro_sync_runs' | 'pagespeed_runs' | 'schema_extension_runs' | 'link_rebuild_runs';
  type: ActivityType;
  status: NormalizedStatus;

  projectId: string;
  projectName: string | null;
  projectSlug: string | null;

  // Display fields
  title: string;            // primary line
  subtitle: string | null;  // secondary line
  errorMessage: string | null;

  // Navigation
  articleId: string | null;
  articleSlug: string | null;
  clusterId: string | null;

  // Timing
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

// ───── GET /api/pipeline-runs/active ────────────────────────────────────

pipelineRunRoutes.get('/active', async (c) => {
  const projectId = c.req.query('projectId') ?? null;
  const sinceParam = c.req.query('since');
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);

  if (isNaN(since.getTime())) {
    return c.json({ ok: false, error: 'Invalid `since` parameter' }, 400);
  }

  const projectFilter = (col: typeof pipelineRuns.projectId) =>
    projectId ? eq(col, projectId) : undefined;

  // ─── pipelineRuns (cold-start, article:outline, article:draft) ──────
  // Fetch all in-flight + terminal-since-cutoff
  const pipelineRunRows = await db.select({
    id: pipelineRuns.id,
    pipelineName: pipelineRuns.pipelineName,
    stepName: pipelineRuns.stepName,
    status: pipelineRuns.status,
    projectId: pipelineRuns.projectId,
    projectName: projects.name,
    projectSlug: projects.slug,
    input: pipelineRuns.input,
    output: pipelineRuns.output,
    errorMessage: pipelineRuns.errorMessage,
    startedAt: pipelineRuns.startedAt,
    completedAt: pipelineRuns.completedAt,
    createdAt: pipelineRuns.createdAt,
  })
    .from(pipelineRuns)
    .leftJoin(projects, eq(pipelineRuns.projectId, projects.id))
    .where(and(
      // active (queued/running) OR terminal-since-cutoff
      or(
        inArray(pipelineRuns.status, ['queued', 'running']),
        and(
          inArray(pipelineRuns.status, ['completed', 'failed', 'cancelled']),
          gte(pipelineRuns.createdAt, since),
        ),
      ),
      ...(projectFilter(pipelineRuns.projectId) ? [projectFilter(pipelineRuns.projectId)!] : []),
    ))
    .orderBy(desc(pipelineRuns.createdAt));

  // For pipeline runs with article references in input.articleId, batch-fetch article info
  const articleIdsFromPR = pipelineRunRows
    .map((r) => (r.input as { articleId?: string } | null)?.articleId)
    .filter((id): id is string => typeof id === 'string');

  const articleInfoMap = new Map<string, { id: string; slug: string; title: string | null; cornerstoneKeyword: string }>();
  if (articleIdsFromPR.length > 0) {
    const rows = await db.select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      cornerstoneKeyword: articles.cornerstoneKeyword,
    }).from(articles).where(inArray(articles.id, articleIdsFromPR));
    for (const r of rows) articleInfoMap.set(r.id, r);
  }

  // ─── astroSyncRuns ──────────────────────────────────────────────────
  const astroSyncRows = await db.select({
    run: astroSyncRuns,
    project: { name: projects.name, slug: projects.slug },
    article: { id: articles.id, slug: articles.slug, title: articles.title, cornerstoneKeyword: articles.cornerstoneKeyword },
  })
    .from(astroSyncRuns)
    .leftJoin(projects, eq(astroSyncRuns.projectId, projects.id))
    .leftJoin(articles, eq(astroSyncRuns.articleId, articles.id))
    .where(and(
      or(
        eq(astroSyncRuns.status, 'pending'),
        gte(astroSyncRuns.startedAt, since),
      ),
      ...(projectFilter(astroSyncRuns.projectId) ? [projectFilter(astroSyncRuns.projectId)!] : []),
    ))
    .orderBy(desc(astroSyncRuns.startedAt));

  // ─── pagespeedRuns ──────────────────────────────────────────────────
  const pagespeedRows = await db.select({
    run: pagespeedRuns,
    project: { name: projects.name, slug: projects.slug },
    article: { id: articles.id, slug: articles.slug, title: articles.title, cornerstoneKeyword: articles.cornerstoneKeyword },
  })
    .from(pagespeedRuns)
    .leftJoin(projects, eq(pagespeedRuns.projectId, projects.id))
    .leftJoin(articles, eq(pagespeedRuns.articleId, articles.id))
    .where(and(
      or(
        eq(pagespeedRuns.status, 'pending'),
        gte(pagespeedRuns.startedAt, since),
      ),
      ...(projectFilter(pagespeedRuns.projectId) ? [projectFilter(pagespeedRuns.projectId)!] : []),
    ))
    .orderBy(desc(pagespeedRuns.startedAt));

  // ─── schemaExtensionRuns ────────────────────────────────────────────
  const schemaRows = await db.select({
    run: schemaExtensionRuns,
    project: { name: projects.name, slug: projects.slug },
    article: { id: articles.id, slug: articles.slug, title: articles.title, cornerstoneKeyword: articles.cornerstoneKeyword },
  })
    .from(schemaExtensionRuns)
    .leftJoin(projects, eq(schemaExtensionRuns.projectId, projects.id))
    .leftJoin(articles, eq(schemaExtensionRuns.articleId, articles.id))
    .where(and(
      or(
        eq(schemaExtensionRuns.status, 'pending'),
        gte(schemaExtensionRuns.startedAt, since),
      ),
      ...(projectFilter(schemaExtensionRuns.projectId) ? [projectFilter(schemaExtensionRuns.projectId)!] : []),
    ))
    .orderBy(desc(schemaExtensionRuns.startedAt));

  // ─── linkRebuildRuns ────────────────────────────────────────────────
  const linkRows = await db.select({
    run: linkRebuildRuns,
    project: { name: projects.name, slug: projects.slug },
    cluster: { id: clusters.id, name: clusters.name },
  })
    .from(linkRebuildRuns)
    .leftJoin(projects, eq(linkRebuildRuns.projectId, projects.id))
    .leftJoin(clusters, eq(linkRebuildRuns.clusterId, clusters.id))
    .where(and(
      or(
        eq(linkRebuildRuns.status, 'pending'),
        gte(linkRebuildRuns.startedAt, since),
      ),
      ...(projectFilter(linkRebuildRuns.projectId) ? [projectFilter(linkRebuildRuns.projectId)!] : []),
    ))
    .orderBy(desc(linkRebuildRuns.startedAt));

  // ─── Normalize all into unified ActivityEntry shape ─────────────────
  const entries: ActivityEntry[] = [];

  // pipelineRuns → entries
  for (const pr of pipelineRunRows) {
    const articleId = (pr.input as { articleId?: string } | null)?.articleId ?? null;
    const articleInfo = articleId ? articleInfoMap.get(articleId) : null;
    entries.push({
      id: pr.id,
      source: 'pipeline_runs',
      type: classifyPipelineName(pr.pipelineName),
      status: pr.status as NormalizedStatus,
      projectId: pr.projectId,
      projectName: pr.projectName,
      projectSlug: pr.projectSlug,
      title: buildPipelineTitle(pr.pipelineName, pr.stepName, articleInfo),
      subtitle: buildPipelineSubtitle(pr.pipelineName, articleInfo),
      errorMessage: pr.errorMessage,
      articleId: articleInfo?.id ?? null,
      articleSlug: articleInfo?.slug ?? null,
      clusterId: null,
      startedAt: pr.startedAt?.toISOString() ?? null,
      finishedAt: pr.completedAt?.toISOString() ?? null,
      createdAt: pr.createdAt.toISOString(),
    });
  }

  // astroSyncRuns → entries
  for (const row of astroSyncRows) {
    entries.push({
      id: row.run.id,
      source: 'astro_sync_runs',
      type: 'astro_sync',
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: row.project?.name ?? null,
      projectSlug: row.project?.slug ?? null,
      title: row.article?.title ?? row.article?.cornerstoneKeyword ?? 'Article sync',
      subtitle: 'Astro sync',
      errorMessage: row.run.errorMessage,
      articleId: row.article?.id ?? null,
      articleSlug: row.article?.slug ?? null,
      clusterId: null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  // pagespeedRuns → entries
  for (const row of pagespeedRows) {
    entries.push({
      id: row.run.id,
      source: 'pagespeed_runs',
      type: 'pagespeed',
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: row.project?.name ?? null,
      projectSlug: row.project?.slug ?? null,
      title: row.article?.title ?? row.article?.cornerstoneKeyword ?? 'Article validation',
      subtitle: 'PageSpeed validation',
      errorMessage: row.run.errorMessage,
      articleId: row.article?.id ?? null,
      articleSlug: row.article?.slug ?? null,
      clusterId: null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  // schemaExtensionRuns → entries
  for (const row of schemaRows) {
    entries.push({
      id: row.run.id,
      source: 'schema_extension_runs',
      type: 'schema_extension',
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: row.project?.name ?? null,
      projectSlug: row.project?.slug ?? null,
      title: row.article?.title ?? row.article?.cornerstoneKeyword ?? 'Schema extension',
      subtitle: 'Schema.org extension',
      errorMessage: row.run.errorMessage,
      articleId: row.article?.id ?? null,
      articleSlug: row.article?.slug ?? null,
      clusterId: null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  // linkRebuildRuns → entries
  for (const row of linkRows) {
    const articlesProcessed = row.run.articlesProcessed ?? 0;
    const subtitle = articlesProcessed > 0
      ? `${row.run.articlesModified ?? 0} of ${articlesProcessed} articles modified`
      : 'Internal linking rebuild';
    entries.push({
      id: row.run.id,
      source: 'link_rebuild_runs',
      type: 'link_rebuild',
      status: normalizeStatus(row.run.status),
      projectId: row.run.projectId,
      projectName: row.project?.name ?? null,
      projectSlug: row.project?.slug ?? null,
      title: row.cluster?.name ? `Cluster: ${row.cluster.name}` : 'Internal links',
      subtitle,
      errorMessage: row.run.errorMessage,
      articleId: null,
      articleSlug: null,
      clusterId: row.cluster?.id ?? null,
      startedAt: row.run.startedAt.toISOString(),
      finishedAt: row.run.finishedAt?.toISOString() ?? null,
      createdAt: row.run.startedAt.toISOString(),
    });
  }

  // Sort: in-flight (queued/running) first, then terminal by startedAt desc
  entries.sort((a, b) => {
    const aActive = a.status === 'queued' || a.status === 'running';
    const bActive = b.status === 'queued' || b.status === 'running';
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return new Date(b.startedAt ?? b.createdAt).getTime() - new Date(a.startedAt ?? a.createdAt).getTime();
  });

  return c.json({
    ok: true,
    data: {
      entries,
      since: since.toISOString(),
      activeCount: entries.filter((e) => e.status === 'queued' || e.status === 'running').length,
    },
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────

function classifyPipelineName(name: string): ActivityType {
  if (name.startsWith('cold-start:')) return 'cold_start';
  if (name === 'article:outline') return 'article_outline';
  if (name === 'article:draft') return 'article_draft';
  if (name === 'article:sync') return 'astro_sync';
  if (name === 'article:validate-pagespeed') return 'pagespeed';
  if (name === 'article:extend-schema') return 'schema_extension';
  if (name === 'article:link-rebuild') return 'link_rebuild';
  return 'other';
}

function normalizeStatus(raw: string): NormalizedStatus {
  const map: Record<string, NormalizedStatus> = {
    queued: 'queued',
    running: 'running',
    pending: 'running',
    completed: 'completed',
    succeeded: 'completed',
    failed: 'failed',
    errored: 'failed',
    budget_exceeded: 'failed',
    cancelled: 'cancelled',
  };
  return map[raw] ?? 'failed';
}

function buildPipelineTitle(
  pipelineName: string,
  stepName: string | null,
  articleInfo: { title: string | null; cornerstoneKeyword: string } | null | undefined,
): string {
  if (articleInfo) {
    return articleInfo.title ?? articleInfo.cornerstoneKeyword;
  }
  if (pipelineName.startsWith('cold-start:')) {
    return pipelineName.replace('cold-start:', '').replace(/-/g, ' ');
  }
  return pipelineName;
}

function buildPipelineSubtitle(
  pipelineName: string,
  articleInfo: { title: string | null; cornerstoneKeyword: string } | null | undefined,
): string | null {
  if (pipelineName.startsWith('cold-start:')) {
    const phase = pipelineName.replace('cold-start:', '');
    return `Cold-start phase: ${phase}`;
  }
  if (pipelineName === 'article:outline') return 'Outline generation';
  if (pipelineName === 'article:draft') return 'Draft generation';
  return null;
}
```

Mount in `apps/api/src/index.ts`:
```typescript
app.route('/api/pipeline-runs', pipelineRunRoutes);
```

### Frontend: List-Polling Composable

`apps/web/src/composables/useActiveRunsPolling.ts`:

```typescript
import { ref, type Ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { api } from 'src/lib/api-client';

export type ActivityType =
  | 'cold_start' | 'article_outline' | 'article_draft'
  | 'astro_sync' | 'pagespeed' | 'schema_extension'
  | 'link_rebuild' | 'other';

export type NormalizedStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ActivityEntry {
  id: string;
  source: string;
  type: ActivityType;
  status: NormalizedStatus;
  projectId: string;
  projectName: string | null;
  projectSlug: string | null;
  title: string;
  subtitle: string | null;
  errorMessage: string | null;
  articleId: string | null;
  articleSlug: string | null;
  clusterId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface ActiveRunsResponse {
  entries: ActivityEntry[];
  since: string;
  activeCount: number;
}

interface UseActiveRunsPollingOptions {
  /** Project ID to filter by, or null for all projects */
  projectId?: Ref<string | null>;
  /** ISO datetime for cutoff. Defaults to 24h ago, refreshed each poll. */
  sinceHours?: Ref<number>;
  /** Polling interval in ms. Default 2500. */
  intervalMs?: number;
}

interface UseActiveRunsPollingResult {
  entries: Ref<ActivityEntry[]>;
  activeCount: Ref<number>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  isPolling: Ref<boolean>;
  refresh: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

export function useActiveRunsPolling(opts: UseActiveRunsPollingOptions = {}): UseActiveRunsPollingResult {
  const entries = ref<ActivityEntry[]>([]);
  const activeCount = ref<number>(0);
  const loading = ref<boolean>(false);
  const error = ref<string | null>(null);
  const isPolling = ref<boolean>(false);

  const intervalMs = opts.intervalMs ?? 2500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function fetchOnce(): Promise<void> {
    loading.value = true;
    try {
      const sinceMs = (opts.sinceHours?.value ?? 24) * 60 * 60 * 1000;
      const since = new Date(Date.now() - sinceMs).toISOString();
      const params = new URLSearchParams({ since });
      if (opts.projectId?.value) params.set('projectId', opts.projectId.value);

      const res = await api.get<{ ok: boolean; data: ActiveRunsResponse }>(
        `/pipeline-runs/active?${params.toString()}`,
      );
      entries.value = res.data.data.entries;
      activeCount.value = res.data.data.activeCount;
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'fetch_failed';
    } finally {
      loading.value = false;
    }
  }

  async function refresh(): Promise<void> {
    await fetchOnce();
  }

  function scheduleNext(): void {
    if (stopped) return;
    if (document.visibilityState !== 'visible') {
      // Skip polling while hidden, retry when visible
      return;
    }
    timer = setTimeout(() => {
      void (async () => {
        await fetchOnce();
        scheduleNext();
      })();
    }, intervalMs);
  }

  function start(): void {
    stopped = false;
    isPolling.value = true;
    void fetchOnce().then(() => scheduleNext());
  }

  function stop(): void {
    stopped = true;
    isPolling.value = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible' && isPolling.value && !timer) {
      void fetchOnce().then(() => scheduleNext());
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    start();
  });

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stop();
  });

  // Re-fetch when filter changes
  if (opts.projectId) {
    watch(opts.projectId, () => void refresh());
  }
  if (opts.sinceHours) {
    watch(opts.sinceHours, () => void refresh());
  }

  return { entries, activeCount, loading, error, isPolling, refresh, start, stop };
}
```

### Frontend: ActivityPage

`apps/web/src/pages/ActivityPage.vue`:

```vue
<template>
  <q-page padding>
    <div class="row items-center q-mb-lg">
      <div class="col">
        <h1 class="text-h5 q-my-none">{{ $t('activity.title') }}</h1>
        <p class="text-caption text-grey-7 q-mt-xs">
          {{ $t('activity.subtitle', { count: activeCount }) }}
        </p>
      </div>
      <div class="col-auto">
        <q-btn flat icon="refresh" :loading="loading" @click="refresh" />
      </div>
    </div>

    <div class="filters q-mb-md">
      <q-select
        v-model="selectedProjectId"
        outlined
        dense
        emit-value
        map-options
        :options="projectOptions"
        :label="$t('activity.filters.project')"
        style="min-width: 220px;"
      />
      <q-select
        v-model="selectedType"
        outlined
        dense
        emit-value
        map-options
        :options="typeOptions"
        :label="$t('activity.filters.type')"
        clearable
        style="min-width: 200px;"
      />
      <q-select
        v-model="selectedStatus"
        outlined
        dense
        emit-value
        map-options
        :options="statusOptions"
        :label="$t('activity.filters.status')"
        clearable
        style="min-width: 160px;"
      />
      <q-select
        v-model="sinceHours"
        outlined
        dense
        emit-value
        map-options
        :options="sinceOptions"
        :label="$t('activity.filters.since')"
        style="min-width: 160px;"
      />
    </div>

    <div v-if="loading && filteredEntries.length === 0" class="text-center q-pa-xl">
      <q-spinner size="3em" color="primary" />
    </div>

    <div v-else-if="filteredEntries.length === 0" class="empty-state">
      <q-icon name="event_note" size="64px" color="grey-5" />
      <p class="text-body1 q-mt-md">{{ $t('activity.empty') }}</p>
      <p class="text-caption text-grey-7">{{ $t('activity.emptyHint') }}</p>
    </div>

    <div v-else class="activity-list">
      <ActivityRow
        v-for="entry in filteredEntries"
        :key="entry.id"
        :entry="entry"
      />
    </div>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useProjectsStore } from 'src/stores/projects';
import { useActiveRunsPolling, type ActivityEntry, type ActivityType, type NormalizedStatus } from 'src/composables/useActiveRunsPolling';
import ActivityRow from 'src/components/activity/ActivityRow.vue';

export default defineComponent({
  name: 'ActivityPage',

  components: { ActivityRow },

  setup() {
    const projectId = ref<string | null>(null);
    const sinceHours = ref<number>(24);

    const polling = useActiveRunsPolling({ projectId, sinceHours });

    return {
      projectsStore: useProjectsStore(),
      projectId,
      sinceHours,
      pollingEntries: polling.entries,
      activeCount: polling.activeCount,
      loading: polling.loading,
      refresh: polling.refresh,
    };
  },

  data: () => ({
    selectedType: null as ActivityType | null,
    selectedStatus: null as NormalizedStatus | null,
  }),

  computed: {
    selectedProjectId: {
      get(): string | null {
        return this.projectId;
      },
      set(value: string | null): void {
        this.projectId = value;
      },
    },

    projectOptions() {
      return [
        { label: this.$t('activity.filters.allProjects'), value: null },
        ...this.projectsStore.list.map((p) => ({ label: p.name, value: p.id })),
      ];
    },

    typeOptions() {
      const types: ActivityType[] = ['cold_start', 'article_outline', 'article_draft', 'astro_sync', 'pagespeed', 'schema_extension', 'link_rebuild'];
      return types.map((t) => ({ label: this.$t(`activity.types.${t}`), value: t }));
    },

    statusOptions() {
      const statuses: NormalizedStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];
      return statuses.map((s) => ({ label: this.$t(`activity.statuses.${s}`), value: s }));
    },

    sinceOptions() {
      return [
        { label: this.$t('activity.since.24h'), value: 24 },
        { label: this.$t('activity.since.7d'), value: 24 * 7 },
        { label: this.$t('activity.since.30d'), value: 24 * 30 },
      ];
    },

    filteredEntries(): ActivityEntry[] {
      let result = this.pollingEntries;
      if (this.selectedType) {
        result = result.filter((e) => e.type === this.selectedType);
      }
      if (this.selectedStatus) {
        result = result.filter((e) => e.status === this.selectedStatus);
      }
      return result;
    },
  },

  async created() {
    if (this.projectsStore.list.length === 0) {
      await this.projectsStore.fetchList();
    }
  },
});
</script>

<style lang="scss" scoped>
.filters {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.activity-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.empty-state {
  text-align: center;
  padding: 80px 0;

  p {
    margin: 0;
  }
}
</style>
```

### Frontend: ActivityRow

`apps/web/src/components/activity/ActivityRow.vue`:

```vue
<template>
  <div :class="['activity-row', `activity-row--${entry.status}`]" @click="onClick">
    <div class="activity-row__icon-col">
      <q-spinner v-if="isInFlight" size="20px" :color="iconColor" />
      <q-icon v-else :name="statusIcon" :color="iconColor" size="20px" />
    </div>

    <div class="activity-row__main">
      <div class="activity-row__title-row">
        <span :class="`type-pill type-pill--${entry.type}`">{{ $t(`activity.types.${entry.type}`) }}</span>
        <span class="activity-row__title">{{ entry.title }}</span>
        <q-space />
        <span class="activity-row__time">{{ relativeTime(entry.startedAt ?? entry.createdAt) }}</span>
      </div>

      <div class="activity-row__meta">
        <span v-if="entry.projectName" class="activity-row__meta-item">
          <q-icon name="folder" size="12px" class="q-mr-xs" />
          {{ entry.projectName }}
        </span>
        <span v-if="entry.subtitle" class="activity-row__meta-item">{{ entry.subtitle }}</span>
        <span v-if="duration" class="activity-row__meta-item">{{ duration }}</span>
      </div>

      <div v-if="entry.errorMessage" class="activity-row__error">
        <q-icon name="error" size="12px" class="q-mr-xs" color="negative" />
        {{ entry.errorMessage }}
      </div>
    </div>

    <div v-if="canNavigate" class="activity-row__nav">
      <q-icon name="chevron_right" size="20px" color="grey-6" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { ActivityEntry } from 'src/composables/useActiveRunsPolling';

const STATUS_ICONS: Record<string, string> = {
  queued: 'schedule',
  running: 'sync',
  completed: 'check_circle',
  failed: 'error',
  cancelled: 'cancel',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'grey',
  running: 'primary',
  completed: 'positive',
  failed: 'negative',
  cancelled: 'grey-7',
};

export default defineComponent({
  name: 'ActivityRow',

  props: {
    entry: { type: Object as PropType<ActivityEntry>, required: true },
  },

  computed: {
    isInFlight(): boolean {
      return this.entry.status === 'queued' || this.entry.status === 'running';
    },

    statusIcon(): string {
      return STATUS_ICONS[this.entry.status] ?? 'help';
    },

    iconColor(): string {
      return STATUS_COLORS[this.entry.status] ?? 'grey';
    },

    duration(): string | null {
      const start = this.entry.startedAt ? new Date(this.entry.startedAt).getTime() : null;
      const end = this.entry.finishedAt
        ? new Date(this.entry.finishedAt).getTime()
        : (this.isInFlight ? Date.now() : null);
      if (!start || !end) return null;
      const seconds = Math.round((end - start) / 1000);
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
      return `${(seconds / 3600).toFixed(1)}h`;
    },

    canNavigate(): boolean {
      return !!(this.entry.articleId || this.entry.projectSlug);
    },
  },

  methods: {
    relativeTime(iso: string | null): string {
      if (!iso) return '';
      const ms = Date.now() - new Date(iso).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return this.$t('activity.relative.justNow');
      const m = Math.round(s / 60);
      if (m < 60) return this.$t('activity.relative.minutesAgo', { n: m });
      const h = Math.round(m / 60);
      if (h < 24) return this.$t('activity.relative.hoursAgo', { n: h });
      const d = Math.round(h / 24);
      return this.$t('activity.relative.daysAgo', { n: d });
    },

    onClick(): void {
      if (this.entry.articleId) {
        void this.$router.push({ name: 'article-detail', params: { id: this.entry.articleId } });
      } else if (this.entry.projectSlug) {
        void this.$router.push({ name: 'project-detail', params: { slug: this.entry.projectSlug } });
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.activity-row {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  background: var(--q-card-bg, #fff);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }

  &:hover {
    border-color: var(--q-primary);
  }

  &--running {
    border-left: 3px solid var(--q-primary);
  }
  &--queued {
    border-left: 3px solid var(--q-grey-6);
  }
  &--failed {
    border-left: 3px solid var(--q-negative);
  }
  &--completed {
    border-left: 3px solid var(--q-positive);
  }
  &--cancelled {
    border-left: 3px solid var(--q-grey-7);
    opacity: 0.7;
  }
}

.activity-row__icon-col {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

.activity-row__main {
  flex-grow: 1;
  min-width: 0;
}

.activity-row__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.activity-row__title {
  font-weight: 500;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-row__time {
  font-size: 11px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  flex-shrink: 0;
}

.activity-row__meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  flex-wrap: wrap;
}

.activity-row__meta-item {
  display: inline-flex;
  align-items: center;
}

.activity-row__error {
  margin-top: 6px;
  padding: 6px 10px;
  background: rgba(193, 0, 21, 0.06);
  border-radius: 4px;
  font-size: 12px;
  color: var(--q-negative);
  display: flex;
  align-items: center;
}

.activity-row__nav {
  display: flex;
  align-items: center;
}

.type-pill {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--q-grey-2);
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.65));

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
  }

  &--cold_start { background: rgba(63, 81, 181, 0.12); color: #3f51b5; }
  &--article_outline, &--article_draft { background: rgba(124, 77, 255, 0.12); color: #7c4dff; }
  &--astro_sync { background: rgba(38, 166, 154, 0.12); color: #26a69a; }
  &--pagespeed { background: rgba(242, 192, 55, 0.18); color: #b07b00; }
  &--schema_extension { background: rgba(0, 188, 212, 0.12); color: #00838f; }
  &--link_rebuild { background: rgba(96, 125, 139, 0.12); color: #455a64; }
}
</style>
```

### Routing

Add route to `apps/web/src/router/routes.ts`:

```typescript
{
  path: '/activity',
  component: () => import('layouts/MainLayout.vue'),
  meta: { requiresAuth: true },
  children: [
    { path: '', name: 'activity', component: () => import('pages/ActivityPage.vue') },
  ],
},
```

Add nav-link in MainLayout drawer.

### i18n keys

`apps/web/src/i18n/de/activity.ts`:

```typescript
export default {
  title: 'Aktivität',
  subtitle: '{count} aktiv',
  empty: 'Keine Aktivität',
  emptyHint: 'In diesem Zeitraum gab es keine Pipeline-Runs.',

  filters: {
    project: 'Projekt',
    allProjects: 'Alle Projekte',
    type: 'Typ',
    status: 'Status',
    since: 'Zeitraum',
  },

  since: {
    '24h': 'Letzte 24h',
    '7d': 'Letzte 7 Tage',
    '30d': 'Letzte 30 Tage',
  },

  types: {
    cold_start: 'Cold-Start',
    article_outline: 'Outline',
    article_draft: 'Draft',
    astro_sync: 'Sync',
    pagespeed: 'PageSpeed',
    schema_extension: 'Schema',
    link_rebuild: 'Links',
    other: 'Andere',
  },

  statuses: {
    queued: 'Wartend',
    running: 'Läuft',
    completed: 'Fertig',
    failed: 'Fehler',
    cancelled: 'Abgebrochen',
  },

  relative: {
    justNow: 'gerade eben',
    minutesAgo: 'vor {n} Min',
    hoursAgo: 'vor {n} Std',
    daysAgo: 'vor {n} Tagen',
  },
};
```

Mirror in `en/`.

## Acceptance Criteria

### Backend
- [ ] `GET /api/pipeline-runs/active` returns unified entries from all 5 run tables
- [ ] In-flight runs (queued/running/pending) always returned regardless of date
- [ ] Terminal runs only returned if `startedAt >= since`
- [ ] Default `since` = 24 hours ago
- [ ] Optional `?projectId=` filter
- [ ] Status field normalized: pending→running, succeeded→completed, errored/budget_exceeded→failed
- [ ] Each entry includes project info (name, slug) joined
- [ ] Article-related entries include article info (id, slug, title)
- [ ] Cluster-related entries include cluster info (id, name)
- [ ] `activeCount` field returned for header indicator
- [ ] All endpoints require auth

### Composable
- [ ] `useActiveRunsPolling` returns reactive entries, loading, error
- [ ] Polls every 2.5s when document visible
- [ ] Pauses polling when document hidden (visibilitychange listener)
- [ ] Resumes polling when document visible again
- [ ] Re-fetches when projectId or sinceHours filter changes
- [ ] `refresh()` method triggers manual fetch
- [ ] `stop()` cleans up timer + listener
- [ ] No memory leaks across component unmounts

### Activity Page
- [ ] `/activity` route renders feed
- [ ] Header shows total active count
- [ ] 4 filter dropdowns: Project, Type, Status, Since
- [ ] Project filter triggers backend re-fetch
- [ ] Type and Status filters are client-side (no backend round-trip)
- [ ] Since filter triggers backend re-fetch with new range
- [ ] Refresh button forces immediate poll
- [ ] Empty state when no entries
- [ ] List sorted: in-flight first, then by startedAt desc

### Activity Row
- [ ] Status icon: spinner for in-flight, status-icon for terminal
- [ ] Status color: grey/primary/positive/negative
- [ ] Type pill colored per type
- [ ] Title shows article title or pipeline name
- [ ] Project name shown with folder icon
- [ ] Subtitle shows pipeline-specific context
- [ ] Duration computed live for in-flight (updates on next poll)
- [ ] Error message shown when status='failed' with errorMessage
- [ ] Click on row navigates: article-detail (if articleId), else project-detail (if projectSlug)
- [ ] Left border colored per status (3px primary/positive/negative/grey)

## Testing Strategy

Manual smoke tests:

1. **Empty state**: Fresh DB, no runs. Visit `/activity`. Empty state shown.
2. **In-flight runs**: Trigger a Cold-Start phase from UI. Visit `/activity`. See entry with spinner, "running" status, primary border.
3. **Terminal completion**: Wait for the Cold-Start phase to complete. Refresh `/activity`. Entry now shows green checkmark, positive border.
4. **Failed run**: Trigger an action that fails (e.g., Astro sync without configured repo). Visit `/activity`. Failed entry shown with error message + negative border.
5. **Live polling**: Have `/activity` open in one tab. In another tab, trigger a new run. After ~2.5s, new entry appears in `/activity` without manual refresh.
6. **Visibility pause**: Open `/activity`, switch to another tab for 30 seconds. Switch back. Verify poll resumes (network tab shows new request).
7. **Project filter**: Filter to KI-Wissensraum. Other projects' runs disappear.
8. **Type filter**: Filter to "Article Outline". Only outline runs visible.
9. **Status filter**: Filter to "Failed". Only failed runs visible.
10. **Since filter**: Default 24h. Switch to "30 days". Verify older runs appear.
11. **Click navigation**: Click an article row → article detail page.
12. **Mixed run-types**: Run end-to-end Article pipeline. Verify outline, draft, schema-extension, sync, pagespeed all show as separate entries.

## Open Questions / Decisions Made

**Decision 1: Single composable for both filtered and unfiltered views.**
Could split into "useActiveRunsForProject" vs "useActiveRunsGlobal". Not needed; one composable parameterized by projectId is enough.

**Decision 2: No "Cancel run" button in feed entries.**
Cancellation is a destructive action; from a feed it's too easy to misclick. Cancellation lives on detail pages only (and even there, BullMQ cancellation is non-trivial — separate concern).

**Decision 3: Type and Status are client-side filters.**
The server returns the full normalized list within the `since` window. Filtering by type/status in the browser is fast enough for hundreds of entries. No additional backend filter params needed.

**Decision 4: Polling continues even when no in-flight entries exist.**
Counter-intuitive choice. Reason: we still want to *know* when a new run starts elsewhere. If polling stopped completely on an empty list, Marcel would have to manually refresh to see new triggers. Keeping the poll active maintains real-time feel. The interval is 2.5s — bandwidth cost is negligible.

**Decision 5: Duration shown on row, not full progress bar.**
Progress bars require knowing total duration estimate. Simple "23s" or "1.4m" is more honest.

**Decision 6: `errorMessage` displayed inline, not in a popover.**
For failed runs, the error is the most important info. Inline preserves Skim-ability ("oh, NPM error" vs "Anthropic 429"). Long error messages truncated via CSS line-clamp:2.

**Decision 7: Entry IDs are run IDs from their respective tables.**
This means there's no risk of UUID collision since all run tables have separate UUIDs. A `pipeline_runs.id` and an `astro_sync_runs.id` could coincidentally be different UUIDs but they're never confused because we know the source via the `source` field.

**Decision 8: No global "active run badge" in MainLayout header for v1.**
Could be added later by reading from the same `useActiveRunsPolling` composable in MainLayout. Out of scope for this spec.

**Decision 9: Cold-Start phase entries display the phase as title.**
Better UX than showing `cold-start:cluster-plan` raw. Title becomes "Cluster Plan" via simple string transform.

## Implementation Order

**Recommend 2 sessions.**

**Session 1: Backend + Composable (~5h)**

1. `pipelineRunRoutes` with `/active` endpoint (~2h)
  - Five separate queries normalized into ActivityEntry
  - Helpers: classifyPipelineName, normalizeStatus, buildPipelineTitle
2. `useActiveRunsPolling` composable (~1.5h)
  - Polling loop with visibility-aware pausing
  - Watcher on filter refs
3. Test endpoint with curl + multiple in-flight runs (~30 min)
4. Test composable in a stub component (~30 min)
5. Commit: `feat(api,web): activity feed backend + polling composable (spec 39)`

**Session 2: Activity Page UI (~5h)**

1. `ActivityPage.vue` with filter dropdowns (~1.5h)
2. `ActivityRow.vue` with status colors + nav (~1.5h)
3. Routing + MainLayout nav-link (~30 min)
4. i18n keys for both locales (~30 min)
5. Manual smoke tests (~30 min)
6. Edge cases: empty state, very long titles, dark mode (~30 min)
7. Commit: `feat(web): activity feed page (spec 39)`

Total: ~10 hours.

## Splitting Plan

See "Implementation Order" — 2 sessions with `/clear` between.

## Discovered During Implementation

(empty — fill during/after implementation)

## Deviations

(empty — fill during/after implementation)
