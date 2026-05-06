# Pipelines Package

The execution engine for all marketing pipelines. This is INFRASTRUCTURE — Phase 2+
specs build actual pipelines (article-generation, social-repurpose, identity-workshop)
on top of this.

## Key Concepts

**Step**: One unit of pipeline work. Has typed input/output, idempotency key, cost estimate.
**Pipeline**: Ordered list of steps. The output of step N becomes input of step N+1.
**Runner**: Executes a pipeline synchronously, persisting pipeline_runs rows.
**Queue**: BullMQ wrapper. Enqueue pipelines for async execution.
**Registry**: Pipelines must be registered at worker startup so BullMQ workers can find them.
**Scheduler**: Cron-style scheduled jobs (auth cleanup, daily briefings).

## Hard Rules

- Steps MUST be idempotent
- Steps MUST validate input/output via Zod
- Steps MUST use `@marketing-auto/cost-tracker` for any external API call
- Pipelines MUST be registered before workers start

## Adding a New Pipeline

1. Create `packages/pipelines/src/article/<pipeline-name>/` (or a peer directory under `src/`)
2. Create one file per step under `steps/`
3. Create `pipeline.ts` composing steps + bridges
4. Export from the directory's `index.ts`; re-export from `packages/pipelines/src/index.ts`
5. Register in `apps/api/src/workers/index.ts`
6. Trigger via `enqueuePipeline({ pipelineName: "...", projectId, input })`

## Cold-Start CLI Pipelines

Cold-start phases run synchronously via `runPipeline()` — no BullMQ, no worker registration.
Pattern: load project from DB → call `runPipeline()` → write output markdown to disk.

Steps live in `packages/pipelines/src/cold-start/<phase>/`, CLI scripts in
`apps/api/src/scripts/cold-start/`. Add the script as a `cold-start:<phase>` entry in
`apps/api/package.json` with `--env-file ../../.env`.

## DATA Blocks (cold-start inter-phase protocol)

Phases communicate via structured YAML embedded in markdown files using named DATA blocks:

```markdown
<!-- DATA:clusters BEGIN -->
- name: "Claude Marketing"
  status: proposed
<!-- DATA:clusters END -->
```

Use `parseDataBlock(md, "clusters", ZodSchema)` to read and `renderDataBlock("clusters", data)`
to write. Both live in `@marketing-auto/pipelines/cold-start/shared`. The next phase reads
only the DATA sections; Marcel can freely edit prose outside them.

## Adapter Dependencies in Steps

Steps that call external adapters must list those adapters in `packages/pipelines/package.json`
dependencies. They are NOT inherited from `apps/api`. Currently added: `adapter-anthropic`,
`adapter-dataforseo`. Run `bun install` after adding a new workspace dep or typecheck will fail.

## Test Script Caveat

DO NOT run `bun run test` from inside `packages/pipelines/` — Bun's CLI resolves
the same-named script before the `test` built-in, which triggers workspace broadcasting
and recurses across other packages. Always invoke via:

```
bun --filter @marketing-auto/pipelines test
```

The test script itself does `cd ../.. && bun test packages/pipelines/test` to ensure
the root `.env` is auto-loaded by Bun.

## Prompt Composition

All generative pipeline steps must use `buildSystemPrompt()` from
`@marketing-auto/pipelines` to assemble system prompts. The function
returns a stable `cacheablePrefix` (skill + project context) and a variable
`variableSuffix` (step instructions). Adapter implementations should pass
`cacheablePrefix` with `cache_control: { type: "ephemeral" }` to claim the
90% prompt-caching discount on Anthropic.

Never inline-concat skill content with step instructions yourself. The
caching boundary matters for cost and consistency.

## afterComplete Hook

`Pipeline` has an optional `afterComplete?(output, input): Promise<void>` hook called by the runner after all steps succeed. Use it for post-pipeline side-effects that must happen outside the step chain (e.g., auto-enqueuing a follow-up pipeline). The runner wraps it in its own `try-catch` — failures log a `warn` but do NOT mark the pipeline as failed or trigger BullMQ retries. If `afterComplete` fails silently, manual recovery is needed (e.g., `article:continue`).

