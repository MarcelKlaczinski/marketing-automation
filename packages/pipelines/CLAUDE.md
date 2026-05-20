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

## Standalone BullMQ Workers (Spec 58.1)

Not every async job runs through the pipeline engine. For jobs that are NOT multi-step pipelines (e.g. a single LLM call per article), use a **standalone BullMQ worker** pattern:

1. **Queue definition** in `packages/pipelines/src/engine/<name>-queue.ts` — exports `getQueue`, `enqueue`, `close`, `JobData`, `JobResult`, `PerJobData` (specific shape without the cron-batch variant)
2. **Worker** in `apps/api/src/workers/<name>.worker.ts` — imports queue from the subpath, discriminates two job shapes via Zod `.safeParse()`:
   - **Cron-batch variant** (`{ type: "cron-triggered", projectId }`) — fans out per-item jobs
   - **Per-item variant** (`{ articleId, projectId, projectSlug }`) — does the actual LLM work
3. **Union type** for `JobData` in the queue file, plus a separate `PerJobData` type for callers that only enqueue per-item jobs (avoids exposing `type: "cron-triggered"` to those call sites)
4. **Subpath export** in `packages/pipelines/package.json` + matching `paths` entry in `apps/api/tsconfig.json`
5. **Cron registration** in `apps/api/src/workers/cron-orchestrator.ts` (4 places: type union, `getQueueForJobType`, `allQueues`, `isCronOrchestrated`)

See `packages/pipelines/src/engine/article-quality-analysis-queue.ts` + `apps/api/src/workers/article-quality-analysis.worker.ts` for the canonical example.

## External Signal Sources (Spec 54.4+)

`ExternalSignalSource<Input>` is a parallel abstraction to `TopicSource` for fetching raw external signals (PH launches, HN posts, RSS items). Lives in `src/signal-sources/`.

Interface (three required members):
```typescript
interface ExternalSignalSource<Input = unknown> {
  readonly source: ExternalSignalSourceValue;   // must match DB enum
  readonly inputSchema: z.ZodType<Input>;        // Zod validates + applies defaults
  fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]>;
}
```

**Key invariants:**
- MUST NOT persist — the BullMQ worker owns the `db.transaction()` + `onConflictDoNothing`
- MUST set `externalId` to the source's stable per-entity ID (dedup key)
- No cost tracking required — these adapters call free public APIs (€0/day)
- Caller passes `{} as never` for adapters that rely entirely on Zod `.default()` input fields; Zod `.parse()` inside `fetch()` applies the defaults at runtime

**`as z.ZodType<Input>` cast pattern** — required whenever `inputSchema` has `.default()` fields. Zod `.default()` makes `_input` type `T | undefined`, which fails `ZodType<T>`. Split into `_Schema` + cast alias:
```typescript
const _InputSchema = z.object({ topic: z.string().default("artificial-intelligence") });
type Input = z.infer<typeof _InputSchema>;
const InputSchema = _InputSchema as z.ZodType<Input>; // resolves exactOptionalPropertyTypes variance
```

**Implemented sources:**
| Adapter | Package | Cron job type | Free? |
|---------|---------|---------------|-------|
| HackerNews (Algolia) | `@marketing-auto/adapter-hackernews` | `signal_collector_hackernews` | ✅ |
| ProductHunt | `@marketing-auto/adapter-producthunt` | `signal_collector_producthunt` | ✅ |
| Vendor RSS | `@marketing-auto/adapter-vendor-rss` | `signal_collector_vendor_rss` | ✅ |
| Reddit OAuth | `@marketing-auto/adapter-reddit` | `signal_collector_reddit` | ✅ |

**Reddit specifics:** OAuth2 `client_credentials` flow. Token cached per `clientId` (60s pre-expiry buffer). Credentials stored via `global_credentials` service=`"reddit"`, keys: `client_id`, `client_secret`, `user_agent`. Default: 9 AI/SaaS subreddits, `sortMode=top`, `timeWindow=week`. Stickied + NSFW posts filtered before returning. Rate-limit header `x-ratelimit-remaining` parsed and logged; 429 throws `RedditApiError(status=429)`. Live test: `RUN_LIVE_REDDIT=1 REDDIT_CLIENT_ID=... bun --filter @marketing-auto/adapter-reddit test`.

