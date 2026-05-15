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

## Topic Sources (Spec 54.1+)

`TopicSource<Input>` is a lighter-weight abstraction than `Pipeline` for anything that *produces data* rather than orchestrating a multi-step LLM workflow. Interface: one `emit(input, ctx): Promise<TopicBriefInsert[]>` method. Lives in `src/topic-sources/`.

**When to use TopicSource vs Pipeline:**
- `TopicSource`: single-concern data producers — gap analysis, RSS fetch, trend API call. No cost tracking, no step orchestration needed.
- `Pipeline`: multi-step workflows where each step has cost tracking, idempotency keys, and retries.

**Key invariant**: sources MUST NOT persist `TopicBriefInsert` rows themselves. The caller (route, worker, or import step) owns the `db.transaction()` so that dual-write atomicity is preserved. See `src/topic-sources/README.md`.

**Adding a new source**: see `src/topic-sources/README.md`.

## TopicRoutingPolicy (Spec 54.3)

`src/routing/` contains pure functions that map a `TopicBrief` to a DB action:

```typescript
import { decideRoute, executeDecision } from "@marketing-auto/pipelines";

const decision = decideRoute(brief);          // pure — no DB
const result = await db.transaction(async (tx) =>
  executeDecision(decision, brief, tx)        // transactional
);
```

**`decideRoute(brief): RoutingDecision`** — pure function, no I/O. Maps `brief.source + gapMetadata.gapType` to a discriminated union:
- `missing_hub` → `create_cornerstone_spec`
- `missing_spoke_type` → `create_article` (requires `intentType`)
- `cluster_too_small` → `create_article` (defaults `intentType` to `"use_case"`)
- `missing_translation` → `create_translation` (requires `translationKey + locale`)
- Non-gap_analysis source → `skip`

**`executeDecision(decision, brief, tx): Promise<RoutingResult>`** — runs inside a transaction passed by the caller. Inserts article/spec/translation AND marks the brief as `routed` atomically. For `skip` decisions, marks brief as `superseded`.

**`findBriefForArticle(articleId): Promise<TopicBrief | null>`** — looks up the `TopicBrief` linked to an article via `routedArticleId`. Used by `TopicIntakeStep` for brief-sourced keyword resolution.

**`RoutingNotImplementedError`** — thrown for `create_cluster` (Spec 54.7) and `refresh_article` (future). Field is named `routingKind` (not `kind` or `cause`) to avoid conflict with `Error.cause` reserved built-in.

**`Transaction` type** — `packages/db/src/client.ts` exports `type Transaction = Parameters<Parameters<DB["transaction"]>[0]>[0]`. Use it as the parameter type for any function that must run inside an existing Drizzle transaction (e.g. `executeDecision`). Never open a new transaction inside such a function — always receive `tx` from the caller so the boundary is composable.

**TopicIntakeStep brief-sourced path (Spec 54.3)**: `TopicIntakeStep` calls `findBriefForArticle()` first. If a brief is linked, `brief.secondaryKeywords` is used as satellite keywords. If no brief is found (legacy article created before 54.1), falls back to cluster `satelliteKeywords` match with a `log.warn`. Both paths produce identical output shapes — downstream steps are unaffected.

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

## Cold-Start UI Trigger Helpers (preRunId pattern)

When a UI needs a stable `runId` to poll immediately after enqueue (Spec 35+), use the **preRunId pattern** via the helpers in `packages/pipelines/src/cold-start/triggers.ts`:

```typescript
// canonical trigger helper shape
async function enqueueColdStartXxx(input: { projectId: string; ... }): Promise<{ runId: string; jobId: string }> {
  const runId = await createQueuedRun(projectId, 'cold-start:xxx', pipelineInput);  // INSERT pipeline_runs status='queued'
  const { jobId } = await enqueuePipeline({ ..., preRunId: runId });                 // worker UPDATEs that row to 'running'
  return { runId, jobId };
}
```

The `preRunId` flows through job data → `runPipeline()` UPDATEs the queued row instead of INSERTing. This avoids a second DB round-trip and gives the UI a runId before the worker picks up the job.

