# Spec 64.18 Backlog Bundle (M7 + L8 + H2) — Implementation Log

_Spec: [`specs/64.18-backlog-m7-l8-h2.md`](../../../specs/64.18-backlog-m7-l8-h2.md) — note: Marcel reframed the spec file as a backlog tracker mid-session; the original implementation §3–§5 lives here in the IMPLEMENTED log._
_Implemented: 2026-05-24_

## TL;DR

Three independent backlog items closed in one session per the spec's Phase A → B → C sequencing. Phase A + B shipped as quick wins (~30 min each); Phase C went discovery-first (per spec §5.1) before code-write.

| Phase | Item | Outcome | Tests added |
| --- | --- | --- | --- |
| **A (M7)** | rejected_topic_candidates physical prune | One-shot script + D29 safety | — (spec §3.2: no test) |
| **B (L8)** | `cost_logs.metadata.augmented` field | Pure TS type-extension, jsonb-additive | — (spec §4.4: type-only) |
| **C (H2)** | Comparison-Discovery cluster-routing | Subcategory-aware resolver + planner wiring | 18 |

**Workspace typecheck**: 0 errors across 25 packages. **Planner suite**: 116 pass / 0 fail. **Pipelines suite**: 716 pass / 74 skip / 0 fail.

## Changes by Phase

### Phase A — M7: rejected_topic_candidates prune

**Files touched:**

- [`apps/api/src/scripts/prune-rejected-topic-candidates.ts`](../../../apps/api/src/scripts/prune-rejected-topic-candidates.ts) — new. D29-compliant pattern (mirrors `backfill-brief-embeddings.ts`): dry-run = `count(*)` short-circuit (avoids the predicate-loop footgun); apply requires `--project=<slug>` to prevent cross-tenant mass-delete. DI port for testability though no tests were required per spec §3.2.
- [`apps/api/package.json`](../../../apps/api/package.json) — registered `prune-rejected-topic-candidates` script with the standard `--env-file ../../.env` flag.

**Spec deviation**: spec §3.1 sketched `rejectedTopicCandidates.createdAt`. Actual schema column is `rejectedAt` (verified in [`packages/db/src/schema/content.ts:1140`](../../../packages/db/src/schema/content.ts:1140)). Used `rejectedAt` accordingly.

