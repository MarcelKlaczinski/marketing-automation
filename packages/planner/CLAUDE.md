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

**Mix strategy (consumed by `SelectSocialPostItemsStep`):**
- ⅓ of target from today's planned clusters (parent-link via `parentDraftId`, slotDate inherited)
- ⅓ from `refresh_suggestions` (each row has an `articleId`)
- remainder from `pickFromSuggestionPool` (excluding article IDs already picked from the refresh pool)

Shortfall (`target - emitted`) is logged + surfaced in `generation_notes` so the user sees thin pools rather than missing items.
