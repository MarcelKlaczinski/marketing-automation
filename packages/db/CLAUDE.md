# Database Conventions

## Schema Organization
- One file per logical group: projects, identity, content, operations, auth, push
- All tables exported via `schema/index.ts`
- Type definitions for jsonb columns are co-located with the table

## Multi-Tenancy
- EVERY tenant-scoped table has `project_id` as a non-nullable FK to `projects.id`
- All queries that read/write tenant data MUST filter by `project_id`
- Cross-tenant queries are a security bug — wrap in helper that requires explicit `crossTenant: true` flag
- The `users`, `magic_link_tokens`, `sessions`, `push_subscriptions` tables are platform-wide (not tenant-scoped)

## Helpers
Single-table read helpers live in `packages/db/src/helpers/articles-read.ts` (and similar `*-read.ts` files). Single-table **write** helpers (e.g. `markArticleRefreshed`) live in `packages/db/src/helpers/articles-write.ts`. Both are exported via `packages/db/src/index.ts` as `export * from "./helpers/..."`. Do NOT create a `repos/` directory — the `helpers/` convention is established.

## Conventions
- Primary keys: `uuid` with `defaultRandom()`
- Timestamps: `timestamp({ withTimezone: true })` everywhere, `notNull()`, `defaultNow()`
- All FKs explicit `onDelete` (`cascade` for owned children, `restrict` for protected refs, `set null` for optional refs)
- JSONB for flexible config + a separate column when query-relevant
- Indexes on every FK and frequently-filtered column
- Enum types live in `_enums.ts`, prefixed with their domain
- Every new table must export `$inferSelect` and `$inferInsert` type aliases (e.g. `export type Foo = typeof foo.$inferSelect; export type NewFoo = typeof foo.$inferInsert;`) — callers in other packages need these types; omitting them causes inline `import(...)` type annotations to proliferate
- Composite primary keys use the `primaryKey({ columns: [...] })` table-constraint callback (imported from `drizzle-orm/pg-core`), not `uniqueIndex`. Canonical example: `idempotency_outputs` in `operations.ts` keys on `(idempotencyKey, pipelineName, stepName, projectId)`. The SQL migration declares `PRIMARY KEY (...)` to match.

## Migrations
- Generate with `bun --filter @marketing-auto/db generate`
- Apply with `bun --filter @marketing-auto/db migrate`
- Migrations go in `packages/db/drizzle/` (committed)
- NEVER edit applied migration files — create a new migration to fix
- For dev iteration, `drizzle-kit push` is fine (no migration file); use `generate` once schema is stable
- Both `generate` and `migrate` scripts require `--env-file ../../.env` — `drizzle-kit` calls `getEnv()` at startup and `bun --filter` runs from the package directory, not the repo root
- `drizzle-kit generate` and `drizzle-kit push` are **interactive** (column rename detection). In a non-TTY context (subprocesses, CI) they stall or exit without generating. Write the SQL manually + add to `_journal.json` instead — the `migrate` script only needs the SQL file and the journal entry, not the snapshot.

## Tests
- Run with `bun --filter @marketing-auto/db test` — DO NOT use `bun run test` from inside `packages/db/`. The script has to `cd ../..` to load `.env` from repo root, which then hits Bun's `test` script in the root `package.json` and broadcasts/recurses across workspaces. `--filter` invokes the script in a workspace-aware mode that avoids this.

## pgvector
- `embedding` columns use `vector({ dimensions: N })`
- HNSW index with appropriate distance op:
  - `vector_cosine_ops` for normalized embeddings (most common)
  - `vector_l2_ops` for L2 distance
- Embeddings are 1024-dim (Voyage AI voyage-3) — change carefully, requires re-embedding everything

