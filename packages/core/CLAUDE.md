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
- DO NOT use `string | undefined` when writing to nullable Drizzle columns in `onConflictDoUpdate.set` — `exactOptionalPropertyTypes` requires `null` for absent nullable fields. Build the set object conditionally (see `pauseProjectQueues` in `src/cost/pause.ts`)