**Article pipeline variant (Spec 36+):** HTTP routes use a shared `triggerWithPreRunId` helper that does the `pipelineRuns` INSERT inline, then calls a thin enqueue wrapper from `packages/pipelines/src/article/trigger.ts`. The wrappers export `PreRunInput = { preRunId, articleId, projectId }` and call `enqueuePipeline` directly. Wrappers for pipelines that also write adapter-specific run tables (`enqueueArticleSyncPipeline`, `enqueuePagespeedValidationPipeline`) pre-create those rows **inside the wrapper** so the pipeline's `afterError` hook can find and settle them on failure.

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

## Project Config Resolvers (Spec 54.2+)

`src/config/` provides three resolver functions consumed by article generation steps and gap detection:

- **`loadActiveConfig(projectId)`** — loads the active `project_configurations` row for a project; 60s in-process cache; throws on missing config (system invariant).
- **`resolveMasterPrompt({ projectId, promptKey, fallback })`** — returns the DB override for a prompt key if set, otherwise the code-default fallback. Supported keys: `"article.outline"`, `"article.draft"`, `"article.self_review"`, `"article.localize.fresh"`, `"article.localize.translate"`.
- **`resolveIntentTaxonomy({ projectId, pillarId })`** — returns the pillar's `intent_taxonomy_override` if set, otherwise the project's `intent_taxonomy_default`.

**Pattern for any new article generation step:**
```typescript
// Keep the code default as a named constant for fallback
const MY_STEP_DEFAULT_PROMPT = `...static instructions...`.trim();
// OR inside execute() if the prompt uses runtime values (input.*, locale labels, etc.)

const stepInstructions = await resolveMasterPrompt({
  projectId: ctx.projectId,   // or input.projectId
  promptKey: "article.outline",
  fallback: MY_STEP_DEFAULT_PROMPT,
});
const prompt = await buildSystemPrompt({ ..., stepInstructions });
```

**Scoping rule:** if the prompt string uses runtime values (cluster name, locale, author list), the constant MUST be inside `execute()` — it cannot be a module-level const. If it's fully static, prefer module-level for readability.

## Prompt Composition

All generative pipeline steps must use `buildSystemPrompt()` from
`@marketing-auto/pipelines` to assemble system prompts. The function
returns a stable `cacheablePrefix` (skill + project context) and a variable
`variableSuffix` (step instructions). Adapter implementations should pass
`cacheablePrefix` with `cache_control: { type: "ephemeral" }` to claim the
90% prompt-caching discount on Anthropic.

Never inline-concat skill content with step instructions yourself. The
caching boundary matters for cost and consistency.

### `frontmatterSchema` injection (Spec 50)

`buildSystemPrompt()` accepts an optional `frontmatterSchema?: FrontmatterFieldDescriptor[]`
(imported from `@marketing-auto/db`). When provided, it appends a
"# Frontmatter Requirements" block to `cacheablePrefix` listing required/recommended
fields with their types, allowed values, and format hints. This block is project-level
(not per-article), so it benefits from Anthropic's prompt-cache TTL.

**Pattern** for any step that writes to an Astro collection:
1. `TopicIntakeStep`: loads `project.astroCollectionSchemas?.["blog"] ?? null` and
   returns it as `frontmatterSchema` in its output.
2. Downstream steps (`OutlineStep`, `DraftStep`): accept `frontmatterSchema` in
   `InputSchema` as `z.array(z.unknown()).nullable().optional()`, cast to
   `FrontmatterFieldDescriptor[]` when passing to `buildSystemPrompt()`.
3. `DraftStep` additionally instructs the LLM to output a
   `<!-- FRONTMATTER_EXTRAS: {...JSON...} -->` block at end of body; it parses
   this, strips it from `bodyMd`, and saves to `articles.frontmatterExtras`.
4. **Tool spotlight fields (Spec 54l):** When `intentType` is `overview`, `features`, `review`, `pricing`, or `use-cases` AND `primaryTool` is set, `DraftStep` also emits `pros`, `cons`, `features`, `useCases`, `pricingTier`, `priceFrom`, `rating` in `FRONTMATTER_EXTRAS`. These fields are required for `single-tool-spotlight` eligibility. Articles with `intentType: "general"` or `"tutorial"` do not get these fields — by design.

### Tagged-block output pattern (multi-field LLM responses)

When a step needs the LLM to return multiple distinct fields (e.g. localization: title,
slug, outline JSON, body, extras), instruct it to wrap each field in XML-like tags and
parse with a `parseBlock()` helper:

