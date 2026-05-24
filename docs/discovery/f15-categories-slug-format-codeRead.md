# F1.5 — `categories` Slug-Format Code-Read

_Date: 2026-05-24_
_Spec: [`specs/006-follow-up-robustness.md`](../../specs/006-follow-up-robustness.md)_
_Predecessor: Mini-Cleanup-Followups Spec 004 / F1_

## 1. Problem (recap)

Re-Import-Forecast against Toolwiki reported `categories: 31 inserts + 30 dbOnly`
instead of the expected `0 inserts + 30 matched`. Root cause: slug-format
mismatch between [`repo-inventory.json`](../../apps/api/src/scripts/discovery/repo-inventory.json)
and the live `articles` table.

## 2. Three-way analysis

### 2.1 Astro frontmatter (source of truth)

Each file in [`src/content/categories/<scope>/<bare-slug>.md`](file:///Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/content/categories/blog/comparisons.md)
declares two separate fields:

```yaml
slug: "comparisons"
scope: "blog"
translations: { de: { label, urlSlug }, en: { label, urlSlug } }
```

- **`slug`** is the bare identifier (`comparisons`, `ethics-law`, `fundamentals`).
- **`scope`** is the subdirectory (`blog`, `knowledge`, `tool`) — also encoded
  in the file path, but redundantly stored in frontmatter for the Astro
  renderer's convenience.

Path-prefix is filesystem layout convention, NOT part of the canonical
identifier. Bare-slug is canonical at the source.

### 2.2 Importer ([packages/adapters/astro-sync](../../packages/adapters/astro-sync))

`parseMdxContent()` in [`parse-frontmatter.ts:97`](../../packages/adapters/astro-sync/src/import/parse-frontmatter.ts):

```ts
const filenameSlug = filePath.match(/([^/]+)\.mdx?$/)?.[1] ?? "";
const slug = fm.slug ?? filenameSlug;
```

→ Reads frontmatter `slug:` first (bare), falls back to file basename (also
bare). Path-prefix is never preserved. `UpsertArticlesStep` writes this
bare slug into `articles.slug`.

The full `scope` is preserved in `domain_extras->>'scope'` (jsonb) because
`extras` captures everything that isn't in the typed-field set
([`parse-frontmatter.ts:111`](../../packages/adapters/astro-sync/src/import/parse-frontmatter.ts:111)).

### 2.3 Inventory generator (formerly `audit-repo-inventory.ts`)

Deleted in commit `32b0c54` as "obsolete discovery audit script", but the
last-committed `repo-inventory.json` still reflects its output. The relevant
function was:

```ts
function slugFromPath(rootPrefix: string, path: string): string {
  const rel = path.replace(rootPrefix + "/", "");
  return rel.replace(/\.(md|mdx)$/, "");
}
```

For `noLocaleSplit` collections (the `else` branch when no `de/` subdir
exists), it called `slugFromPath(root, file)` where `root = "src/content/categories"`
— so for `src/content/categories/blog/comparisons.md`, the relative path
`blog/comparisons.md` keeps the `blog/` subdirectory and produces
`"blog/comparisons"`.

For locale-split collections (the `if` branch), it called
`slugFromPath(deDir, file)` where `deDir = "src/content/<coll>/de"` — the
files in there are flat (no further nesting), so the slug naturally ends up
bare.

→ **`categories` is the only collection in the Toolwiki repo today that
uses `noLocaleSplit`** (verified via filesystem walk: all 8 other
collections have a `de/` subdirectory). So the bug is scoped to `categories`.

## 3. Decision: Option A — DB canonical (bare slugs)

Per spec §F15.1.2 recommendation:

- DB is already bare-slug. No migration.
- Astro frontmatter is already bare-slug. No content-side change.
- Inventory generator is the lone outlier. One-file fix.
- Path-prefix in the inventory was never used by any consumer
  (`forecastReImportState` matches on slug only; no other reader).
- Per Marcel's selection: emit a separate `scopes` map for future
  disambiguation needs, even though no current consumer reads it.

## 4. Pre-existing data-integrity discovery (out of Spec 006 scope)

Walking the `categories` directory revealed a slug collision the importer
silently lossy-merges:

```
blog/ethics-law.md       → bare slug "ethics-law" → INSERT  (first write wins)
knowledge/ethics-law.md  → bare slug "ethics-law" → UPDATE  (overwrites first row)
```

The unique key `(project_id, source, collection, locale, slug)` doesn't
include `scope`. Toolwiki DB currently has **30 categories rows** (not 31)
because the second file's UPDATE silently overwrites the first. Inspection:

```sql
SELECT slug, locale, domain_extras->>'scope', file_path
FROM articles
WHERE collection = 'categories' AND project_id = '<toolwiki>'
ORDER BY slug;
-- ethics-law | de | knowledge | src/content/categories/knowledge/ethics-law.md
-- (no row for the blog/ethics-law.md sibling)
```

Practical impact today: **zero** — both files have identical `translations`
labels (`"Ethik & Recht"` / `"Ethics & Law"`), so the lost row has no unique
content. But it's a footgun: if Marcel ever differentiates the two scopes'
labels, the importer will silently lose one.

This is an Importer-Robustness concern, not a Forecast-Diff concern. Out of
scope for Spec 006 per spec §2 (`In Scope: Slug-Format-Mismatch... auflösen`).
Flagged here for follow-up; documented in
[`docs/backlog/post-cleanup-followups.md`](../backlog/post-cleanup-followups.md).

## 5. Implementation plan

1. New `apps/api/src/scripts/discovery/generate-repo-inventory.ts` with bare-slug
   derivation (`basename(filePath, '.md')`) for `noLocaleSplit` collections;
   per-entry `scopes: Record<slug, scope>` map populated when a subdirectory
   exists between `<contentRoot>/<collection>/` and `<file>.md`.
2. Extend `RepoCollectionInventory.noLocaleSplit` type in
   [`forecast-re-import-state.ts`](../../apps/api/src/scripts/discovery/forecast-re-import-state.ts)
   to allow the optional `scopes?` field. No matching-logic change today.
3. Regenerate `repo-inventory.json` against the local Astro repo (default
   path `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu`,
   overridable via `--astro-repo=<path>`).
4. Smoke tests at
   `apps/api/test/scripts/forecast-categories-slug-format.smoke.test.ts`
   covering bare-slug match, scope-collision dedup behaviour, and regression
   repro of the old path-prefix bug.
5. Manual-verify: `bun --filter @marketing-auto/api forecast-re-import-state toolwiki`
   should report `categories: 0 inserts / N updates / 0 dbOnly`.
6. Docs (backlog close + IMPLEMENTED.md + root CLAUDE.md index entry).
