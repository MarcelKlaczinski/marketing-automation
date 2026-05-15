# Astro Markdown Sync Adapter

Pushes a `final_review` article from the DB to its project's Astro repository as an `.mdx` file
plus a hero image asset. Commits directly to main via the GitHub App API.

## Credential Loading (Spec 32)

GitHub App credentials are resolved from the global vault first:
- `github_app.app_id` → falls back to `GITHUB_APP_ID` env var
- `github_app.private_key_content` (inline PEM, self-hosted mode) — checked first
- `github_app.private_key_path` (file path, lokal mode) → falls back to `GITHUB_APP_PRIVATE_KEY_PATH` env var

If `private_key_content` is set in vault (self-hosted), the key is used directly (no file read).
Otherwise the adapter reads the PEM from the path. Set credentials via installer or env vars.

## Hard Rules

- This adapter is the ONLY writer to Astro repos for blog content. Manual edits to generated
  `.mdx` files are silently overwritten on the next sync.
- Each sync is one atomic GitHub commit (.mdx + image + any future siblings).
- Always commits directly to main. PR-mode is reserved for Spec 21.5.
- Schema parsing is best-effort. If the Astro repo's content config is unparseable,
  the adapter emits permissive frontmatter (everything we know) and warns about unpopulated
  required fields. Marcel must either fix the regex parser or use astroFrontmatterDefaults.
- Hardcoded `collection: "blog"`. Other collections (Glossar, Case-Studies, Tools) need
  separate adapter pipelines.

## Required Environment

- `GITHUB_APP_ID` — App ID from GitHub App settings
- `GITHUB_APP_PRIVATE_KEY_PATH` — path to .pem file

See `SETUP-GITHUB-APP.md` in this package for one-time setup steps.

## Required Per-Project Configuration

Each project that wants to sync needs `projects.astro_repo` (set via Drizzle Studio):
```json
{
  "owner": "marcel-bauer",
  "name": "ki-wissensraum-astro",
  "installationId": 12345678,
  "defaultBranch": "main",
  "contentRoot": "src/content",
  "assetsRoot": "src/assets"
}
```

The installation ID comes from `bun --filter @marketing-auto/adapter-astro-sync list-installations`.

## Collection Schema Extraction (Spec 50)

On every Astro import run, `ExtractCollectionSchemasStep` (first step in `AstroImportPipeline`) fetches `src/content/config.ts` from GitHub, calls `parseAllCollectionSchemas()`, and persists the result to `projects.astroCollectionSchemas` (JSONB). Downstream pipeline steps (`TopicIntakeStep`, `OutlineStep`, `DraftStep`) read this and inject the field descriptors into the LLM system prompt so every generated article satisfies the Astro Zod schema at publish time.

`parseAllCollectionSchemas()` uses bracket-balanced extraction to parse the full `z.object({...})` body for each `defineCollection`. Field classifier produces `FrontmatterFieldDescriptor` objects with:
- `type`: `"string" | "string_array" | "object_array" | "number" | "boolean" | "date" | "unknown"`
- `enumValues?: string[]` — extracted from `z.enum([...])`
- `objectShape?: string` — inner field names for `object_array` (e.g. `"{ question, answer }"`)

**FRONTMATTER_EXTRAS protocol**: `DraftStep` instructs the LLM to output a structured HTML comment at the very end of the draft body:
```
<!-- FRONTMATTER_EXTRAS: {"category":"Guides & Tutorials","tags":["ki","chatbot"]} -->
```
The step parses this with a regex, strips it from `bodyMd`, and saves to `articles.frontmatterExtras`. `buildFrontmatter()` in `apps/api/src/routes/articles.ts` merges these extras (highest priority) with schema defaults and static columns.

**Type-cast pattern for adapter vs DB types**: `ExtractCollectionSchemasStep` returns a value typed as `FrontmatterField[]` (adapter-local) but must persist as `AstroCollectionSchemas` (DB type). Use `as unknown as import("@marketing-auto/db").AstroCollectionSchemas` with a justification comment explaining the structural identity.

**Astro silent-exclusion trap**: Astro silently excludes content entries from `getStaticPaths()` when the collection's Zod schema fails validation (missing required fields like `date`, `category`, `excerpt`). The result is a 404 with no console error. Always ensure `buildFrontmatter()` produces all required fields for the target collection — check `unpopulatedRequired` in step output after a sync.