```typescript
function parseBlock(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, "i");
  const m = text.match(re);
  if (!m) return null;
  return m[0].replace(new RegExp(`^<${tag}>\\s*`, "i"), "")
             .replace(new RegExp(`\\s*<\\/${tag}>$`, "i"), "").trim();
}
// Usage: parseBlock(raw, "TITLE") ?? fallback
```

Always provide a fallback for every `parseBlock()` call — the LLM may omit a tag
under token pressure. See `src/article/localize/pipeline.ts` for the canonical example.

### HubCarousel MDX injection (DraftStep post-processing)

`DraftStep` injects the `HubCarousel` Astro component into every generated draft:
- Import statement prepended at the top of `bodyMd`
- `<HubCarousel excludeSlug="...">` inserted before the last `##` heading (= Fazit position)
- Idempotent: skips injection if `"HubCarousel"` already appears in the body

This must be preserved when adding post-processing steps — do not strip or move the
import. The component is required by the Astro blog layout for cluster navigation.

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

**Same problem at the Pipeline level** (not just steps): if a Pipeline `inputSchema` has any `.default()` field, TypeScript rejects the schema as `Pipeline<Input, Output>` for the same reason. Fix: declare a `type PipelineInput` explicitly, then cast the schema:

```typescript
// pipeline.ts
type PipelineInput = {
  projectSlug: string;
  approvedClusters: ApprovedCluster[];
  projectId?: string;
  locales: ("de" | "en")[];  // has a .default() — must use type cast
};

const InputSchema = z.object({
  projectSlug: z.string(),
  approvedClusters: z.array(ApprovedClusterSchema).min(1),
  projectId: z.string().optional(),
  locales: z.array(z.enum(["de", "en"])).default(["de", "en"]),
}) as z.ZodType<PipelineInput>;

class MyPipeline extends Pipeline<PipelineInput, ...> {
  readonly inputSchema = InputSchema;  // ← no TS error
}
```

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

**Testing `afterComplete` in isolation**: if you only need to verify hook behaviour (e.g. a follow-up enqueue) without running the full pipeline, call the method directly on a pipeline instance:

```typescript
const pipeline = new MyPipeline();
await pipeline.afterComplete(fakeOutput, fakeInput);
// assert DB side-effects here
```

This works whenever the hook's side-effect (DB insert, queue enqueue) precedes any Redis/BullMQ call. If BullMQ is unavailable the DB write still happens and the error is swallowed by `afterComplete`'s internal try-catch. See `ArticleSyncPipeline` / `enqueueClusterLinkRebuild` for the canonical example.

**Three more gotchas to avoid:**

3. **Spreading two detection fixtures silently zeroes out array fields.** If you have `FAQ_DETECTION` (with questions) and `HOWTO_DETECTION` (with `faqQuestions: []`), then `{ ...FAQ_DETECTION, ...HOWTO_DETECTION, hasFaq: true }` produces `faqQuestions: []` — the spread overwrites. Always build merged inputs field-by-field:
   ```typescript
   // ✗ Wrong — faqQuestions becomes []
   { ...FAQ_DETECTION, ...HOWTO_DETECTION, hasFaq: true, hasHowTo: true }
   // ✓ Right
   { hasFaq: true, hasHowTo: true, faqQuestions: FAQ_DETECTION.faqQuestions, howToSteps: HOWTO_DETECTION.howToSteps, ... }
   ```

4. **Pipelines with `afterComplete` auto-triggers break status assertions in integration tests.** If `afterComplete` transitions the article (e.g., `final_review` → `schema_extending`), a test that asserts `status === "final_review"` immediately after `runPipeline` will fail. Assert both statuses: `expect(["final_review", "schema_extending"]).toContain(saved!.status)` with a comment explaining why.

## Cost Enforcement Integration (Spec 41)

`getPipelineQueue()` registers the BullMQ pause/resume callbacks with `registerQueuePauser` from `@marketing-auto/core/cost`. This must fire before any cost limit can be hit, so:

- `startPipelineWorker()` calls `getPipelineQueue()` at startup to ensure registration happens even in worker-only processes.
- `enqueuePipeline()` also calls `getPipelineQueue()`, so API+worker combined processes are covered.

