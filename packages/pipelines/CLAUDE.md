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

1. Create `packages/pipelines/src/templates/<pipeline-name>/`
2. Create one file per step
3. Create the pipeline class composing steps
4. Register in `apps/api/src/workers/index.ts`
5. Trigger via `enqueuePipeline({ pipelineName: "...", projectId, input })`

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
dependencies. They are NOT inherited from `apps/api`. Currently added: `adapter-anthropic`.
Add `adapter-dataforseo` when implementing phases that call DataForSEO.

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

## Common Mistakes

- DO NOT do business logic outside of `execute()` — it won't be tracked
- DO NOT skip cost-tracker for "small" calls — they accumulate
- DO NOT make a step do two things — split into two steps
- DO NOT mutate `ctx` — it's read-only from your perspective
- DO NOT call other steps directly — use `getStepOutput` or pipeline.bridge
