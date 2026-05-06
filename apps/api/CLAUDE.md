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

## Worker Patterns
- One worker per queue, queue name = step name (e.g., "draft-generation")
- Steps must be idempotent (safe to re-run)
- Always wrap external calls in cost-tracker decorator
- Always log structured (pino, JSON output)

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

## Common Mistakes to Avoid
- DO NOT do business logic in route handlers — that goes in /packages/core
- DO NOT call adapters directly from routes — always via core services
- DO NOT use `process.env` directly — use typed `getEnv()` from @marketing-auto/shared
- DO NOT use console.log — use the pino logger
- DO NOT omit `--env-file ../../.env` from package.json scripts — `bun --filter` runs from the package dir, not the repo root, so `.env` at the root is not auto-loaded. Every script that touches `getEnv()` (directly or via imports) needs this flag.