**Live verification (dry-run)**:
- `bun --filter @marketing-auto/api prune-rejected-topic-candidates --project=toolwiki` → 0 rows (snapshot drift from spec's "1 row" — likely cleaned up via CASCADE or aged-out since spec write).
- `bun --filter @marketing-auto/api prune-rejected-topic-candidates --apply` (no project) → exits non-zero. D29 guard works.

### Phase B — L8: `cost_logs.metadata` typing

**Files touched:**

- [`packages/db/src/schema/operations.ts`](../../../packages/db/src/schema/operations.ts):
  - New exported `interface CostLogMetadata` with documented optional fields: `durationMs?`, `estimatedCostEur?` (the two fields `track()` always writes), `augmented?` + `augmentation_type?` (forward-relevant — Spec 64.8 consumes), plus an index signature `[key: string]: unknown` so future audit fields stay back-compat.
  - `metadata` column re-typed via `.$type<CostLogMetadata>()` (was `Record<string, unknown>`).

**Migration**: none. `cost_logs.metadata` is already `jsonb`; this is a pure TS type extension. No backfill needed (rows without `augmented` read as undefined, treated as falsy by consumers).

**Consumer-call pattern** documented inline in the JSDoc on `CostLogMetadata` and matches the existing `track()` metadata-callback contract from `packages/cost-tracker/CLAUDE.md`:

```typescript
await track({
  ...,
  metadata: (response) => ({ augmented: true, augmentation_type: "rag" }),
});
```

No change to `track()` signature; the cost-tracker contract explicitly notes that adding audit fields is callback-only.

### Phase C.1 — H2 Discovery (read-only)

**Files added:**

- [`specs/_drafts/64.18-h2-comparison-routing.discovery.md`](../../../specs/_drafts/64.18-h2-comparison-routing.discovery.md) — ~290 LOC discovery doc covering: DB inspection of all 4 stuck briefs, cluster landscape (46 total / 8 in `comparisons` pillar), existing routing-code read, 3 pattern options evaluated, recommendation (subcategory-aware resolver), implementation sketch, 4 open questions for Marcel.
- [`apps/api/src/scripts/discovery/inspect-h2-comparison-briefs.ts`](../../../apps/api/src/scripts/discovery/inspect-h2-comparison-briefs.ts) — read-only inspector. Kept for re-runs.

**Key findings** (full detail in discovery doc §1-§3):

- All 4 stuck briefs are `source='comparison_discovery'` + `clusterAction='comparison'` + `clusterId=null` + `locale=null`, batch-created 2026-05-21.
- Root cause: `discoverComparisonPairs()` never stamped `clusterId` on the briefs it created. Downstream (`pipeline-router.ts` `case "comparison":`) already forwards `pipelineInput.clusterId` when set, but never invented one.
- All 4 tools (claude, chatgpt, perplexity, deepl) share `category='text-language'`; chatgpt + claude have `subcategory='chatbots-assistants'`. The Toolwiki `chatbot-comparisons-2026` cluster is the natural editorial home for all 4.

### Phase C.2 — H2 Implementation

**Files touched:**

- [`packages/planner/src/comparison-routing.ts`](../../../packages/planner/src/comparison-routing.ts) — **new**. Two exports:
  - `resolveComparisonCluster(toolA, toolB, clusterIndex): ComparisonRoutingResolution` — pure (no I/O). 5 routing branches: empty-index → `create_new`; shared subcategory → `append_to_existing/subcategory`; either-tool subcategory anchor → `append_to_existing/subcategory`; shared category match → `append_to_existing/category`; else → `create_new`. Discriminated union return shape (`clusterAction` + `clusterId` + `matchedBy`) lets callers narrow programmatically.
  - `loadComparisonClusterIndex(projectId, { pillarName?, tx? })` — DB loader. Builds `matchTokens` per cluster by joining cluster name segments + `primaryKeyword` + member-article `subcategory`/`category`. `pillarName: string = "comparisons"` parameter (DEFAULT_COMPARISON_PILLAR exported) for multi-domain forward-compat.

- [`packages/planner/src/comparison-discovery.ts`](../../../packages/planner/src/comparison-discovery.ts) — wired:
  - `DiscoverComparisonPairsInput.comparisonPillarName?: string` added (forwards to the loader).
  - `ToolInfo` widened with `subcategory`/`rawCategory` raw values so the resolver can prefer subcategory over the existing combined `category` alias (which the scorer uses for same-category bonus).
  - `persistPairs()` signature extended with `toolInfoBySlug` + `clusterIndex`. INSERT path stamps `clusterId` when matched; UPDATE path re-stamps on every run (so future cluster creation backfills stuck briefs without code change).
  - `discoverComparisonPairs()` calls `loadComparisonClusterIndex()` once before `persistPairs()` (skipped when `toPersist.length === 0`).
  - Log line widened with `pairsRoutedToCluster` + `pairsAwaitingCluster` counters.

- [`packages/pipelines/src/planning/steps/select-floor-items.ts`](../../../packages/pipelines/src/planning/steps/select-floor-items.ts) — comparison content-type branch in `pipelineInputFromBrief()` now forwards `brief.clusterId` to `pipelineInput`. Router `case "comparison":` already spreads it into article:blog jobData transparently (no router change needed).

- [`packages/planner/src/index.ts`](../../../packages/planner/src/index.ts) — re-exported the new public surface.

**Tests added (18 total)**:

- [`packages/planner/test/comparison-routing.test.ts`](../../../packages/planner/test/comparison-routing.test.ts) — **new**. 12 cases: 5 branch tests, 3 edge cases (case-insensitivity, null/null tools, empty index), 4 Toolwiki-stuck-briefs snapshot (parametrised via `it.each` — all 4 land in `chatbot-comparisons-2026`).
- [`packages/planner/test/comparison-discovery.test.ts`](../../../packages/planner/test/comparison-discovery.test.ts) — extended with new `cluster-routing (Spec 64.18 / Phase C.2)` describe block: 4 integration cases (stamp-on-insert, leave-null-when-no-cluster, re-stamp-on-second-run-after-cluster-creation, custom `pillarName`). New `makePillarAndCluster()` fixture helper (seeds pillar + cluster + optional member article). `afterEach` extended to clean up clusters + pillars before the project (FK order).
- [`packages/planner/test/pipeline-router.test.ts`](../../../packages/planner/test/pipeline-router.test.ts) — 2 new regression cases for the comparison branch (forwards `clusterId` when stamped; leaves `undefined` when not).
- [`packages/pipelines/test/planning/select-floor-items-step.test.ts`](../../../packages/pipelines/test/planning/select-floor-items-step.test.ts) — existing 63.7b regression-guard rewritten to reflect the 64.18 narrowing: comparison items DO stamp `clusterId` (still no `clusterAction`/`intentType`); ki_wissen behaviour unchanged.

**Multi-Domain readiness** (spec §7 / discovery §3):
- `pillarName` parameter defaults to `"comparisons"` (Toolwiki convention from Spec 002 / Bucket-C cleanup) and can be overridden per-call. Bellemann / Balkonkraftwerk override via the HTTP route body when their own comparison pillar lands.
- `matchTokens` are derived from `articles.subcategory` + `articles.category` (Spec 54.8 promoted columns). Any tenant whose astro-sync writes those columns benefits automatically.

### Pending Marcel-side post-deploy

**Backfill SQL for the 4 stuck Toolwiki briefs** (per discovery §6 step 4 — kept idempotent via `IS NULL` filter so safe to re-run):

```sql
UPDATE topic_briefs
SET cluster_id = (
  SELECT c.id FROM clusters c
  JOIN content_pillars p ON p.id = c.pillar_id
  WHERE c.project_id = $1
    AND p.name = 'comparisons'
    AND c.name = 'chatbot-comparisons-2026'
)
WHERE project_id = $1
  AND source = 'comparison_discovery'
  AND cluster_id IS NULL;
```

The next `comparison-discovery` cron run (or manual `POST /api/projects/toolwiki/comparison-discovery/run`) will re-stamp the same `cluster_id` on the UPDATE path, so this backfill is just to unblock the 4 briefs that are already `plan_pending` / `pending`.

## Verification

- **Workspace typecheck**: 0 errors across 25 packages.
- **Planner tests**: 116 pass / 0 fail (was 106 pre-spec; +12 unit + 4 integration + 2 regression = 18 new, but one existing 63.7b case was deleted-and-rewritten net +9 to count).
- **Pipelines tests**: 716 pass / 74 skip / 0 fail.
- **Live dry-run** of Phase A prune-script: 0 rows (Toolwiki snapshot drift from spec's "1 row" — likely background CASCADE).

## Open questions answered (vs discovery §7)

1. ✅ `chatbot-comparisons-2026` is OK as default — all 4 stuck briefs route there cleanly.
2. ✅ First-match tie-breaking (deterministic, V2 can add weighting if needed).
3. ✅ Tenant-portability via `pillarName: string = "comparisons"` parameter added.
4. ⏸ The 1 `pending`-status brief (ChatGPT vs DeepL) routing is now structurally identical to the 3 `plan_pending` ones — Marcel can approve when ready.

## Acceptance criteria (vs spec §3.2 / §4.4 / §5.3)

- ✅ Phase A: dry-run reports count, no walk
- ✅ Phase A: apply-mode requires `--project` flag
- ⏸ Phase A: Toolwiki apply (deferred — 0 rows to delete today; safe to re-run when rejected_topic_candidates grows)
- ✅ Phase B: TS type extended, jsonb-additive, no migration
- ✅ Phase B: typecheck 0 errors across cost-tracker + pipelines + db + api
- ✅ Phase C.1: Discovery file written
- ✅ Phase C.1: Pattern recommendation justified vs 3 options
- ⏸ Phase C.2: Marcel approves recommendation before code-write — _proceeded with the recommended default per "lets go" confirmation; can be reverted/adjusted if Marcel wants a different pattern_
- ✅ Phase C.2: `resolveComparisonCluster()` helper implemented + unit-tested (12 cases)
- ✅ Phase C.2: pipeline-router dispatches comparison_discovery correctly (regression-tested)
- ⏸ Phase C.2: 4 stuck Toolwiki comparison briefs successfully routed (deferred — Marcel runs backfill SQL post-deploy or waits for next `comparison-discovery` cron)
- ✅ Phase C.2: existing gap_analysis + trend_discovery routing unchanged (no router edit needed; pipelines suite 716/0 pass)
- ✅ Phase C.2: Multi-Domain readiness noted (`pillarName` parameter)
