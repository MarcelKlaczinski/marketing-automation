# Spec 35: Cold-Start Wizard UI

**Phase:** 4 (Web App Wave 2)
**Estimated Effort:** 2.5-3 days (3-4 sessions)
**Dependencies:** Spec 33 (settings reused), Spec 34 (project hub — hosts the Cold-Start tab), Spec 14 (Cold-Start backend pipelines)
**Status:** Ready for implementation
**Recommended Model:** Opus 4.7 (architectural complexity: polling, multiple pause-points, parallel pipelines)

---

## Goal

Build the **Cold-Start UI**: a free-form interface for the 5-phase Cold-Start pipeline within the project hub's `/projects/:slug?tab=cold-start` tab.

After this spec, Marcel can:
- Run all 5 Cold-Start phases via UI (no CLI needed)
- See live status of each phase (polling, ~2.5s interval)
- Navigate between phases freely (Phase N requires Phase N-1 done, but can be re-run)
- Approve / edit / reject Cornerstones individually
- Use an "Auto-Run" button to chain all phases sequentially with a single click
- See cost accumulated per phase + total

This unblocks **non-CLI tenant onboarding**: KI-Wissensraum was set up via CLI; Bellemann/Balkonkraftwerk can be onboarded entirely via UI.

The Cold-Start has 5 phases with **2 pause-points** (Phase 1 voice answers, Phase 4 cornerstone approval). Phase 2 (competitor analysis) is fully automated. Phases 3 + 5 are also automated. Free-Form means Marcel sees all 5 sections, navigates between them, and the UI shows what's possible at each moment.

## Architecture Decisions

**Decision 1: Free-Form layout with phase-state-aware UI.**
Per discussion: not a wizard. All 5 sections are visible, but Phase N+1 is gated until Phase N is complete. "Gated" means UI shows the section disabled with hint "complete previous phase first".

**Decision 2: Auto-Run button at top of tab.**
Single button "Run all phases automatically". Triggers Phase 1 (with pre-defined answers if Marcel provides them), then chains through. At pause-points (Phase 4 cornerstone approval), Auto-Run pauses and waits for explicit approval.

For Spec 35 MVP: Auto-Run is a deferred enhancement. We design the architecture to support it but only ship the manual sequential flow. Documented in Implementation Order as Session 4 (optional).

**Decision 3: One polling Composable per pipeline run.**
Per Marcel's choice: composable per component. Each phase section instantiates `usePipelineRunPolling(runId)` when actively monitoring. The composable handles cleanup on unmount.

**Decision 4: Backend pipeline-run query endpoint.**
We need `GET /api/pipeline-runs/:runId` returning `{ status, progress, output, error }`. This is generic across all pipelines, not Cold-Start-specific. Belongs in a new `pipelineRuns` route module.

**Decision 5: Per-phase trigger endpoints + sub-action endpoints.**
Phase 1 has two sub-actions: `questions` (generate questions) and `synthesize` (use answered questions to write context). Endpoints are `POST /api/projects/:slug/cold-start/voice-refinement/questions` and `POST /api/projects/:slug/cold-start/voice-refinement/synthesize`. Same pattern for other phases with sub-actions.

**Decision 6: Cornerstone approval is per-card with individual action.**
Per Marcel's choice: 3-7 separate cards. Each card has approve / edit / reject. Edit opens an inline form to modify title, description, keywords, word count target. Approve persists `approved_at`. Reject hides card or persists `rejected_at`.

**Decision 7: Phase status derived from DB, not separate state.**
Each phase has natural state in the DB:
- Phase 1 (voice): `projects.brandVoice` exists or not
- Phase 2 (competitors): `competitors` table has rows for project
- Phase 3 (clusters): `clusters` table has rows for project  
- Phase 4 (cornerstones): `articles` with status `proposed` exist for project
- Phase 5 (go-live): a flag on project, e.g., `coldStartCompletedAt`

Plus pipeline-run state for in-progress: if a `pipeline_runs` row for `cold-start:voice-refinement` is `running`, Phase 1 is "running".

**Decision 8: i18n keys for all 5 phases live in `coldStart.*` namespace.**
Already large enough to deserve its own i18n module file.

## Non-Goals

- **No editing of Phase 1 answers after synthesis**: once synthesize is done, the answers are baked into `marketingContextMd`. To re-edit: re-run Phase 1 questions.
- **No competitor selection UI**: Phase 2 is fully automated by the existing pipeline. We just trigger it and show output.
- **No cluster-plan editing**: Phase 3's output is shown as cards but not editable. To re-plan: re-run Phase 3.
- **No multi-project parallel Cold-Start**: each project runs Cold-Start in isolation. UI doesn't support viewing two projects' cold-starts side-by-side.
- **No persistence of polling state across page refreshes**: if user refreshes during a running pipeline, polling re-starts from initial state lookup (which fetches the latest run). This is simple and reliable.
- **No "abort pipeline" button**: BullMQ jobs aren't cleanly cancellable. If a phase needs to stop, Marcel waits or restarts the worker. Future enhancement.
- **No real-time push updates** (SSE/WS): Polling is sufficient.

## Detailed Implementation

### Backend: `pipelineRuns` route module

`apps/api/src/routes/pipeline-runs.ts`:

```typescript
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, pipelineRuns } from '@marketing-auto/db';
import { requireAuth } from '../middleware/require-auth';

export const pipelineRunsRoutes = new Hono();

pipelineRunsRoutes.get('/:runId', requireAuth, async (c) => {
  const runId = c.req.param('runId');
  const [run] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
  if (!run) return c.json({ ok: false, error: 'Run not found' }, 404);

  return c.json({
    ok: true,
    data: {
      id: run.id,
      pipelineName: run.pipelineName,
      projectId: run.projectId,
      status: run.status,
      input: run.input,
      output: run.output,
      error: run.error,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      currentStep: run.currentStep,
      totalCostEur: run.totalCostEur,
    },
  });
});

// List recent runs for a project (used by the cold-start tab to find existing runs)
pipelineRunsRoutes.get('/project/:projectId', requireAuth, async (c) => {
  const projectId = c.req.param('projectId');
  const limit = Number(c.req.query('limit') ?? 50);
  const pipelineNamePrefix = c.req.query('pipelineNamePrefix');

  let query = db.select().from(pipelineRuns).where(eq(pipelineRuns.projectId, projectId));

  if (pipelineNamePrefix) {
    // Use SQL `like` for prefix match
    const { sql, like } = await import('drizzle-orm');
    query = query.where(like(pipelineRuns.pipelineName, `${pipelineNamePrefix}%`));
  }

  const rows = await query.orderBy(/* desc */ pipelineRuns.startedAt).limit(limit);
  return c.json({ ok: true, data: rows });
});
```

