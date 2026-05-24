# IR1 Code-Read — UpsertArticlesStep Slug-Match Path

_Spec: [specs/005-import-robustness.md](../../specs/005-import-robustness.md) Sprint IR1.1_
_Date: 2026-05-24_
_Branch: `feature/importer-robustness`_

## TL;DR

The spec's narrative ("matched sie via cornerstoneKeyword/filePath-Heuristik") **does not match the actual code**. There is no heuristic matching. Matching is done by Postgres's native unique-constraint resolution via `onConflictDoUpdate` on the composite key `(projectId, source, collection, locale, slug)`. The constraint is a HARD unique index (no WHERE clause) — `status` is NOT in the key.

The real Anomaly-A root cause: when a new MDX file declares a `slug:` (in frontmatter) OR resolves a filename-derived slug that coincides with an existing superseded row's slug, the `onConflictDoUpdate` matches the superseded row and writes the NEW filePath in-place while leaving `status='superseded'` and slug unchanged. Result: superseded row with OLD slug + NEW filePath, no active row at that key.

Three fix paths are viable. **My recommendation: Option D — partial unique index `WHERE status != 'superseded'`** (not listed in the spec; supersedes the spec's Option A as the cleanest path).

## 1. Current Match Path

### 1.1 Where the slug comes from

[`parse-frontmatter.ts:96-97`](../../packages/adapters/astro-sync/src/import/parse-frontmatter.ts:96):

```ts
const filenameSlug = filePath.match(/([^/]+)\.mdx?$/)?.[1] ?? "";
const slug = fm.slug ?? filenameSlug;
```

So `slug` is **frontmatter `slug:` field first, then filename basename as fallback**. This is important — a Branch-B rename that touches only the file name but leaves the frontmatter `slug:` field with the OLD slug WILL trip the bug. Same outcome if no `slug:` field exists and the filename is renamed: the parsed slug is the NEW filename, no collision with the OLD row.

### 1.2 Where the match is done

[`upsert-articles.ts:120-188`](../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts:120):

```ts
const result = await db
  .insert(articles)
  .values({
    projectId, source: "imported", collection, locale, slug, ...
    filePath: p.filePath as string,    // <-- NEW filePath
    ...
    status: "published",                // <-- INSERT only; SET clause does NOT touch status
    ...
  })
  .onConflictDoUpdate({
    target: [
      articles.projectId,
      articles.source,
      articles.collection,
      articles.locale,
      articles.slug,
    ],
    set: {
      // status is NOT in SET — superseded rows stay superseded
      filePath: p.filePath as string,   // <-- this is what overwrites the OLD filePath
      ...
    },
  })
  .returning({ id: articles.id, importedAt: articles.importedAt });
```

**No `WHERE status != 'superseded'` anywhere in the match.** Postgres's unique constraint resolution looks across ALL rows.

### 1.3 The actual unique constraint

[`content.ts:363-366`](../../packages/db/src/schema/content.ts:363):

```ts
sourceCollectionLocaleSlugUnique: uniqueIndex(
  "articles_project_source_coll_locale_slug_unique"
).on(t.projectId, t.source, t.collection, t.locale, t.slug),
```

**Hard unique index** — no WHERE clause, no `status` in the key. This is the structural reason the spec's Option A (add `AND status != 'superseded'` to a match query) doesn't work as written: after filtering out the superseded match, the subsequent INSERT still trips the constraint on the same `(project, source, collection, locale, slug)` tuple.

## 2. Anomaly-A Reconstruction (what really happened)

| Step | State |
|---|---|
| Pre-Branch-B | 2 active rows: `slug=...leitfaden, filePath=.../leitfaden.mdx`, `slug=...guide, filePath=.../guide.mdx` |
| Branch-B rename | Files renamed to `...best-practices-2026.mdx`. Frontmatter `slug:` either kept the OLD slug OR was absent (filename fallback was the NEW filename — but somehow the slug coincidence happened, see below) |
| Cleanup-Spec 001 C2 | `UPDATE articles SET status='superseded'` on the 2 orphan slugs. **Does NOT touch filePath.** [cleanup-post-refactor-drift.ts:120-130](../../apps/api/src/scripts/cleanup-post-refactor-drift.ts:120) |
| Re-Import (C4) | `ParseFrontmatterBatchStep` reads the NEW `...best-practices-2026.mdx` file. Parsed slug resolves to the OLD slug (`...leitfaden` / `...guide`) via frontmatter `slug:` field. `UpsertArticlesStep` runs `insert().onConflictDoUpdate()`. Conflict-target `(project, source, blog, de, ...leitfaden)` matches the superseded row. SET clause runs — overwrites filePath, body, etc. — but NOT status. Row stays superseded with OLD slug + NEW filePath. |
| Result | 2 superseded rows at OLD slug + NEW filePath, 0 active rows at NEW slug. Astro renders fine (reads MDX directly), Marcel's tooling sees no active row. |

**Critical assumption:** the NEW MDX files must have had `slug: "...leitfaden"` / `slug: "...guide"` in their frontmatter — same as the OLD rows. Otherwise the filename fallback would have produced `...best-practices-2026` and there'd have been no slug collision. I cannot verify this without reading the Astro repo's git history at that commit; the spec asserts the bug happened so the slug must have collided somehow. The fix is robust either way.

## 3. Defense-in-Depth Map

Per v3 Lesson 1 (Spec 004 / F3): grep for parallel paths that could write `articles.slug` or `articles.filePath` for `source='imported'` rows.

### 3.1 Write paths into `articles`

| Site | Source | Notes |
|---|---|---|
| [upsert-articles.ts:120](../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts:120) | `imported` | **In scope of IR1.** The bug origin. |
| [persist.ts:115](../../packages/pipelines/src/article/blog/persist.ts:115) | `generated` | Article generation pipeline. Writes generated articles only — never matches on imported rows. |
| [steps/persist-article.ts](../../packages/pipelines/src/article/steps/persist-article.ts) | `generated` | Same as above. |
| [extend-schema.ts:19](../../apps/api/src/scripts/article/extend-schema.ts:19) | (any) | Admin CLI. SELECT only — no UPDATE of slug/filePath. |
| [cleanup-post-refactor-drift.ts:120](../../apps/api/src/scripts/cleanup-post-refactor-drift.ts:120) | (any) | UPDATE `status` + `updatedAt` only. Does NOT touch slug or filePath. **Not the bug origin.** |
| [cleanup-bucket-c-drift.ts:371](../../apps/api/src/scripts/cleanup-bucket-c-drift.ts:371) | (any) | SELECT only. |

### 3.2 onConflictDoUpdate on `articles`

`grep -n "onConflictDoUpdate" packages/adapters/astro-sync/src/` returned ONLY:
- `upsert-articles.ts:154` (the bug origin)
- `detect-content-gaps.ts:315` (different table — topic_briefs)

**Single-Point-of-Decision confirmed.** No parallel write path into `articles` with a slug-match heuristic exists. Unlike Spec 004 / F3 (where the HTTP route bypassed the internal trigger), IR1's fix at `UpsertArticlesStep` is the complete defense — no HTTP route, no admin CLI, no other pipeline writes to `articles` with `source='imported'` and slug matching.

### 3.3 Read paths that could be tricked

`FilterChangedFilesStep` reads existing rows by `filePath`. It does NOT filter by status, so it sees superseded rows. But its only use of the result is the unchanged-detection (gitSha match) + `removedPaths` reporting. Worst-case: a superseded row whose filePath happens to match an incoming file's path could mark that file as "unchanged" if the gitSha matches, causing the file to be skipped. With the bug-induced state (superseded row with NEW filePath), this is the actual symptom — once the superseded row has the NEW filePath stamped, every subsequent Re-Import sees the gitSha match and skips the file, so the new active row is never created.

**This means IR1's fix has a secondary requirement: `FilterChangedFilesStep` should also filter superseded rows out of `existingByPath`.** Otherwise after the partial-unique-index fix, the bug-induced rows still keep Re-Import from healing the missing active rows.

## 4. Fix Options

### Option A (Spec recommendation): Manual select-then-insert/update with status filter

```ts
const existing = await tx.query.articles.findFirst({
  where: and(
    eq(articles.projectId, projectId),
    eq(articles.source, "imported"),
    eq(articles.collection, collection),
    eq(articles.locale, locale),
    eq(articles.slug, slug),
    ne(articles.status, "superseded"),
  ),
});

if (existing) {
  await tx.update(articles).set({...}).where(eq(articles.id, existing.id));
} else {
  await tx.insert(articles).values({...});  // <-- this still trips the hard unique constraint
}
```

**Pro:** Minimal code surface, no migration.

**Con:** The hard unique index `(project, source, collection, locale, slug)` is status-agnostic. The INSERT will fail with `duplicate key value violates unique constraint "articles_project_source_coll_locale_slug_unique"` because the superseded row still occupies that key. Without a migration, this option requires catching the constraint error and skipping (data loss) OR writing the new row with a synthetic slug suffix (ugly). The spec acknowledges this in §IR1.3 ("falls Constraint `status` NICHT einschließt: erweitern via Migration ODER Insert-Path fängt Conflict ab"), but doesn't pick.

**My read:** Option A is two changes pretending to be one. The constraint widening is the real fix; the manual match is incidental.

### Option B (Spec): Match + Warning + Insert-instead

Same issue as A — needs a constraint change or error-catch.

### Option C (Spec): Match + Resurrection

Flip `status='superseded'` back to `'published'` on match. Spec rejects this on the grounds that cleanup-specs deliberately mark rows superseded. The risk is real: if the cleanup script flips a row because the file was deleted from the repo, and then someone re-adds a file with the same slug, resurrection would silently un-cleanup the row.

### Option D (NEW — recommended): Partial unique index

```sql
DROP INDEX articles_project_source_coll_locale_slug_unique;
CREATE UNIQUE INDEX articles_project_source_coll_locale_slug_active_unique
  ON articles (project_id, source, collection, locale, slug)
  WHERE status != 'superseded';
```

Drizzle schema:

```ts
sourceCollectionLocaleSlugActiveUnique: uniqueIndex(
  "articles_project_source_coll_locale_slug_active_unique"
).on(t.projectId, t.source, t.collection, t.locale, t.slug)
  .where(sql`${t.status} != 'superseded'`),
```

`UpsertArticlesStep` keeps using `onConflictDoUpdate`, but Drizzle requires `targetWhere` to mirror the index predicate exactly (Memory D108 + canonical example at [detect-content-gaps.ts:319](../../packages/adapters/astro-sync/src/import/steps/detect-content-gaps.ts:319)):

```ts
.onConflictDoUpdate({
  target: [articles.projectId, articles.source, articles.collection, articles.locale, articles.slug],
  targetWhere: sql`status != 'superseded'`,
  set: {...},
})
```

**Pro:**
- Surgical fix at the constraint level — the structural invariant ("one active row per file") is enforced by the DB, not by application code.
- INSERT of new active row co-existing with a superseded row at the same key is now allowed and EXPECTED.
- `onConflictDoUpdate` semantics stay intact — naturally only matches active rows.
- Same pattern as `topic_briefs_unique_open_per_gap` (Memory D108). Familiar.

**Con:**
- Requires a migration (`0103_articles_slug_unique_active_only.sql`).
- Need to verify no existing rows violate the new partial constraint (i.e., no two active rows at the same key today). Cleanup is done so this should be safe, but worth checking pre-migration.
- `FilterChangedFilesStep` also needs `status != 'superseded'` filter to prevent the gitSha-match short-circuit from skipping the new file (see §3.3).

**Status of existing rows:** verified safe pre-migration by querying for duplicate active rows — this needs to be a pre-implementation step.

## 5. Recommendation

**Go with Option D + FilterChangedFilesStep status-filter.** Two surgical edits:

1. Migration `0103_articles_slug_unique_active_only.sql`: drop the hard unique, create the partial. Pre-implementation: `SELECT COUNT(*) FROM (SELECT project_id, source, collection, locale, slug, COUNT(*) FROM articles WHERE status != 'superseded' GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1) — must be 0`.
2. `upsert-articles.ts`: add `targetWhere: sql\`status != 'superseded'\`` to the `onConflictDoUpdate`. No need to import `ne` — Drizzle's `sql` template handles it.
3. `filter-changed-files.ts`: add `ne(articles.status, "superseded")` to the existing-rows SELECT so the gitSha-match short-circuit doesn't skip new files when a stale superseded row is sitting at the new filePath.
4. Drizzle schema: update the index definition with `.where()` clause.

This is closer to the spec's Option A in spirit (don't match superseded) but uses the right tool (partial index) instead of the application-layer workaround. Spec §7 IR-4 ("Unique-Constraint anpassen? Klären in IR1.3") implicitly opens this path.

## 6. Open Questions for Marcel

1. **Go with Option D (partial unique index) or stick with Spec's Option A (application-layer + insert-fallback)?** D is what I'd recommend. A as written is not implementable without one of: error-catch, slug-suffix, or migration anyway.
2. **The cleanup script's `status='superseded'` action is reversible by intent. With Option D, if a future cleanup supersedes a row AND then a fresh MDX with the same slug is added to the repo, the importer will INSERT a NEW row at that slug. Is that the desired behavior?** (My read: yes — file in repo wins over historical-cleanup decisions. The superseded row remains as an audit-trail tombstone.)
3. **Should I also fix `FilterChangedFilesStep`'s gitSha-match short-circuit on superseded rows in the same sprint?** (My read: yes — without it, post-D state still self-blocks healing.)

## 7. Estimated Effort

Including the migration + Drizzle schema update + FilterChangedFilesStep fix + tests:

- Migration + verification SQL: 30min
- Drizzle schema update + upsert-articles fix: 30min
- FilterChangedFilesStep fix: 15min
- 4 smoke tests + 1 regression test: 2-3h
- /review-task: 30min

**Total: 4-5h** — within the spec's IR1 envelope (4-6h).