## afterError Hook

`Pipeline` has an optional `afterError?(error, input): Promise<void>` hook called by the runner when any step throws. Use it for **guaranteed cleanup** — killing spawned processes, releasing locks, closing connections — that must happen even if the pipeline fails mid-run. Same try-catch semantics as `afterComplete`: cleanup failures log a `warn` and do not affect BullMQ retry counts.

```typescript
override async afterError(_error: unknown, _input: PipelineInput): Promise<void> {
  await this.killPreviewServer();  // example: PageSpeedValidationPipeline
}
```

## Zod `.default()` in Step Schemas

Zod's `.default(value)` makes the field's `_input` type `T | undefined` while `_output` stays `T`. Under `strictFunctionTypes`, TypeScript rejects this schema as `ZodType<TOutput>` in `BaseStep` because `_input` doesn't extend `TOutput`.

Fix: export a cast alias from the types file and use it for `inputSchema`/`outputSchema` assignments:

```typescript
// In types.ts — safe: .parse() always returns T; cast only affects the _input variance check
export const ArticleOutlineSchemaOutput = ArticleOutlineSchema as z.ZodType<ArticleOutline>;

// In the step file
readonly outputSchema = ArticleOutlineSchemaOutput;
```

The `.default()` behavior is preserved at runtime — use this pattern whenever a schema needs a default for LLM-output resilience.

## Testing Pipeline Steps

**Unit tests** (no LLM/API calls) call `step.execute(input, ctx)` directly against a real DB.
Use this `mockCtx` pattern:

```typescript
import { createLogger } from "@marketing-auto/shared";
import type { StepContext } from "../src/engine/step.ts";

const mockCtx = (projectId: string): StepContext => ({
  projectId,
  pipelineRunId: crypto.randomUUID(),
  stepRunId: crypto.randomUUID(),
  pipelineName: "test",
  log: createLogger("test"),
  reportProgress: async () => {},
  getStepOutput: () => undefined,
});
```

**Live-gated tests** (call real APIs) use `describe.skipIf`:

```typescript
const LIVE = process.env.RUN_LIVE_ARTICLE_PIPELINE === "1";
describe.skipIf(!LIVE)("MyStep (live)", () => { ... });
```

Run with: `RUN_LIVE_ARTICLE_PIPELINE=1 bun --filter @marketing-auto/pipelines test`

**Two gotchas to avoid:**

1. **`projectSlug` must match the DB slug exactly.** Steps that call `buildSystemPrompt`
   (Research, Outline, Draft, SelfReview) load the marketing context by `projectSlug`.
   Capture the slug from `beforeAll` and pass it through — never re-derive it:
   ```typescript
   // ✗ Wrong: doesn't match the slug inserted in beforeAll
   projectSlug: `my-test-${projectId.slice(0, 8)}`
   // ✓ Right: capture slug variable in beforeAll and use it
   projectSlug,
   ```

2. **Steps that mutate the article slug need `afterEach` cleanup.**
   `PersistOutlineStep` writes the LLM-chosen slug back to the articles row. If `beforeEach`
   re-inserts with the original slug, the next run hits the unique `(project_id, slug)` index
   when the step writes the same derived slug again. Use `afterEach` to delete by `articleId`.

**Integration tests** use `runPipeline()` (the synchronous runner) — no BullMQ worker needed.
Set `approvalMode: "manual"` to prevent `afterComplete` from calling `enqueuePipeline`.

## Common Mistakes

- DO NOT do business logic outside of `execute()` — it won't be tracked
- DO NOT skip cost-tracker for "small" calls — they accumulate
- DO NOT make a step do two things — split into two steps
- DO NOT mutate `ctx` — it's read-only from your perspective
- DO NOT call other steps directly — use `getStepOutput` or pipeline.bridge
- DO NOT put post-pipeline side-effects (like enqueuing a follow-up job) inside a step — use `afterComplete` instead so failures don't retry the entire pipeline
- DO NOT use `console.log`/`console.error` in `afterComplete` or `afterError` — these hooks have no `StepContext`, so declare a module-level `const log = createLogger("pipelines:my-pipeline")` at the top of `pipeline.ts` and use it there
