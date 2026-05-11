# Spec 48: Cold-Start Phase 4 Multi-Language Refactor

**Phase:** Marketing-Tool integration spec — fixes Spec 45/46 gap
**Estimated Effort:** 2-3 hours (1 session, structured into 4 sections)
**Dependencies:** Spec 14 (Cold-Start), Spec 45/46 (multi-language generation), Spec 22.6 (dev cache — recommended for cheap iteration)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (focused refactor, no new architecture)
**Repos affected:** marketing-tool (api + web)

---

## Context

Spec 45/46 introduced multi-language cornerstone generation: `cornerstoneSpecs` table, DE+EN pairs via `translationKey`, parallel `enqueueClusterArticleGeneration`. The backend pipeline supports `locales` parameter and `GenerateCornerstoneSpecsStep` produces 1 spec per (cluster × locale).

**But**: Spec 45/46 was integrated **next to** the existing Cold-Start wizard, not **into** it. As a result:

1. **Cold-Start Phase 4** (`Phase4Cornerstones.vue`) uses the **old single-locale flow**: reads from `articles` table directly, no locale awareness, no pair display.
2. **Cold-Start API endpoint** `POST /cold-start/cornerstones` **does NOT pass `locales`** to the pipeline → falls back to default-only-DE.
3. **`CornerstoneApprovalPage.vue`** exists as a standalone component but is **NOT routed** anywhere — orphaned code.
4. **Phase 4 trigger** still uses the legacy `articleId/action` endpoint instead of the new `cornerstone-specs/:specId/approve` endpoint.

The net effect: **users cannot create a complete DE+EN cluster end-to-end through the UI**. Backend supports it, UI doesn't expose it.

This spec wires Spec 45/46 into the canonical Cold-Start wizard so the multi-language flow becomes the only flow.

## Goal

After this spec:
- Cold-Start API endpoint `POST /cold-start/cornerstones` accepts `locales: ('de' | 'en')[]` parameter, default `['de', 'en']`, and forwards to pipeline
- `Phase4Cornerstones.vue` shows DE+EN translation pairs side-by-side using existing `CornerstonePairCard.vue`
- Phase 4 reads from `/cornerstone-specs` endpoint (Spec 45/46), not `/cold-start/cornerstones` (legacy)
- Phase 4 "Approve all" button uses pair-approve and triggers `enqueueClusterArticleGeneration` (parallel DE+EN article generation)
- `CornerstoneApprovalPage.vue` either gets routed for power-users, or is deleted (decision in Section D)
- Old `/cold-start/cornerstones/:articleId/action` endpoint deprecated (kept temporarily for backwards-compat, removed in follow-up)
- Cold-Start store updated: `cornerstoneSpecsByProject` replaces `cornerstonesByProject`

## Non-Goals

- **No new Backend Pipeline changes** — `GenerateCornerstoneSpecsStep` already does DE+EN; we just thread `locales` through the trigger.
- **No project-level locale config** — locale set is hardcoded to `['de', 'en']` at trigger time. Per-project locale-config can come later.
- **No retroactive migration of existing data** — old `articles`-based cornerstones from previous test runs are NOT moved to `cornerstone_specs`. Fresh cold-starts use new flow.
- **No edit-spec-inline UI** — Phase 4 only shows + approves + rejects pairs. Editing cornerstone keywords/titles before approval is future work.
- **No removal of `CornerstoneCard.vue`** yet — kept for any legacy single-locale views (will be cleaned up in a later spec once nothing references it).
- **No changes to Cluster-Plan (Phase 3)** — clusters stay locale-neutral (already correct).

## Pre-flight

```bash
cd <marketing-tool-repo>
git status --porcelain  # clean
git checkout -b feature/48-cold-start-multilang
bun test 2>&1 | tail -3  # green baseline
```

## Architecture Overview

