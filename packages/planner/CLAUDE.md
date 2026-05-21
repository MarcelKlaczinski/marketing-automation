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
