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

## Worker Patterns
- One worker per queue, queue name = step name (e.g., "draft-generation")
- Steps must be idempotent (safe to re-run)
- Always wrap external calls in cost-tracker decorator
- Always log structured (pino, JSON output)

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
wird ihm SIGTERM gesendet und 2s gewartet, bevor der neue Worker die Queue übernimmt.

- `tmp/worker.pid` ist in `.gitignore` — kein Commit nötig
- `pkill` ist **nicht mehr nötig** — `worker:restart` startet einfach einen neuen Worker, der
  den alten automatisch ablöst
- Stale PID-Datei (Prozess tot) wird beim nächsten Start stillschweigend ignoriert

**BullMQ `lockDuration`**: Auf 10 Minuten gesetzt (default: 30s). LLM-Jobs dauern bis zu 15 min.
Würde der Lock ablaufen, könnte BullMQ den Job als "stalled" markieren und einem anderen Worker
geben — was doppelte API-Kosten verursachen würde. `maxStalledCount: 0` deaktiviert Auto-Retry
bei Stalls zusätzlich.

## Tests
- Run with `bun --filter @marketing-auto/api test`. The script `cd`s to repo root before invoking `bun test` so `.env` auto-loads — `server.ts` calls `getEnv()` at import, which would fail without it. Same recursion gotcha as `packages/db` / `packages/core`: don't run `bun run test` from inside the package.

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

## Trend Synthesizer Worker (Spec 54.5)

`src/workers/trend-synthesizer.ts` — daily synthesis of `external_signals` into `topic_briefs`.

### Three job types (mirrors signal-collector pattern)

```
schedule-daily  →  synthesize-all  →  synthesize-project (one per project)
```

- `schedule-daily`: fans out to a single `synthesize-all` job
- `synthesize-all`: queries all projects, fans out one `synthesize-project` per project
- `synthesize-project`: runs the full per-project synthesis pipeline (janitor + `TrendDiscoveryTopicSource.emit()` + brief insert)

### Janitor

Each `synthesize-project` run stamps signals older than 14 days that were never processed:

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

### Cron

Registered in `src/workers/index.ts` via `registerTrendSynthesizerCron()`:
- Default: `30 1 * * *` (01:30 UTC — 60 min after signal-collector at 00:30)
- Override: `TREND_SYNTHESIZER_CRON` env var

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
- DO NOT define pure helper functions inline in route files when they need unit tests — extract them to `src/lib/<name>.ts` and import from there. Route-level private functions are invisible to test files. Pattern: `detectDivergence()` was a private function in `articles.ts`; extracted to `src/lib/divergence.ts` so `test/lib/divergence.test.ts` can import and test it directly. See `apps/api/src/lib/divergence.ts` for the canonical example.
- DO NOT use `await import(...)` inside a `mock.module()` callback — the callback is synchronous and `await` inside it is a syntax error. Import the real module at the top of the test file before calling `mock.module()`, or omit real-module re-exports from the mock entirely if the test only needs the DB layer.
- DO NOT do business logic in route handlers — that goes in /packages/core (or `src/lib/<domain>-service.ts` for bootstrap/system routes without project context)
- DO NOT call adapters directly from routes — always via core services (exception: installer verify flow per spec Decision 10, with a justification comment). When adding a new adapter verify flow, the verify function MUST live in `packages/adapters/<name>/src/verify.ts` (exported via `"./verify"` subpath) and be imported from there — do NOT define it inline in `system.ts`. All existing adapters follow this pattern: `verifyAnthropic`, `verifyReplicate`, `verifySmtp`, etc. all live in their adapter packages. The system.ts header comment ("each adapter owns its verify logic") is the rule, not just documentation.
- DO NOT use `process.env` directly — use typed `getEnv()` from @marketing-auto/shared
- DO NOT use console.log — use the pino logger
- DO NOT omit `--env-file ../../.env` from package.json scripts — `bun --filter` runs from the package dir, not the repo root, so `.env` at the root is not auto-loaded. Every script that touches `getEnv()` (directly or via imports) needs this flag.
- DO NOT import `requireAuth` from `"../middleware/require-auth"` — the file is `src/middleware/auth.ts`. Correct import: `import { requireAuth } from "../middleware/auth.ts"`. A wrong path silently crashes the server at startup with a module-not-found error.
- DO NOT mount a route file at a specific prefix (e.g. `/api/articles`) if that file contains routes whose paths don't start with that prefix (e.g. `/projects/:slug/…`). Those routes become unreachable. Extract them into a separate named export (e.g. `legacyArticleRoutes`) and mount that separately at the broader prefix (`/api`). See `src/routes/articles.ts` + `src/server.ts` for the canonical example.
- DO NOT register a named sub-route (e.g. `/across-projects`) after a wildcard param route (e.g. `/:id`) in the same Hono router — Hono matches in registration order, so `/:id` silently captures the named route as `id="across-projects"`. Always register specific named paths before wildcard params. See the ordering in `src/routes/articles.ts` (line ~87 `across-projects` before line ~128 `/:id`).
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
- DO NOT add a new cron job type without updating all 4 places: (1) SQL migration (`ALTER TYPE cron_job_type ADD VALUE`), (2) Drizzle `cronJobTypeEnum` in `packages/db/src/schema/cron.ts`, (3) `getQueueForJobType()` switch in `cron-orchestrator.ts`, (4) `allQueues` array in `syncCronJobs()`. Missing any one silently ignores jobs or causes TypeScript errors at runtime. See migration 0054 + cron-orchestrator.ts for the canonical pattern.

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
