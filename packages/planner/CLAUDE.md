# Planner

Home for Planner-Foundation code shared between API routes and the Planner-Engine (62.4).
Originally split out of `packages/cost-tracker` in Spec 62.3.5.

## Dependency direction

- `packages/planner` MAY depend on `@marketing-auto/cost-tracker` (directed, no cycle)
- `packages/planner` MUST NOT depend on `@marketing-auto/pipelines` (Lesson D15 from 62.0a — pipelines depends on cost-tracker for `track()`; planner depending on pipelines would chain a cycle once pipelines also consumes planner in 62.4)
- Allowed deps: `@marketing-auto/db`, `@marketing-auto/shared`, `@marketing-auto/cost-tracker`, `drizzle-orm`, `zod`
- The pipeline-step lookup is injected via a `PipelineStepResolver` callback — same DI pattern as `estimateWeeklyPlanCost` in cost-tracker

## Tests

- Run with `bun --filter @marketing-auto/planner test`
- DO NOT run `bun run test` from inside this package — Bun resolves the same-name script before the built-in and recurses (same gotcha as cost-tracker / db / api)

## Project Goal Validator (Spec 62.2)

`validateProjectGoals(projectId, { resolvePipelineSteps? })` is the canonical pre-flight check for the Content Planner (Spec 62.4). Loads `project_goals` + `project_planner_config`, runs sanity checks, and returns:

```typescript
{
  valid: boolean;                                  // true iff errors.length === 0
  errors: Array<{ code, message, details? }>;      // 5 codes; see GOAL_VALIDATION_ERROR_CODES
  warnings: Array<{ code, message, details? }>;    // 3 codes; see GOAL_VALIDATION_WARNING_CODES
  resolvedGoals: ProjectGoal[];
  config: ProjectPlannerConfig | null;
  estimatedWeeklyFloorEur: number | null;          // null if no config or no goals
}
```

**Error codes:** `NO_GOALS_DEFINED`, `NO_PLANNER_CONFIG`, `FLOOR_EXCEEDS_BUDGET`, `INVALID_CADENCE_UNIT`, `INVALID_MIN_MAX`.
**Warning codes:** `FLOOR_NEAR_BUDGET` (≥85% of budget), `SUB_BUDGETS_OVER_GLOBAL`, `ALL_GOALS_INACTIVE_OR_ZERO`.

**`CONTENT_TYPE_TO_PIPELINE` map**: each `content_type` is expanded into N synthetic `PlannedItem` rows for `estimateWeeklyPlanCost` (e.g. `cluster` → `cluster:full-plan`, `comparison`/`ki_wissen` → `article:blog`, `social_post` → `article:social-image`). When adding a new content type to the `CONTENT_TYPES` enum in `packages/shared/src/types/project-goals.ts`, also extend the map in `goal-validator.ts` or cost estimation will return 0 for that type.

**Pipelines-cycle avoidance**: the validator never imports from `@marketing-auto/pipelines`. API routes wire pipeline lookups via the `resolvePipelineSteps` callback (`(name) => pipelineRegistry.get(name)?.steps`); CLI scripts can omit the callback and fall through to historical/default tiers.

## Social-Source Selectors (Spec 62.4-followup Issue 2)

`src/social-source-selectors.ts` provides three pure DB readers consumed by `SelectSocialPostItemsStep` in `packages/pipelines`. They follow the same DI pattern as the trend-discovery readers — return raw row data, never persist, never call adapters.

```typescript
import {
  pickFromRefreshSuggestions,   // active refresh_suggestions, newest-first
  pickFromSuggestionPool,        // published DE articles with no recent template_render
  countSuggestionPool,           // size check for capacity planning
} from "@marketing-auto/planner";
```

**`pickFromRefreshSuggestions({ projectId, limit })`** — JOINs `refresh_suggestions` against `articles`, filters `dismissed_at IS NULL AND approved_at IS NULL`, orders by `generated_at DESC`. Returns `{ suggestionId, articleId, generatedAt }[]`.

**`pickFromSuggestionPool({ projectId, limit, excludeArticleIds?, recentRenderCutoff? })`** — selects published `locale='de'` articles whose latest `template_renders.created_at` is older than `recentRenderCutoff` (default: 14 days ago). The `NOT EXISTS (SELECT 1 FROM template_renders WHERE article_id = ... AND created_at > $cutoff)` subquery is built via Drizzle's `sql` template (Drizzle's `inArray`-style helpers don't compose inside a correlated subquery). `excludeArticleIds` uses `sql.join(ids.map(id => sql\`${id}\`), sql\`, \`)` to parametrise the exclusion list — keeps Drizzle's parameter binding intact, no SQL injection vector.