## Common Mistakes to Avoid
- DO NOT drop a PostgreSQL enum directly if the column has a DEFAULT — the default holds a reference to the type and `DROP TYPE` will fail with "other objects depend on it". Sequence: `ALTER COLUMN ... DROP DEFAULT` → `ALTER COLUMN ... SET DATA TYPE text USING ...::text` → `DROP TYPE` → `CREATE TYPE` → `ALTER COLUMN ... SET DATA TYPE new_enum USING ...::new_enum` → restore default.
- DO NOT add FKs from `content.ts` tables to `operations.ts` tables — `operations.ts` already imports from `content.ts`, creating a circular dependency. Store correlation UUIDs without a DB-level FK constraint and add a comment explaining why.
- DO NOT use `serial` for IDs — use `uuid` with `defaultRandom()`
- DO NOT forget `withTimezone: true` on timestamps
- DO NOT add columns without considering `notNull()` and a sensible default
- DO NOT cross-reference tenants in queries
- DO NOT use `pgEnum` without importing from `_enums.ts`
- DO NOT modify already-applied migrations
- DO NOT use `string` for enum-typed Drizzle columns in query filters — import the enum (`costServiceEnum`, etc.) and derive the type with `(typeof fooEnum.enumValues)[number]`. Using `string` forces an `as never` cast to satisfy Drizzle's types, which silently bypasses type safety.
- DO NOT call `jsonb_array_elements()` or `jsonb_array_elements_text()` on a column that may contain objects instead of arrays — PostgreSQL throws `cannot extract elements from an object` at query time, not at write time. Guard with `WHERE jsonb_typeof(col) = 'array'` or fix the data before aggregating. Applies to any jsonb column that could hold mixed shapes across rows (e.g. `content_hooks` on `article_discovery`).
- DO NOT use today's real Unix timestamp as the `when` value in `_journal.json` for manually written migrations — the Drizzle ORM migrator skips any migration whose `when` is ≤ the `MAX(created_at)` already recorded in `__drizzle_migrations`. Always use a value strictly greater than the last existing journal entry (inspect the file, add ~100000000 as margin).
- DO NOT change a JSONB column's TypeScript type without also updating every adapter step that reads that column — the type is `$type<T>()` on the column definition, but adapter steps have their own local Zod schemas that echo the shape. Changing `Record<string,unknown>` to `Array<Record<string,unknown>>` (or any structural change) requires updating `inputSchema`/`outputSchema` in every step that touches the field, plus any integration test fixtures that hardcode the old shape.
- DO NOT cast a `$type<T>()` jsonb column value to `Record<string, unknown>` before reading its fields — the column is already typed as `T`, so access `gap.metadata?.clusterName` directly. Casting through `Record<string, unknown>` loses the type and forces `as` re-casts for every field.
- DO NOT pass a Zod-inferred type with `.optional()` fields directly to `db.insert().values()` under `exactOptionalPropertyTypes` — Zod optional fields are `T | undefined` but Drizzle's insert type expects `T | null`. Strip undefined entries first: `Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as typeof table.$inferInsert`. Safe when the mapper explicitly uses `null` (not `undefined`) for absent optional fields.
- DO NOT reference `ContentPillar` as a named import from `@marketing-auto/db` — it does not exist as an explicit export. Use `typeof contentPillars.$inferSelect` for the full type, or an inline object shape (e.g. `{ id: string; name: string }`) when only a subset of columns is needed in a function parameter. The same applies to any table that only exports the Drizzle table object but not an explicit type alias.
- DO NOT omit `project_id` from child tables just because a parent FK (e.g. `article_id`) already chains to a tenant — child tables are queried directly in many contexts and must satisfy the multi-tenant invariant independently. Pattern: `project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE` + a project index. Caught during Spec E.1a review: `refresh_suggestions` initially lacked it despite `refresh_dismissed` having it as a reference.
- DO NOT import `sql` from `drizzle-orm/pg-core` when using it inside a schema file for partial index `.where()` conditions — `sql` is not exported by `drizzle-orm/pg-core` and TypeScript will error (`Module '"drizzle-orm/pg-core"' has no exported member 'sql'`). Import `sql` from `drizzle-orm` as a separate import alongside the `drizzle-orm/pg-core` imports. Pattern: `import { index, pgTable, ... } from "drizzle-orm/pg-core"; import { sql } from "drizzle-orm";`. See `packages/db/src/schema/content.ts` `renderStatusActiveIdx` for the canonical example.
- DO NOT rely on field-level Zod `.default()` inside an object when the outer object itself uses `.default(partialValue)` — Zod's `ZodDefault._parse()` returns the outer default value as-is without re-parsing it through the inner schema. So `z.object({ a: z.string().default("x") }).default({})` returns `{}`, not `{ a: "x" }`, when the key is absent. Always make the outer `.default(...)` value fully specified (all fields explicit). Caught in `packages/db/src/schema/project-config.ts` `SignalSourcesSchema` reddit inner default missing `sortMode`, `timeWindow`, etc.
- DO NOT add a value to an existing `pgEnum` without auditing every TypeScript type that narrows it — any consumer that defines its own `NormalizedStatus = "queued" | ...` (or similar) will fail to compile when the underlying enum widens, often at a `someRow.status` assignment site. Workspace-wide `bun --filter '*' typecheck` after the schema change catches these. Canonical example: adding `paused` / `superseded` to `pipelineRunStatusEnum` in Spec 62.0a broke `NormalizedStatus` in `apps/api/src/routes/pipeline-runs.ts` at two `pr.status` assignments; fix was widening the type union AND wrapping the assignments with `normalizeStatus()` so the mapping (e.g. `superseded → "failed"`) is centralised.
- DO NOT INSERT a new "active" row BEFORE marking the prior active row as inactive when a partial unique index keys on `(scope) WHERE status NOT IN (terminal...)` — both rows are momentarily active during the INSERT and the index trips with `duplicate key value violates unique constraint`. Correct order inside the transaction: (1) `UPDATE prior SET status='superseded'`, (2) `INSERT new`, (3) optionally back-fill `prior.supersededBy = new.id`. Canonical example: `persistWeeklyPlanInTx` in `packages/db/src/helpers/weekly-plan-write.ts` for the partial unique `weekly_plans_one_active_per_week` index (Spec 62.4). Applies to any future "one active per scope" table — refresh chains, batch runs, etc.
- DO NOT cancel a parent row (e.g. `weekly_plans.status = 'cancelled'`) without sweeping its dependent child rows (`planned_items.status IN ('pending','enqueued')`) in the SAME transaction — leaving children in their pre-cancel state produces "Datenmüll" (a cancelled plan with 31 pending items) that future queries misinterpret as live work. Canonical pattern: `transitionWeeklyPlanStatus` runs `UPDATE planned_items SET status='cancelled' WHERE weekly_plan_id=$1 AND status IN ('pending','enqueued')` inside the same `db.transaction()`. `in_progress` rows are explicitly left untouched (62.8 §5.5: BullMQ can't reliably stop mid-flight). Same rule applies to any future "parent + dependent children" cancel — `pipeline_runs` + `step_runs`, `chains` + `step_runs`, etc.
- DO NOT block "cancel a running parent" transitions in a status state-machine without thinking about Marcel's recovery path — `transitionWeeklyPlanStatus` originally accepted only `draft|approved → cancelled`. A plan stuck in `running` (executor started dispatching but the user changed their mind) had NO supported exit and Marcel couldn't generate a fresh plan because the partial unique index still saw the running row. Fix: include `running` in the allowed prior states; the sweep then handles the items. Applies to any future status enum that has a non-terminal "active" middle state.