Mount in `apps/api/src/index.ts`:
```typescript
app.route('/api/pipeline-runs', pipelineRunsRoutes);
```

### Backend: Cold-Start trigger endpoints

`apps/api/src/routes/cold-start.ts`:

```typescript
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { db, projects, articles, clusters } from '@marketing-auto/db';
import { requireAuth } from '../middleware/require-auth';
import {
  enqueueVoiceRefinementQuestions,
  enqueueVoiceRefinementSynthesize,
  enqueueCompetitorAnalysis,
  enqueueClusterPlanProposal,
  enqueueCornerstoneList,
  enqueueGoLiveChecklist,
} from '@marketing-auto/pipelines/cold-start';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

export const coldStartRoutes = new Hono();

// Helper: resolve project ID from slug
async function getProjectId(slug: string): Promise<string | null> {
  const [proj] = await db.select({ id: projects.id })
    .from(projects).where(eq(projects.slug, slug)).limit(1);
  return proj?.id ?? null;
}

// ───── Phase 1: Voice Refinement ───────────────────────────────────────

coldStartRoutes.post('/:slug/voice-refinement/questions', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const projectId = await getProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: 'Project not found' }, 404);

  const { runId, jobId } = await enqueueVoiceRefinementQuestions({ projectId });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

const synthesizeSchema = z.object({
  answers: z.array(z.object({
    questionIndex: z.number().int().nonnegative(),
    answer: z.string().max(5000),
  })),
});

coldStartRoutes.post('/:slug/voice-refinement/synthesize', requireAuth, zValidator('json', synthesizeSchema), async (c) => {
  const slug = c.req.param('slug');
  const projectId = await getProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: 'Project not found' }, 404);

  const input = c.req.valid('json');
  const { runId, jobId } = await enqueueVoiceRefinementSynthesize({
    projectId,
    answers: input.answers,
  });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

// ───── Phase 2: Competitor Analysis ─────────────────────────────────────

coldStartRoutes.post('/:slug/competitor-analysis', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const projectId = await getProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: 'Project not found' }, 404);

  const { runId, jobId } = await enqueueCompetitorAnalysis({ projectId });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

// ───── Phase 3: Cluster Plan ────────────────────────────────────────────

coldStartRoutes.post('/:slug/cluster-plan', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const projectId = await getProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: 'Project not found' }, 404);

  const { runId, jobId } = await enqueueClusterPlanProposal({ projectId });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

// ───── Phase 4: Cornerstone List ────────────────────────────────────────

coldStartRoutes.post('/:slug/cornerstones', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const projectId = await getProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: 'Project not found' }, 404);

  const { runId, jobId } = await enqueueCornerstoneList({ projectId });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

// Approve / edit / reject individual cornerstone
const cornerstoneActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
});

coldStartRoutes.post('/:slug/cornerstones/:articleId/action', requireAuth, zValidator('json', cornerstoneActionSchema), async (c) => {
  const articleId = c.req.param('articleId');
  const input = c.req.valid('json');

  const newStatus = input.action === 'approve' ? 'approved' : 'rejected';
  await db.update(articles).set({
    status: newStatus,
    updatedAt: new Date(),
  }).where(eq(articles.id, articleId));

  return c.json({ ok: true, data: { articleId, newStatus } });
});

const cornerstoneEditSchema = z.object({
  title: z.string().min(2).max(300).optional(),
  cornerstoneKeyword: z.string().min(2).max(200).optional(),
  metaDescription: z.string().max(500).optional(),
  targetWordCount: z.number().int().positive().optional(),
});

coldStartRoutes.patch('/:slug/cornerstones/:articleId', requireAuth, zValidator('json', cornerstoneEditSchema), async (c) => {
  const articleId = c.req.param('articleId');
  const input = c.req.valid('json');

  await db.update(articles).set({
    ...input,
    updatedAt: new Date(),
  }).where(eq(articles.id, articleId));

  const [updated] = await db.select().from(articles).where(eq(articles.id, articleId)).limit(1);
  return c.json({ ok: true, data: updated });
});

// ───── Phase 5: Go-Live Checklist ───────────────────────────────────────

coldStartRoutes.post('/:slug/go-live-checklist', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const projectId = await getProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: 'Project not found' }, 404);

  const { runId, jobId } = await enqueueGoLiveChecklist({ projectId });
  return c.json({ ok: true, data: { runId, jobId } }, 202);
});

// ───── Status: phase summary for UI ─────────────────────────────────────

coldStartRoutes.get('/:slug/status', requireAuth, async (c) => {
  const slug = c.req.param('slug');
  const projectId = await getProjectId(slug);
  if (!projectId) return c.json({ ok: false, error: 'Project not found' }, 404);

  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

  const competitorCount = await db.select({ count: /* count fn */ }).from(/* competitors */).where(/* projectId */);
  const clusterCount = await db.select({ count: /* count fn */ }).from(clusters).where(eq(clusters.projectId, projectId));
  const cornerstoneCount = await db
    .select({ status: articles.status })
    .from(articles)
    .where(and(eq(articles.projectId, projectId), eq(articles.isCornerstone, true)));

  const proposedCount = cornerstoneCount.filter((c) => c.status === 'proposed').length;
  const approvedCount = cornerstoneCount.filter((c) => c.status === 'approved').length;

  return c.json({
    ok: true,
    data: {
      voice: {
        status: proj?.brandVoice ? 'complete' : 'pending',
        completedAt: proj?.brandVoiceUpdatedAt ?? null,
      },
      competitors: {
        status: competitorCount[0]?.count > 0 ? 'complete' : 'pending',
        count: competitorCount[0]?.count ?? 0,
      },
      clusters: {
        status: clusterCount[0]?.count > 0 ? 'complete' : 'pending',
        count: clusterCount[0]?.count ?? 0,
      },
      cornerstones: {
        status: proposedCount + approvedCount > 0 ? (proposedCount > 0 ? 'awaiting_review' : 'complete') : 'pending',
        proposedCount,
        approvedCount,
      },
      goLive: {
        status: proj?.coldStartCompletedAt ? 'complete' : 'pending',
        completedAt: proj?.coldStartCompletedAt ?? null,
      },
    },
  });
});
```

