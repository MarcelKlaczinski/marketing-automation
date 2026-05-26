# Backend API Conventions

## Structure
- `src/server.ts`         Hono server entrypoint, middleware setup
- `src/routes/`           HTTP endpoints, thin glue layer
  - `src/routes/projects/signal-sources.ts`  Signal source CRUD + per-source config + manual trigger (Spec 59.1c)
- `src/workers/`          BullMQ workers (added in Spec 05)
- `src/webhooks/`         Inbound webhooks (added later)
- `src/middleware/`       Custom Hono middleware (auth, cost-context)
- `src/lib/`              Local utilities (logger setup, helpers)
  - `src/lib/chain-orchestrator.ts`  Per-gap automation chain (Spec 49d)
  - `src/lib/brand-asset-service.ts` Brand asset CRUD + brand-token defaults (Spec 52b)
  - `src/lib/color-utils.ts`         OKLCH↔hex helpers + WCAG contrast ratio (Spec 52b)
  - `src/lib/icon-resolver.ts`       Re-exports `resolveToolIcon` from pipelines (Spec 52a)
  - `src/lib/divergence.ts`          Pure `detectDivergence()` helper for translation sibling conflict detection (Spec 59.2)
  - `src/lib/brief-bulk-selector.ts` Discriminated-union body resolver + shared `buildBriefsWhere()` for bulk brief Approve/Dismiss (Spec 64.17)

## Service Layer Pattern (`src/lib/<domain>-service.ts`)

When a route needs to call an adapter (anthropic, dataforseo, etc.) but the logic
is too route-specific to live in `packages/core`, extract it into a service file:

```
src/lib/gap-service.ts    ← adapter calls + business logic for gap suggestion
src/lib/system-service.ts ← system/installer-related logic (no project context)
src/lib/email.ts          ← transactional email helpers
```

