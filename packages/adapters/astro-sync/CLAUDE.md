# Astro Markdown Sync Adapter

Pushes a `final_review` article from the DB to its project's Astro repository as an `.mdx` file
plus a hero image asset. Commits directly to main via the GitHub App API.

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

## Performance / Cost

Per article sync (KI-Wissensraum profile):
- ~5-6 GitHub API calls (1 ref read, 1 commit read, 2 blobs, 1 tree, 1 commit, 1 ref update)
- ~500KB binary upload (hero image)
- Time: ~10-30 seconds per article
- Cost: €0 (GitHub API is free; R2 download is free for us as customer)
