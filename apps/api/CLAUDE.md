# Backend API Conventions

## Structure
- `src/server.ts`         Hono server entrypoint, middleware setup
- `src/routes/`           HTTP endpoints, thin glue layer
- `src/workers/`          BullMQ workers (added in Spec 05)
- `src/webhooks/`         Inbound webhooks (added later)
- `src/middleware/`       Custom Hono middleware (auth, cost-context)
- `src/lib/`              Local utilities (logger setup, helpers)

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
# Aktuellen Worker-PID finden
ps aux | grep "workers/index" | grep -v grep

# Restart (oder via npm-script):
bun --filter @marketing-auto/api run worker:restart
```

**npm-Script** (`apps/api/package.json`):

```json
"worker:restart": "pkill -f 'apps/api/src/workers/index' || true; sleep 1; bun --env-file ../../.env apps/api/src/workers/index.ts &"
```

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

## Scheduler Pattern
Scheduled jobs live as `registerScheduledJob()` calls in `src/workers/index.ts`, not as standalone processes. The handler function can be extracted to its own file (see `src/workers/article-scheduler.ts`) that exports a single tick function for testability. Gate optional schedulers behind an env flag checked at registration time so they never fire in envs where the flag is absent.

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
- DO NOT do business logic in route handlers — that goes in /packages/core (or `src/lib/<domain>-service.ts` for bootstrap/system routes without project context)
- DO NOT call adapters directly from routes — always via core services (exception: installer verify flow per spec Decision 10, with a justification comment)
- DO NOT use `process.env` directly — use typed `getEnv()` from @marketing-auto/shared
- DO NOT use console.log — use the pino logger
- DO NOT omit `--env-file ../../.env` from package.json scripts — `bun --filter` runs from the package dir, not the repo root, so `.env` at the root is not auto-loaded. Every script that touches `getEnv()` (directly or via imports) needs this flag.
- DO NOT import `requireAuth` from `"../middleware/require-auth"` — the file is `src/middleware/auth.ts`. Correct import: `import { requireAuth } from "../middleware/auth.ts"`. A wrong path silently crashes the server at startup with a module-not-found error.
- DO NOT mount a route file at a specific prefix (e.g. `/api/articles`) if that file contains routes whose paths don't start with that prefix (e.g. `/projects/:slug/…`). Those routes become unreachable. Extract them into a separate named export (e.g. `legacyArticleRoutes`) and mount that separately at the broader prefix (`/api`). See `src/routes/articles.ts` + `src/server.ts` for the canonical example.
- DO NOT register a named sub-route (e.g. `/across-projects`) after a wildcard param route (e.g. `/:id`) in the same Hono router — Hono matches in registration order, so `/:id` silently captures the named route as `id="across-projects"`. Always register specific named paths before wildcard params. See the ordering in `src/routes/articles.ts` (line ~87 `across-projects` before line ~128 `/:id`).
- DO NOT use `z.string().optional()` for query params that must match a known enum set — an invalid value passes validation and produces a silent empty result instead of a 400. Use `z.enum(VALID_VALUES).optional()` so the boundary rejects bad input. See the `lane` param in `articles.ts` for the canonical example.

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