```
BEFORE (broken):
  Phase 3 (clusters approved)
       ↓
  POST /cold-start/cornerstones { approvedClusters }
       ↓
  enqueueColdStartCornerstoneList({ approvedClusters })   ← no locales param
       ↓
  Pipeline picks default → DE only
       ↓
  Articles inserted into `articles` table         ← OLD model
       ↓
  Phase 4 reads /cold-start/cornerstones from `articles`  ← OLD model
       ↓
  Phase 4 calls /cold-start/cornerstones/:articleId/action  ← OLD endpoint

AFTER (fixed):
  Phase 3 (clusters approved)
       ↓
  POST /cold-start/cornerstones { approvedClusters, locales: ['de','en'] }
       ↓
  enqueueColdStartCornerstoneList({ approvedClusters, locales })
       ↓
  GenerateCornerstoneSpecsStep produces 2 specs/cluster (DE+EN)   ← Spec 45/46
       ↓
  cornerstoneSpecs rows persisted with shared translationKey      ← Spec 45/46
       ↓
  Phase 4 reads GET /projects/:slug/cornerstone-specs   ← NEW endpoint
       ↓
  Phase 4 displays CornerstonePairCard for each translationKey
       ↓
  "Approve pair" → POST /cornerstone-specs/pair/:translationKey/approve
       ↓
  "Generate articles" → POST /clusters/:clusterId/generate-articles
                       (calls enqueueClusterArticleGeneration → 2 article pipelines)
```

## Splitting Plan

4 sections for `/start-task /review-task` workflow:

```
A — Cold-Start trigger accepts locales        ~30min   [task: 48.1-trigger]
B — Phase 4 UI refactor to use specs flow     ~1h      [task: 48.2-phase4-ui]
C — Cold-Start store update + cleanup         ~45min   [task: 48.3-store]
D — Route CornerstoneApprovalPage + final     ~30min   [task: 48.4-route-final]
```

---

## Section A — Cold-Start Trigger Accepts `locales`

### A.1 Files modified

- `apps/api/src/routes/cold-start.ts` — extend `cornerstoneListSchema` and trigger call
- `packages/pipelines/src/cold-start/04-cornerstone-list/trigger.ts` (or wherever `enqueueColdStartCornerstoneList` is defined) — accept `locales` param
- `packages/pipelines/src/cold-start/04-cornerstone-list/pipeline.ts` — ensure `locales` flows into `GenerateCornerstoneSpecsStep` input

### A.2 Schema + route update

```typescript
// apps/api/src/routes/cold-start.ts
const cornerstoneListSchema = z.object({
  approvedClusters: z.array(/* existing shape */).min(1),
  // NEW:
  locales: z.array(z.enum(["de", "en"])).min(1).max(2).default(["de", "en"]),
});

coldStartRoutes.post(
  "/:slug/cold-start/cornerstones",
  zValidator("json", cornerstoneListSchema),
  async (c) => {
    const slug = c.req.param("slug");
    const proj = await resolveProject(slug);
    if (!proj) return c.json({ ok: false, error: "Project not found" }, 404);

    const blocked = await checkTriggerAllowed({/* unchanged */});
    if (blocked) return guardErrorToResponse(c, blocked);

    const { approvedClusters, locales } = c.req.valid("json");
    const { runId, jobId } = await enqueueColdStartCornerstoneList({
      projectId: proj.id,
      approvedClusters,
      locales,                       // NEW
    });
    return c.json({ ok: true, data: { runId, jobId } }, 202);
  }
);
```

### A.3 Trigger function signature

```typescript
// packages/pipelines/src/cold-start/04-cornerstone-list/trigger.ts
export interface EnqueueColdStartCornerstoneListInput {
  projectId: string;
  approvedClusters: ApprovedCluster[];
  locales?: ("de" | "en")[];   // NEW, default ['de', 'en']
}

export async function enqueueColdStartCornerstoneList(
  input: EnqueueColdStartCornerstoneListInput
): Promise<{ runId: string; jobId: string }> {
  // ... existing pre-INSERT pipelineRun row ...

  const pipelineInput = {
    projectId: input.projectId,
    approvedClusters: input.approvedClusters,
    locales: input.locales ?? ["de", "en"],   // NEW
    // ... existing fields ...
  };

  // enqueue ...
}
```

### A.4 Pipeline forwards `locales`

The `CornerstoneListPipeline` already accepts `locales` in its input schema (from Spec 45/46 Section B). Verify:

```typescript
// packages/pipelines/src/cold-start/04-cornerstone-list/pipeline.ts
readonly inputSchema = z.object({
  projectId: z.string().uuid().optional(),
  projectSlug: z.string().optional(),
  approvedClusters: z.array(ApprovedClusterSchema).min(1),
  locales: z.array(z.enum(["de", "en"])).default(["de", "en"]),  // already there from Spec 45/46
});
```