Rules:
- Service files import adapters directly (that's their job)
- Route handlers import service functions and call them — no adapter imports in routes
- Service files use pino logger, not console.log
- Business logic that is project-context-aware and reusable across routes → `packages/core` instead

Canonical example: `src/lib/gap-service.ts` (Spec 49c) — DataForSEO keyword enrichment + Claude Haiku suggestion, called from two route handlers without duplicating logic.

### Hook-Library lib (Spec 65.4)

`src/lib/hook-library/` is the canonical home for Family-B narrative-hook lookup:

- [`pick-hook.ts`](src/lib/hook-library/pick-hook.ts) `pickHook(input)` — loads up to 10 LRU-eligible hooks via `listLruEligibleHooks`, asks Haiku 4.5 + `jsonMode: true` to pick one by UUID with a reasoning sentence, falls back to first LRU on hallucination / LLM throw / Zod-parse-fail. Returns `null` only when no candidates exist. Marks the picked hook used via `markHookUsed`.
- [`render-hook.ts`](src/lib/hook-library/render-hook.ts) `renderHook(pattern, vars)` — pure `{variable}` substitution. Throws `HookRenderError` on missing variable so a broken substitution fails loudly instead of leaking `"… wegen {tool}"` into a published slide.

Cost-tracked under `COST_OPS.HOOK_PICK` (€0.005/call). Used by 65.5 brief-generators when `FORMAT_TYPES[formatType].needsHooks === true`. The hook-picker pattern (LRU candidates + LLM picks UUID + hallucination fallback to candidates[0]) is reusable for any future "LLM picks N of M from a curated pool" surface (template picker, persona picker, etc.).

### Persona-Scoring lib (Spec 65.3 Part A)

`src/lib/persona-scoring/` is the canonical home for tool↔persona suitability scoring consumed by 65.5 brief-generators when a brief surface requires persona-targeted tool selection:

- [`score-tool-for-personas.ts`](src/lib/persona-scoring/score-tool-for-personas.ts) `scoreToolForPersonas({projectId, toolId, personas?})` — ONE Haiku 4.5 + `jsonMode: true` call per tool, scoring ALL listed personas in one batch (default = `DEFAULT_PERSONAS`, all 10). Zod-validates the LLM output, filters hallucinated persona slugs, soft-fails (`source: "skipped" | "failed"`) instead of throwing so a batch can continue with the remaining tools.
- [`pick-persona-scored-tools.ts`](src/lib/persona-scoring/pick-persona-scored-tools.ts) `pickPersonaScoredTools({projectId, persona, toolIds, minScore?, maxInlineScores?})` — lazy-fetch helper for brief-generators. Returns fresh-window scores (<180 days per Marcel-Decision §3.4), inline-triggers `scoreToolForPersonas` for missing/stale tools up to `maxInlineScores` (default 5) with 3-way bounded concurrency, ranks by `(score DESC, scoredAt DESC, toolId ASC)`. The inline batch always scores ALL personas per tool so sibling-persona requests hit the cache.
- [`invalidate-persona-scores.ts`](src/lib/persona-scoring/invalidate-persona-scores.ts) `invalidatePersonaScoresForTool({toolId, reason})` — deletes EVERY persona-score row for a tool across ALL projects (Marcel-Decision §10 cascade). Called by the tool-data-refresh worker on material-change detection. The next brief-generator pass for any project will lazy-re-score against the freshly-extracted facts.

**Cost-tracked under `COST_OPS.PERSONA_SCORE`** (€0.01/call, ~€1.10 for a 108-tool Toolwiki backfill). The all-personas-per-tool batch shape (Option α from Discovery §3.1) is the canonical choice for any future "score N attributes per item" surface — coherence across attributes within one context window beats per-attribute isolation, and Haiku's output cap (~150-200 tokens for 10 personas × ~60-char reasoning) is comfortable.

**Backfill script** [`scripts/backfill-persona-scores.ts`](src/scripts/backfill-persona-scores.ts) — project-scoped (Memory D23 enforcement), dry-run default, `--force` re-score path, `--limit` cap. DI seam `scoreToolFn` keeps tests offline. Settings UI surface at [`SettingsPersonaScoringPage.vue`](../../apps/web/src/pages/settings/SettingsPersonaScoringPage.vue) — stats card + per-persona fresh-coverage progress + backfill controls.

### Tool-Data-Refresh worker (Spec 65.3 Part B)

`src/lib/tool-data-refresh/` is the canonical home for the cron-driven freshness pipeline that detects pricing / feature changes on tool-articles and cascades persona-score invalidation:

- [`select-stale-tools.ts`](src/lib/tool-data-refresh/select-stale-tools.ts) `selectStaleTools({projectId, locale, staleThresholdDays, limit})` — staleness scan with `NULL-first` ordering (never-refreshed beats once-fresh-now-old). Always uses `sql\`${col} ASC NULLS FIRST\`` + `asc(t.id)` tiebreaker (PostgreSQL ASC defaults to NULLS LAST — see root CLAUDE.md DO-NOT).
- [`extract-tool-data.ts`](src/lib/tool-data-refresh/extract-tool-data.ts) `extractToolData({toolId, toolName, toolWebsite, currentSnapshot})` — single Anthropic call with `webSearch: {enabled: true, maxUses: 3}` + `jsonMode: true`. Returns a Zod-validated `ToolDataExtract` with `materialChangeJudgment.isMaterial` boolean from LLM-as-judge (no Tavily/Serper adapter needed — the Anthropic adapter has built-in web-search since Spec 64+; never-cached because results go stale).
- [`compute-diff.ts`](src/lib/tool-data-refresh/compute-diff.ts) `computeToolDataDiff({extract, priorPricingFingerprint?, priorFeatureFingerprint?})` — pure helper (no DB), computes pricing/feature fingerprints (SHA-256 truncated to 16 chars) for next-tick short-circuit detection. The material-change flag is canonical from the LLM; fingerprint diffs are observability-only.
- [`apply-changes.ts`](src/lib/tool-data-refresh/apply-changes.ts) `applyToolDataChanges({toolId, extract, diff, priorMetadata?})` — writes the audit blob into `articles.tool_data_refresh_metadata` (Pattern 143 typed jsonb, distinct from Spec 54.10 `refresh_metadata` for article-content refresh), advances `articles.last_refreshed_at`, additively writes the extract under `domain_extras.toolDataRefresh` via `jsonb_set` (preserves Marcel-owned sibling keys). On material change, cascades to `invalidatePersonaScoresForTool`. Conservative: NEVER overwrites `tool_pricing` / `tool_price_from` directly — those are Astro-imported, Marcel-owned.
- [`notify-batch.ts`](src/lib/tool-data-refresh/notify-batch.ts) `notifyToolDataRefreshBatch({projectId, refreshedCount, materialChanges, ...})` — Memory D21 batched notification: ONE notification per tick to every `users.role='owner'` row, severity `critical` (Web Push) when material changes occurred, else `info` (SSE only). Kill-switch via `PIPELINE_NOTIFICATIONS_ENABLED=false`.

**Worker** [`workers/tool-data-refresh.worker.ts`](src/workers/tool-data-refresh.worker.ts) — cron-orchestrated (`tool_data_refresh` enum widening + Memory-D124 seed pattern at worker startup + per-project INSERT in `routes/projects.ts`). Default OFF, pattern `0 */6 * * *`, 5 tools/tick. Per-tool try/catch so one failure never stops the tick. Uses the canonical `markCronRunSucceeded`/`markCronRunFailed` cron-state observability writes.

**Cost-tracked under `COST_OPS.TOOL_DATA_REFRESH`** (€0.05/call — Anthropic web-search 3 queries + Haiku extract). Monthly: ~108 tools × 30-day cadence ≈ 3.6 refreshes/day × €0.05 ≈ €5.40/month.

**HTTP routes** [`routes/projects/persona-scoring.ts`](src/routes/projects/persona-scoring.ts) — 3 endpoints under `/api/projects/:slug/persona-scoring/{stats,scores,backfill}`. Backfill runs synchronously (Marcel-Decision §3.3 lazy + opt-in trigger, not BullMQ V1) — endurance ~5 min for 108-tool Toolwiki. Future V1.1 could move it behind BullMQ if scale demands.

### Recurring-content brief-generator + cron coordinator (Spec 65.5)

`src/lib/recurring-content/` is the canonical home for the end-to-end recurring-brief-generation pipeline that operationalises Theme 65 foundation (65.0-65.4). Cron-driven, BullMQ-consumed, output lands in `topic_briefs` with `source='recurring'` + `approval_status='plan_pending'`.

**Cron coordinator** [`workers/recurring-content.cron.ts`](src/workers/recurring-content.cron.ts) — module-level `setInterval(15min)` started by `server.ts` ONLY (Memory D17 + D24 single-instance). Per tick: `listDueRecurringDefinitions({limit: 10})` → `enqueueRecurringBriefGenerator()` per row. Idempotent start; `.unref()` so the process can exit. Mirrors the `template-usage-log-prune.cron.ts` (Spec 65.1) shape.

**BullMQ worker** [`workers/recurring-brief-generator.worker.ts`](src/workers/recurring-brief-generator.worker.ts) (`concurrency: 1`, `attempts: 1`) — consumes the cron-enqueued jobs. Per job:
1. Acquires a per-`definitionId` **Redis lock** (5min TTL) via `SET NX EX` + a Lua release-if-owner script. The lock token is generated per-attempt; release uses `EVAL "if get == token then del"` so we never release a lock that has expired and been re-acquired by another process.
2. Re-loads the definition (cron may have read a stale row); guards against `!isActive`, project mismatch, and missing rows.
3. Resolves `language` from `projects.target_locales[0]` (BCP-47 → 2-letter), `runNumber` from prior persisted briefs, `previousRunToolIds` from the most recent prior brief's `recurringMetadata.formatConfig.toolIds`.
4. Dispatches via `dispatchBriefGenerator` → format-type-specific generator under `lib/recurring-content/brief-generators/`.
5. Advances `next_run_at` via `markRecurringDefinitionRun` regardless of outcome (skipped briefs still consume the slot — a brand-asset gap shouldn't fire again in 30 seconds; Marcel reviews the admin notification).

**5 brief-generators** under [`lib/recurring-content/brief-generators/`](src/lib/recurring-content/brief-generators/) — flat functions, one file per format-type, all composing the same 6 shared helpers:

- **`shared/pick-tools.ts`** — `pickToolsForBrief()`. Manual override path (when `format_config.manualToolIds` set, verifies project + collection then truncates to topN). LLM-curated path (oversample×4 → optional `pickPersonaScoredTools` reorder when `config.persona` set → Haiku 4.5 + jsonMode picks final N → hallucination fallback drops invalid UUIDs + top-ups from pool head). Cost-tracked under `COST_OPS.RECURRING_TOOLS_CURATE` (€0.005).
- **`shared/check-brand-assets.ts`** — `ensureBrandAssetsAvailable()`. Throws `BrandAssetsMissingError` with the list of tools missing `logo_url` (uses 65.2 `listToolsWithBrandAssets`). Brief-generators catch and return `status: "skipped", reason: "brand-assets-missing"` so the worker can dispatch an admin notification (`notify-skipped.ts`, Memory D21 fan-out per `users.role='owner'`).
- **`shared/select-template.ts`** — `selectTemplateForRecurringBrief()` 3-Layer (Spec 65.5 absorbs 65.6). Layer 0 = `fixed` (returns `definition.fixedTemplateKey`). Layer 1 = eligible-templates lookup via 65.4 `FORMAT_TYPES[formatType].eligibleTemplates` (single-eligible short-circuit). Layer 2 = LRU via `listRecentTemplateUsage(definition.id, limit: eligible.length - 1)` skipping recently-used; falls back to `eligible[0]` cold-start. Layer 3 = LLM-rank via Haiku 4.5 + jsonMode with hallucination/Zod-fail/throw fallback to LRU pick. Cost-tracked under `COST_OPS.RECURRING_TEMPLATE_RANK` (€0.005). Post-select logging happens in the caller via `logTemplateUsage` AFTER `persistRecurringBrief` lands — a failed persist must not leave a phantom usage entry.
- **`shared/select-end-slide.ts`** (Spec 65.9) — `selectEndSlideForRecurringBrief()` 2-Strategy. Strategy 1 = `definition.endSlidePool` IDs → LRU within pool (filters to active + project-scoped rows from `end_slide_definitions`). Strategy 2 = `FORMAT_TYPES[formatType].defaultEndSlides` from the 65.4 registry → LRU among matching active rows. Pool fall-through (with `log.warn`) when the pool resolves to 0 active candidates — pool-rot is non-fatal. LRU consumes `template_usage_log.end_slide_type` (first writer is Spec 65.9; pre-65.9 NULL rows are filtered out). Pure `pickLruEndSlide(candidates, recentlyUsedTypes)` extracted + exported for offline unit-test coverage. Throws `NoEligibleEndSlidesError` when project has 0 active rows matching the format-type defaults — each generator catches and returns `status: "skipped", reason: "no-end-slide-eligible"` so a missing seed advances `next_run_at` instead of crashing the cron loop. No LLM call, no cost-tracker entry.
- **`shared/brief-text.ts`** — `buildBriefText()`. Single Sonnet 4.6 call with tagged-block `<TITLE>...</TITLE><BODY>...</BODY>` output (Sonnet rejects jsonMode prefill). Returns 3-6 sentences of dense brief-text that primes downstream `article:social-image` / `article:blog` content generators. Cost-tracked under `COST_OPS.RECURRING_BRIEF_BUILD` (€0.05).
- **`shared/persist-brief.ts`** — `persistRecurringBrief()` writes `topic_briefs` with `source='recurring'`, `clusterAction='standalone'`, `approval_status='plan_pending'`, frozen `recurringMetadata` snapshot (`definitionId + runNumber + previousToolIds + formatType + formatConfig.{outputTargets, selectedTemplateKey, selectedTemplateVia, selectedEndSlide, hookData, toolIds}`). Always runs through `TopicBriefInsertSchema.parse` to enforce the `source='recurring' ⇔ recurringMetadata != null` superRefine invariant. Spec 65.9 added the optional `selectedEndSlide: {endSlideDefinitionId, type, config, name, selectedVia}` field — frozen so the 65.7 renderer reads the same shape it would have gotten from a fresh selector call (replays don't drift).

Family B generators (`story-arc-clickbait`, `lifestyle-listicle`, `opinion-recommendation`) ALSO call `pickHook` + `renderHook` from `lib/hook-library/` (Spec 65.4) — the picked hook + rendered substitution lands in `recurringMetadata.formatConfig.hookData` for downstream replay.

**Dispatch registry** [`brief-generators/index.ts`](src/lib/recurring-content/brief-generators/index.ts) — `BRIEF_GENERATORS: Record<FormatTypeKey, fn>` map + `dispatchBriefGenerator(ctx)` entry point with `UnknownFormatTypeError` for stale `format_type` values that fell out of the registry.

**Frequency helper** [`compute-next-run.ts`](src/lib/recurring-content/compute-next-run.ts) — `weekly | biweekly | monthly` or any cron expression. Cron via `cron-parser@5.5.0` (new dep). Monthly uses an explicit day-of-month clamp (`setUTCMonth` overflows — see root CLAUDE.md DO-NOT).

**Notification surface** [`notify-skipped.ts`](src/lib/recurring-content/notify-skipped.ts) — fans out one notification per `users.role='owner'` row when a brief is skipped (Memory D21 batched). English strings to match `tool-data-refresh/notify-batch.ts` convention. Severity `info` (none of the V1 skip reasons warrant Web Push). `PIPELINE_NOTIFICATIONS_ENABLED=false` kill-switch.

**12-point Content-Type registration** (Memory D7) — `recurring_content` registered across `CONTENT_TYPES`, `PLANNING_CONTENT_TYPES`, `PIPELINE_NAME_BY_CONTENT_TYPE` (default `article:social-image`; pipeline-router upgrades to `article:blog` when `outputTargets.article=true && social!==true`), `CONTENT_TYPE_TO_PIPELINE`, `matchBriefToContentType` (`source==='recurring'` → `'recurring_content'`), `pipelineInputFromBrief`, `distribute-slot-dates.ts` round-robin, `pipeline-router.ts` case, `PlannerItemCard.vue` `.ct-recurring_content` teal hue, `SettingsPlannerPage.vue` (`ContentType` union + `ALL_CONTENT_TYPES` + `perTypeInputs`), i18n DE+EN under `planner.contentType` + `settings.planner.contentTypes`.

### Settings UI surface (Spec 65.11)

Three sibling routes under `/api/projects/:slug` give Marcel full self-service:

- **`routes/projects/recurring-content-definitions.ts`** — 10 endpoints (CRUD + activation toggle + Run-Now + Dry-Run + history + format-types + upcoming-runs). Multi-tenant guard via `loadProject(slug)` + `loadOwnedDefinition(id, projectId)` returning 404 on cross-project access. `validateFormatConfig` from `@marketing-auto/shared/format-types` enforces per-format Zod schemas at write time (permissive fallback for unregistered types).
- **`routes/projects/hooks.ts`** — 4 endpoints. Pattern-vs-variables sanity check rejects undeclared `{vars}` with 422 so a broken hook can't silently fail at `renderHook` time. `formatType` + `language` are immutable after creation (UI exposes them read-only).
- **`routes/projects/end-slides.ts`** — 4 endpoints. Per-type Zod validation via `END_SLIDE_CONFIG_SCHEMAS` imported from the new non-JSX subpath `@marketing-auto/social/end-slide-components/types` (apps/api can't pull the React-bearing barrel because `--jsx` is not set). `type` is immutable after create — a config-shape migration on top of a UI-driven edit is high friction with no clear use case; Marcel creates a new end-slide instead.

**Worker contract extensions** (Spec 65.11) on top of the 65.5 worker:

- `RecurringBriefGeneratorJobData.forceImmediate?: boolean` — when `true` the handler skips `markRecurringDefinitionRun`. Run-Now from the Settings UI uses this so manual fires don't consume the regular schedule slot. The next cron tick still fires on schedule.
- `runDryRunForDefinition({definitionId, projectId})` — new synchronous entry that runs the same dispatch path as the BullMQ handler with `ctx.dryRun = true`. Each of the 5 generators short-circuits before `logTemplateUsage` + `persistRecurringBrief` via the shared helper `shared/dry-run-preview.ts` `buildDryRunPreview(input)` and returns the new `"dry-run-preview"` `GeneratedBriefResult` variant. LLM calls are real — costs match a normal run; the UI hint warns Marcel before pressing the button.
- The BullMQ handler's status branch is now `if (persisted) … else if (skipped) …` with a defensive `else` that logs the unreachable `dry-run-preview` case — dry-runs always go through `runDryRunForDefinition`, never through the BullMQ path.

## Endpoint Patterns
- All endpoints use Zod-validated input via @hono/zod-validator
- All responses follow `{ ok: true, data }` | `{ ok: false, error }` shape
- Long-running operations: enqueue a BullMQ job, return job_id, client polls/subscribes via Web Push

## Pagination Pattern (Spec 47)

All list endpoints use `src/lib/pagination.ts`. Canonical shape:

```typescript
import { paginated, paginationQuerySchema } from "../lib/pagination.ts";

const myQuerySchema = paginationQuerySchema.extend({
  projectSlug: z.string(),
  // override default: paginationQuerySchema defaults limit=50
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const [rows, countRows] = await Promise.all([
  db.select(...).from(t).where(cond).limit(q.limit).offset(q.offset),
  db.select({ count: sql<number>`count(*)::int` }).from(t).where(cond),
]);
return c.json({ ok: true, data: paginated(rows, countRows, q) });
```

Response envelope: `{ items, total, limit, offset }`.

**Pair-level pagination** (e.g. `/articles/imported` DE/EN pairs): paginate over `DISTINCT translationKey` ordered by `MAX(updatedAt)`, count distinct keys separately, then load article rows for those keys and group in memory. Never apply row-level `LIMIT/OFFSET` on grouped data.

**Cursor pagination needs a unique tiebreaker.** If you add a `cursor` mode that filters with `lt(sortCol, cursor)` (strict less-than) and the sort column is not unique, entire groups of rows that share the same value will be silently skipped at the page boundary. Caught on `/api/projects/:slug/articles`: 239/272 toolwiki articles shared `updatedAt = 2026-05-16T09:37:00.362Z` (PostgreSQL `now()` returns transaction-start time, so a single import batch stamps identical timestamps on every row). Page 1 returned 20 rows whose `nextCursor` landed inside the bulk-import group; page 2's `lt(updatedAt, cursor)` then dropped all 239 silently and scrolling stalled at exactly 40. Two safe options when designing a new cursor endpoint:

1. **Composite cursor** — sort and filter on `(updatedAt, id)` together. Use PostgreSQL row-tuple comparison: `WHERE (updated_at, id) < ($1::timestamptz, $2::uuid) ORDER BY updated_at DESC, id DESC`. The cursor string encodes both values (e.g. `<isoTimestamp>_<uuid>`).
2. **Offset mode for the consumer** — if the consumer just needs "show all rows", route it through the offset branch (the cursor branch is fine for stable timeline scrolls). The existing `/articles` endpoint already supports both modes; the infinite-scroll UI uses offset because cursor isn't safe yet.

Same gotcha applies to any other sort column that bulk imports stamp uniformly (`publishedAt`, `frontmatterUpdatedAt`, `createdAt` during seeds, etc.). Adding a cursor mode without a tiebreaker is a latent bug that only surfaces after a bulk operation.

## Bulk-Action Endpoint Pattern (Spec 64.17)

Bulk endpoints that mutate a list of rows (Approve / Dismiss / Reject / Cancel etc.) use a **discriminated-union body** so the same endpoint accepts both an explicit ID list AND a filter-shape that the server re-queries at action time:

```typescript
const bulkBriefSelectorSchema = z.union([
  z.object({ briefIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({
    filter: filterShapeSchema,                    // mirror the list-endpoint filter
    excludeIds: z.array(z.string().uuid()).max(500).default([]),
  }),
]);
```

Three rules:

1. **Shared WHERE-clause helper.** Extract the filter→SQL translation from the list endpoint into a `buildXxxWhere(projectId, filter)` helper so the list endpoint AND the bulk selector share one source of truth. Lock the projectId into `conditions[0]` so multi-tenant isolation is structural, not opt-in. Canonical: [`buildBriefsWhere`](src/lib/brief-bulk-selector.ts).
2. **Race-safety re-query.** The filter-shape branch runs a fresh `SELECT id FROM ... WHERE buildXxxWhere(...) LIMIT 500` at action time, then subtracts `excludeIds`. If cron fires between client-side selection and submit, the server picks the freshest set. Return `reQueried: true` + `totalMatched` in the response so the UI can surface a "X matched at action time, Y processed" diagnostic banner.
3. **Cap symmetrically.** Both shapes get the same cap (currently 500 for briefs) so operational bounds match regardless of which path the client took. Filter-shape resolution must `LIMIT 500` to enforce this server-side too — Zod only checks the briefIds-shape array length.

**Composing additional fields onto a union schema:** `z.union(...).extend({...})` doesn't compose (the receiver is a `ZodUnion`, not a `ZodObject`). Use `z.intersection(unionSchema, z.object({...}))` instead. Canonical: `bulkApproveSchema = z.intersection(bulkBriefSelectorSchema, z.object({mode, dispatch}))`.

**Pre-flight aggregate endpoint** (when the action has conditional skip-logic): expose a sibling `POST /<resource>/bulk-preflight-<gate-name>` that takes the same selector body and returns counts via `count(*) FILTER (WHERE ...)::int` aggregates. Pure read, no side effects, no cost log. The UI calls it on modal-open so the user sees "5 of 22 need cluster assignment (will be skipped)" before submit instead of after. Canonical: `bulk-preflight-cluster-check` in [routes/projects/briefs.ts](src/routes/projects/briefs.ts).

## Worker Patterns
- One worker per queue, queue name = step name (e.g., "draft-generation")
- Steps must be idempotent (safe to re-run)
- Always wrap external calls in cost-tracker decorator
- Always log structured (pino, JSON output)

### Cron-state observability writes (Spec 62.7-followup / 64.21-d)

Every cron-orchestrated worker MUST record `cron_state.lastRun*` exactly once per tick via `markCronRunSucceeded` / `markCronRunFailed` from [`packages/db/src/helpers/cron-state-write.ts`](../../packages/db/src/helpers/cron-state-write.ts). The 3 columns existed since migration 0076 but went un-written until Marcel noticed the "Letzter Lauf: —" in the Settings UI.

**Canonical wiring pattern** (used by all 9 cron-orchestrated workers as of 2026-05-25):

```typescript
async function handleSomeCronTick(projectId: string): Promise<void> {
  try {
    await doTheWork(projectId);                                    // your tick body
    await markCronRunSucceeded({ projectId, jobType: "your_job" }); // typed against CronJobType enum
  } catch (err) {
    await markCronRunFailed({
      projectId,
      jobType: "your_job",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err; // re-throw so BullMQ surfaces the failed job too
  }
}
```

**"Success" semantically means "tick reached its terminal state without throwing", NOT "tick produced new data"**. This deliberately includes no-op ticks (no due rows), guard-blocked ticks (cost-limit / pause), dedup paths (PlanAlreadyExistsError), and partial-fetcher failures inside an otherwise-completed tick. The intent: the UI's "Letzter Lauf" timestamp shows when the cron last ran, not when it last produced output.

**Don't call from manual one-off jobs that aren't cron ticks** (e.g. signal-collector's `collect-adapter` job name handles both cron + manual paths — only the cron branch records). Otherwise a manual fire overwrites the cron timestamp with a context that isn't visible in Settings.

**One worker — `comparison-discovery` — intentionally does NOT re-throw** after `markCronRunFailed`. Documented inline at the catch site. The rationale: discovery only writes pending briefs that Marcel reviews, so a missed tick is harmless, and the `cron_state.lastRunStatus='failed'` + warning log already give observability. Don't copy this without a similar rationale.

**Adding a new cron-orchestrated worker?** Wire all 5 sites per Memory D124 (enum widening migration + Drizzle enum + `getQueueForJobType` switch + `allQueues` + `isCronOrchestrated` startsWith) PLUS this `markCronRun*` call pair in the handler body. The pattern is the 6th coordination point — TypeScript catches missed enum casts via `CronJobType` re-derivation but doesn't catch a missed mark call.

### Time-series + threshold detection in cron-driven workers (Spec 64.21)

Pattern for any cron-driven worker that needs to compare current state against history (star-counts, fork-counts, response-time percentiles, ad-spend daily totals, etc.):

1. **History table** — separate from the entity table. Columns: `(id, project_id, <entity_id>, snapshot_at, <metric>, created_at)`. Three indexes: `(<entity_id>, snapshot_at DESC)` for the primary read pattern (find snapshot N days ago), `(snapshot_at)` for pruning, `(project_id)` for tenant-scope queries.
2. **Per-row snapshot insert BEFORE the entity-table write** — preserves read-after-write order. The next tick's `queryMetricAgo(cutoff)` sees the fresh snapshot only if it's strictly older than the next cutoff.
3. **Detect logic in a pure helper module** — no I/O, no DB. Takes `(prior, current, config)` and returns `{triggered, ...diagnostics}`. Fully unit-testable. Negative-direction filters belong here, not in the emit module (keeps "downside" branches out of the pipeline entirely; future "inverse" signals get their own detect function).
4. **Application-layer dedup** when partial unique indexes can't express the predicate. PostgreSQL forbids non-immutable `NOW()` in partial-index `WHERE`, so window-scoped existence checks (`EXISTS … WHERE entity_id=$1 AND created_at >= NOW - windowDays`) are the alternative.
5. **Per-project config cache scoped to one tick** — `Map<projectId, ResolvedConfig>` keyed at first read per project per tick, `.clear()` at end-of-tick. Cheaper than per-row SELECT, safer than session-long cache (Marcel's UI edits between ticks visible immediately).
6. **End-of-tick housekeeping** — single DELETE prunes rows older than retention window. Retention = 3× detection-window default so future widening doesn't lose baselines. Wrap in try/catch (failure must NOT crash the tick).
7. **DI seam (Pattern 121)** — `*Deps` interface with `emit*Brief` as an injectable function. Default = real emit module from the relevant pipelines package; tests inject fakes to capture invocations without touching DB.

Canonical example: `github-inventory-refresh.worker.ts` — Star-Trend (Spec 64.21) sits on top of the same worker that does Release-Detection (Spec 64.20 A3). Same retention + DI + try/catch posture, different metric + detect function.

## Worker Lifecycle (Spec 64.11)

### Startup reconciliation

`reconcileStalledRenders()` in [src/workers/lib/render-reconciliation.ts](src/workers/lib/render-reconciliation.ts) runs ONCE at worker startup, BEFORE `acquirePidLock()` releases the lock and any BullMQ worker spawns. It resets two classes of orphaned rows so the next poll finds clean state:

- `social_posts.render_status='rendering' AND render_started_at < NOW() - X min` → `pending` + `render_started_at = null`. Clearing the timestamp is what makes the row look fresh to the next reconciliation; without it, the row would be reset on every restart.
- `pipeline_runs.status='running' AND started_at < NOW() - X min` → `failed` with an `errorMessage` audit trail and `completedAt = NOW()`. The `pipelineRunStatusEnum` has **no `pending` value** — `failed` is the only correct destination, since the BullMQ job is gone and a fresh run is a Marcel-side decision.

The cutoff is configurable via `RENDER_RECONCILIATION_TIMEOUT_MINUTES` (default 15 — Remotion renders top out around 10 min, BullMQ `lockDuration` is 10 min, +5 min buffer). Idempotent: a second invocation against the same state finds 0 rows.

**Other pipeline-run states are deliberately left alone:** `batch_pending`, `paused`, `queued`, `superseded` represent intentional suspension states whose lifecycle is owned by other workers (batch-processor, step-pause flow, BullMQ pickup). The reconciliation never touches them.

If `reconcileStalledRenders()` itself throws (e.g. DB unreachable at startup), the error is logged but worker startup proceeds — running with stale rows is preferable to a worker that won't start.

### Pipeline-completion notifications

Long-running pipelines fire push notifications via [`notifyPipelineCompletion`](../../packages/core/src/notifications/pipeline-completion.ts) so Marcel gets a signal when a 5–10 min `article:blog` run or a 3–5 min `social-render` finishes (or fails). Currently wired in two places:

- **`apps/api/src/workers/social-render.worker.ts`** — `worker.on('completed' | 'failed')` listeners attached after the existing `ready`/`error` handlers.
- **`packages/pipelines/src/engine/queue.ts`** — the shared `startPipelineWorker` adds a `RICH_COMPLETION_PIPELINES` set (currently just `article:blog`) that short-circuits the legacy `MEANINGFUL_PIPELINES` fan-out + the legacy `pipeline_failure` fan-out so the same job never fires two competing notifications.

The helper:
- Fans out one notification per `users.role='owner'` row (mirrors `notifyStepPaused`).
- Coalesces by `(type='pipeline_completed', metadata->>'pipelineRunId')` so retries don't double-notify.
- Severity is `info` on success (SSE only) and `critical` on failure (Web Push fires).
- Resolves the deep link from `projects.slug` + (article slug or social path).
- All errors are swallowed in a try/catch — a failed dispatch must never escalate into a worker job failure.

**Kill switch:** `PIPELINE_NOTIFICATIONS_ENABLED=false` disables dispatch without a redeploy (default `true`). Use during noisy local-dev sessions.

**Out of scope for V1:** `cluster:full-plan` is not a registered BullMQ pipeline — it runs inline via `runClusterFullPlanFromBrief`, with no `worker.on('completed')` to hook. Successful spokes already fire their own `article:blog` notification, so a cluster-level event is redundant.

### Test gotcha: notification coalesce is GLOBAL, not per-user

`notifyPipelineCompletion` (and `notifyStepPaused`) coalesce by `(type, metadata->>'pipelineRunId')` across **all** users. Real-DB tests that use static run IDs (`"run-success-1"`) collide with prior test runs whose tenant owners weren't cleaned up by CASCADE (because their projects survived). The second run silently no-ops and assertions on `rows.length === 1` fail with `Received: 0`. Always stamp test `pipelineRunId` values with `Date.now() + random` so each invocation is unique. See `apps/api/test/workers/lib/pipeline-notification.test.ts` for the canonical pattern.

### social-render worker template dispatch (Spec 65.8 Day-5-followup)

`apps/api/src/workers/social-render.worker.ts` `renderSlidesViaRemotion()` dispatches by `templateKey`. The if-chain order:

1. **`FAMILY_B_TEMPLATE_KEYS`** (Spec 65.8 Day-5-followup) — `story-arc-clickbait` / `lifestyle-listicle` / `opinion-recommendation`. Reads `social_posts.content.renderInput` and asserts the discriminated `kind: "family-b"` shape (see `packages/pipelines/CLAUDE.md` "Family-B render dispatch" section). Spreads `compositionInput` + fresh `brandTokens` + `overrides` from job-data, dispatches to `renderStoryArcClickbait` / `renderLifestyleListicle` / `renderOpinionRecommendation` from `@marketing-auto/social/render-server`.
2. **`comparison-grid-4`** (Spec 60.2) — single-still grid, snapshot-pattern with the `ComparisonGrid4Input` shape.
3. **`comparison-grid-3`** (Spec 60.3 + 65.7 multi-slide) — multi-slide carousel, snapshot-pattern with the `ComparisonGrid3Input` shape.
4. **`verdict-per-use-case` / `single-tool-spotlight` / `pro-con-verdict`** (Spec 60.1 + 60.4 + 60.5) — single-still or 3-slide templates, all using the snapshot-pattern.
5. **Default** — `throw new Error('Unknown templateKey: ${templateKey}')`.

**Pre-existing gap (Spec 65.7, NOT wired):** `comparison-grid-5` / `head-to-head-vs` / `head-to-head-deep-dive` have `renderComparisonGrid5` / `renderHeadToHeadVs` / `renderHeadToHeadDeepDive` functions in `render-server.ts` but no if-branch here. They'd throw `Unknown templateKey` at render time today. Fix shape is identical to the `comparison-grid-3` branch (multi-slide snapshot pattern). Owner: Spec 65.7 follow-up.

**Adding a new template branch:** (1) widen the `renderServer` dynamic-import type signature at the top, (2) add an `else if (templateKey === "<new-key>")` branch BEFORE the catch-all, (3) read `social_posts.content.renderInput` for the snapshot, (4) spread `brandTokens` + `overrides` from job-data, (5) call the matching render function. The snapshot must already be persisted at INSERT time by the matching `RenderSlidesStep` branch — never reconstruct it from job-data alone (re-renders must use the persisted snapshot, NOT job-data).

## Worker-Restart bei Pipeline-Code-Änderungen

**Wann nötig**: Jede Änderung an Files unter
- `packages/pipelines/src/`
- `packages/adapters/*/src/import/` (oder andere pipeline-relevante Adapter)
- BullMQ-Worker-Code in `apps/api/src/workers/`

**Warum**: Der BullMQ-Worker lädt Pipeline-Steps beim Start. Neuer Code wird
erst nach Restart aktiv. Im Dev-Mode ohne `--hot` läuft der Worker als
Daemon-Process unverändert weiter.

**Wie**:

```bash
# PID-Datei zeigt den aktuell laufenden Worker
cat tmp/worker.pid

# Restart: neuer Worker liest PID-Datei, sendet SIGTERM an alten Prozess und startet dann selbst
bun --filter @marketing-auto/api run worker:restart
```

## Single-Worker-Garantie (PID-Datei)

Der Worker schreibt beim Start seine PID in `tmp/worker.pid` (Projektroot).
Bei jedem Start wird geprüft, ob ein Prozess mit der gespeicherten PID noch läuft — falls ja,
wird ihm SIGTERM gesendet und **bis zu 20s mit 200ms-Polling gewartet** bis er tatsächlich
exit'et (signal 0 returns ESRCH). Falls nach 20s noch lebt → SIGKILL.

- `tmp/worker.pid` ist in `.gitignore` — kein Commit nötig
- `pkill` ist **nicht mehr nötig** — `worker:restart` startet einfach einen neuen Worker, der
  den alten automatisch ablöst
- Stale PID-Datei (Prozess tot) wird beim nächsten Start stillschweigend ignoriert
- `releasePidLock()` **liest erst, löscht nur wenn die PID-Datei noch unsere eigene PID enthält** — sonst hat ein neuer Worker bereits übernommen und wir würden seinen Lock kapern
- Nach dem `writeFile(PID_FILE, ownPid)` verifiziert der Worker per re-read dass seine PID wirklich drin steht — falls ein paralleler Restart gewonnen hat: `process.exit(0)` clean

**Diagnostik bei "worker:restart wirkt nicht"**: `bun --filter @marketing-auto/api worker:status` —
zeigt PID-File-Inhalt, Process-Liveness, Redis-Connectivity und BullMQ-Queue-Counts (active/waiting/delayed).

**Symptom "alter Code läuft trotz Restart"** (z.B. ein bereits gefixter Step crasht weiter):
mehrere Worker-Prozesse koexistieren als Geister aus früheren fehlgeschlagenen Restarts.
BullMQ load-balanced über alle connected Workers — einer davon hat noch den alten Code.
Diagnose: `ps aux | grep "bun.*workers/index" | grep -v grep` — wenn mehr als eine Zeile,
manuell den falschen killen (`kill -TERM <pid>`, fall-through SIGKILL). Danach `tmp/worker.pid`
checken — falls leer/falsch, einen frischen Start machen. Der `1cfe5bd` Hardening-Fix
verhindert NEUE Geister, kann aber existierende nicht rückwirkend einsammeln.

**BullMQ `lockDuration`**: Auf 10 Minuten gesetzt (default: 30s). LLM-Jobs dauern bis zu 15 min.
Würde der Lock ablaufen, könnte BullMQ den Job als "stalled" markieren und einem anderen Worker
geben — was doppelte API-Kosten verursachen würde. `maxStalledCount: 0` deaktiviert Auto-Retry
bei Stalls zusätzlich. **Konsequenz für worker:restart**: `pipelineWorker.close()` im alten
Worker wartet bis aktive Jobs draining sind — kann bis zu `lockDuration` dauern. Deshalb das
20s-Polling statt fixem Sleep (Spec 62.6-followup fix `1cfe5bd`).

## Tests
- Run with `bun --filter @marketing-auto/api test`. The script `cd`s to repo root before invoking `bun test` so `.env` auto-loads — `server.ts` calls `getEnv()` at import, which would fail without it. Same recursion gotcha as `packages/db` / `packages/core`: don't run `bun run test` from inside the package.
- **Custom timeout = 3rd positional arg, not Vitest options object.** Bun's `it()` / `test()` signature is `(label, fn, timeoutMs?)`. The Vitest-style `it(label, { timeout: 15_000 }, fn)` form is a typecheck error (`'timeout' does not exist in type '(done: ...) => void | Promise<unknown>'`) because Bun's types only have the function-shaped second argument. Use `it("label", async () => { … }, 15_000)`. Same applies to `test()`, `beforeAll()`, etc. Spec 65.3 follow-up cleared a stale Vitest-style form in [`test/routes/briefs-bulk-actions.test.ts`](test/routes/briefs-bulk-actions.test.ts).

## Auth Patterns (Spec 04 + 31)
- Session middleware: `sessionLoader` (populates `c.var.user`) runs on `*`; `requireAuth` (enforces) runs on protected routes only
- Cookie name: `ma_session` — httpOnly, SameSite=Lax, Secure in prod only
- Tokens: always hash with SHA-256 before DB storage (`hashToken()`); raw token only in email/cookie, never in logs
- Add users manually: `bun --filter @marketing-auto/api add-user <email> [name] [owner|editor]`
- **All article action routes require auth**: `articleRoutes.use(requireAuth)` is applied at router level in `src/routes/articles.ts`. All 4 endpoints (`/generate`, `/continue`, `/sync`, `/validate-pagespeed`) return 401 without a valid session cookie.
- **Magic-link endpoints**: `POST /api/auth/magic-link/request` (request link) and `POST /api/auth/magic-link/verify` (verify + JSON response) are the current API. Legacy `POST /login` and `GET /verify?token=` (redirect flow) are kept for backward compat.
- **`APP_BASE_URL` must be the frontend origin** (e.g. `http://localhost:3051`), not the API origin. Magic-link emails link to `APP_BASE_URL/auth/verify?token=...` (the frontend verify page), and redirect-flow responses go to `APP_BASE_URL/inbox`. If set to the API URL, the links and redirects will 404.
- **`/me` response shape**: `{ ok: true, data: { id, email } }` — only id and email. `name` and `role` are available on the DB user row but not currently exposed; add them if RBAC is needed.
- **Email shim** (`src/lib/email.ts`): always return `SendEmailResult` (not `void`) so callers can check `.delivered` to detect the SMTP-not-configured dev fallback and log the verify URL.

## Trend Synthesizer Worker (Spec 54.5 + 63.4 refactor)

`src/workers/trend-synthesizer.ts` — synthesis of `external_signals` into `topic_briefs`. Spec 63.4 collapsed the original 3-stage fan-out (`schedule-daily → synthesize-all → synthesize-project`) into a single per-project handler driven by the `cron_state` orchestrator pattern (parallel to `planner-weekly-generation` from 62.7 and `comparison-discovery` from 63.3b).

### Single job shape

The worker validates `{ projectId, type?: "cron-triggered" | "synthesize-project" }` via Zod `.passthrough()` so both entry points reduce to `handleSynthesizeProject(projectId)`:

1. **Per-project cron tick** (Spec 63.4) — `cron-orchestrator` adds a repeatable BullMQ job named `trends_synthesizer:<projectId>` with data `{ projectId, type: "cron-triggered" }` whenever `cron_state.is_active = true` for that project.
2. **Legacy manual `synthesize-project`** — still accepted so the CLI script (`bun --filter @marketing-auto/api trends:synthesize <slug>`) and the 2 HTTP manual-trigger routes (`apps/api/src/routes/trends.ts`, `apps/api/src/routes/projects/cron.ts`) keep working without changes.

### Janitor

Each run stamps signals older than 14 days that were never processed:

```typescript
await db.update(externalSignals)
  .set({ processedAt: new Date() })
  .where(and(
    eq(externalSignals.projectId, projectId),
    isNull(externalSignals.processedAt),
    lt(externalSignals.collectedAt, new Date(Date.now() - 14 * 86_400_000)),
  ))
  .returning({ id: externalSignals.id });
```

### Cron (per-project via cron_state)

The cron_job_type enum value `trends_synthesizer` (note: plural) pre-exists since Spec 56.6 — **no enum-widening migration is needed**. `seedTrendSynthesizerCron()` runs at worker startup and on project create (`routes/projects.ts`) to idempotently insert a `cron_state` row with `is_active: false` and the default pattern `0 1 * * *` (daily 01:00 UTC). Marcel toggles per-project in SettingsPlannerPage.

The Spec 54.5 global `registerTrendSynthesizerCron()` + the `TREND_SYNTHESIZER_CRON` env var were removed in 63.4 — no migration needed since the function was already commented-out at worker startup, leaving no BullMQ repeatable to clean up.

Cadence granularity is daily-or-weekly: `project_planner_config.trend_synth_cron_day_of_week` is `nullable integer` — `null` → daily (`0 H * * *`), `0..6` → weekly (`0 H * * DOW`). Helper: `buildTrendSynthCronPattern(dayOrNull, hour)` in `packages/db/src/helpers/project-planner-config-write.ts`.

### Brief persistence pattern

The `TrendDiscoveryTopicSource` returns briefs without persisting — the worker owns the transaction (54.1 convention). Drizzle insert requires stripping `undefined` fields because Zod-inferred `TopicBriefInsert` uses `field?: T | undefined` while Drizzle's `$inferInsert` uses `field?: T`:

```typescript
type DrizzleInsert = typeof topicBriefs.$inferInsert;
const rows = briefs.map(
  (b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) as DrizzleInsert,
);
await db.transaction(async (tx) => { await tx.insert(topicBriefs).values(rows); });
```

### Manual trigger

```bash
bun --filter @marketing-auto/api trends:synthesize <slug>
```

Enqueues a `synthesize-project` job with a unique jobId. Useful during dev without waiting for the cron.

## Scheduler Pattern
Scheduled jobs live as `registerScheduledJob()` calls in `src/workers/index.ts`, not as standalone processes. The handler function can be extracted to its own file (see `src/workers/article-scheduler.ts`) that exports a single tick function for testability. Gate optional schedulers behind an env flag checked at registration time so they never fire in envs where the flag is absent.

## Runtime Cron Toggle Pattern (Spec 56.6)

Per-project cron schedules are driven by the `cron_state` DB table rather than hardcoded BullMQ repeating jobs. `src/workers/cron-orchestrator.ts` runs every minute, reads active rows from `cron_state`, and syncs BullMQ repeating jobs to match.

When a Settings PATCH changes `trendsCronEnabled` or `refreshCronEnabled`:
1. Upsert the `cron_state` row (in the route handler)
2. Mirror the flag to `projects` table (for fast reads in list endpoints)
3. Call `syncCronJobs()` in the background (fire-and-forget) so the change takes effect within seconds without waiting for the next orchestrator tick

Manual "Run Now" buttons POST to `/:slug/cron-status/run` with `{ jobType }`. This enqueues a one-off job directly — separate from the repeating schedule.

The main project PATCH (`PATCH /api/projects/:slug`) also handles `trendsCronEnabled` / `refreshCronEnabled` fields and upserts `cron_state` inline. This is intentional: the frontend Settings page saves all discovery config in one request to the project PATCH rather than requiring a separate cron-status call. Both code paths (project PATCH and cron-status PATCH) end up calling `syncCronJobs()` fire-and-forget.

### Startup catch-up for missed daily fires

BullMQ repeating jobs do NOT backfire missed schedules — if the worker is offline at the cron minute, that day's run is lost silently. In dev (worker not on overnight) this means daily `signal_collector_*` jobs never fire via the scheduled path. `catchUpStaleSignalCollectors()` in [cron-orchestrator.ts](src/workers/cron-orchestrator.ts) runs once on `registerCronOrchestrator()` and idempotently enqueues a one-off for any active signal-collector row whose last `external_signals` row is > 24h old. Idempotency is layered: (a) per-day deterministic jobId `<jobType>_<projectId>_catchup_<YYYY-MM-DD>` — BullMQ silently dedupes on duplicate jobIds within the same UTC day; (b) the 24h freshness guard skips when a scheduled fire actually succeeded recently. Copy this pattern for any future cron-orchestrated worker whose schedule cadence is daily or coarser.

## Optional-Body POST Endpoints
When a POST endpoint has all-optional body fields, `zValidator("json", ...)` will hard-fail (400 with raw parse error) if the client sends no body or no `Content-Type: application/json`. Instead, parse manually:
```typescript
const rawBody = await c.req.json().catch(() => ({}));
const body = MySchema.safeParse(rawBody).data ?? {};
```

## Mixed Public/Private Routes Pattern
When a router has some public and some auth-protected endpoints (e.g. `systemRoutes`), apply `requireAuth` **per-route**, not at router level:
```typescript
systemRoutes.get("/status", ...)            // public
systemRoutes.post("/credentials", requireAuth, zValidator(...), ...)  // protected
systemRoutes.post("/verify/:adapter", requireAuth, ...)               // protected
```
Business logic shared across those handlers goes in `src/lib/<domain>-service.ts` (not `packages/core`) when it has no project_id context and is tightly coupled to the HTTP layer. See `src/lib/system-service.ts`.

## Pipeline Trigger Pattern (Spec 41)

All pipeline-trigger endpoints must use one of the two helpers in `src/routes/_lib/trigger-helpers.ts`. They enforce three guards in order: (1) project-pause → 423, (2) cost-budget pre-flight → 402, (3) idempotency → 200 deduped.

**`triggerWithPreRunId(opts)`** — use when the route owns the `pipeline_runs` row. It pre-INSERTs the row before enqueueing and returns `{ runId, jobId, deduped }`. Use `triggerResultToResponse(c, result)` to send the HTTP response.

```typescript
const result = await triggerWithPreRunId({
  pipelineName: "article:outline",
  projectId: article.projectId,
  uniqueKey: { field: "articleId", value: id },
  costEstimate: { service: "anthropic", operation: "outline-generation" },
  extraInput: { articleId: id },
  enqueue: enqueueArticleOutlinePipeline,
});
return triggerResultToResponse(c, result);
```

**`checkTriggerAllowed(opts)`** — use when the caller already manages its own `pipeline_runs` row (e.g., cold-start triggers that call `enqueuePipeline()` internally). Returns `null` if allowed, or an error result. Use `guardErrorToResponse(c, blocked)` for the error path.

```typescript
const blocked = await checkTriggerAllowed({ pipelineName, projectId, uniqueKey, costEstimate });
if (blocked) return guardErrorToResponse(c, blocked);
// ... caller does its own enqueue
```

HTTP semantics: 202 = new run, 200 = deduped (run already exists), 402 = cost limit, 423 = project paused.

**Adapter-specific audit tables + `checkTriggerAllowed`**: when a pipeline maintains its own audit table (e.g. `astroImportRuns`) in addition to `pipelineRuns`, use `checkTriggerAllowed`. When it returns `deduped: true`, it gives back the `pipelineRuns.id`, not the adapter audit row ID. Query the adapter table separately — `SELECT id FROM astro_import_runs WHERE project_id = $1 AND status IN ('pending','running') LIMIT 1` — to return the correct ID to the frontend.

**Cron-workers may also call `triggerWithPreRunId`** (Spec 62.7). Workers in `src/workers/*.worker.ts` are inside the API package and can import from `routes/_lib/trigger-helpers.ts` directly. Use this when a scheduled job must respect the same three guards an HTTP-triggered run would — instead of calling `enqueuePipeline` / `enqueueXxxPipeline` directly, which skips pause/cost/idempotency. Canonical example: `planner-weekly-generation.worker.ts` triggers `planning:weekly` with `{ planKey: \`${year}-${week}\` }` as the uniqueKey, so multiple fires in the same week dedupe automatically.

DO NOT add a new trigger endpoint that bypasses these helpers — cost + idempotency must always be enforced at the HTTP boundary.

## Route Param Enum Validation Pattern

When validating a route parameter against a typed `as const` array, widen the **array** to accept `string`, not the value being tested:

```typescript
const validServices = ["anthropic", "replicate"] as const;
// ✅ correct — widen the array
if (!(validServices as readonly string[]).includes(service)) { ... }
// ❌ wrong — casts the value before checking, defeating the guard
if (!validServices.includes(service as typeof validServices[number])) { ... }
```

After the guard the type is still `string`, so cast explicitly if you need the narrowed type downstream.

## Common Mistakes to Avoid
- DO NOT copy a stored `renderInput` snapshot 1:1 in a re-render endpoint — call `template.buildInput(article, discovery)` to rebuild it so DB-state changes since the original render are picked up. The snapshot is frozen at original-render time; if a tool icon was missing from `project_brand_assets` then but has since been resolved (or if `domainExtras` was edited), a 1:1 copy carries the stale data forward and the user clicks "Re-Render" forever without seeing the fix. The pattern: read the article + sibling-locale article (if requested locale differs from source) + discovery row, call `template.buildInput()`, fall back to the stored snapshot in a try/catch with `log.warn` if rebuild crashes. See `POST /:articleId/template-renders/:renderId/re-render` in `apps/api/src/routes/social-posts.ts` for the canonical implementation (Spec 63.X). The original snapshot is still kept on the superseded row for history.
- DO NOT trust `bun --hot` to pick up Zod schema changes on Hono routes — `zValidator(schema)` middleware is captured at module-eval time inside `.get(..., zValidator(...), handler)`. When `--hot` re-evaluates the route file, a new Hono router instance is built with the new middleware, but `server.ts` still holds a reference to the old router that was mounted at startup. Handler code updates take effect; schema validation does not. Symptom: a freshly-added query param is silently dropped (Zod strips unknown keys) and the endpoint returns identical filtered results to the pre-change schema. Fix: full process restart (`Ctrl-C` + re-run the dev script). Caught when `?readiness=ready` looked accepted but the filter never narrowed the result set.
- DO NOT define pure helper functions inline in route files when they need unit tests — extract them to `src/lib/<name>.ts` and import from there. Route-level private functions are invisible to test files. Pattern: `detectDivergence()` was a private function in `articles.ts`; extracted to `src/lib/divergence.ts` so `test/lib/divergence.test.ts` can import and test it directly. See `apps/api/src/lib/divergence.ts` for the canonical example.
- DO NOT use `await import(...)` inside a `mock.module()` callback — the callback is synchronous and `await` inside it is a syntax error. Import the real module at the top of the test file before calling `mock.module()`, or omit real-module re-exports from the mock entirely if the test only needs the DB layer.
- DO NOT do business logic in route handlers — that goes in /packages/core (or `src/lib/<domain>-service.ts` for bootstrap/system routes without project context)
- DO NOT call adapters directly from routes — always via core services (exception: installer verify flow per spec Decision 10, with a justification comment). When adding a new adapter verify flow, the verify function MUST live in `packages/adapters/<name>/src/verify.ts` (exported via `"./verify"` subpath) and be imported from there — do NOT define it inline in `system.ts`. All existing adapters follow this pattern: `verifyAnthropic`, `verifyReplicate`, `verifySmtp`, etc. all live in their adapter packages. The system.ts header comment ("each adapter owns its verify logic") is the rule, not just documentation.
- DO NOT add a new credentials-managed adapter without updating ALL FIVE sites in one PR — silent partial readiness produces a 400 Bad Request on save AND a permanently-missing Verify button (because status never flips to `configured: true`): (1) `credentialSchema.service` z.enum in [routes/system.ts](src/routes/system.ts:79) — gates POST `/api/system/credentials`; (2) `adapterEnum` z.enum in [routes/system.ts](src/routes/system.ts:141) — gates POST `/api/system/verify/:adapter`; (3) `runVerifyByAdapter()` switch case in the same file — dispatches to the verify function; (4) `getAllAdapterStatuses()` in [lib/system-service.ts](src/lib/system-service.ts:43) — feeds `/api/system/status`, the data source for the frontend's "configured" badge AND the gate for showing the Verify button; (5) the `adapters` array in [apps/web/src/pages/settings/SettingsCredentialsPage.vue](../../apps/web/src/pages/settings/SettingsCredentialsPage.vue) — renders the credential card. **Plus the `validServices` DELETE allow-list at [routes/system.ts:127](src/routes/system.ts:127)** — missing it makes `DELETE /api/system/credentials/<service>` 400 silently; not a launch blocker but rots the disconnect-flow. Spec 65.8 caught `nano-banana` had been missing since 64.6 and fixed it alongside the new entries.

  **Portal-completeness vs API-completeness gating (Spec 65.8 Marcel-feedback):** when an external service's developer portal exposes MORE credential fields than the API call actually uses (Unsplash → `application_id` + `access_key` + `secret_key`, but Search API needs only `access_key` for Client-ID auth), gate the two states differently: `getAllAdapterStatuses("unsplash", [...all 3 keys])` requires the FULL portal set for the green "configured" badge (so partial entry stays "not configured" — matches Marcel's mental model "enter what the portal shows"), while `runVerifyByAdapter` cases gate ONLY on what the call actually needs (`access_key` alone). Document the split inline at both sites — the comment in [system-service.ts](src/lib/system-service.ts) explains why all 3 are required for configured, the comment in [routes/system.ts](src/routes/system.ts) explains why verify is narrower. Same pattern applies to any future adapter whose portal-row is wider than its read-only API. Caught Spec 64.6 follow-up: nano-banana had (2)+(3) wired but (1) was missing (→ 400 on save) and (4) was missing (→ `status.configured` stayed `undefined` → `isConfigured` always false → no Verify button). Frontend dictionary lookup is by `adapter.id` (kebab-case literal like `"nano-banana"`), so the return-object key in `getAllAdapterStatuses` MUST be the literal kebab-case string, not a camelCased rename — `github_app` shipped with the camelCased latent bug `githubApp` until the GitHub-App UI landed (post-Spec-44 follow-up), which forced the rename to `"github_app"` so the Settings page could resolve the status. When an adapter accepts **multiple interchangeable keys** (e.g. github_app's `private_key_content` OR `private_key_path`, either counts as configured), `getAdapterStatus(service, requiredKeys[])` can't express "at least one of N" — write a custom helper alongside it. Canonical example: `getGitHubAppStatus()` in [lib/system-service.ts](src/lib/system-service.ts) mirrors the generic helper's shape but encodes the OR-logic in the `missingKeys` calculation.
- DO NOT use `process.env` directly — use typed `getEnv()` from @marketing-auto/shared
- DO NOT use console.log — use the pino logger
- DO NOT omit `--env-file ../../.env` from package.json scripts — `bun --filter` runs from the package dir, not the repo root, so `.env` at the root is not auto-loaded. Every script that touches `getEnv()` (directly or via imports) needs this flag.
- DO NOT import `requireAuth` from `"../middleware/require-auth"` — the file is `src/middleware/auth.ts`. Correct import: `import { requireAuth } from "../middleware/auth.ts"`. A wrong path silently crashes the server at startup with a module-not-found error.
- DO NOT mount a route file at a specific prefix (e.g. `/api/articles`) if that file contains routes whose paths don't start with that prefix (e.g. `/projects/:slug/…`). Those routes become unreachable. Extract them into a separate named export (e.g. `legacyArticleRoutes`) and mount that separately at the broader prefix (`/api`). See `src/routes/articles.ts` + `src/server.ts` for the canonical example.
- DO NOT register a named sub-route (e.g. `/across-projects`) after a wildcard param route (e.g. `/:id`) in the same Hono router — Hono matches in registration order, so `/:id` silently captures the named route as `id="across-projects"`. Always register specific named paths before wildcard params. See the ordering in `src/routes/articles.ts` (line ~87 `across-projects` before line ~128 `/:id`). **Extended (Spec 64.20 A2 T2):** the conflict also applies to **3-segment paths** when the trailing segment is identical — `POST /:slug/inventory/:id/approve` vs `POST /:slug/inventory/discovery/approve` both share trailing `/approve`, and Hono's trie router matches `:id="discovery"` (HTTP 500 from "invalid input syntax for type uuid") unless the literal-only route is registered first. Same rule for 2-segment: `PATCH /:slug/inventory/:id` vs `PATCH /:slug/inventory/cron-status`. The trie-router cannot disambiguate by structural shape alone when both branches have the same arity — registration order wins. Canonical fix sites: [routes/projects/inventory.ts](src/routes/projects/inventory.ts) cron-status routes (line ~164) AND discovery/approve+reject routes (line ~440) BOTH moved above their `:id` siblings.
- DO NOT count "already-X" state in a bulk-mutate endpoint AFTER the UPDATE that flips rows to X — the freshly-flipped rows match the post-state predicate and inflate the count. Snapshot the predicate-match set BEFORE the UPDATE, then count from the snapshot. Canonical pattern: `POST /:slug/inventory/discovery/approve` in [routes/projects/inventory.ts](src/routes/projects/inventory.ts) — pre-snapshots `alreadyApprovedRows = SELECT ... WHERE approvedAt IS NOT NULL` BEFORE the `UPDATE ... SET approvedAt = NOW() WHERE approvedAt IS NULL`. Math: `notFound = requested - approved - alreadyApproved`. Caught Spec 64.20 A2 T2 by the 3-way mix test (1 unapproved + 1 already-approved + 1 ghost UUID → assertion checked `{approved:1, alreadyApproved:1, notFound:1}`, post-UPDATE query returned 2 already-approved).
- DO NOT use `z.string().optional()` for query params that must match a known enum set — an invalid value passes validation and produces a silent empty result instead of a 400. Use `z.enum(VALID_VALUES).optional()` so the boundary rejects bad input. See the `lane` param in `articles.ts` for the canonical example.
- DO NOT apply `isBlogBrief` detection to `translation_created` routing results — translation briefs have `locale !== null && clusterId !== null` and would incorrectly enter the blog pipeline. Gate the check on `routeResult.kind === "article_created"` only. Translation mode is Spec 54.10. See `src/routes/projects.ts` line ~852.
- DO NOT build a raw `sql\`... ANY(ARRAY[${ids.join(",")}])\`` clause for a list of IDs — even with UUID strings that contain no special characters, this bypasses Drizzle's parameterised binding. Use `inArray(col, ids)` from `@marketing-auto/db` instead. Caught during Spec 54.12 Session 3 review in `retry-failed-spokes`.
- DO NOT call `.set({ updatedAt: new Date() })` on the `clusters` table — it has no `updatedAt` column (check the schema before adding timestamps to any `.update().set()`). The `topicBriefs` and `articles` tables do have `updatedAt`.
- DO NOT cast `run.input as Record<string, unknown>` to read JSONB fields when the column can be SQL NULL — `null as Record<string, unknown>` produces `null` at runtime and any property access on it throws. Always guard first: `const input = run.input ?? {}; const articleId = typeof input.articleId === "string" ? input.articleId : undefined;`
- DO NOT call a pipeline-specific enqueue wrapper (e.g. `enqueueBlogGeneration`, `enqueueRefreshPipeline`) from the retry endpoint — those wrappers create new articles / validate briefs, which is wrong for retry (article and brief already exist). Use `enqueuePipeline` directly with `{ ...originalInput, retriedFromRunId: failedRunId }`. Block `cluster:plan` and `cold-start:*` with 422 (not retryable via this path).
- DO NOT omit `stream.onAbort` cleanup in SSE endpoints that open a Redis subscriber — each SSE client gets its own `IORedis` subscriber connection; without `onAbort(() => { subscriber.unsubscribe(channel); subscriber.quit(); })`, abandoned connections accumulate and exhaust the Redis connection pool. See `src/routes/projects/pipeline-events.ts` for the canonical pattern.
- DO NOT use `like` from `@marketing-auto/db` — it is not re-exported from the workspace DB package. Use `ilike` instead (case-insensitive LIKE; acceptable for all current use-cases since pipeline names and slugs are already lowercase). If case-sensitive matching is ever needed, add `like` to `packages/db/src/index.ts`.
- DO NOT define helper functions in a route file without `export` if a scoped sibling under `routes/projects/` needs to share them — `import { fn } from "../pipeline-runs.ts"` only works when the function is exported. When creating a scoped sub-route that mirrors an existing route's logic, export the shared helpers rather than copy-pasting them.
- DO NOT pass `isNull(subquery)` to exclude rows — it compiles but produces wrong SQL. The correct pattern for "exclude rows present in another table" is LEFT JOIN + `isNull(joinedTable.id)`: `.leftJoin(otherTable, and(eq(...), eq(...))).where(isNull(otherTable.id))`. See `refresh-detector.ts` and `refresh.ts` for the canonical example.
- DO NOT add a second network round-trip when `autoApproveGaps = true` in the `/suggest` handler — auto-generation fires inline after the dual-write (brief + gap metadata), using `decideRoute` + `executeDecision` + `triggerWithPreRunId` with the in-memory `updatedBrief` object. The response is enriched with `{ autoTriggered: true, articleId, runId, jobId }` so the frontend knows immediately. Errors during auto-trigger (cost limit, routing skip, exception) fall through to return the plain suggestion with `autoTriggered: false` — the suggestion itself never fails due to auto-approval.

- DO NOT interpolate a numeric variable directly into an `INTERVAL` sql template — Drizzle binds it as a parameter and PostgreSQL rejects `INTERVAL $1 days`. Use `sql.raw(String(n))` for the number: `` sql`COALESCE(...) < NOW() - INTERVAL '${sql.raw(String(days))} days'` ``. Only safe for integers derived from DB config (not user input). Caught in Spec 56.6 `needsRefresh` and `discovery-counts` expressions.
- DO NOT set `lastEditedAt` (or any "user-edited" timestamp) on every PATCH — distinguish content-field changes from workflow-state changes. A status-only PATCH (e.g. `status: "approved"`) is a workflow action and must NOT set `lastEditedAt`; only changes to title, metaDescription, slug, cornerstoneKeyword, or bodyMd count as content edits. Setting it on status changes creates false divergence warnings (e.g. divergence banner appears after Marcel approves a freshly translated article). Pattern: `const isContentEdit = input.title !== undefined || input.metaDescription !== undefined || ...; if (isContentEdit) patch.lastEditedAt = now;`
- DO NOT add a new cron job type without updating all 4 places: (1) SQL migration (`ALTER TYPE cron_job_type ADD VALUE`), (2) Drizzle `cronJobTypeEnum` in `packages/db/src/schema/cron.ts`, (3) `getQueueForJobType()` switch in `cron-orchestrator.ts`, (4) `allQueues` array AND `isCronOrchestrated` startsWith check in `syncCronJobs()`. Missing any one silently ignores jobs or causes TypeScript errors at runtime. See migration 0054 + cron-orchestrator.ts for the canonical pattern.
- DO NOT seed `cron_state` rows in the SAME SQL migration that adds the `cron_job_type` enum value — PostgreSQL forbids using a newly-added enum value in the session that added it, even across separate migration transactions in one migrator run (`invalid input value for enum cron_job_type: "..."`). Pattern: enum-only migration + idempotent seed at worker startup via `onConflictDoNothing` on the `(project_id, job_type)` unique constraint. Also insert the row at project creation in `routes/projects.ts` so new projects get it immediately without waiting for the next worker restart. See `seedStepPauseCleanupCron()` in `apps/api/src/workers/step-pause-cleanup.worker.ts` for the canonical pattern (Spec 62.0a Section 4.5.3).
- DO NOT let a post-failure or post-cancel cleanup query throw out of its outer handler — wrap in try-catch. Pipeline failure handlers in `runner.ts` and HTTP cancel handlers in routes have already persisted the terminal state by the time cleanup runs; an exception here either (a) propagates to BullMQ and escalates a failed pipeline into a retry (re-running paid LLM steps), or (b) turns a successful HTTP cancel into a 500. Log a `warn` and continue. The 6h `step_pause_cleanup` worker is the backstop for any stale rows. Same convention as the existing `afterError` / `afterComplete` hook wrapping in `runner.ts`. See Spec 62.0a Section 4.5.2 sites for the canonical pattern.
- DO NOT instantiate `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })` directly in a worker — credentials live in the `global_credentials` vault, not env, in any deployment that ran through the installer. Workers that talk to the Anthropic SDK directly (because the batch lifecycle endpoints are not exposed via the adapter, e.g. `batch-processor.worker.ts`) must replicate the adapter's vault-first pattern: `const fromVault = await getGlobal("anthropic", "api_key"); const apiKey = fromVault ?? getEnv().ANTHROPIC_API_KEY;`. Cache the resulting client in a module-level singleton. Same rule for any future worker that bypasses an adapter (Reddit OAuth refresh, R2 admin ops, etc.). Caught by Spec 62 pre-flight smoke-test.
- DO NOT write a "detector" worker that only emits SSE events without persisting to the table the UI reads from — `refresh-detector.ts` initially only published a `refresh.detected` event and returned candidates as a function result; `refresh_suggestions` stayed empty forever. Workers that produce UI-visible state must INSERT (idempotent via `onConflictDoNothing((article_id, source))`). And: re-runs must also DISMISS obsolete rows for items no longer matching the condition (e.g. article was refreshed since last detection) — otherwise the UI keeps showing stale entries. Pattern: compute `obsoleteIds = activeRows.filter(r => !currentMatches.has(r.articleId))` then `db.update().set({ dismissedAt: now }).where(inArray(refreshSuggestions.id, obsoleteIds))`. See `detectStaleArticles` in `apps/api/src/workers/refresh-detector.ts`.
- DO NOT use `coalesce(lastRefreshedAt, publishedAt, updatedAt)` for "effective freshness" of imported Astro articles — `articles.frontmatterUpdatedAt` (the Astro `updated:` frontmatter field) is the author's edit-marker and must come FIRST in the coalesce. `lastRefreshedAt` is set only by the refresh pipeline; for imported content it stays at `publishedAt`. Correct order: `coalesce(frontmatterUpdatedAt, lastRefreshedAt, publishedAt, updatedAt)`. Same column ordering must be replicated everywhere staleness is computed (worker + `/refresh-candidates` endpoint) or the two views diverge.
- DO NOT assign `pipeline_runs.status` directly to an `ActivityEntry.status` field — the DB enum is wider than the UI's `NormalizedStatus` union, and adding any new enum value (e.g. `batch_pending`, `paused`, `superseded`) silently widens the assignment site beyond what the UI handles. Always wrap with `normalizeStatus(pr.status)` from `src/routes/pipeline-runs.ts`. When a new `pipelineRunStatusEnum` value lands, update both the `NormalizedStatus` union AND the `map` inside `normalizeStatus()` — internal-only states (`superseded`) map to a UI-visible terminal (`failed`); user-actionable states (`paused`) get their own UI surface. Caught in Spec 62.0a Session 1 when the enum widened with `paused` + `superseded`.
- DO NOT widen a `z.unknown()` Zod-validated payload field into a typed Drizzle jsonb column without acknowledging the boundary cast — Zod's `z.unknown()` produces `unknown` (functionally accepts any JSON value); Drizzle's `$type<Record<string, unknown>>()` is a TypeScript hint only and does not enforce at the column level. The cast `payload.editedInput as Record<string, unknown>` at the service layer (e.g. `step-pause-service.ts` for Spec 62.0a) is functionally safe because (a) jsonb accepts the value regardless, and (b) downstream consumers re-validate with their own Zod schema (e.g. `step.inputSchema.parse()` re-validates on re-execute). Keep these casts at the service boundary, not in the route handler; document with a comment that re-validation happens downstream.
- DO NOT add a post-UPDATE "collision detection" check in a route that writes to a table with a partial unique index — the index already accepted-or-rejected the operation by the time the check runs, so the check is always dead code. Either (a) trust the constraint and let a violation surface as a 500 (acceptable for race conditions on single-tenant tables), or (b) catch the unique-violation error from the helper and translate to 409 in the route. The naive pattern "UPDATE → SELECT-peer → log warn" was caught during Spec 62.2 /review-task on `PATCH /projects/:slug/goals/:goalId`; the post-check never fires for non-race cases and only logs (does nothing) for race cases. See [apps/api/src/routes/project-goals.ts](apps/api/src/routes/project-goals.ts) PATCH handler for the canonical "trust the index" form. Same rule applies any time a route reactivates a soft-deleted row that would conflict with an existing active sibling.
- DO NOT implement "PUT replace = full state" semantics for a collection without wrapping the diff in a `db.transaction()` — partial failures (one INSERT works, the next fails) leave the active set in an inconsistent intermediate state with no rollback. The canonical pattern is `replaceProjectGoals()` in `packages/db/src/helpers/project-goal-write.ts`: load existing active rows → for each body row, INSERT new or UPDATE match → soft-delete any active row whose discriminator is absent from the body, all inside one `db.transaction(async (tx) => { ... })`. Reuse this shape for any future collection upsert endpoint (e.g. project tags, cron schedules, brand tokens sections).
- DO NOT use `:` in a BullMQ `jobOptions.jobId` — BullMQ rejects it at runtime with `Custom Id cannot contain :`. The `name` field accepts colons (signal-collector worker dispatches on `name.startsWith("signal_collector_hackernews:")`), but the `jobId` cannot. Use `_` or `-` as separators for the deterministic-jobId dedup pattern. Same constraint already documented for `anthropicCustomId` in root CLAUDE.md.
- DO NOT assume a BullMQ repeating job (`repeat: { pattern }`) will eventually catch up missed daily fires when the worker comes back online — BullMQ silently advances `next` to the following slot when the worker is offline at the scheduled minute, dropping that day's run entirely. For any daily-or-coarser per-project cron registered via `cron-orchestrator`, add a startup catch-up like `catchUpStaleSignalCollectors()`: load active `cron_state` rows on `registerCronOrchestrator()`, compare against a domain-specific "last successful run" signal (e.g. `MAX(external_signals.collected_at)`), and enqueue a one-off with a per-day deterministic `jobId` so multiple restarts dedup. Caught Spec 62 signal-adapter diagnosis: HN had only 2 rows ever despite a correctly-registered `signal_collector_hackernews` BullMQ repeat — the worker was offline at every scheduled 00:30 Berlin fire.

## Gap Routes — TopicBrief as SSoT (Spec 54.3)

Three routes under `/api/projects/:slug/content-gaps/:id/` consume `TopicBrief` as the Single Source of Truth:

### `/suggest` (idempotency pattern)
1. Load brief by `gapId` + `approvalStatus IN ['pending','approved']` → 404 if missing
2. Idempotency check: `if (brief.secondaryKeywords.length > 0 && brief.primaryKeyword)` → return `{ cached: true, clusterUpdated: false, briefId }` without any adapter call
3. Call `suggestGapTitle()` from `src/lib/gap-service.ts` (returns data, does NOT write cluster)
4. Write to `topicBriefs` only (NOT `clusters.satelliteKeywords`)
5. Dual-write to `contentGaps.metadata` for backward compat
6. Response: `{ suggestedTitle, suggestedSlug, suggestedMeta, primaryKeyword, secondaryKeywords, briefId, clusterUpdated: false, cached: false }`

`clusterUpdated` is ALWAYS `false` after Spec 54.3 — kept in response for backward compat shape only.

### `/generate` (routing pattern)
1. Load brief by `gapId` → 404 if no active brief
2. `const decision = decideRoute(brief)` (pure, from `@marketing-auto/pipelines`)
3. `const result = await db.transaction(async (tx) => executeDecision(decision, brief, tx))`
4. For article/translation: **detect blog brief** (see below), trigger either blog or outline pipeline, update `contentGaps`, return with `briefId`
5. For cornerstone_spec: update `contentGaps.filledBySpecId`, return with `briefId`
6. For skip: return 422

**Blog brief detection (Spec 54.9):** `isBlogBrief(brief)` = `brief.locale !== null && brief.clusterId !== null`. When true, enqueue `article:blog` via `enqueueBlogGenerationPipeline` (pass `briefId` in `extraInput`). When false, enqueue `article:outline` via `enqueueArticleOutlinePipeline` as before. The trend brief approval endpoint (`trends.ts`) always routes to `article:blog` because all trend briefs have locale + clusterId (the endpoint already guards `if (!brief.clusterId)` → 400 before reaching the enqueue call).

### `/automate` (chain pattern)
Same brief load + `decideRoute` + `executeDecision` in transaction, then `startChain()` outside the transaction (BullMQ call must not be inside a DB transaction). Returns `{ chainId, articleId, briefId, deduped: false }`. Note: `/automate` still enqueues `article:outline` (the chain's first step) — blog pipeline integration via chain is deferred to Spec 54.10.

**DO NOT** call `decideRoute` / `executeDecision` directly from routes without the brief — the brief is the SSoT. The gap metadata in `contentGaps` is secondary (backward compat only).

## Pipeline-Runs Resolve + Rerun (Spec 62.6)

The resolve endpoint `POST /api/pipeline-runs/:id/step-pauses/:stepPauseId/resolve` handles 8 actions. The 8th — `rerun` — is unique:

1. **Pre-flight gate** — `resolveStepPause()` calls `computeRerunImpact()` BEFORE the atomic DB resolve. If the impact reports `requiresConfirm: true` and the payload omits `confirmDestructive: true`, the service returns `{ ok: false, status: 409, error: "destructive_confirm_needed", impact }`. The route surfaces `impact` in the response body so the UI can render the type-DELETE dialog without an extra round-trip.
2. **Cleanup-then-resume** — after the atomic resolve, the service calls `executeRerunCleanup()` (from `@marketing-auto/pipelines`) which: marks later child step-runs as `superseded`, auto-dismisses any later step_pauses, deletes idempotency-cache rows for step N..end, trims `suspensionCheckpoint.accumulatedOutput`, then runs the pipeline-specific cleanup hook if registered. The trimmed `accumulatedOutput` becomes the `priorOutput` passed to `enqueuePipeline`.
3. **Preflight-only endpoint** — `GET /api/pipeline-runs/:id/step-pauses/:stepPauseId/rerun-preflight` returns the impact preview without mutating state. Pure read; used by the UI before the user opts in to the destructive case.

The cleanup-hook registry (`registerRerunCleanupHook(pipelineName, hook)`) is forward-compat. PlanWeekPipeline does NOT register a hook because `PersistPlanStep.pausableInDebug() === false` AND it's the last step — no paused state can carry DB writes that need reverting. Register a hook only when the pipeline has a pausable step AFTER a step that writes DB state.

**SSE events emitted by the resolve flow**: `step.resolved` (always), `run.statusChanged` (paused → running on re-enqueue, paused → cancelled on abort). The runner emits `step.paused` + `run.statusChanged` (running → paused) after persisting a new pause. All three are added to `PipelineEvent` in `packages/core/src/events/pipeline-events.ts` and mirrored in `apps/web/src/types/ui.ts`.

## Plan Execution Worker (Spec 62.8)

`startPlanExecutionWorker()` in `src/workers/plan-execution.worker.ts` consumes the `plan-execution` queue (defined in `packages/pipelines/src/execution/plan-execution-queue.ts`). `concurrency: 1`, `attempts: 1`. The worker validates `{ planId, triggeredBy? }` via Zod and calls `executePlan(planId)` from `@marketing-auto/pipelines/execute-plan`. Registered in `workers/index.ts` alongside the other BullMQ workers.

**New endpoints in `routes/projects/plans.ts`:**
- `PATCH /:slug/plans/:planId` — extended so a `status=approved` transition enqueues `plan-execution` (deterministic jobId `plan-exec-${planId}`); response carries `executionEnqueued: boolean`.
- `POST /:slug/plans/:planId/cancel-pending` — bulk cancels pending + enqueued items via `cancelPendingItemsForPlan`. Returns `{ cancelled, generatingUntouched }`.
- `POST /:slug/planned-items/:itemId/retry` — only items in `failed` state. 409 on wrong-state, then re-enqueues plan-execution.
- `GET /:slug/plans/:planId/progress` — aggregated item counts (`getPlanItemCounts`) + current plan status. Cheap GROUP BY backed by the partial-indexed `status` column.

**SSE events emitted from plan execution**: `plan.item.statusChanged` (every status flip, with `blockReason` / `failureReason` when relevant) and `plan.statusChanged` (when `maybeFinalizePlanStatus` rolls the plan to completed / partially_failed). Both added to `PipelineEvent` in `packages/core/src/events/pipeline-events.ts` + `apps/web/src/types/ui.ts` + listener `handlePlannerExecutionEvent` in `usePipelineEvents.ts`.

## Notifications Deploy Checklist (Spec 40)

When deploying to production for the first time (after local development):

1. **Generate fresh VAPID keys** for production. Nicht die localhost-Keys wiederverwenden:
   ```
   bunx web-push generate-vapid-keys
   ```
   Prod-Env aktualisieren: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

2. **Localhost-Subscriptions löschen** (sie sind an den dev-Origin gebunden):
   ```sql
   DELETE FROM push_subscriptions WHERE endpoint LIKE '%localhost%' OR endpoint LIKE '%127.0.0.1%';
   ```

3. **Service Worker erreichbar unter `/push-service-worker.js`** — im Prod-Build verifizieren.

4. **HTTPS required in production.** Service Worker Registration auf Nicht-localhost erfordert HTTPS.

5. **Täglicher Prune**: `POST /api/admin/prune-notifications` per Cron oder manuell wöchentlich:
   ```
   curl -X POST -H "Cookie: ma_session=..." https://your-domain/api/admin/prune-notifications
   ```

## Project Target-Locales + Target-Niche

### Target-Locales

`projects.targetLocales` (jsonb array, default `["de-DE"]`) controls which markets
Cold-Start pipelines target. Set via direct SQL — no UI yet.

Examples:
- DACH-only tenant: `["de-DE"]`
- Bilingual DE/EN: `["de-DE", "en-US"]`
- International EN-only: `["en-US"]`

Supported locales in `packages/pipelines/src/cold-start/_lib/locale-context.ts`:
`de-DE` (Google.de, Germany/de), `en-US` (Google.com, USA/en), `en-GB` (Google.co.uk, UK/en).
Add new locales by extending `LOCALE_METADATA` in that file.

Phases that respect `targetLocales`:
- **Phase 2a** (`IdentifyCompetitorsStep`): prompt asks for competitors per locale; bilingual projects
  get the international/DACH distribution hint with toolify.ai / futurepedia.io examples
- **Phase 2b** (`FetchCompetitorKeywordsStep`): DataForSEO `rankedKeywords` call uses location/language
  inferred from competitor TLD (`.de`/`.at`/`.ch` → Germany/de, `.com`/`.ai`/`.io` → USA/en, `.co.uk` → UK/en)
- **Phase 3** (`GenerateClusterCandidatesStep`): prompt instructs LLM to propose clusters for each
  target locale and tag the locale in the `reasoning` field
- **Phase 4 + 5**: inherit locale from Phase 3's approved clusters (no extra config needed)

To set toolwiki as bilingual (already applied by migration 0019):
```sql
UPDATE projects SET target_locales = '["de-DE", "en-US"]'::jsonb WHERE slug = 'toolwiki';
```

### Target-Niche

`projects.targetNiche` (text, nullable) — niche tag for Cold-Start competitor discovery and
cluster generation hints. `null` = generic fallback (LLM infers niche from marketing context).
Set via direct SQL — no UI yet. Applied by migration 0020.

Known niches in `packages/pipelines/src/cold-start/_lib/niche-context.ts`:
- `"ai-tool-wiki"` — Editorial AI tool directory (toolwiki)
- `"automotive-dealer"` — Regional car dealership (DACH)
- `"solar-energy"` — Solar products + balcony power stations (DACH)

Phases that respect `targetNiche`:
- **Phase 2a** (`IdentifyCompetitorsStep`): injects niche-specific competitor examples and topical
  keywords into the discovery prompt; also removes `competitor-profiling` skill (URL-input mismatch)
- **Phase 3** (`GenerateClusterCandidatesStep`): injects topical keywords + content types as cluster
  generation hints

Adding a new niche:
1. Add entry to `NICHE_LIBRARY` in `packages/pipelines/src/cold-start/_lib/niche-context.ts`
2. Define `exampleCompetitors` (international + DACH), `topicalKeywords`, `contentTypes`
3. Set `target_niche` on relevant projects:
```sql
UPDATE projects SET target_niche = 'your-niche' WHERE slug = 'project-slug';
```

To verify toolwiki has niche set (applied by migration 0020):
```sql
SELECT slug, target_locales, target_niche FROM projects WHERE slug = 'toolwiki';
-- Expected: target_locales=["de-DE","en-US"], target_niche="ai-tool-wiki"
```

## Pipeline Chains (Per-Gap Automation, Spec 49d)

Pipeline chains orchestrate multiple existing pipelines into a single automated workflow:

```
Gap → Outline → Draft+Hero → Schema-DE → Localize→EN → Schema-EN → [Astro-Transfer]
```

### Trigger

```
POST /api/projects/:slug/content-gaps/:id/automate
```

Only for `missing_spoke_type` and `cluster_too_small` gaps. Returns `{ chainId }`.

### State Machine

State is persisted in the `pipeline_chains` table (`status`, `current_step`, `step_runs` JSONB).

```
queued → running → completed
                ↓
              failed → (resume) → running
              cancelled (terminal)
```

### Chain Advancement

Each relevant pipeline's `afterComplete` hook calls `advanceChain()` when `chainId` is present in its input. The orchestrator determines the next step and enqueues it. No auto-retry on failure (cost-anti-drain convention).

- **`outline`** → draft (approvalMode="manual" prevents auto-continue)
- **`draft`** → schema-de (chainId suppresses normal auto-schema-extension)
- **`schema-de`** → localize (creates EN sibling stub first via `createEnSibling()`)
- **`localize`** → schema-en (uses `chain.siblingArticleId` as target)
- **`schema-en`** → astro-transfer (only if `project.autoPublish=true`) or complete
- **`astro-transfer`** → complete

### Failure Recovery

UI shows Resume button when `status=failed`. Call:
```
POST /api/projects/:slug/pipeline-chains/:id/resume
```
Picks up at `failedStep`, clears error fields, re-enqueues the step.

### Auto-Publish

`projects.auto_publish` (boolean, default false) controls whether Astro-Transfer runs automatically. toolwiki has this set to `true`.

### Chain Management API

- `GET  /api/projects/:slug/pipeline-chains`            — list chains (filterable by status)
- `GET  /api/projects/:slug/pipeline-chains/:chainId`   — chain detail + step_runs + cost
- `POST /api/projects/:slug/pipeline-chains/:chainId/resume` — resume failed chain
- `POST /api/projects/:slug/pipeline-chains/:chainId/cancel` — cancel running chain

### Worker Registration

Chain callbacks are registered at worker startup in `src/workers/index.ts`:
```typescript
registerChainCallbacks(chainCallbacks);
registerSchemaChainCallbacks(chainCallbacks);
registerLocalizeChainCallbacks({ advanceChain: chainCallbacks.advanceChain });
```

After any pipeline code change, restart the worker:
```bash
bun --filter @marketing-auto/api run worker:restart
```

## Brand Asset Management (Spec 52b)

### Routes
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/api/projects/:slug/brand-assets` | List assets; optional `?assetType=tool_icon\|logo&source=…` |
| POST   | `/api/projects/:slug/brand-assets/upload` | Multipart upload (SVG/PNG/JPEG ≤500 KB); stores to R2 + upserts DB |
| DELETE | `/api/projects/:slug/brand-assets/:id` | Deletes R2 object (custom-upload only) + DB row |
| POST   | `/api/projects/:slug/brand-assets/:id/reset` | Deletes row + re-resolves via `resolveToolIcon` |
| GET    | `/api/projects/:slug/brand-tokens` | Returns tokens with defaults merged in |
| PATCH  | `/api/projects/:slug/brand-tokens` | Deep-merges `{ tokens: { colors?, typography?, voice?, social? } }` |
| POST   | `/api/projects/:slug/brand-tokens/reset` | Resets one or more sections (`{ sections?: ["typography",…] }`) |
| GET    | `/api/projects/:slug/social-posts` | Admin list of all social posts (left-joined with articles) |
| POST   | `/api/projects/:slug/social-posts/re-render-batch` | Marks posts as `replaced`, triggers new social-image pipeline per post |

### Key conventions
- `DEFAULT_TYPOGRAPHY` in `brand-asset-service.ts` is the single source of truth for typography defaults; always import from there rather than hardcoding values in route files.
- `getBrandTokens()` always merges `DEFAULT_TYPOGRAPHY` into the stored tokens before returning, so callers never need to supply their own fallback.
- The `r2_key` column on `project_brand_assets` stores the R2 object key for custom-upload assets. Delete from R2 before deleting the DB row to prevent orphaned objects.
- `exactOptionalPropertyTypes` causes `ParsedBrandTokens` (`field?: T | undefined`) to be incompatible with Drizzle's `.set()` — use `as any` with a `biome-ignore` comment when calling `.set({ brandTokens: … })`.
- Social-post batch routes live in `socialPostBatchRoutes` (separate Hono router), registered at `/api/projects` in `server.ts`. Individual-post routes stay in `socialPostDetailRoutes`.

## Tool-Icon Resolution (Spec 52a)

Entry point for API routes: `src/lib/icon-resolver.ts` (re-exports from pipelines).

Resolution chain in priority order:
1. `project_brand_assets` DB cache (project-scoped) — cache-hit skips all adapters
2. **simple-icons** — 3000+ tech/SaaS brand logos (CC0, includes Claude/Figma/Notion/Perplexity)
3. **iconify logos** — 1200+ icons (includes Midjourney/OpenAI/Flux/Anthropic)
4. **lobe-icons** — AI-focused static PNGs (Recraft/Ideogram/Hedra/Kling/etc.)
5. **Deterministic HSL avatar** with initials — NEVER emoji

Every successful resolution is written back to `project_brand_assets` with `source` + `inline_svg`.

Cache-bust: `DELETE FROM project_brand_assets WHERE asset_type='tool_icon' AND asset_key='<slug>'`

The `emoji` field was removed from `ExtractToolsStep` output in Spec 52a.
Existing posts with emoji-logos are intentionally NOT re-rendered (Spec decision).

## Template Engine (Spec 65.0 Day 1-6)

Filesystem-based registry with hot-reload, preview, persistent renders, and Day-6 soft-disable + snapshot patterns.

### Soft-disable resolution (Spec 65.0 Day 6)

`PATCH /api/projects/:slug/templates/:templateKey` flips `templates.is_active` via `setTemplateActive({projectId, templateKey, isActive})` from `@marketing-auto/db`. The helper resolves **project-scoped row first, falls back to global only if no project-scoped row exists**, and returns a discriminated `{updated, scope: "project" | "global" | null}` so the API can echo the resolved scope back to the UI. The partial unique index `templates_active_key_per_project_uniq WHERE is_active = TRUE` makes flipping safe — `false` rows fall out of the unique-key constraint scope so re-enabling never collides with concurrent enables of the same key in another scope.

`GET /api/projects/:slug/templates?includeInactive=true` widens the listing to include `is_active=false` rows. Default (omitted) preserves the pre-Day-6 active-only contract. The query param is parsed with `z.coerce.boolean().optional()` so `?includeInactive=true` and `?includeInactive=false` both work.

### Article snapshot wire-up (`articles.template_key` / `template_version`)

The two columns exist since Day 1-2 but went unwritten until Day 6. `markArticleTemplateSnapshot({articleId, templateKey, templateVersion})` in `@marketing-auto/db` is the shared write that stamps the snapshot from every `template_renders` INSERT site (Marcel-Decision §8 "current wins" — articles always point at the most recently rendered template's `file_hash`). All 4 call sites wrap the write in try-catch with `log.warn` so a snapshot-write failure NEVER breaks the render flow. Canonical sites:

- `packages/pipelines/src/article/steps/social-generation.step.ts` — pipeline auto-render after template_renders INSERT
- `apps/api/src/routes/social-posts.ts` — generate-templates endpoint + re-render endpoint (the latter fetches `projectId` fresh because `articleId` is the only param in scope)
- `apps/api/src/routes/admin.ts` — admin manual render (uses `articleRow.projectId` already in scope)

When adding a new `template_renders` INSERT site, wire the snapshot write inside the same scope with the same try/catch posture. Always call `getTemplate({projectId, templateKey})` to resolve the current `file_hash` rather than passing a stale version through pipeline state.

### Render timeout via `Promise.race`

`apps/api/src/lib/template-preview-service.ts` wraps `renderFn(renderInput)` in `Promise.race` against a 120-second `setTimeout` (constant `RENDER_TIMEOUT_MS = 120_000`). The ceiling covers Remotion's cold-bundle init + headless Chrome boot + LLM-bound sample-data renders. Note: Remotion's `renderStill` doesn't reliably surface cancel signals across backends — the user-facing response returns within budget but Chrome processes may dangle briefly (cleaned up by OS lifecycle). Use the same `Promise.race` pattern for any future endpoint that calls into Remotion or other process-spawning libraries.

### Periodic cache-copy + preview-dir sweep

`server.ts` runs `cleanupStaleCacheCopies` + `cleanupLegacyPreviewSessions` at boot (with `maxAgeMs: 0` to wipe legacy artifacts) AND every hour via `setInterval` (with `maxAgeMs: PERIODIC_SWEEP_MS = 3600000`). Add `.unref()` on the interval handle so the process can still exit cleanly in tests and signal-handler graceful-shutdown paths.

### Common Day-6 mistakes

- DO NOT call `apiPatch` from a frontend composable when the backend's 4xx response body carries structured fields the call site needs — `apiPatch` throws `Error(body.error)` and drops sibling fields. Use raw `fetch` + `res.json()` manually, returning a discriminated `Success | Failure` union to the caller. Canonical example: [`useTemplateActions.ts`](../../apps/web/src/composables/settings/useTemplateActions.ts) preserves the 404-body `templateKey` field so the UI can patch the right card by templateKey instead of by index. Same posture as `usePauseActions.ts` (Spec 62.6) for 409 `impact` body.
- DO NOT INSERT into `template_renders` without immediately calling `markArticleTemplateSnapshot` in a try/catch — the article row's `template_key` / `template_version` columns become stale and Marcel-Decision §8 ("current wins") silently breaks. All 4 existing INSERT sites use the same try/catch + log.warn pattern; copy it verbatim for new sites.
- DO NOT raise `RENDER_TIMEOUT_MS` past 120s without checking whether the BullMQ job's `lockDuration` (currently 10 min) still has comfortable headroom — a render timeout that approaches lock-duration would let BullMQ relocate the job mid-render and double-bill.
- DO NOT omit `.unref()` on a `setInterval` registered in `server.ts` — tests that import the server module for route assertions would hang waiting for the interval handle to clear.
- DO NOT add a new query-param filter (like `?includeInactive=`) to the templates GET route without also extending the `useTemplatesList` composable input + the watcher dependency array — the composable re-fetches only when watched dependencies change, so a new flag must be in the watcher tuple or it'll only kick in on the first toggle from `false`.
