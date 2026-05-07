# Core Package

Domain logic that's not specific to API/worker/UI layers.

## Modules
- `credentials/`     Encrypted vault for tenant API credentials (Spec 02)
- `cost-tracker/`    Cost logging + hard limits (Spec 03)
- `cost/`            Cost enforcement: pre-flight budget checks, queue pause/resume, alert logging (Spec 41)

## Cost Enforcement Module (`src/cost/`)

- `checkCostBudget(projectId, service, estimatedCostEur)` — pre-flight check; returns `ok: true/false`
- `assertCostBudget(...)` — throws `CostLimitExceededError` + pauses queues if limit exceeded. Call this before every external API call in adapters.
- `estimateCostEur(service, operation)` — looks up conservative estimate from `COST_ESTIMATES_EUR`. Logs a warning if no entry found (returns 0 so check passes).
- `registerQueuePauser(pauseFn, resumeFn)` — called by `packages/pipelines` at queue init to inject BullMQ pause/resume callbacks without creating a circular dep. If not registered, DB state is still written on pause (queue won't be paused in Redis — acceptable if the API+worker run in the same process which calls `enqueuePipeline()`).
- Add new operation cost estimates to `COST_ESTIMATES_EUR` in `estimates.ts` when adding a new pipeline step.
- Use `COST_OPS` constants from `src/cost/operations.ts` for all operation strings — never hard-code them. Import via `import { COST_OPS } from "@marketing-auto/core/cost"`. `VALID_COST_OPS` set lets `estimateCostEur()` warn at runtime when an unknown operation is used.
- For multi-step pipelines where the trigger route needs a worst-case cost sum (e.g. schema-extension), pass `{ service, estimatedCostEur: sum }` to `triggerWithPreRunId` instead of `{ service, operation }`. Both shapes are accepted by `TriggerOptions`.

## Conventions
- All public APIs return `Result<T, E>` rather than throwing (use `@marketing-auto/shared/result`)
- All side-effecting functions are testable in isolation (no hidden globals)
- Sensitive data NEVER appears in logs, even at debug level

## Tests
- Run with `bun --filter @marketing-auto/core test`. The script `cd`s to repo root before invoking `bun test` so `.env` resolves correctly. Don't run `bun run test` from inside the package — same recursion gotcha as `packages/db`.

## Common Mistakes to Avoid
- DO NOT log credential payloads, even fragments
- DO NOT return decrypted credentials from public APIs/UIs — only used at moment of external call
- DO NOT pass credentials through HTTP responses except through dedicated, audited endpoints
- DO NOT add a new pipeline operation without also adding its cost estimate to `COST_ESTIMATES_EUR` in `src/cost/estimates.ts` — missing entries silently return 0 and skip budget enforcement
- DO NOT hard-code operation strings in pipeline steps or trigger routes — always use `COST_OPS.X` from `src/cost/operations.ts`. Hard-coded strings will also fail the `VALID_COST_OPS` guard and emit runtime warnings
- DO NOT define per-call dynamic operation strings (e.g. `article-research-serp-${keyword}`) without also adding a matching `COST_OPS` constant and a cost estimate — the SERP research step currently does this and silently produces 0-EUR estimates
- DO NOT use `string | undefined` when writing to nullable Drizzle columns in `onConflictDoUpdate.set` — `exactOptionalPropertyTypes` requires `null` for absent nullable fields. Build the set object conditionally (see `pauseProjectQueues` in `src/cost/pause.ts`)