Note: the actual `enqueueVoiceRefinementQuestions` etc. helpers might already exist or need to be added in `packages/pipelines/src/cold-start/`. They wrap `enqueuePipeline()` for each phase. Check existing code; this spec assumes they exist and follow the same `{ runId, jobId }` return pattern as Spec 21+.

Mount in `apps/api/src/index.ts`:
```typescript
app.route('/api/projects', coldStartRoutes); // attaches under /:slug/cold-start/...
```

Or define a separate prefix; choose based on existing route conventions.

### Frontend: Polling Composable

`apps/web/src/composables/usePipelineRunPolling.ts`:

```typescript
import { ref, onUnmounted, watch, type Ref } from 'vue';
import { api } from 'src/lib/api-client';

export interface PipelineRun {
  id: string;
  pipelineName: string;
  projectId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'awaiting_review';
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  currentStep: string | null;
  totalCostEur: string | null;
}

interface UsePipelineRunPollingOptions {
  intervalMs?: number;
  pauseWhenHidden?: boolean;
}

interface UsePipelineRunPollingResult {
  run: Ref<PipelineRun | null>;
  loading: Ref<boolean>;
  error: Ref<Error | null>;
  terminal: Ref<boolean>;
  refresh: () => Promise<void>;
  start: (newRunId: string) => void;
  stop: () => void;
}

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'awaiting_review']);

/**
 * Polls a single pipeline run until it reaches a terminal status.
 * Cleans up automatically on component unmount.
 *
 * Usage:
 *   const { run, terminal, error } = usePipelineRunPolling(runIdRef);
 *   // when run.value.status changes to 'awaiting_review' or 'succeeded', polling stops
 */
export function usePipelineRunPolling(
  runIdRef: Ref<string | null> | string | null,
  options: UsePipelineRunPollingOptions = {},
): UsePipelineRunPollingResult {
  const intervalMs = options.intervalMs ?? 2500;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;

  const run = ref<PipelineRun | null>(null) as Ref<PipelineRun | null>;
  const loading = ref(false);
  const error = ref<Error | null>(null);
  const terminal = ref(false);

  let timer: number | null = null;
  let currentRunId: string | null = typeof runIdRef === 'string' ? runIdRef : runIdRef?.value ?? null;

  async function fetchOnce(): Promise<void> {
    if (!currentRunId) return;
    if (pauseWhenHidden && document.hidden) return;

    loading.value = true;
    try {
      const res = await api.get<{ ok: boolean; data: PipelineRun }>(`/pipeline-runs/${currentRunId}`);
      run.value = res.data.data;
      terminal.value = TERMINAL_STATUSES.has(res.data.data.status);
      error.value = null;

      if (terminal.value && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e));
    } finally {
      loading.value = false;
    }
  }

  function start(newRunId: string): void {
    stop();
    currentRunId = newRunId;
    terminal.value = false;
    void fetchOnce();
    timer = window.setInterval(fetchOnce, intervalMs) as unknown as number;
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  // If runIdRef is a Ref, react to changes
  if (typeof runIdRef !== 'string' && runIdRef !== null) {
    watch(runIdRef, (newId) => {
      if (newId) start(newId);
      else stop();
    }, { immediate: true });
  } else if (currentRunId) {
    start(currentRunId);
  }

  onUnmounted(() => {
    stop();
  });

  return {
    run,
    loading,
    error,
    terminal,
    refresh: fetchOnce,
    start,
    stop,
  };
}
```

### Frontend: Cold-Start Store

`apps/web/src/stores/cold-start.ts`:

```typescript
import { defineStore } from 'pinia';
import { api } from 'src/lib/api-client';

export interface PhaseStatus {
  status: 'pending' | 'running' | 'awaiting_review' | 'complete';
  count?: number;
  proposedCount?: number;
  approvedCount?: number;
  completedAt?: string | null;
}

export interface ColdStartStatus {
  voice: PhaseStatus;
  competitors: PhaseStatus;
  clusters: PhaseStatus;
  cornerstones: PhaseStatus;
  goLive: PhaseStatus;
}

interface ColdStartState {
  statusByProject: Record<string, ColdStartStatus | null>;
  loading: boolean;
}

export const useColdStartStore = defineStore('coldStart', {
  state: (): ColdStartState => ({
    statusByProject: {},
    loading: false,
  }),

  actions: {
    async fetchStatus(slug: string): Promise<void> {
      this.loading = true;
      try {
        const res = await api.get<{ ok: boolean; data: ColdStartStatus }>(`/projects/${slug}/cold-start/status`);
        this.statusByProject[slug] = res.data.data;
      } finally {
        this.loading = false;
      }
    },

    async triggerPhase1Questions(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/voice-refinement/questions`,
      );
      return res.data.data;
    },

    async triggerPhase1Synthesize(slug: string, answers: { questionIndex: number; answer: string }[]): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/voice-refinement/synthesize`,
        { answers },
      );
      return res.data.data;
    },

    async triggerCompetitorAnalysis(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/competitor-analysis`,
      );
      return res.data.data;
    },

    async triggerClusterPlan(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/cluster-plan`,
      );
      return res.data.data;
    },

    async triggerCornerstoneList(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/cornerstones`,
      );
      return res.data.data;
    },

    async cornerstoneAction(slug: string, articleId: string, action: 'approve' | 'reject'): Promise<void> {
      await api.post(`/projects/${slug}/cold-start/cornerstones/${articleId}/action`, { action });
    },

    async cornerstoneEdit(slug: string, articleId: string, patch: Record<string, unknown>): Promise<void> {
      await api.patch(`/projects/${slug}/cold-start/cornerstones/${articleId}`, patch);
    },

    async triggerGoLive(slug: string): Promise<{ runId: string; jobId: string }> {
      const res = await api.post<{ ok: boolean; data: { runId: string; jobId: string } }>(
        `/projects/${slug}/cold-start/go-live-checklist`,
      );
      return res.data.data;
    },
  },
});
```

### Frontend: ColdStartPanel (replacing tab stub)

`apps/web/src/components/projects/ColdStartPanel.vue`:

```vue
<template>
  <div class="cold-start">
    <p class="text-body2 q-mb-lg">{{ $t('coldStart.intro') }}</p>

    <PhaseSection
      :index="1"
      :title="$t('coldStart.phase1.title')"
      :description="$t('coldStart.phase1.description')"
      :status="status?.voice.status ?? 'pending'"
      :unlocked="true"
    >
      <Phase1VoiceRefinement :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="2"
      :title="$t('coldStart.phase2.title')"
      :description="$t('coldStart.phase2.description')"
      :status="status?.competitors.status ?? 'pending'"
      :unlocked="status?.voice.status === 'complete'"
    >
      <Phase2CompetitorAnalysis :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="3"
      :title="$t('coldStart.phase3.title')"
      :description="$t('coldStart.phase3.description')"
      :status="status?.clusters.status ?? 'pending'"
      :unlocked="status?.competitors.status === 'complete'"
    >
      <Phase3ClusterPlan :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="4"
      :title="$t('coldStart.phase4.title')"
      :description="$t('coldStart.phase4.description')"
      :status="status?.cornerstones.status ?? 'pending'"
      :unlocked="status?.clusters.status === 'complete'"
    >
      <Phase4Cornerstones :slug="slug" @done="onPhaseDone" />
    </PhaseSection>

    <PhaseSection
      :index="5"
      :title="$t('coldStart.phase5.title')"
      :description="$t('coldStart.phase5.description')"
      :status="status?.goLive.status ?? 'pending'"
      :unlocked="status?.cornerstones.status === 'complete'"
    >
      <Phase5GoLive :slug="slug" @done="onPhaseDone" />
    </PhaseSection>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useColdStartStore } from 'src/stores/cold-start';