If `projectSlug` is missing in current schema (likely was added by Spec 45/46), confirm trigger passes correct shape.

### A.5 Section A Acceptance

- [ ] `POST /cold-start/cornerstones` accepts `{ approvedClusters, locales? }`
- [ ] Default `locales: ['de', 'en']` if omitted (backwards compat)
- [ ] curl smoke: trigger pipeline with `{"approvedClusters":[...], "locales":["de","en"]}` produces pipelineRun
- [ ] Pipeline run input contains `locales` array
- [ ] After completion: `cornerstoneSpecs` table has 2N rows for N clusters (one DE, one EN per cluster)
- [ ] Commit: `feat(cold-start): cornerstone-list trigger accepts locales (48.1)`

---

## Section B — Phase 4 UI Refactor

### B.1 Files modified

- `apps/web/src/components/cold-start/Phase4Cornerstones.vue` — rewrite to use specs flow
- `apps/web/src/components/cornerstones/CornerstonePairCard.vue` — verify exists (from Spec 45/46), reuse
- Inline reject dialog into Phase 4 (don't import existing `CornerstoneApprovalPage` directly)

### B.2 Phase 4 rewrite

```vue
<!-- apps/web/src/components/cold-start/Phase4Cornerstones.vue -->
<template>
  <div class="q-pt-md">
    <!-- loading -->
    <div v-if="loadingInitial" class="text-center q-pa-md">
      <q-spinner size="2em" color="primary" />
    </div>

    <!-- no clusters yet -->
    <div v-else-if="approvedClusters.length === 0 && phase === 'idle'">
      <q-banner class="bg-warning text-white" rounded>
        <template #avatar><q-icon name="warning" /></template>
        {{ $t('coldStart.phase4.noClusters') }}
      </q-banner>
    </div>

    <!-- idle: ready to generate -->
    <div v-else-if="phase === 'idle'">
      <p class="text-body2 q-mb-md">
        {{ $t('coldStart.phase4.idleDescriptionMultiLang', { count: approvedClusters.length }) }}
      </p>

      <q-card flat bordered class="q-pa-md q-mb-md">
        <div class="text-subtitle2 q-mb-sm">{{ $t('coldStart.phase4.localesLabel') }}</div>
        <q-option-group
          v-model="selectedLocales"
          :options="localeOptions"
          type="checkbox"
          inline
        />
      </q-card>

      <q-btn
        color="primary"
        :label="$t('coldStart.phase4.generate')"
        :loading="triggering"
        :disable="selectedLocales.length === 0"
        unelevated
        @click="onGenerate"
      />
    </div>

    <!-- running -->
    <div v-else-if="phase === 'running'">
      <q-banner class="bg-blue-1 text-blue-9 q-mb-md" rounded>
        <template #avatar><q-spinner size="20px" color="primary" /></template>
        {{ $t('coldStart.phase4.running') }}
      </q-banner>
    </div>

    <!-- review pairs -->
    <template v-else-if="phase === 'review'">
      <p class="text-body2 q-mb-md">{{ $t('coldStart.phase4.reviewIntroMultiLang') }}</p>

      <CornerstonePairCard
        v-for="pair in pairs"
        :key="pair.translationKey"
        :pair="pair"
        :slug="slug"
        @approved="onPairChanged"
        @rejected="onPairChanged"
      />

      <div v-if="anyApproved" class="row q-mt-lg">
        <q-space />
        <q-btn
          color="positive"
          :label="$t('coldStart.phase4.generateArticles', { count: approvedClusterIds.length })"
          :loading="generating"
          unelevated
          @click="onGenerateArticles"
        />
      </div>

      <div class="q-mt-md">
        <q-btn
          flat
          color="primary"
          :label="$t('coldStart.phase4.regenerate')"
          size="sm"
          :loading="triggering"
          @click="onGenerate"
        />
      </div>
    </template>

    <q-banner v-if="errorMsg" class="bg-negative text-white q-mt-md" rounded>
      <template #avatar><q-icon name="error" /></template>
      {{ errorMsg }}
    </q-banner>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from "vue";
import { Notify } from "quasar";
import { usePipelineRunPolling } from "src/composables/usePipelineRunPolling";
import { api } from "src/lib/api-client";
import { useColdStartStore } from "src/stores/cold-start";
import CornerstonePairCard from "src/components/cornerstones/CornerstonePairCard.vue";

type Phase = "idle" | "running" | "review";
type Locale = "de" | "en";

interface CornerstoneSpec {
  id: string;
  clusterId: string;
  locale: Locale;
  translationKey: string;
  cornerstoneKeyword: string;
  proposedTitle: string;
  proposedSlug: string;
  metaDescription: string;
  estimatedWordCount: number;
  h2Outline: string[];
  status: "proposed" | "approved" | "in_generation" | "article_done" | "rejected";
}

interface Pair {
  translationKey: string;
  clusterId: string;
  de: CornerstoneSpec | null;
  en: CornerstoneSpec | null;
}

export default defineComponent({
  name: "Phase4Cornerstones",
  components: { CornerstonePairCard },

  props: {
    slug: { type: String, required: true },
  },

  emits: ["done"],

  setup() {
    const runId = ref<string | null>(null);
    return {
      coldStartStore: useColdStartStore(),
      runId,
      polling: usePipelineRunPolling(runId),
    };
  },

  data: () => ({
    triggering: false,
    generating: false,
    loadingInitial: true,
    approvedClusters: [] as Array<{
      name: string;
      pillar: string;
      status: "approved";
      cornerstone_keyword: string;
      cornerstone_search_volume: number | null;
      cornerstone_difficulty: number | null;
      satellite_keywords: [];
    }>,
    pairs: [] as Pair[],
    selectedLocales: ["de", "en"] as Locale[],
    errorMsg: "",
  }),

  computed: {
    localeOptions(): Array<{ label: string; value: Locale }> {
      return [
        { label: "Deutsch (DE)", value: "de" },
        { label: "English (EN)", value: "en" },
      ];
    },

    currentRun() {
      return this.polling.run.value;
    },

    phase(): Phase {
      const r = this.currentRun;
      if (r?.status === "running" || r?.status === "queued") return "running";
      if (this.pairs.length > 0) return "review";
      return "idle";
    },

    anyApproved(): boolean {
      return this.pairs.some(
        (p) => p.de?.status === "approved" || p.en?.status === "approved"
      );
    },

    approvedClusterIds(): string[] {
      const set = new Set<string>();
      for (const p of this.pairs) {
        if (p.de?.status === "approved" || p.en?.status === "approved") {
          set.add(p.clusterId);
        }
      }
      return Array.from(set);
    },
  },

  watch: {
    "polling.terminal.value"(isTerminal: boolean) {
      if (!isTerminal) return;
      const r = this.currentRun;
      if (r?.status === "completed") {
        void this.fetchPairs();
      } else if (r?.status === "failed") {
        this.errorMsg = r.error ?? (this.$t("coldStart.phase4.failed") as string);
      }
    },
  },

  async created() {
    await Promise.all([this.loadClusterData(), this.fetchPairs()]);
    this.loadingInitial = false;
  },

  methods: {
    async loadClusterData(): Promise<void> {
      // ... existing logic to fetch approved clusters from status ...
    },

    async fetchPairs(): Promise<void> {
      try {
        const res = await api.get<{
          ok: boolean;
          data: { pairs: Pair[]; totalSpecs: number };
        }>(`/projects/${this.slug}/cornerstone-specs`);
        this.pairs = res.data.data.pairs;
      } catch (e) {
        this.errorMsg = (e as Error).message;
      }
    },

    async onGenerate(): Promise<void> {
      this.triggering = true;
      this.errorMsg = "";
      try {
        const res = await api.post<{
          ok: boolean;
          data: { runId: string; jobId: string };
        }>(`/projects/${this.slug}/cold-start/cornerstones`, {
          approvedClusters: this.approvedClusters,
          locales: this.selectedLocales,
        });
        this.runId = res.data.data.runId;
      } catch (e) {
        this.errorMsg = (e as Error).message;
      } finally {
        this.triggering = false;
      }
    },

    onPairChanged(): void {
      void this.fetchPairs();
    },

    async onGenerateArticles(): Promise<void> {
      this.generating = true;
      this.errorMsg = "";
      try {
        let totalEnqueued = 0;
        for (const clusterId of this.approvedClusterIds) {
          const res = await api.post<{
            ok: boolean;
            data: { results: Array<{ articleId: string; locale: string }> };
          }>(`/projects/${this.slug}/clusters/${clusterId}/generate-articles`);
          totalEnqueued += res.data.data.results.length;
        }
        Notify.create({
          type: "positive",
          message: this.$t("coldStart.phase4.articlesEnqueued", { total: totalEnqueued }),
          timeout: 4000,
        });
        this.$emit("done");
      } catch (e) {
        this.errorMsg = (e as Error).message;
      } finally {
        this.generating = false;
      }
    },
  },
});
</script>
```

**Note**: This depends on `POST /projects/:slug/clusters/:clusterId/generate-articles` (from Spec 45/46 Section D). Verify it exists; the Spec 45/46 report mentioned it lives in cornerstone-specs.ts route, not clusters.ts, but URL path is same.

### B.3 i18n keys

```typescript
// apps/web/src/i18n/de/coldStart.ts (extend phase4 section)
phase4: {
  // ... existing keys ...
  idleDescriptionMultiLang:
    "Für jeden der {count} genehmigten Cluster wird pro Sprache ein Cornerstone-Spec generiert.",
  localesLabel: "Sprachen für Generierung",
  reviewIntroMultiLang:
    "Überprüfe die DE+EN-Pärchen. Genehmige sie einzeln oder als Paar, dann generiere die Artikel.",
  generateArticles: "{count} Cluster generieren",
  regenerate: "Erneut generieren",
  articlesEnqueued: "{total} Article-Generationen gestartet",
},
```

```typescript
// apps/web/src/i18n/en/coldStart.ts (analog)
```

### B.4 Section B Acceptance

- [ ] Phase 4 UI shows locale selector before "Generate"
- [ ] Trigger sends `locales` array to API
- [ ] After pipeline completes, Phase 4 displays `CornerstonePairCard` for each translation pair
- [ ] DE-only or EN-only pairs (one locale missing) handled gracefully via existing PairCard logic
- [ ] "Approve pair" / "Reject" actions work
- [ ] After ≥1 cluster approved, "Generate Articles" button appears and triggers cluster-level article generation
- [ ] Smoke flow in dev: trigger → review pairs → approve → generate articles → see 2 article pipelines enqueued per approved cluster
- [ ] Commit: `feat(web): Phase 4 uses multi-language cornerstone specs flow (48.2)`

---

## Section C — Cold-Start Store Update + Cleanup

### C.1 Files modified

- `apps/web/src/stores/cold-start.ts` — replace `cornerstonesByProject` with `cornerstoneSpecsByProject` (or just remove since Phase 4 now manages its own state)
- `apps/web/src/components/cold-start/ColdStartPanel.vue` (if it reads `cornerstones` from store) — adjust
- `apps/api/src/routes/cold-start.ts` — mark `GET /cold-start/cornerstones` and `POST /cold-start/cornerstones/:articleId/action` as deprecated (add comment, keep working temporarily)

### C.2 Store cleanup

Decision: since Phase 4 manages pair state locally (matching CornerstoneApprovalPage pattern from Spec 45/46), we **remove** the old cornerstones store entries:

```typescript
// apps/web/src/stores/cold-start.ts
interface ColdStartState {
  statusByProject: Record<string, ColdStartStatus | null>;
  // REMOVED: cornerstonesByProject
  loading: boolean;
}

export const useColdStartStore = defineStore("coldStart", {
  state: (): ColdStartState => ({
    statusByProject: {},
    // REMOVED: cornerstonesByProject: {},
    loading: false,
  }),
  // REMOVED: fetchCornerstones, approveCornerstone, rejectCornerstone actions
  // (those targeted the old /cold-start/cornerstones/:articleId/action endpoint)
});
```

**Important**: search codebase for `cornerstonesByProject`, `fetchCornerstones` references and remove/replace.

### C.3 Cold-Start status endpoint — keep `phase4` working

`GET /cold-start/status` returns phase completion state. Phase 4 status check currently looks at `articles` count with `status='proposed'/'approved'`. Update to check `cornerstoneSpecs` instead:

```typescript
// apps/api/src/routes/cold-start.ts (in status endpoint)
// Replace:
//   const cornerstoneRows = await db.select().from(articles).where(...status IN proposed/approved...);
// With:
const cornerstoneSpecsCount = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(cornerstoneSpecs)
  .where(eq(cornerstoneSpecs.projectId, projectId));

const approvedSpecsCount = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(cornerstoneSpecs)
  .where(
    and(
      eq(cornerstoneSpecs.projectId, projectId),
      eq(cornerstoneSpecs.status, "approved")
    )
  );

// phase 4 status logic:
const cornerstoneListRunning = /* existing pipeline-run check */;
const phase4Complete =
  cornerstoneSpecsCount[0]?.count > 0 && /* optional: all clusters covered */;
```

### C.4 Mark legacy endpoints as deprecated

```typescript
// apps/api/src/routes/cold-start.ts
// Add deprecation comments above old endpoints:

/**
 * @deprecated Spec 48 — use GET /projects/:slug/cornerstone-specs instead.
 * This endpoint reads from `articles` table and does not support multi-language.
 * Kept temporarily for any legacy callers. Remove in follow-up after no
 * frontend references remain.
 */
coldStartRoutes.get("/:slug/cold-start/cornerstones", async (c) => {
  // ... unchanged ...
});

/**
 * @deprecated Spec 48 — use POST /projects/:slug/cornerstone-specs/:specId/approve
 * or .../pair/:translationKey/approve instead.
 */
coldStartRoutes.post("/:slug/cold-start/cornerstones/:articleId/action", ...);
```

### C.5 Section C Acceptance

- [ ] `useColdStartStore` no longer has `cornerstonesByProject` or `fetchCornerstones`
- [ ] Codebase grep confirms no remaining references
- [ ] Cold-Start status endpoint returns correct `phase4` state based on `cornerstoneSpecs`
- [ ] Legacy `cornerstones` endpoints have JSDoc `@deprecated` comments
- [ ] `bun --filter @marketing-auto/web vue-tsc --noEmit` passes
- [ ] Commit: `refactor(cold-start): store + status use cornerstoneSpecs (48.3)`

---

## Section D — Route Approval Page + Final

### D.1 Decision: keep or remove `CornerstoneApprovalPage.vue`?

`CornerstoneApprovalPage.vue` (from Spec 45/46) is currently orphan code. Two options:

**Option 1 — Route it as power-user view**:
- Adds `/projects/:slug/cornerstone-approval` route
- Useful as standalone view when Phase 4 wizard is "done" but user wants to re-review pairs

**Option 2 — Delete it**:
- Phase 4 now does everything the approval page did
- Less duplicate code

**Recommendation: Option 1**. Phase 4 is part of a wizard (linear flow). Cornerstone approval is also useful as an ongoing standalone activity (re-approving rejected specs, regenerating, etc.) without re-entering the wizard.

### D.2 Add route

```typescript
// apps/web/src/router/routes.ts (add new route)
{
  path: "projects/:slug/cornerstone-approval",
  name: "cornerstone-approval",
  component: () => import("src/pages/CornerstoneApprovalPage.vue"),
  props: true,
  meta: { requiresAuth: true },
},
```

### D.3 Link from Phase 4

Add small link in Phase 4 review state:

```vue
<!-- in Phase4Cornerstones.vue, review template -->
<div class="q-mt-md text-caption">
  <router-link
    :to="{ name: 'cornerstone-approval', params: { slug } }"
    class="text-primary"
  >
    {{ $t('coldStart.phase4.openStandaloneView') }}
  </router-link>
</div>
```

### D.4 Verify CornerstoneApprovalPage still works after Section C changes

`CornerstoneApprovalPage.vue` should already use `GET /projects/:slug/cornerstone-specs` (per Spec 45/46 Section E). Verify nothing breaks after deprecating the legacy endpoints in Section C — the approval page should not depend on `/cold-start/cornerstones`.

### D.5 Section D Acceptance

- [ ] Route `/projects/:slug/cornerstone-approval` registered
- [ ] Page accessible via direct URL
- [ ] Link in Phase 4 navigates to standalone view
- [ ] Page renders correctly with toolwiki data (after backend Cold-Start run)
- [ ] No console errors
- [ ] Commit: `feat(web): route cornerstone approval page + link from Phase 4 (48.4)`

---

## Final Verification

```bash
# Type check
bun --filter @marketing-auto/api tsc --noEmit
bun --filter @marketing-auto/pipelines tsc --noEmit
bun --filter @marketing-auto/web vue-tsc --noEmit

# Tests
bun test

# Manual end-to-end smoke (with ANTHROPIC_CACHE_MODE=auto):
# 1. Open Cold-Start tab in toolwiki Project
# 2. Run Phase 1-3 (or assume they're done from earlier)
# 3. Phase 4: locale checkboxes both checked → click "Generate"
# 4. Wait for pipeline (1-2 min, recorded to fixtures on first run)
# 5. See pairs displayed side-by-side
# 6. Approve a pair → "Generate Articles" button appears
# 7. Click "Generate Articles" → 2 article pipelines enqueued per approved cluster
# 8. Watch worker logs for parallel DE + EN article generation
# 9. After completion: 2 article rows per approved cluster, locale field populated

# SQL check:
psql "$DATABASE_URL" -c "
  SELECT cs.cluster_id, cs.locale, cs.status, cs.proposed_title, a.id as article_id, a.locale as article_locale
  FROM cornerstone_specs cs
  LEFT JOIN articles a ON a.cornerstone_spec_id = cs.id
  WHERE cs.project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  ORDER BY cs.cluster_id, cs.locale;
"
```

## Acceptance Criteria (combined)

- [ ] All 4 sections committed on `feature/48-cold-start-multilang`
- [ ] User can run full Cold-Start (Phase 1-4) entirely in UI and get DE+EN article pairs
- [ ] Locale-selector visible in Phase 4 before generation
- [ ] Pair-review UI integrated into Phase 4 (not separate)
- [ ] Standalone CornerstoneApprovalPage routed for power users
- [ ] Old cornerstones endpoints deprecated but functional
- [ ] No regressions in cold-start status/wizard flow

## Reporting Back

After implementation:

1. **Schema/code diff** summary
2. **Trigger smoke**: paste curl response for new `POST /cold-start/cornerstones` with locales
3. **UI smoke**: describe Phase 4 with toolwiki data — pairs visible? locales correct?
4. **Generate articles smoke**: for one approved cluster, paste output showing 2 article pipelines enqueued (DE+EN)
5. **Locale-aware sample**: paste DE title + EN title from one pair to verify they're independently written
6. **Test results**
7. **Commit hashes** — 4 commits
8. **Deviations** — any spec gaps Claude Code filled

## Discovered During Implementation

- **Route already existed**: `projects/:slug/cornerstones` → `CornerstoneApprovalPage.vue` was already registered in `apps/web/src/router/routes.ts` (line 44–49) from Spec 45/46. Section D required only adding the `<router-link>` in Phase 4 — no route registration work.
- **`CornerstonePairCard.vue` emits `approved`/`rejected`** (not `approved-pair`/`rejected-pair` as one might assume from naming). Confirmed before wiring Phase 4.
- **`CornerstoneArticle` still consumed by `CornerstoneCard.vue`**: The legacy component imports `CornerstoneArticle` from the store; the type must be kept even though the state/actions were removed.
- **Dead store in `setup()` after refactor**: After removing store actions from Phase 4, the `coldStartStore` return from `setup()` became unused. Caught in `/review-task`. Pattern to watch: when refactoring a component away from store actions, also clean up `setup()` returns.
- **Status endpoint counted `rejected` specs in `proposedCount`**: The new implementation computes `proposedCount = totalCount - approvedCount`, which includes `rejected` specs. Acceptable for the wizard's phase-completion heuristic (any non-approved spec means the phase isn't "done"), but differs slightly from the old articles-table query which filtered for `status IN ('proposed','approved')` only.

## Deviations

- **Section D merged into Section B commit**: The `<router-link>` to the standalone approval page was part of the `Phase4Cornerstones.vue` rewrite rather than a separate commit. No separate 48.4 commit was created because the route already existed and the only deliverable (the link) was part of the Section B file.
- **`triggerCornerstoneList` kept in store** (updated, not removed): The store action was updated to accept `locales` param rather than removed. Phase 4 now calls the API directly (bypassing the store), but the store action remains available for other callers. The spec's Section C said to remove `cornerstoneAction` and `cornerstoneEdit` only — `triggerCornerstoneList` was kept as a thin convenience wrapper.
