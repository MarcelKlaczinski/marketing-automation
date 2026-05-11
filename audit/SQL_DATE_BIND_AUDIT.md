# SQL Date-Bind Bug Audit
Generated: 2026-05-11

## Rule

Drizzle typed operators (`gte`/`lte`/`gt`/`lt`/`eq`/`ne`) auto-serialize Date → ISO string.  
`sql` template literals bypass this — postgres.js receives a raw `Date` and throws:
```
TypeError: "string" argument must be of type string or instance of Buffer. Received an instance of Date
at postgres.js/bytes.js (bind step)
```

## Found Issues

| File | Line | Code snippet (before) | Classification | Status |
|------|------|----------------------|----------------|--------|
| `packages/core/src/cost/enforcement.ts` | 82 | `sql\`... >= ${startOfDay}\`` | CASE A | ✅ FIXED (commit `4d72f59`) — converted to `startOfDayIso = startOfDay.toISOString()` |

## Files Audited (Clean — no issues)

**packages/core/**
- `src/cost/enforcement.ts` — already fixed; only `startOfDayIso` (string) in sql template
- `src/cost/pause.ts` — no sql templates
- `src/notifications/index.ts` — sql templates use IS NOT NULL / count(*) only; Date comparisons use `gte`/`lt`/`isNull`
- `src/credentials/vault.ts` — no sql templates
- `src/credentials/global-vault.ts` — no sql templates

**packages/pipelines/src/**
- `engine/runner.ts` — all Date usage in `.set()` / `.values()` (Drizzle handles)
- `engine/scheduler.ts` — no sql templates; Date in `.where(gte(...))` (Drizzle handles)
- `cold-start/triggers.ts` — no sql templates
- `article/trigger.ts` — no sql templates
- `schema-extension/trigger.ts` — no sql templates
- All other pipeline step files — no sql templates

**packages/adapters/**
- `astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts` — sql template uses `IS NULL` only, no Date

**packages/db/src/**
- No sql template literals found

**apps/api/src/routes/**
- `cost.ts` — sql templates use aggregate functions (`coalesce`, `sum`, `to_char`) and column references; Date comparisons via `gte`/`lte` (Drizzle handles)
- `articles.ts` — sql templates: `MAX(...)`, `!= id` (string). `fiveMinAgo` Date used with `gte(...)` (Drizzle handles). Clean.
- `clusters.ts` — sql templates: position comparisons (numbers), `IS NOT NULL`. Clean.
- `pillars.ts` — sql templates: position comparisons (numbers). Clean.
- `notifications.ts` — no sql templates; heartbeat uses `Date.now()` for arithmetic only
- `push-subscriptions.ts` — no sql templates
- `cold-start.ts` — no sql templates; Date in `.set()` (Drizzle handles)
- `pipeline-runs.ts` — no sql templates; Date in `gte(...)` (Drizzle handles)
- `cornerstone-specs.ts` — no sql templates
- `projects.ts` — no sql templates
- `admin.ts` — no sql templates
- `auth.ts` — no sql templates; `gt(sessions.expiresAt, new Date())` (Drizzle handles)
- `_lib/trigger-helpers.ts` — sql templates use string fields only (`uniqueKey.field/value`)

**apps/api/src/middleware/**
- `auth.ts` — no sql templates; Date in `gt(...)` (Drizzle handles)

**apps/api/src/lib/**
- `cleanup.ts` — no sql templates; Date in `lt(sessions.expiresAt, new Date())` (Drizzle handles)
- `system-service.ts` — no sql templates

**apps/api/src/workers/**
- `article-scheduler.ts` — no sql templates

## Total sql`` Template Locations (19 total, all audited)

| File | Lines | Variables interpolated | Safe? |
|------|-------|----------------------|-------|
| `packages/core/src/cost/enforcement.ts` | 82, 91, 209, 210 | `startOfDayIso` (string), `service` (string), `thresholdType` (string) | ✅ |
| `packages/core/src/notifications/index.ts` | 192, 243, 263 | `count(*)`, `IS NOT NULL` | ✅ |
| `packages/adapters/astro-sync/…/sync-clusters-from-frontmatter.ts` | 250 | `IS NULL` | ✅ |
| `apps/api/src/routes/cost.ts` | 81, 88, 89, 99, 100, 105, 109, 110, 114, 115, 128, 133, 139, 140, 144, 145, 214 | aggregate functions, column refs, string casts | ✅ |
| `apps/api/src/routes/articles.ts` | 228, 310 | `MAX(...)`, `id` (string) | ✅ |
| `apps/api/src/routes/clusters.ts` | 226, 237, 317 | `position` (number), `IS NOT NULL` | ✅ |
| `apps/api/src/routes/pillars.ts` | 153, 164 | `position` (number) | ✅ |
| `apps/api/src/routes/_lib/trigger-helpers.ts` | 77, 153 | `uniqueKey.field` (string), `uniqueKey.value` (string) | ✅ |

## Test Coverage

- Regression test added: `packages/core/test/sql-date-bind.test.ts` (1 test — positive path)
- All 17 existing core tests still pass (18 total, 0 fail)
- Test verifies: `sql` template with `.toISOString()` executes without error

## CLAUDE.md Update

Convention added to root `CLAUDE.md` under `## SQL Date-Binding Convention`.

## Conclusion

**No new fixes needed.** The single instance of this bug (commit `4d72f59`) was already fixed before this audit. All 19 `sql` template literal sites in the codebase are safe — none interpolate a raw `Date` object. The regression test and CLAUDE.md convention guard against future occurrences.