**Adding a new source**: create `packages/adapters/<name>/`, implement `ExternalSignalSource<Input>`, add the adapter to the `collect-adapter` switch in `signal-collector.ts`, and register it in `handleCollectProject()`.

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

- **`loadActiveConfig(projectId)`** — loads the active `project_configurations` row for a project; 60s in-process cache; throws on missing config (system invariant). Parses `topicScope` and `masterPrompts` JSONB fields through their Zod schemas on every cache miss — Zod `.default()` values are applied to rows stored before new fields were added (spec 54.5b forward-compat fix).
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

## Refresh + Translation Pipelines (Spec 54.10 + 59.2)

### article:refresh

`article:refresh` re-generates an existing article in place, preserving the original body in `article_versions` before any LLM call. 8 steps: `RefreshIntakeStep` → `ToolRelevanceStep` → `OutlineStep` → `PersistOutlineStep` → `DraftStep` → `PersistBodyStep` → `ToolLinkerStep` → `SelfReviewStep`.

Key invariants:
- `RefreshIntakeStep` (step 1) persists `article_versions` **before** any LLM call (Decision 14: defensive ordering)
- Outline + Draft receive `sourceContext` (refresh framing) + `voiceContext` (original body excerpt + peer refs) combined into a single `sourceContext` field via `[a, b].filter(Boolean).join("\n\n")`
- Article status stays at `published` — `PersistArticleStep` is NOT used; the refresh updates `bodyMd`/`wordCount`/`outline` in place via `PersistBodyStep` + `ToolLinkerStep`
- `afterComplete` enqueues schema extension, then propagates to the sibling (any locale) via `enqueueTranslationPipeline(mode: "refresh_propagation")` if one exists — bidirectional since Spec 59.2

### article:translation

`article:translation` generates a target-locale sibling from an existing source article. Works bidirectionally: DE→EN and EN→DE. Three modes:
- `fresh_translation` — creates target article stub, then generates body
- `refresh_propagation` — re-translates existing sibling after source refresh
- `manual_resync` — user-triggered re-sync; re-translates existing sibling

7 steps: `TranslationSetupStep` → `TranslationDecisionStep` → `TranslationBodyStep` → `PersistBodyStep` → `ToolLinkerStep` (target locale) → `SelfReviewStep` → `PersistArticleStep`.

`TranslationDecisionStep` (Haiku 4.5) classifies source content as `"literal"` (universal) or `"adaptive"` (locale-specific). Uses different adaptive markers per direction: `DE_TO_EN_ADAPTIVE_MARKERS` (DSGVO, BaFin, Mittelstand) and `EN_TO_DE_ADAPTIVE_MARKERS` (HIPAA, USD-only pricing, Silicon Valley framing). `TranslationBodyStep` handles both paths: one Sonnet call for literal, Sonnet outline + Sonnet draft for adaptive.

Auto-triggered from `BlogPipeline.afterComplete` when `project.targetLocales` includes the opposite-locale BCP-47 tag (`"en-US"` or `"de-DE"`) AND `project.translationAutoTrigger === true` (default). Sibling-existence is checked before enqueuing to avoid duplicate creation.

**Step I/O field names are locale-neutral (Spec 59.2):** `TranslationSetupOutput` uses `sourceBodyMd`, `sourceTitle`, `targetArticleId`, `sourceLocale`, `targetLocale`, `sourceHeroR2Key`, `sourceFrontmatterExtras`, etc. — NOT the old DE-named fields (`deBodyMd`, `enArticleId`). The bridge in `pipeline.ts` uses these neutral names throughout.

**`TranslationSetupStep` must carry all source fields the target article reuses:** hero image R2 key/URL/alt + `schemaJsonLd`. These are not re-generated; the bridge copies them into `persist-article` input. If omitted, target articles get empty hero and `schemaJsonLd: [{}]`.