If `registerQueuePauser` is never called (e.g., a process that imports `assertCostBudget` but never initializes a queue), the DB pause state is still written — but Redis `queue.pause()` is not called. The trigger-layer check (`isProjectPaused`) will still block new jobs. This is acceptable but means already-queued jobs may start.

## Common Mistakes

- DO NOT do business logic outside of `execute()` — it won't be tracked
- DO NOT skip cost-tracker for "small" calls — they accumulate
- DO NOT make a step do two things — split into two steps
- DO NOT mutate `ctx` — it's read-only from your perspective
- DO NOT call other steps directly — use `getStepOutput` or pipeline.bridge
- DO NOT put post-pipeline side-effects (like enqueuing a follow-up job) inside a step — use `afterComplete` instead so failures don't retry the entire pipeline
- DO NOT use `console.log`/`console.error` in `afterComplete` or `afterError` — these hooks have no `StepContext`, so declare a module-level `const log = createLogger("pipelines:my-pipeline")` at the top of `pipeline.ts` and use it there
- DO NOT create an external audit row in a trigger function without also wiring `afterComplete`/`afterError` on the pipeline to settle its `status`, metric columns, and `finishedAt`. Thread the row ID through the pipeline input schema as an optional field so the pipeline can find and update the row. See `ClusterLinkRebuildPipeline` + `enqueueClusterLinkRebuild` in `internal-linking/` for the pattern.
- DO NOT hardcode audience/market/search-engine strings in Cold-Start step instructions — read `projects.targetLocales` from DB inside `execute()` and use `buildLocaleContext()` from `src/cold-start/_lib/locale-context.ts` to derive locale-specific values. The locale DB query adds one fast indexed read per step; it's intentional. See `IdentifyCompetitorsStep` and `GenerateClusterCandidatesStep` for the pattern.
- DO NOT use `article:localize` in translate mode when the source article has no `bodyMd` — the API gate returns 422, but step code also throws. Always generate the draft pipeline first. Use `fresh` mode to create a stub article without a body, then generate outline + draft independently for the target locale.
- DO NOT call `await import("sharp")` and use the result directly as a function — Bun/ESM returns `{ default: fn }`, not `fn`. Calling the namespace throws `TypeError` which the per-variant try-catch swallows, producing `variantCount: 0` silently. Always extract `.default`: `const sharpFn = (mod as unknown as { default: SharpCallable }).default`. See `hero-generation/pipeline.ts` for the canonical pattern.
- DO NOT enqueue article pipelines without a stable `jobId` in `jobOptions` — BullMQ assigns a UUID by default, allowing the same logical job to be queued multiple times if the UI retriggers quickly. Set `jobId: \`pipeline-name-${articleId}\`` in all `enqueuePipeline()` calls. See `packages/pipelines/src/article/trigger.ts` for all 8 article pipelines.
- DO NOT exceed 8192 tokens per LLM call when using claude-sonnet-4-6 — that model's hard `MAX_OUTPUT_TOKENS` cap is 8192. Long article translations (body + outline + extras) must be split into at least two calls; throw explicitly when `stopReason === "max_tokens"` so the failure is visible rather than silently truncated. See `article/localize/pipeline.ts` two-call split pattern.
- DO NOT query by `translationKey` alone in multi-tenant pipelines — translationKeys are project-scoped by convention but not enforced by a DB constraint. Always add `eq(articles.projectId, input.projectId)` alongside `eq(articles.translationKey, ...)` to prevent cross-tenant sibling matches. See `hero-generation/pipeline.ts` `afterComplete`.
- DO NOT assume `packages/pipelines/src/article/social-image/hookPrompt.ts` is dead code — it is an active, separate code path from `packages/core/src/social-hooks/hookPrompt.ts`. The pipelines version (`buildHookPrompt`) handles hook-only generation for the social-image pipeline's `GenerateHookStep`. The core version (`buildContentPrompt`) handles hook+caption+hashtags for the newer `generateContentWithGate` flow used by template definitions. Two different call sites, two different prompt shapes.
- DO NOT extract a `*_DEFAULT_PROMPT` constant to module level when the prompt string uses runtime values (`input.*`, locale labels, author lists, etc.) — template literals with variable interpolation must be scoped inside `execute()` or a private method. Module-level constants only work for fully static prompts (no interpolation). Both placements are valid; the name is what matters for clarity. See `SelfReviewStep` (static = module-level) vs `OutlineStep` (dynamic = inside execute) for examples.