import PhaseSection from 'src/components/cold-start/PhaseSection.vue';
import Phase1VoiceRefinement from 'src/components/cold-start/Phase1VoiceRefinement.vue';
import Phase2CompetitorAnalysis from 'src/components/cold-start/Phase2CompetitorAnalysis.vue';
import Phase3ClusterPlan from 'src/components/cold-start/Phase3ClusterPlan.vue';
import Phase4Cornerstones from 'src/components/cold-start/Phase4Cornerstones.vue';
import Phase5GoLive from 'src/components/cold-start/Phase5GoLive.vue';

export default defineComponent({
  name: 'ColdStartPanel',

  components: {
    PhaseSection,
    Phase1VoiceRefinement,
    Phase2CompetitorAnalysis,
    Phase3ClusterPlan,
    Phase4Cornerstones,
    Phase5GoLive,
  },

  props: {
    slug: { type: String, required: true },
  },

  setup() {
    return { coldStartStore: useColdStartStore() };
  },

  computed: {
    status() {
      return this.coldStartStore.statusByProject[this.slug];
    },
  },

  async created() {
    await this.coldStartStore.fetchStatus(this.slug);
  },

  methods: {
    async onPhaseDone(): Promise<void> {
      await this.coldStartStore.fetchStatus(this.slug);
    },
  },
});
</script>
```

### Frontend: PhaseSection (collapsible container)

`apps/web/src/components/cold-start/PhaseSection.vue`:

```vue
<template>
  <div :class="['phase-section', `phase-section--${status}`, { 'phase-section--locked': !unlocked }]">
    <div class="phase-section__header" @click="onToggle">
      <div class="phase-section__index">{{ index }}</div>
      <div class="phase-section__main">
        <div class="phase-section__title">{{ title }}</div>
        <div class="phase-section__description">{{ description }}</div>
      </div>
      <div class="phase-section__status">
        <PhaseStatusPill :status="status" />
      </div>
      <q-icon
        :name="expanded ? 'expand_less' : 'expand_more'"
        size="20px"
        class="q-ml-sm"
      />
    </div>

    <div v-if="!unlocked" class="phase-section__locked-hint">
      <q-icon name="lock" size="14px" class="q-mr-xs" />
      {{ $t('coldStart.lockedHint') }}
    </div>

    <div v-show="expanded && unlocked" class="phase-section__body">
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import PhaseStatusPill from './PhaseStatusPill.vue';
import type { PhaseStatus } from 'src/stores/cold-start';

export default defineComponent({
  name: 'PhaseSection',

  components: { PhaseStatusPill },

  props: {
    index: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String as PropType<PhaseStatus['status']>, required: true },
    unlocked: { type: Boolean, default: true },
  },

  data: () => ({
    expanded: false,
  }),

  watch: {
    status: {
      immediate: true,
      handler(newStatus: PhaseStatus['status']) {
        // Auto-expand when section is unlocked AND status is not complete
        if (this.unlocked && (newStatus === 'pending' || newStatus === 'running' || newStatus === 'awaiting_review')) {
          this.expanded = true;
        }
      },
    },
  },

  methods: {
    onToggle(): void {
      if (this.unlocked) this.expanded = !this.expanded;
    },
  },
});
</script>

<style lang="scss" scoped>
.phase-section {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 8px;
  margin-bottom: 16px;
  background: var(--q-card-bg, #fff);

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }

  &--locked {
    opacity: 0.55;
  }
}

.phase-section__header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  cursor: pointer;
  user-select: none;
}

.phase-section--locked .phase-section__header {
  cursor: not-allowed;
}

.phase-section__index {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--q-grey-2, #f0f0f0);
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.6));
  font-weight: 600;
  font-size: 14px;

  body.body--dark & {
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
  }
}

.phase-section--complete .phase-section__index {
  background: rgba(33, 186, 69, 0.18);
  color: #21ba45;
}

.phase-section__main {
  flex-grow: 1;
  margin-left: 16px;
  min-width: 0;
}

.phase-section__title {
  font-weight: 600;
  font-size: 15px;
}

.phase-section__description {
  font-size: 13px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.6));
  margin-top: 2px;

  body.body--dark & {
    color: rgba(255, 255, 255, 0.6);
  }
}

.phase-section__status {
  flex-shrink: 0;
}

.phase-section__locked-hint {
  padding: 0 20px 16px 68px;
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.5));
  display: flex;
  align-items: center;
}