**`TranslationBodyStep` outputs `targetTitle`, `targetMetaDescription`, `targetTags`** in addition to the body. Both literal and adaptive paths request `<TITLE>`, `<META_DESCRIPTION>`, and `<TAGS>` blocks at the end of the LLM response. The bridge derives `targetSlug = slugify(targetTitle)` and writes it to both the DB `articles.slug` column and `frontmatterExtras.slug`.

**`LANG_INDEPENDENT_EXTRAS` must NOT include `"category"` or `"subcategory"`** — those are human-readable strings that may be locale-specific (e.g. "Praxis & Use Cases" in DE). Target locale categories should be generated by the LLM or left blank. Only copy truly locale-neutral values: enum-style fields (`intentType`, `bottomLinksVariant`, etc.) and numeric/boolean fields (`pricingTier`, `rating`, `priceFrom`, `pros`, `cons`, `features`, `useCases`, `toolSlugs`, etc.).

**`TranslationPipeline.afterComplete` calls `checkClusterCompletion`**: clusters wait for both DE + EN articles before transitioning to `completed`. The blog pipeline fires the check after the source article completes (count < expected at that point), so the translation pipeline must re-check after each target article finishes. Without this call, clusters stay stuck at `running` indefinitely.

**`TranslationPipelineOutputSchema` must exactly match `PersistArticleStep.outputSchema`**: the runner does NOT call `bridge()` for the final step — it passes `PersistArticleStep`'s Zod-validated output directly as the pipeline output. Any extra fields in `TranslationPipelineOutputSchema` that the step never emits will fail `invalid_type` validation at runtime for every translation job.

**`enqueueTranslationPipeline` accepts `preRunId?: string`** for `triggerWithPreRunId` compatibility (Spec 59.2). Internal auto-trigger callers (BlogPipeline, RefreshPipeline) omit it. The HTTP endpoint `POST /articles/:id/translate` passes it via `triggerWithPreRunId`'s `enqueue` callback.

### Voice Reference Loader

`loadVoiceReferences({ projectId, clusterId, locale, excludeArticleId, limit })` in `src/article/voice-reference/loader.ts` returns top-N published articles (same cluster + locale, ranked by `selfReviewScore DESC, createdAt DESC`). Falls back to project-wide if cluster yields fewer than `limit` results. Used by both Refresh and Translation pipelines.

### ChainStep routing (Spec 54.10 Section A)

`ChainStep` is a **TypeScript-only union type** — no DB enum or CHECK constraint exists on `pipeline_chains`. Adding a new value requires only a Drizzle schema update (`packages/db/src/schema/content.ts`), no SQL DDL. The chain-orchestrator maintains two sequences: `LEGACY_STEP_SEQUENCE` (outline→draft→schema-de→localize→schema-en→astro-transfer) and `BLOG_STEP_SEQUENCE` (blog→localize→schema-en→astro-transfer). `isBlogEligible()` routes to the correct sequence at `startChain()` time.

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