**Template-eligible collections filter (Spec 63.2, supersedes 63.1):** all three readers (`pickFromRefreshSuggestions`, `pickFromSuggestionPool`, `countSuggestionPool`) filter on `inArray(articles.collection, SOCIAL_ELIGIBLE_COLLECTIONS_ARR)`. The constant `SOCIAL_ELIGIBLE_COLLECTIONS` lives in `src/social-eligible-collections.ts` and currently lists `["tools", "comparisons"]` — the only collections with at least one rendering template. The filter is an allow-list, so `authors` (Spec 63.1's concern) is excluded by virtue of not being in the list; `ki-wissen`, `usecases`, and plain `blog` are excluded for the same reason. The relevant column is `articles.collection` (text, NOT NULL, default `'blog'`) — NOT the `collection_type` enum (which has no "authors" value). When adding a future social source reader against `articles`, replicate the `inArray()` filter — the canonical comment is `// Spec 63.2: only collections with at least one social template.`. When a Phase-E template lands that covers `ki-wissen` or `usecases`, extend `SOCIAL_ELIGIBLE_COLLECTIONS` in one place. Pool-filtering deliberately stays at collection level (cheap, deterministic); per-article eligibility (tool count, pro/con count, etc.) is enforced downstream by the template registry.

**DO NOT narrow `SOCIAL_ELIGIBLE_COLLECTIONS` without auditing test fixtures** — every test that seeded a "should be included" article with the previous baseline collection (e.g. `collection: "blog"`) will silently start returning empty results once the value drops out of the allow-list. The fixture rows in `packages/planner/test/social-source-selectors.test.ts` use `collection: "tools"` as the canonical eligible baseline; reuse that when extending coverage. Caught during 63.2 implementation — four pre-existing 63.1 fixtures had to bump `"blog"` → `"tools"`.

**Mix strategy (consumed by `SelectSocialPostItemsStep`):**
- ⅓ of target from today's planned clusters (parent-link via `parentDraftId`, slotDate inherited)
- ⅓ from `refresh_suggestions` (each row has an `articleId`)
- remainder from `pickFromSuggestionPool` (excluding article IDs already picked from the refresh pool)

Shortfall (`target - emitted`) is logged + surfaced in `generation_notes` so the user sees thin pools rather than missing items.

## Pipeline Router (Spec 62.8 + 63.7b + 64.18)

`getPipelineForItem(item, llmMode)` in `src/execution/pipeline-router.ts` is the pure routing function consumed by `executePlan()`. Returns a `RoutedJob` discriminated union (`kind: "enqueue"` for BullMQ-backed pipelines, `kind: "inline"` for free-function pipelines like `cluster:full-plan` per Memory D127). The router reads `planned_items.pipeline_input` (jsonb) for routing decisions — never re-queries.

**Cluster items branch on `pipelineInput.clusterAction` since Spec 63.7b:**
- `"append_to_existing"` + `clusterId` set → `enqueue article:blog` with `collectionType` derived from `intent_type` (knowledge → ki-wissen, use_case → usecases, default → blog). The resulting article becomes a spoke under the existing cluster via `articles.cluster_id` (already wired by `persist.ts:40`).
- `"create_new"` (or any legacy planned_item missing the stamped fields) → `inline cluster:full-plan` (unchanged behaviour).
- Missing `clusterId` despite `append_to_existing` → falls through to `cluster:full-plan` (safe default for misclassified briefs).

**Three fields must be stamped into `pipelineInput` at plan-generation time** for the router to make the decision: `clusterAction`, `clusterId`, `intentType`. The select step (`SelectFloorItemsStep`) stamps all three for `contentType === "cluster" | "cluster_spoke"`; for `"comparison"` it stamps only `clusterId` since 64.18 (see Comparison-Pair Discovery section).

**`pipelineNameForItem()` in `select-floor-items.ts` must mirror the router's predicate** — when `append_to_existing` + `clusterId`, the persisted `planned_items.pipeline_name` becomes `article:blog` (not `cluster:full-plan`) so the cost estimator's tier-1 step-sum reflects the cheaper spoke cost. If you change the router's cluster-branch predicate, change `pipelineNameForItem` in lockstep.

**`collectionType` in jobData MUST be an `ArticleCollectionType` enum value, NOT the Astro folder name.** I.e. `"comparison"` (singular) not `"comparisons"` (plural). `BlogPipelineInputSchema` validates against the enum and rejects the folder name. Pre-63.7b this was dead code (executor dropped `collectionType` before `enqueueBlogGeneration`) and the typo went undetected. Since 63.7b the value is threaded through, so `deriveCollectionFromIntent` returns `ArticleCollectionType` and the comparison/ki_wissen branches assign via a typed `const collectionType: ArticleCollectionType` to keep the typo out at compile time. The Astro folder mapping (`"comparison"` → `"comparisons"`) happens later in `COLLECTION_ASTRO_NAME` inside the article pipeline.

## Comparison-Pair Discovery (Spec 62.3 + 63.3b + 64.18)

`discoverComparisonPairs({ projectId, ...weights })` produces pending `topic_briefs` with `source='comparison_discovery'` from co-mention matrices in `article_discovery`. Algorithm + persistence detailed in `src/comparison-discovery.ts` header. Two things callers commonly want to tune:

**Score knobs** are exposed on `DiscoverComparisonPairsInput` (Spec 63.3b):

```typescript
discoverComparisonPairs({
  projectId,
  minScore: 0.3,                 // threshold for persistence
  coMentionWeight: 0.4,          // raw popularity component
  categoryOverlapBonus: 0.4,     // same-category boost
  crossCategoryPenalty: 0.05,    // cross-category penalty (subtracted)
  recencyWeight: 0.2,            // mostRecentMentionAt freshness
});
```

Defaults shift weight toward semantic fit (same-category) over raw popularity. The pure `computePairScore(inputs, weights?)` is exported for unit testing the formula without DB fixtures. The HTTP route `POST /api/projects/:slug/comparison-discovery/run` accepts these in the request body too — Marcel can re-tune live before letting the weekly cron run.

**Weekly cron** is registered by `apps/api/src/workers/comparison-discovery.worker.ts` (job_type `comparison_discovery`, default Sunday 06:00 UTC, OFF). The worker calls `discoverComparisonPairs()` directly — it's a free function, not a registered pipeline, so no `triggerWithPreRunId` / `pipeline_runs` row is involved. Settings UI lives in `SettingsPlannerPage.vue`; the toggle is independent of the planner cron's validity gate since discovery only writes pending briefs (no cost / no planned_item).

**`loadToolInfo()` category-lookup uses Spec 54.8 promoted columns, NOT `domainExtras`** — `articles.category` and `articles.subcategory` are dedicated text columns lifted out of the Astro frontmatter by `adapter-astro-sync` during `upsertArticles`. The original 63.3a code read `domainExtras.category` and silently returned `undefined` for every Toolwiki tool, defeating the same-category bonus. Lookup precedence is now: `articles.subcategory` (13 buckets, ≥3 tools each — the editorial taxonomy) → `articles.category` (7 buckets, fallback) → `domainExtras.primaryCategory` (legacy). When extending the lookup for other projects (Bellemann, Balkonkraftwerk affiliate) verify whether their astro-sync setup promotes equivalent columns or if a different field needs to be added to the cascade.

**Cluster-routing at brief-creation (Spec 64.18)** — `persistPairs()` calls `resolveComparisonCluster(toolA, toolB, clusterIndex)` (pure helper in [`src/comparison-routing.ts`](src/comparison-routing.ts)) and stamps the resulting `clusterId` directly on the brief. Before 64.18 every comparison_discovery brief landed with `cluster_id = NULL` and its eventual article was orphaned from any hub-spoke. Routing precedence (sibling to 63.4's pgvector Hub-Spoke for trend briefs, but structured-input not vector):

1. Both tools share `subcategory` → cluster whose `matchTokens` contain it → `append_to_existing`.
2. Either tool's `subcategory` matches a cluster (chatbot-anchor pattern: "Claude vs DeepL" → `chatbot-comparisons-2026`).
3. Shared `category` match → cluster whose `matchTokens` contain it.
4. No match → `clusterAction: 'create_new'` (the downstream `pipeline-router` `case "comparison":` accepts both routed and unrouted, so unmatchable pairs still flow through).

`matchTokens` per cluster are pre-built once by `loadComparisonClusterIndex(projectId, { pillarName? })` from cluster `name` segments + `primaryKeyword` + member-article `subcategory`/`category`. The loader is DI-friendly (accepts `tx`) and `pillarName` defaults to `"comparisons"` — Bellemann / Balkonkraftwerk pass a different slug via the `DiscoverComparisonPairsInput.comparisonPillarName` knob (forwarded by the HTTP route body).

**Re-stamp on every run (late-binding resolver)** — `persistPairs()`'s UPDATE branch re-applies `routing.clusterId` on every discovery run. If a matching cluster is created *after* a brief was first persisted with `cluster_id = NULL`, the next discovery run backfills the brief without manual SQL. Pattern is reusable any time a resolver depends on world-state that may post-date the row insert (e.g. tag → cluster lookups, author → project assignment).

**Two `clusterAction` namespaces — don't confuse them.** `topic_briefs.cluster_action` is the brief-side discriminator (text column with values `"create_new" | "append_to_existing" | "comparison" | "standalone"`). The Spec 64.18 resolver's `ComparisonClusterAction` is the routing-decision discriminator (`"append_to_existing" | "create_new"`). Comparison briefs keep `clusterAction: "comparison"` on the row (planner content-type marker); only `clusterId` is mutated by the resolver. Don't UPDATE the row's `clusterAction` from the resolver's output — it's a different semantic axis.

**Comparison branch stamps `clusterId` (Spec 64.18, narrows 63.7b).** The `case "comparison":` spreads `pipelineInput` into the article:blog jobData, so any field stamped at plan-time flows through. `SelectFloorItemsStep.pipelineInputFromBrief()` now stamps `clusterId` for comparison content_type (was: cluster + cluster_spoke only). `clusterAction` and `intentType` stay scoped to the cluster branch because they're the inline-vs-enqueue discriminator there; the comparison branch unconditionally enqueues so they're unused.
