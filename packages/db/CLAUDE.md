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

## Conventions
- Primary keys: `uuid` with `defaultRandom()`
- Timestamps: `timestamp({ withTimezone: true })` everywhere, `notNull()`, `defaultNow()`
- All FKs explicit `onDelete` (`cascade` for owned children, `restrict` for protected refs, `set null` for optional refs)
- JSONB for flexible config + a separate column when query-relevant
- Indexes on every FK and frequently-filtered column
- Enum types live in `_enums.ts`, prefixed with their domain

## Migrations
- Generate with `bun --filter @marketing-auto/db generate`
- Apply with `bun --filter @marketing-auto/db migrate`
- Migrations go in `packages/db/drizzle/` (committed)
- NEVER edit applied migration files — create a new migration to fix
- For dev iteration, `drizzle-kit push` is fine (no migration file); use `generate` once schema is stable
- Both `generate` and `migrate` scripts require `--env-file ../../.env` — `drizzle-kit` calls `getEnv()` at startup and `bun --filter` runs from the package directory, not the repo root

## Tests
- Run with `bun --filter @marketing-auto/db test` — DO NOT use `bun run test` from inside `packages/db/`. The script has to `cd ../..` to load `.env` from repo root, which then hits Bun's `test` script in the root `package.json` and broadcasts/recurses across workspaces. `--filter` invokes the script in a workspace-aware mode that avoids this.

## pgvector
- `embedding` columns use `vector({ dimensions: N })`
- HNSW index with appropriate distance op:
  - `vector_cosine_ops` for normalized embeddings (most common)
  - `vector_l2_ops` for L2 distance
- Embeddings are 1024-dim (Voyage AI voyage-3) — change carefully, requires re-embedding everything

## Common Mistakes to Avoid
- DO NOT use `serial` for IDs — use `uuid` with `defaultRandom()`
- DO NOT forget `withTimezone: true` on timestamps
- DO NOT add columns without considering `notNull()` and a sensible default
- DO NOT cross-reference tenants in queries
- DO NOT use `pgEnum` without importing from `_enums.ts`
- DO NOT modify already-applied migrations
- DO NOT use `string` for enum-typed Drizzle columns in query filters — import the enum (`costServiceEnum`, etc.) and derive the type with `(typeof fooEnum.enumValues)[number]`. Using `string` forces an `as never` cast to satisfy Drizzle's types, which silently bypasses type safety.