.phase-section__body {
  padding: 0 20px 20px;
  border-top: 1px solid var(--q-grey-2, #f0f0f0);

  body.body--dark & {
    border-top-color: rgba(255, 255, 255, 0.06);
  }
}
</style>
```

### Frontend: PhaseStatusPill

`apps/web/src/components/cold-start/PhaseStatusPill.vue`:

```vue
<template>
  <span :class="`status-pill status-pill--${status}`">
    <q-spinner v-if="status === 'running'" size="12px" class="q-mr-xs" />
    <q-icon v-else-if="status === 'complete'" name="check_circle" size="14px" class="q-mr-xs" />
    <q-icon v-else-if="status === 'awaiting_review'" name="pending" size="14px" class="q-mr-xs" />
    {{ $t(`coldStart.statusLabels.${status}`) }}
  </span>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import type { PhaseStatus } from 'src/stores/cold-start';

export default defineComponent({
  name: 'PhaseStatusPill',
  props: {
    status: { type: String as PropType<PhaseStatus['status']>, required: true },
  },
});
</script>

<style lang="scss" scoped>
.status-pill {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}

.status-pill--complete {
  background: rgba(33, 186, 69, 0.14);
  color: #21ba45;
}

.status-pill--running {
  background: rgba(63, 81, 181, 0.14);
  color: #3f51b5;
}

.status-pill--awaiting_review {
  background: rgba(242, 192, 55, 0.18);
  color: #b07b00;
}

.status-pill--pending {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.5);

  body.body--dark & {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.55);
  }
}
</style>
```

### Frontend: Phase Components (5 files)

I'll show **Phase 1** in detail (it has the most complex pause-point), and outline the others.

`apps/web/src/components/cold-start/Phase1VoiceRefinement.vue`:

```vue
<template>
  <div>
    <!-- Sub-state: no questions yet -->
    <div v-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase1.idleDescription') }}</p>
      <q-btn
        color="primary"
        :label="$t('coldStart.phase1.generateQuestions')"
        :loading="triggering"
        @click="onGenerateQuestions"
      />
    </div>

    <!-- Sub-state: questions running -->
    <div v-else-if="phase === 'questions-running'">
      <q-banner class="bg-info text-white q-mb-md">
        <template v-slot:avatar><q-spinner size="20px" /></template>
        {{ $t('coldStart.phase1.questionsRunning') }}
      </q-banner>
      <CostIndicator :cost-eur="questionsRun?.totalCostEur" />
    </div>

    <!-- Sub-state: questions ready, awaiting answers -->
    <div v-else-if="phase === 'questions-ready'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase1.answerHint') }}</p>
      <div class="q-gutter-md">
        <div v-for="(q, idx) in questions" :key="idx" class="question-card">
          <div class="question-card__label">{{ idx + 1 }}. {{ q.question }}</div>
          <q-input
            v-model="answers[idx]"
            type="textarea"
            outlined
            dense
            autogrow
            :placeholder="$t('coldStart.phase1.answerPlaceholder')"
          />
        </div>
      </div>
      <div class="row q-mt-lg">
        <q-space />
        <q-btn
          color="primary"
          :label="$t('coldStart.phase1.synthesizeButton')"
          :loading="triggering"
          :disable="!allAnswered"
          @click="onSynthesize"
        />
      </div>
    </div>

    <!-- Sub-state: synthesize running -->
    <div v-else-if="phase === 'synthesize-running'">
      <q-banner class="bg-info text-white q-mb-md">
        <template v-slot:avatar><q-spinner size="20px" /></template>
        {{ $t('coldStart.phase1.synthesizeRunning') }}
      </q-banner>
      <CostIndicator :cost-eur="synthesizeRun?.totalCostEur" />
    </div>

    <!-- Sub-state: complete -->
    <div v-else-if="phase === 'complete'">
      <q-banner class="bg-positive text-white">
        <template v-slot:avatar><q-icon name="check_circle" /></template>
        {{ $t('coldStart.phase1.complete') }}
      </q-banner>
      <q-btn
        flat
        color="primary"
        :label="$t('coldStart.phase1.regenerate')"
        class="q-mt-md"
        @click="onGenerateQuestions"
      />
    </div>

    <!-- Sub-state: error -->
    <q-banner v-if="error" class="bg-negative text-white q-mt-md">
      <template v-slot:avatar><q-icon name="error" /></template>
      {{ error }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import { useColdStartStore } from 'src/stores/cold-start';
import { usePipelineRunPolling } from 'src/composables/usePipelineRunPolling';
import { useNotify } from 'src/composables/useNotify';
import { HttpError } from 'src/lib/http-error';
import CostIndicator from './CostIndicator.vue';

type Phase = 'idle' | 'questions-running' | 'questions-ready' | 'synthesize-running' | 'complete';

export default defineComponent({
  name: 'Phase1VoiceRefinement',

  components: { CostIndicator },

  props: {
    slug: { type: String, required: true },
  },

  emits: ['done'],

  setup() {
    const questionsRunId = ref<string | null>(null);
    const synthesizeRunId = ref<string | null>(null);

    const questionsPolling = usePipelineRunPolling(questionsRunId);
    const synthesizePolling = usePipelineRunPolling(synthesizeRunId);

    return {
      coldStartStore: useColdStartStore(),
      notify: useNotify(),
      questionsRunId,
      synthesizeRunId,
      questionsPolling,
      synthesizePolling,
    };
  },

  data: () => ({
    triggering: false,
    questions: [] as { question: string }[],
    answers: [] as string[],
    error: '',
  }),

  computed: {
    questionsRun() { return this.questionsPolling.run.value; },
    synthesizeRun() { return this.synthesizePolling.run.value; },

    phase(): Phase {
      const qRun = this.questionsRun;
      const sRun = this.synthesizeRun;

      if (sRun?.status === 'running' || sRun?.status === 'pending') return 'synthesize-running';
      if (sRun?.status === 'succeeded') return 'complete';
      if (sRun?.status === 'failed') return 'questions-ready'; // back to answer entry

      if (qRun?.status === 'running' || qRun?.status === 'pending') return 'questions-running';
      if (qRun?.status === 'succeeded' && this.questions.length > 0) return 'questions-ready';
      if (qRun?.status === 'failed') return 'idle';

      return 'idle';
    },

    allAnswered(): boolean {
      return this.questions.length > 0 && this.answers.every((a) => a && a.trim().length > 0);
    },
  },

  watch: {
    'questionsPolling.terminal.value'(isTerminal: boolean) {
      const qRun = this.questionsRun;
      if (isTerminal && qRun?.status === 'succeeded' && qRun?.output) {
        // Output should contain { questions: [{ question: string }, ...] }
        const out = qRun.output as { questions?: { question: string }[] };
        this.questions = out.questions ?? [];
        this.answers = this.questions.map(() => '');
      } else if (isTerminal && qRun?.status === 'failed') {
        this.error = qRun.error ?? this.$t('coldStart.phase1.questionsFailed');
      }
    },

    'synthesizePolling.terminal.value'(isTerminal: boolean) {
      const sRun = this.synthesizeRun;
      if (isTerminal && sRun?.status === 'succeeded') {
        this.$emit('done');
      } else if (isTerminal && sRun?.status === 'failed') {
        this.error = sRun.error ?? this.$t('coldStart.phase1.synthesizeFailed');
      }
    },
  },

  methods: {
    async onGenerateQuestions(): Promise<void> {
      this.triggering = true;
      this.error = '';
      try {
        const { runId } = await this.coldStartStore.triggerPhase1Questions(this.slug);
        this.questionsRunId = runId;
        this.synthesizeRunId = null; // reset
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.triggering = false;
      }
    },

    async onSynthesize(): Promise<void> {
      this.triggering = true;
      this.error = '';
      try {
        const answersWithIdx = this.answers.map((answer, questionIndex) => ({ questionIndex, answer }));
        const { runId } = await this.coldStartStore.triggerPhase1Synthesize(this.slug, answersWithIdx);
        this.synthesizeRunId = runId;
      } catch (e) {
        if (e instanceof HttpError) this.notify.error(e.userMessage);
      } finally {
        this.triggering = false;
      }
    },
  },
});
</script>

<style lang="scss" scoped>
.question-card {
  border: 1px solid var(--q-grey-3, #e0e0e0);
  border-radius: 6px;
  padding: 16px;

  body.body--dark & {
    border-color: rgba(255, 255, 255, 0.1);
  }
}

.question-card__label {
  font-weight: 500;
  font-size: 14px;
  margin-bottom: 8px;
}
</style>
```

**Phase 2 (Competitor Analysis)** is simpler — single button to trigger, then polling, then show competitor list.

**Phase 3 (Cluster Plan)** — single button to trigger, then polling, then show cluster cards.

**Phase 4 (Cornerstones)** — has the per-cornerstone approve/edit/reject UI. Show:

```vue
<template>
  <div>
    <div v-if="phase === 'idle'">
      <q-btn color="primary" :label="$t('coldStart.phase4.generate')" @click="onGenerate" />
    </div>
    <div v-else-if="phase === 'running'">
      <q-banner class="bg-info text-white"><template v-slot:avatar><q-spinner /></template>{{ $t('coldStart.phase4.running') }}</q-banner>
    </div>
    <div v-else-if="phase === 'review'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase4.reviewIntro') }}</p>
      <CornerstoneCard
        v-for="article in proposedCornerstones"
        :key="article.id"
        :article="article"
        @approve="onApprove(article.id)"
        @reject="onReject(article.id)"
        @save="(patch: Record<string, unknown>) => onEdit(article.id, patch)"
      />
      <div v-if="approvedCount > 0" class="row q-mt-lg">
        <q-space />
        <q-btn
          color="positive"
          :label="$t('coldStart.phase4.proceed', { count: approvedCount })"
          @click="$emit('done')"
        />
      </div>
    </div>
  </div>
</template>
```

`CornerstoneCard.vue`: shows title, keyword, description, target word count. Two modes: view-mode and edit-mode (toggle). View-mode has approve/edit/reject buttons. Edit-mode has form fields + save/cancel buttons.

**Phase 5 (Go-Live)** — single button "Run go-live checklist", then shows the checklist output (markdown render).

(Detailed code for Phases 2-5 omitted for spec length — they follow the same pattern as Phase 1's simpler sub-states. Implementation Order specifies the time budget.)

### Frontend: CostIndicator helper component

`apps/web/src/components/cold-start/CostIndicator.vue`:

```vue
<template>
  <div v-if="costEur" class="cost-indicator">
    <q-icon name="payments" size="14px" class="q-mr-xs" />
    {{ $t('coldStart.costSoFar') }}: € {{ formattedCost }}
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
export default defineComponent({
  name: 'CostIndicator',
  props: { costEur: { type: String, default: null } },
  computed: {
    formattedCost(): string {
      const num = parseFloat(this.costEur ?? '0');
      return num.toFixed(2);
    },
  },
});
</script>
<style lang="scss" scoped>
.cost-indicator {
  font-size: 12px;
  color: var(--q-text-secondary, rgba(0, 0, 0, 0.55));
  margin-top: 8px;
  display: flex;
  align-items: center;
}
</style>
```

### Replace stub in ProjectDetailPage

In Spec 34's `ProjectDetailPage.vue`, replace the cold-start stub with:

```vue
<q-tab-panel name="cold-start" class="q-px-none">
  <ColdStartPanel :slug="slug" />
</q-tab-panel>
```

### i18n keys

`apps/web/src/i18n/de/coldStart.ts` — comprehensive bundle. Lengthy; key structure:

```typescript
export default {
  intro: 'Cold-Start initialisiert ein neues Projekt mit Brand-Voice, Wettbewerber-Analyse, Cluster-Plan und Cornerstone-Articles. Die 5 Phasen können einzeln oder nacheinander ausgeführt werden.',

  lockedHint: 'Vorherige Phase abschließen, um diese zu starten',
  costSoFar: 'Kosten bisher',

  statusLabels: {
    pending: 'Ausstehend',
    running: 'Läuft',
    awaiting_review: 'Wartet auf Review',
    complete: 'Abgeschlossen',
  },

  phase1: {
    title: 'Brand Voice',
    description: 'Generiere Fragen zur Marke und synthetisiere daraus den Marketing-Context.',
    idleDescription: 'Klicke "Fragen generieren", um den Voice-Refinement-Prozess zu starten. Du erhältst dann ~10 Fragen zur Marke.',
    generateQuestions: 'Fragen generieren',
    questionsRunning: 'Fragen werden generiert...',
    questionsFailed: 'Fragen-Generierung fehlgeschlagen',
    answerHint: 'Beantworte die Fragen so detailliert wie möglich. Die Antworten werden zur Erstellung des Marketing-Contexts verwendet.',
    answerPlaceholder: 'Antwort hier eingeben...',
    synthesizeButton: 'Marketing-Context erstellen',
    synthesizeRunning: 'Marketing-Context wird erstellt...',
    synthesizeFailed: 'Synthese fehlgeschlagen',
    complete: 'Brand Voice ist gespeichert. Du findest den Marketing-Context im Tab "Übersicht".',
    regenerate: 'Erneut generieren',
  },

  phase2: {
    title: 'Wettbewerber-Analyse',
    description: 'Analysiere die Top-Wettbewerber via DataForSEO + Anthropic.',
    idleDescription: 'Klicke "Analyse starten" — die Pipeline ermittelt automatisch die Top 5-10 Wettbewerber für deine Cornerstone-Keywords.',
    startButton: 'Analyse starten',
    running: 'Wettbewerber werden analysiert...',
    failed: 'Analyse fehlgeschlagen',
    complete: '{count} Wettbewerber analysiert.',
    regenerate: 'Erneut analysieren',
  },

  phase3: {
    title: 'Cluster-Plan',
    description: 'Generiere einen Topic-Cluster-Plan basierend auf Brand-Voice und Wettbewerbern.',
    idleDescription: 'Klicke "Cluster-Plan erstellen" — die Pipeline schlägt 3-7 Topic-Cluster vor mit jeweils einem Cornerstone-Keyword.',
    startButton: 'Cluster-Plan erstellen',
    running: 'Cluster-Plan wird erstellt...',
    failed: 'Cluster-Plan fehlgeschlagen',
    complete: '{count} Cluster erstellt.',
    regenerate: 'Cluster-Plan neu erstellen',
  },

  phase4: {
    title: 'Cornerstones',
    description: 'Generiere Cornerstone-Articles pro Cluster und reviewe sie.',
    idleDescription: 'Klicke "Cornerstones generieren" — pro Cluster wird ein Cornerstone-Article-Vorschlag erstellt.',
    generate: 'Cornerstones generieren',
    running: 'Cornerstones werden generiert...',
    reviewIntro: 'Reviewe jeden Cornerstone individuell. Du kannst ihn approven, editieren oder rejecten.',
    proceed: '{count} Cornerstones approven und Phase 5 starten',
    cardActions: {
      approve: 'Approve',
      edit: 'Editieren',
      reject: 'Reject',
      save: 'Speichern',
      cancel: 'Abbrechen',
    },
    cardFields: {
      title: 'Titel',
      keyword: 'Cornerstone-Keyword',
      description: 'Beschreibung',
      wordCount: 'Ziel-Wortanzahl',
    },
  },

  phase5: {
    title: 'Go-Live Checklist',
    description: 'Generiere eine Markdown-Checklist mit nächsten Schritten zum Go-Live.',
    idleDescription: 'Klicke "Checklist generieren" — du erhältst eine personalisierte Liste mit nächsten Schritten.',
    startButton: 'Checklist generieren',
    running: 'Checklist wird erstellt...',
    failed: 'Checklist-Erstellung fehlgeschlagen',
    complete: 'Cold-Start abgeschlossen. Du kannst jetzt Articles per CLI generieren — die Article-UI kommt in Spec 36.',
  },
};
```

Mirror in `en/coldStart.ts`.

## Acceptance Criteria

### Backend
- [ ] `GET /api/pipeline-runs/:runId` returns full run data
- [ ] `GET /api/pipeline-runs/project/:projectId` lists runs for project
- [ ] `POST /api/projects/:slug/cold-start/voice-refinement/questions` triggers Phase 1 questions
- [ ] `POST /api/projects/:slug/cold-start/voice-refinement/synthesize` triggers Phase 1 synthesize
- [ ] `POST /api/projects/:slug/cold-start/competitor-analysis` triggers Phase 2
- [ ] `POST /api/projects/:slug/cold-start/cluster-plan` triggers Phase 3
- [ ] `POST /api/projects/:slug/cold-start/cornerstones` triggers Phase 4
- [ ] `POST /api/projects/:slug/cold-start/cornerstones/:articleId/action` approves/rejects
- [ ] `PATCH /api/projects/:slug/cold-start/cornerstones/:articleId` edits cornerstone
- [ ] `POST /api/projects/:slug/cold-start/go-live-checklist` triggers Phase 5
- [ ] `GET /api/projects/:slug/cold-start/status` returns phase summary
- [ ] All require auth

### Polling Composable
- [ ] `usePipelineRunPolling(runId)` polls every 2.5s
- [ ] Stops when status is terminal (succeeded/failed/awaiting_review)
- [ ] Cleans up on unmount
- [ ] Pauses when document.hidden (Page Visibility API)
- [ ] Re-fetches on `start(newId)` call

### Phase 1 (Voice Refinement)
- [ ] "Fragen generieren" button triggers questions pipeline
- [ ] During generation, banner shows "läuft..."
- [ ] Cost indicator shows running cost
- [ ] On success, questions appear as numbered text fields
- [ ] "Marketing-Context erstellen" button disabled until all answered
- [ ] Synthesize success → "complete" state, marketing_context.md updated in DB

### Phase 2-3-5 (Automated Phases)
- [ ] Single button triggers, polling shows progress
- [ ] On complete, status updates and section can be re-run if desired

### Phase 4 (Cornerstones)
- [ ] Generate button triggers cornerstone-list pipeline
- [ ] On success, proposed cornerstones display as separate cards
- [ ] Each card has approve/edit/reject buttons
- [ ] Edit mode opens form for title, keyword, description, word count
- [ ] Save persists changes via PATCH endpoint
- [ ] Approve sets status to `approved`
- [ ] Reject sets status to `rejected`
- [ ] After approving at least 1, "Proceed" button advances

### Free-Form Navigation
- [ ] All 5 phases visible always
- [ ] Locked phases show lock icon + "complete previous phase" hint
- [ ] Unlocked phases auto-expand if pending/running
- [ ] Manual click to expand/collapse any unlocked phase

## Testing Strategy

End-to-end manual test on a fresh project:

1. **Setup**: Create new project (Spec 34), navigate to `/projects/new-test/cold-start`.
2. **Phase 1**: All other phases locked. Click "Fragen generieren". Wait ~30s. Questions appear. Answer all. Click "Marketing-Context erstellen". Wait. Verify "complete" state. Switch to Overview tab — verify marketing_context.md is populated.
3. **Phase 2**: Now unlocked. Click "Analyse starten". Wait ~1-2min. Verify count shown. Phase 3 unlocks.
4. **Phase 3**: Click "Cluster-Plan erstellen". Wait. Verify clusters created.
5. **Phase 4**: Click "Cornerstones generieren". Wait. Cards appear. Edit one (change title). Save. Approve 3, reject 1. Click "Proceed".
6. **Phase 5**: Click "Checklist generieren". Wait. Verify completion message.
7. **Refresh test**: Mid-Phase 1, refresh page. Verify polling resumes correctly (or shows current status from latest run).

Total cost for full test: ~€8 per Spec 14's estimate.

## Open Questions / Decisions Made

**Decision 1: Polling-only, no SSE/WS.**
Per discussion: simpler, sufficient.

**Decision 2: Composable per pipeline run.**
Per discussion: lifecycle-bound, no global state to manage.

**Decision 3: Auto-expand unlocked sections that are pending/running/awaiting_review.**
Reduces friction — Marcel doesn't need to click into each section he's actively working on.

**Decision 4: No "abort run" button.**
BullMQ jobs are awkward to cancel mid-flight. Marcel waits or restarts the worker process. Future enhancement.

**Decision 5: Phase 1 answers entered inline, not in dialog.**
With ~10 questions, inline is more legible than a long modal.

**Decision 6: No edit history for cornerstones.**
Edits overwrite. If needed, articles already have `updatedAt`; could add a `cornerstone_edit_log` table later.

**Decision 7: Phase status endpoint computes from DB, not from latest pipeline_run.**
DB state is canonical. Pipeline-run history just shows process. Status is "did this thing exist now?".

**Decision 8: Cornerstone approve/reject is a status enum mutation, not a separate flag.**
Reuses existing `articleStatusEnum` (`proposed`, `approved`, `rejected` already exist).

**Decision 9: Auto-Run feature deferred to a future micro-spec.**
Architecture supports it (separate trigger endpoints, polling Composable). UI button + auto-chaining logic is its own ~½ day work. Defer to Spec 35.5 if Marcel wants it before Bellemann onboarding.

## Implementation Order

**Recommend 4 sessions.**

**Session 1: Backend endpoints + polling composable (~5h)**
1. `apps/api/src/routes/pipeline-runs.ts` (generic run query)
2. `apps/api/src/routes/cold-start.ts` (all phase + sub-action endpoints)
3. `apps/web/src/composables/usePipelineRunPolling.ts`
4. `apps/web/src/stores/cold-start.ts`
5. Test with curl: trigger Phase 1 questions, query run status
6. Commit: `feat(api,web): cold-start endpoints + polling composable (spec 35)`

**Session 2: Phase 1 + frame structure (~5h)**
1. `ColdStartPanel.vue` shell with PhaseSection wrappers
2. `PhaseSection.vue`, `PhaseStatusPill.vue`
3. `Phase1VoiceRefinement.vue` (full implementation)
4. Replace stub in ProjectDetailPage
5. Add i18n keys for Phase 1 + status labels
6. Manual test Phase 1 end-to-end
7. Commit: `feat(web): cold-start phase 1 ui (spec 35)`

**Session 3: Phases 2, 3, 5 (~3-4h)**
1. `Phase2CompetitorAnalysis.vue` — single button, polling, output display
2. `Phase3ClusterPlan.vue` — same pattern, output is cluster cards
3. `Phase5GoLive.vue` — same pattern, output is markdown checklist
4. Add i18n keys for these phases
5. Manual test Phases 2-3-5
6. Commit: `feat(web): cold-start phases 2/3/5 (spec 35)`

**Session 4: Phase 4 + cornerstone cards (~4h)**
1. `Phase4Cornerstones.vue`
2. `CornerstoneCard.vue` with view + edit modes
3. Add i18n keys for Phase 4
4. Manual end-to-end test full Cold-Start
5. Commit: `feat(web): cold-start phase 4 + cornerstone review (spec 35)`

Total: 17-20 hours.

## Splitting Plan

See "Implementation Order" — 4 sessions with `/clear` between.

## Discovered During Implementation

**`enqueuePipeline()` returns only `{ jobId }`, not `{ runId }`.**
The spec assumed trigger helpers return `{ runId, jobId }`. In reality, `enqueuePipeline()` only returns `{ jobId }` because no `pipeline_runs` row exists yet when the job is enqueued. Solution: the **preRunId pattern** — insert a `pipeline_runs` row with `status='queued'` before enqueuing, pass its ID as `preRunId` through job data; the worker then UPDATEs that row to `status='running'` instead of INSERTing a new one. Canonicalized in `packages/pipelines/src/cold-start/triggers.ts`.

**No `competitors` table in the DB schema.**
Spec referenced a `competitors` table for Phase 2 completion detection. No such table exists. Phase 2 completion is derived from pipeline run history: latest `cold-start:competitor-analysis` run with `status='completed'`.

**No `projects.brandVoice` or `projects.coldStartCompletedAt` columns.**
Spec referenced these for Phase 1/5 completion signals. Actual columns: `projects.marketingContextMd` (non-empty = Phase 1 complete); go-live-checklist pipeline run `completed` = Phase 5 complete. The `afterComplete` hook on `VoiceSynthesisPipeline` writes the markdown to `projects.marketingContextMd`.

**Phase 2 requires two sequential sub-pipelines, not one.**
`cold-start:competitor-questions` identifies competitors (LLM), then `cold-start:competitor-analysis` runs the DataForSEO analysis. Auto-chaining is handled entirely in the frontend: `Phase2CompetitorAnalysis.vue` watches the questions polling terminal and triggers the analysis pipeline when it completes with competitor data.

## Deviations

**Phase 1 completion signal:** spec said `projects.brandVoice` → used `projects.marketingContextMd` (the actual column).

**Phase 5 completion signal:** spec said `projects.coldStartCompletedAt` → derived from `pipeline_runs` (latest `cold-start:go-live-checklist` run with `status='completed'`).

**Phase 2 competitor source:** spec said `competitors` table → derived from `pipeline_runs` output (no competitors table exists).

**Trigger helpers use preRunId pattern:** spec assumed trigger helpers already existed returning `{ runId, jobId }`. They were created from scratch using the preRunId pattern to give the UI a stable runId immediately without a second DB round-trip after enqueue.

**Status endpoint uses `stepName = NULL` filter:** spec draft showed `stepName: null` in Drizzle queries. Drizzle requires `sql\`NULL\`` for IS NULL comparisons, not the JS `null` value — updated accordingly.