5. **Live tests that call `anthropic.messages()` require a real `projectId` from the DB.** The cost tracker inserts into `cost_logs` which has a FK on `projects.id`. A random `crypto.randomUUID()` projectId causes a FK violation that the step catches as a step failure, firing the fallback. In live-gated test files, resolve the real project ID in `beforeAll` with a DB query and pass it through `mockCtx()`. See `packages/pipelines/test/article/social-image-caption-live.test.ts` for the pattern.

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
- DO NOT import the named `embed` function from `@marketing-auto/adapter-voyage` — it's an ESM binding and cannot be replaced in tests. Always use `voyage.embed(...)` (the object property). See `src/topic-sources/trend-discovery/coverage.ts` for the canonical pattern.
- DO NOT route a `refresh_detection` brief through the **blog** pipeline — `ToolRelevanceStep` (step 2) calls `buildSourceContextFragment()` which is valid for `refresh_detection` but the blog pipeline expects a brief with `clusterId + locale` for author-picking and tool-relevance. Route refresh briefs to `article:refresh` instead via `enqueueRefreshPipeline()`.
- DO NOT expect `ToolLinkerStep` to link every tool mention — it links only the **first** occurrence per H2 section (SEO best practice). A tool mentioned 4 times in a single section gets linked once. This is intentional; do not change the behaviour without updating the spec.
- DO NOT pass an empty `briefId` in the `article:blog` pipeline input — `AuthorPickStep` and `ToolRelevanceStep` both query the brief by ID in their `execute()` methods. A missing brief causes the pipeline to fail at step 1 or 2. The `enqueueBlogGenerationPipeline` wrapper always receives `briefId` from `triggerWithPreRunId` via `extraInput`; verify it is present before adding new callers.
- DO NOT assume `mockImplementationOnce` exhaustion is safe when a step makes multiple `anthropic.messages()` calls — once `mockImplementationOnce` runs out, subsequent calls fall through to the base `mockReturnValue`. If the base mock returns a different JSON shape than the call site expects, the downstream validator crashes at runtime (`TypeError: undefined is not an object evaluating 'hook.highlightWord.trim'`). Fix: add field-presence guards before passing parsed JSON to any validator. Pattern: `if (typeof candidate.leadPhrase === "string" && typeof candidate.highlightWord === "string") { hookPartial = candidate; }`. Caught in Spec 57.1: `ExtractToolsStep` makes 3 LLM calls (extraction + hook + enrich); tests that only mocked the first two caused the hook parser to receive tools-extraction JSON from the base mock.
- DO NOT assume author expertise embeddings are pre-populated — they are lazily computed on first `AuthorPickStep` run and cached in `articles.frontmatterExtras.expertiseEmbedding`. The first article generated for a new cluster/author combination pays the Voyage embedding cost (~€0.0001); subsequent calls hit the JSONB cache. If you wipe `frontmatterExtras`, re-importing the authors resets the cache.
- DO NOT hardcode a fallback author slug in `author-picker` — any hardcoded slug may not exist in the project's authors collection and will silently produce phantom author references in generated articles. Always query the DB for the actual top author by post count and validate they exist in `articles WHERE collection='authors'`. See `defaultFallbackAuthor()` in `src/article/author-picker/index.ts`. Throw `AuthorPickerError` rather than returning a phantom slug.
- DO NOT call `updateArticleAuthor()` with an author slug that hasn't been validated against the authors collection — `updateArticleAuthor()` in `blog/persist.ts` enforces this at the DB layer (throws `BlogPipelineError` if the slug is absent), but rely on the author-picker returning a valid slug in the first place. Defense-in-depth: two validation points, neither silently corrupts.
- DO NOT call `linkifyMarkdown` on body text that may already contain `[ToolName](url)` links without pre-populating `linkedInSection` — the section processor now handles this automatically (Spec 54.9.1 fix), but any future refactor of `processSection` must preserve the pre-populate loop that marks already-linked tools as done before scanning for new link positions.
- DO NOT seed test articles with a random `clusterId` UUID without first creating the matching `clusters` row — `articles.cluster_id` is a FK to `clusters.id`. Tests must create `contentPillars` + `clusters` rows in `beforeAll` if they need cluster-scoped article seeds. See `test/article/author-picker/historic.test.ts` for the canonical fixture pattern.
- DO NOT rely on Zod array validators alone for cross-item constraints (e.g. "each spoke must have a distinct intentType") — `.min()` and `.max()` only enforce array length. Add a `.refine()` for cross-item rules: `.refine((items) => new Set(items.map(i => i.field)).size === items.length, "message")`. Skipping this means the LLM can return duplicate values that pass schema validation silently. See `ClusterPlanOutputSchema` in `src/cluster/full-plan/types.ts` for the pattern.
- DO NOT let Zod schema bounds drift from prompt instruction bounds — if the prompt says "4-10 items", the schema must also enforce `.min(4).max(10)`, not a looser range. Mismatches let invalid LLM outputs pass silently while the prompt continues producing correct ones, making the schema useless as a safety net. Always verify schema constraints match the task spec before finalising a types.ts file.
- DO NOT add a field to an intermediate step's output schema just to carry a pipeline-input value to a later step — override `Pipeline.bridge()` instead. Pattern: add `myField: z.string().nullable().optional()` to the intermediate schema so Zod won't fail when that step omits it, then inject in the bridge: `if (fromStep.name === "X" && toStep.name === "Y" && pipelineInput.myField != null) return { ...(output as Record<string, unknown>), myField: pipelineInput.myField }`. See `SocialImagePipeline.bridge()` + `templateKeyOverride` on `GenerateCaptionOutputSchema` (Spec 60.6) for the canonical pattern.
- DO NOT do async context loading (DB queries, voice-reference loads) inside `Pipeline.bridge()` — bridge is synchronous. When a pipeline needs async context before the main LLM steps, use a dedicated **intake step** as step 1: load all context in `execute()`, return it in the output schema, and read it in subsequent bridge calls via `getStepOutput("intake-step-name")`. See `RefreshIntakeStep` in `src/article/refresh/intake-step.ts` for the canonical pattern.
- DO NOT write a pipeline step that INSERTs a new DB row without first checking if the row already exists — if the pipeline is re-run after a downstream failure the step will be re-executed and the INSERT will hit a unique constraint. Always do a SELECT-or-INSERT pattern: query for an existing row, return its ID if found, INSERT only if not found. See `TranslationSetupStep` in `src/article/translation/setup-step.ts` for the canonical pattern (idempotent EN article creation via translationKey lookup).
- DO NOT use `MessagesResult.text` — the field is `raw`. `anthropic.messages()` returns `{ raw: string, json: unknown | null, ... }`. Use `result.raw` for free-text responses and `result.json` for JSON-mode responses. `text` does not exist and TypeScript will catch it, but Bun silently returns `undefined` at runtime if strictness is loose.
- DO NOT rely on TypeScript to infer the full return type of `execute()` when new fields are added to a step's `OutputSchema` — TypeScript sometimes fails to unify the inferred type and emits `TS2416 Property 'execute' in type '...' is not assignable to the same property in base type`. Fix: add an explicit return type annotation: `async execute(...): Promise<z.infer<typeof OutputSchema>> { ... }`. This also serves as documentation of the step's contract.
- DO NOT define a `TranslationPipelineOutputSchema` with fields beyond what `PersistArticleStep.outputSchema` emits (`articleId`, `wordCount`, `selfReviewScore`) — the pipeline runner passes the last step's Zod-validated output directly as the pipeline result without calling `bridge()`. Extra fields cause `invalid_type` Zod errors at runtime for every translation job.
- DO NOT omit `checkClusterCompletion` from `TranslationPipeline.afterComplete` — clusters have an expected total of `deArticleCount × 2` when `translationAutoTrigger` is on. `BlogPipeline.afterComplete` fires the check after DE completes (when count < expected), so the cluster never reaches `completed` unless the translation pipeline re-checks after each EN article finishes.
- DO NOT copy `category` or `subcategory` from source articles into target articles in the translation pipeline — these are human-readable strings that may be locale-specific (e.g. "Praxis & Use Cases", "Vergleiche"). Exclude them from `LANG_INDEPENDENT_EXTRAS` and do not pass `sourceCategory`/`sourceSubcategory` to `persist-article`. Only copy truly locale-neutral extras: intentType, pricing fields, rating, features, etc. See `LANG_INDEPENDENT_EXTRAS` in `src/article/translation/pipeline.ts`.
- DO NOT call `findEnSibling()` on an EN article expecting `null` — since Spec 59.2, `findEnSibling` is an alias for the bidirectional `findSibling()`, which returns the DE sibling when called with an EN article. If you specifically need to find only the EN sibling of a DE article, pass a DE article. The alias exists for backward compat; new code should call `findSibling()` directly.
- DO NOT guard refresh sibling propagation with `article.locale === "de"` — since Spec 59.2 the propagation is bidirectional. `RefreshPipeline.afterComplete` calls `findEnSibling(article)` (the bidirectional alias) regardless of locale. Adding a locale guard would silently break EN→DE propagation.
- DO NOT add `preRunId` to an existing enqueue wrapper as a required field — it must remain optional so internal callers (pipelines' `afterComplete` hooks) that don't have a `preRunId` continue working. Use `...(input.preRunId ? { preRunId: input.preRunId } : {})` conditional spread in the `enqueuePipeline()` call. See `enqueueTranslationPipeline` in `src/article/translation/trigger.ts` for the canonical pattern.
- DO NOT copy DE `tags` to EN articles — tags are locale-specific strings. `TranslationBodyStep` outputs `enTags` (LLM-generated in EN) via the `<TAGS>` block; the bridge uses `body.enTags` instead of `s.deTags`. If the LLM emits no tags, EN article gets an empty array rather than German tags.
- DO NOT add a new `@type` to `BuildJsonLdStep` without updating all four places: (1) `OutputSchema.addedTypes` z.enum, (2) the local `addedTypes` array type annotation, (3) the `existingMinusOurs` filter cast, (4) a `buildXxx()` helper function. Missing any one of them causes either a TypeScript error or a stale entry being left in `schemaJsonLd` on re-runs.

## Trend Discovery Topic Source (Spec 54.5+)

`TrendDiscoveryTopicSource` lives in `src/topic-sources/trend-discovery/`. It implements `TopicSource<Input>` and produces TopicBriefs from `external_signals`.

**Module map:**
- `types.ts` — `SynthesisTopic`, `SynthesisOutput`, `ScoreBreakdown`, `CoverageResult`, `ClusterMatchResult`, `MAJOR_VENDOR_DOMAINS`
- `score.ts` — `computeTrendScore()`: 6-component weighted score (buzz + growth + official + SERP volatility + source diversity - coverage penalty)
- `coverage.ts` — `checkExistingCoverage()`: pgvector cosine similarity check + lazy article embedding backfill + Haiku LLM tiebreaker for the 0.60-0.85 band
- `cluster-match.ts` — `findMatchingCluster()`: pgvector similarity search against `clusters.embedding` (threshold 0.65) + lazy cluster embedding backfill

**Score weights (rebalanced in 54.5b — positive weights sum to 100):**
```
buzz=15, growth=15, official=25, serp=20, diversity=25, coverage_penalty=40
```
`source_diversity` = 0 (single/no source), 50 (two distinct sources), 100 (3+ distinct sources). Rebalance rationale: RSS-only signals (no engagement metrics) were scoring zero on buzz and growth, causing valid topics to be rejected. Diversity rewards cross-source confirmation; official raised because vendor announcements are strong trend signals regardless of community engagement.

`min_trend_score` default is **25** (lowered from 40 in 54.5b).

**Coverage thresholds:** sim > 0.85 → covered (reject), sim < 0.60 → new (accept), 0.60–0.85 → Haiku tiebreaker.

**Cluster-match threshold:** 0.65 → `cluster_action = 'append_to_existing'`; below → `cluster_action = 'create_new'`.

**Embedding backfill pattern (articles + clusters):** Queries `WHERE embedding IS NULL`, embeds `title + meta_description` (articles) or `name + primary_keyword` (clusters), writes back via raw SQL `UPDATE ... SET embedding = '...'::vector`. Failures are logged as `warn` and skipped — backfill is opportunistic.

**Partial index on `rejected_topic_candidates`:** PostgreSQL does not allow non-immutable functions (`NOW()`, `CURRENT_TIMESTAMP`) in partial index `WHERE` clauses. The index on `(project_id, expires_at)` has no WHERE predicate — the query filter `expires_at > NOW()` is applied at query time only.

**`scoreBreakdown` in `trendMetadata` uses camelCase, not snake_case:** `emit-brief.ts` remaps `ScoreBreakdown` (snake_case: `community_buzz`, `serp_volatility`, etc.) to camelCase (`communityBuzz`, `serpVolatility`, `sourceDiversity`) when building the `trendMetadata` JSON. It omits `total` from the stored object. Any Zod schema or TypeScript type that models `trendMetadata.scoreBreakdown` must match `emit-brief.ts` output (camelCase, 6 fields: `communityBuzz`, `searchVolumeGrowth`, `officialAnnouncement`, `serpVolatility`, `sourceDiversity`, `existingCoveragePenalty`), NOT the `ScoreBreakdown` type from `types.ts`.

## Blog Generator Pipeline (Spec 54.9)

`article:blog` is the 13-step pipeline that converts an approved `TopicBrief` into a drafted, author-assigned, tool-linked blog article. It is registered in `apps/api/src/workers/index.ts` and triggered via `enqueueBlogGenerationPipeline` (thin preRunId wrapper) or `enqueueBlogGeneration` (full trigger with brief validation).

### Step order

```
1.  AuthorPickStep       — score-based SQL + Voyage embedding fallback + default
2.  ToolRelevanceStep    — resolve sourceContext + toolsContext strings for prompts
3.  TopicIntakeStep      — load article/cluster/project from DB
4.  ResearchStep         — SERP research via DataForSEO
5.  OutlineStep          — LLM outline (Sonnet 4.6, sourceContext + toolsContext injected)
6.  PersistOutlineStep   — checkpoint: save outline, gate on approvalMode
7.  DraftStep            — LLM draft (Sonnet 4.6, sourceContext + toolsContext injected)
8.  PersistBodyStep      — checkpoint: save body immediately
9.  ToolLinkerStep       — linkify first-occurrence tool mentions per H2 section
10. SelfReviewStep       — quality classification (Haiku 4.5)
11. HeroImageStep        — image generation (Replicate SDXL)
12. AssemblyStep         — JSON-LD schema generation
13. PersistArticleStep   — final persist with all fields
```

**`afterComplete`** triggers `enqueueSchemaExtension` (Spec 50). Errors are logged as warn and do not fail the pipeline.

### Author-Picker module (`src/article/author-picker/`)

Three-strategy cascade, no LLM call:

1. **`historic_score`** — SQL `GROUP BY author` on imported blog articles, weighted score `(cluster_hits × 3) + (intent_hits × 2) + (total × 0.1)`. Wins if top result has `cluster_hits + intent_hits ≥ 1`.
2. **`embedding_fallback`** — Voyage embedding of brief topic+keywords vs. author expertise strings. Wins if cosine similarity > 0.55. Expertise embeddings cached in `articles.frontmatterExtras.expertiseEmbedding` after first compute.
3. **`default_fallback`** — returns `anna-weidner`. Logs a `warn` so Marcel can see when the author-picker had no signal.

`matchStrategy`, `matchScore`, `briefSource`, and `briefIntentType` are all logged at INFO level by `AuthorPickStep`, enabling easy observability of which strategy fired and why.

### Tool-Linker module (`src/article/tool-linker/`)

Two-phase architecture:

**Phase 1 — Pre-generation (`pre-generation.ts`)**
`resolveRelevantTools(projectId, brief, locale)` returns:
- `primary`: up to 6 tools where `articles.cluster_id = brief.clusterId`
- `secondary`: top 3 tools by `tool_rating` in the inferred category, excluding primary

These are formatted by `buildToolsContextFragment()` and injected into the Outline and Draft step user messages (NOT the system prompt — keeps the cache boundary clean).

**Phase 2 — Post-draft linkification (`post-generation.ts`)**
`linkifyMarkdown(bodyMd, projectId, locale)` queries ALL tools for the project+locale and replaces the **first occurrence of each tool name per H2 section** with a markdown link (`/de/tools/slug` or `/en/tools/slug`). Rules:
- Case-sensitive match (no "claude" → link, only "Claude")
- Word-boundary check (avoids partial-word matches like "OpenAI's Claude" matching "Claude" but not "OpenAI")
- Longer names matched before shorter (GitHub Copilot wins over GitHub)
- Skip inside code fences, inline code, and existing markdown links
- Persisted back to `articles.bodyMd` by `ToolLinkerStep`

### Source-context module (`src/article/source-context/index.ts`)

`buildSourceContextFragment(brief)` returns a human-readable framing paragraph injected into the Outline and Draft user messages:
- `gap_analysis` → cluster name, gap type, existing sibling articles
- `trend_discovery` → freshness window, trend score, signal count, related event
- `manual` → `""` (no framing)
- `refresh_detection` → refresh framing paragraph with staleness + reason (Spec 54.10; used by `article:refresh` pipeline)
- unknown sources → `""` (graceful fallback)

### Blog brief detection (API layer)

`isBlogBrief(brief)` = `brief.locale !== null && brief.clusterId !== null`. Both conditions must be true for the brief to route to `article:blog`; otherwise falls back to `article:outline`. Trend briefs always satisfy this (guarded at the approval endpoint).