**Config file path — Astro v4 vs v5**: Astro v4 puts `config.ts` inside `contentRoot` (e.g. `src/content/config.ts`). Astro v5 puts it one level up as `src/content.config.ts`. `ExtractCollectionSchemasStep` tries both patterns plus repo-root fallbacks — no code change needed when switching Astro versions.

## Common Mistakes

- DO NOT commit when `articles.status !== "final_review"` — adapter throws
- DO NOT manually edit a generated `.mdx`. The auto-generated header is your warning sign
- DO NOT pass binary content as text. Always set `contentType: "base64"` for images
- DO NOT cache the Octokit instance across processes. Installation tokens expire after 1h
- DO NOT access `data.owner.login` directly on `GET /app` responses — `owner` is a
  `User | Organization` union and `Organization` has no `login`. Use `"login" in owner` narrowing
- DO NOT assume `data` from `GET /app` is non-null — Octokit types it as nullable; null-coalesce
- DO NOT skip the auto-generated header in mdxContent — it's the only signal Marcel has
  that the file was machine-written
- DO NOT use the regex schema parser as if it were authoritative. It's a heuristic.
  Always check `unpopulatedRequired` field in step output
- DO NOT use a non-greedy regex to extract the `z.object({...})` schema body — it stops
  at the first `})` inside any nested field (e.g. `z.object({})`). Use bracket counting instead
  (see `bracketBalanced()` in `resolve-schema.ts`)
- DO NOT check `z.string()` before `z.array(z.string())` in the field classifier — the array
  pattern also contains `z.string()`, so more-specific checks must come first
- DO NOT assign `outputSchema = SomeSchema` in a step class when the schema has `.default()`
  fields — Zod's `_input` variance (`string | undefined`) conflicts with `BaseStep`'s
  `ZodType<TOutput>` generic. Cast with `as z.ZodType<OutputType>` (same pattern as pipelines)
- DO NOT sync to an Astro repo that has no commits yet — an empty repo has no `main` branch,
  so every GitHub API path lookup returns 404. The adapter will fail at `resolve-schema` with
  "Could not find Astro content config". Bootstrap the repo first (create at least one commit
  with a `src/content/config.ts`). The bootstrap script pattern: blobs → tree → commit →
  `POST /git/refs` with no `parents` array.
- DO NOT access `.content` directly after narrowing `GET /repos/{owner}/{repo}/contents/{path}`
  with `!Array.isArray()` — the union type still includes symlink (which has no `.content`).
  Cast to `{ type: string; content?: string; size: number }` before reading the field.
- DO NOT add a new stage to `AstroSyncError` without checking whether it should be persisted to
  `astro_sync_runs.error_stage`. The DB column only accepts: `load | schema | image | render | commit | db_update | stale_read`.
  Stages `auth` and `config` are error categories for the load phase and intentionally excluded from
  the DB column (they indicate config problems, not pipeline-stage failures). See `afterError()` in
  `pipeline.ts` for the filter list.
- DO NOT use `targetWhere` that only partially matches a partial index predicate in Drizzle's
  `onConflictDoUpdate` — PostgreSQL requires the `targetWhere` clause to match the index predicate
  EXACTLY (every condition). The `topic_briefs_unique_open_per_gap` index has TWO conditions:
  `WHERE "gap_id" IS NOT NULL AND "approval_status" IN (...)`. If `targetWhere` only has the
  `approval_status IN (...)` part, Postgres throws "there is no unique or exclusion constraint
  matching the ON CONFLICT specification" at runtime. Always reproduce the full index WHERE clause.

## Gap Detection (Spec 54.3)

`DetectContentGapsStep` counts ALL project articles regardless of `source` (imported, generated,
manual). The `eq(articles.source, "imported")` filter was removed in Spec 54.3 (Tech Debt #1).
Generated and imported articles now equally count toward:
- Cluster size (`cluster_too_small` threshold of 3)
- Intent coverage (`missing_spoke_type` check)
- Translation pairing (`missing_translation` check)
- Hub presence (`missing_hub` check)

## Performance / Cost

Per article sync (KI-Wissensraum profile):
- ~5-6 GitHub API calls (1 ref read, 1 commit read, 2 blobs, 1 tree, 1 commit, 1 ref update)
- ~500KB binary upload (hero image)
- Time: ~10-30 seconds per article
- Cost: €0 (GitHub API is free; R2 download is free for us as customer)
