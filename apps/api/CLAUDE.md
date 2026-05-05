# Backend API Conventions

## Structure
- routes/        HTTP endpoints (Hono routes), thin glue
- workers/       BullMQ workers (heavy lifting)
- webhooks/      Inbound webhooks (Telegram, Stripe later)
- middleware/    Hono middleware (auth, logging, cost-context)

## Endpoint Patterns
- All endpoints use Zod-validated input via @hono/zod-validator
- All responses follow { ok: true, data } | { ok: false, error } shape
- Auth via magic-link middleware (Resend), NOT JWT for MVP
- Long-running operations: queue a BullMQ job, return job_id, client polls or subscribes via WebPush

## Worker Patterns
- One worker per queue, queue name = step name (e.g. "draft-generation")
- Steps must be idempotent (re-runnable safely)
- Always wrap external calls in cost-tracker decorator
- Always log structured (pino, JSON output)

## Common Mistakes
- DO NOT do business logic in route handlers (that goes in /packages/core)
- DO NOT call adapters directly from routes (always via core services)
- DO NOT use process.env directly — use typed config from /packages/shared
