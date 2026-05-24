# Spec 006 / F1.5 — `categories` Slug-Format Reconciliation — IMPLEMENTED

_Date: 2026-05-24_
_Spec: [`specs/006-follow-up-robustness.md`](../../../specs/006-follow-up-robustness.md)_
_Code-Read: [`docs/discovery/f15-categories-slug-format-codeRead.md`](../../discovery/f15-categories-slug-format-codeRead.md)_

## Outcome

Forecast-Re-Import against Toolwiki was reporting
`categories: 31 inserts / 30 dbOnly` instead of `0 inserts / 30 updates / 0 dbOnly`.
Root cause: slug-format mismatch between
[`repo-inventory.json`](../../../apps/api/src/scripts/discovery/repo-inventory.json)
(path-prefixed `blog/comparisons`) and the live `articles` table (bare
`comparisons`). Fixed at the inventory generator (single source of truth)
per spec recommendation Option A (DB canonical).

## Before / After metrics

Toolwiki `categories` collection:

| Metric | Pre-fix | Post-fix |
|---|---|---|
| Forecast inserts | 31 | **0** |
| Forecast updates | 0 | **30** |
| Forecast dbOnly | 30 | **0** |

Full forecast (post-fix):

```
## Summary
- Total expected INSERTS: 0
- Total expected UPDATES: 310
- Active DB rows not in repo (DB-only): 0

## Per-collection breakdown
- authors: 0 inserts / 10 updates / 0 DB-only
- blog: 0 inserts / 50 updates / 0 DB-only
- categories: 0 inserts / 30 updates / 0 DB-only        ← fixed
- comparisons: 0 inserts / 28 updates / 0 DB-only
- ki-wissen: 0 inserts / 36 updates / 0 DB-only
- special-landings: 0 inserts / 10 updates / 0 DB-only
- tool-categories: 0 inserts / 14 updates / 0 DB-only
- tools: 0 inserts / 108 updates / 0 DB-only
- usecases: 0 inserts / 24 updates / 0 DB-only
```

## Files touched

### New

- [`apps/api/src/scripts/discovery/generate-repo-inventory.ts`](../../../apps/api/src/scripts/discovery/generate-repo-inventory.ts)
  — re-creates the missing inventory generator (was deleted in commit `32b0c54`)
  with bare-slug derivation + optional per-slug `scopes` map. CLI:
  `--astro-repo=<path>` (default `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu`)
  + `--out=<path>` (default `apps/api/src/scripts/discovery/repo-inventory.json`).
  Two pure helpers exported for tests: `bareSlugFromPath()` + `scopeFromPath()`.
- [`docs/discovery/f15-categories-slug-format-codeRead.md`](../../discovery/f15-categories-slug-format-codeRead.md)
  — three-way analysis (Astro frontmatter / Importer / Inventory generator)
  with decision rationale + discovered scope-collision footgun.
- [`apps/api/test/scripts/forecast-categories-slug-format.smoke.test.ts`](../../../apps/api/test/scripts/forecast-categories-slug-format.smoke.test.ts)
  — 5 cases: 2 helper-unit tests (`bareSlugFromPath` + `scopeFromPath`) + 3
  forecast-diff regression tests (post-fix happy path, scope-collision dedup,
  pre-fix path-prefix bug repro).

### Modified

- [`apps/api/src/scripts/discovery/forecast-re-import-state.ts`](../../../apps/api/src/scripts/discovery/forecast-re-import-state.ts)
  — extended `RepoCollectionInventory.noLocaleSplit` type with optional
  `scopes?: Record<string, string>` field. Pure type widening; no matching
  logic change.
- [`apps/api/src/scripts/discovery/repo-inventory.json`](../../../apps/api/src/scripts/discovery/repo-inventory.json)
  — regenerated. `categories` block now has bare slugs + new `scopes` map.
- [`apps/api/package.json`](../../../apps/api/package.json)
  — registered `regenerate-repo-inventory` script entry.
- [`docs/backlog/post-cleanup-followups.md`](../../backlog/post-cleanup-followups.md)
  — F1.5 marked ✅ COMPLETED with link to this IMPLEMENTED.md.

## Acceptance per Spec §5

1. ✅ F15.1.1 — Code-read notes at
   [`docs/discovery/f15-categories-slug-format-codeRead.md`](../../discovery/f15-categories-slug-format-codeRead.md).
2. ✅ F15.1.2 — Marcel-Decision: **Option A (DB canonical / bare slugs)**
   + **slug + scope separat** field choice + **CLI-Flag `--astro-repo=`** default.
3. ✅ F15.2.1 — Fix landed in
   [`generate-repo-inventory.ts`](../../../apps/api/src/scripts/discovery/generate-repo-inventory.ts).
4. ✅ F15.2.2 — 5 smoke tests grün
   ([`forecast-categories-slug-format.smoke.test.ts`](../../../apps/api/test/scripts/forecast-categories-slug-format.smoke.test.ts)).
5. ✅ F15.2.3 — Manual-verify: `categories: 0 inserts / 30 updates / 0 dbOnly`.
6. ✅ F15.3 — Backlog closed + this IMPLEMENTED.md.

## Discovered & deviations

1. **The inventory generator was missing entirely.** Spec §3.1 assumed it
   lived at `apps/api/src/scripts/discovery/generate-repo-inventory.ts`. The
   actual generator (`audit-repo-inventory.ts`) had been deleted in commit
   `32b0c54` as an "obsolete discovery audit script" but the produced
   `repo-inventory.json` was still committed and consumed. Re-created at the
   spec-assumed path so the spec's `regenerate-repo-inventory` command works.

2. **Scope collision is a real footgun, not just hypothetical.**
   Toolwiki's `categories/` directory has 31 physical files but only 30
   unique bare slugs:
   ```
   src/content/categories/blog/ethics-law.md       — slug "ethics-law", scope "blog"
   src/content/categories/knowledge/ethics-law.md  — slug "ethics-law", scope "knowledge"
   ```
   Both files have **identical** frontmatter except for `scope`, so the
   importer's silent UPSERT-overwrite via `(project_id, source, collection,
   locale, slug)` produces a single DB row (`knowledge` wins, alphabetically
   last). Practical impact today: zero (labels match). Long-term risk: if
   Marcel ever differentiates the two scopes' content, one will be silently
   dropped. **Out of scope for Spec 006** per §2 (importer-robustness is a
   separate spec); documented in
   [code-read note §4](../../discovery/f15-categories-slug-format-codeRead.md#4-pre-existing-data-integrity-discovery-out-of-spec-006-scope)
   + [backlog](../../backlog/post-cleanup-followups.md) for follow-up.

3. **Generator emits the colliding slug twice intentionally.** Rather than
   dedup at generator time (which would hide the collision from downstream
   tooling), the generator emits all physical files in `slugs[]` and lets
   `computeForecastDiff()`'s `new Set(repoSlugs)` dedup at diff time. This
   keeps the JSON faithful to the filesystem state and surfaces the collision
   in raw inventory inspection. The `scopes` map captures only the
   last-write-winning scope per slug (`Object.fromEntries`-style assign).

4. **Re-creation of the generator script gave us an opportunity to make
   the Astro-repo path overridable.** The original hardcoded the path; the
   re-creation accepts `--astro-repo=<path>` with the original hardcode as
   default. Matches the spec's `--project=toolwiki` intent (per-tenant repo
   path), though we ended up exposing the path directly rather than going
   through project lookup because the generator doesn't otherwise touch the
   DB and adding a DB hop just for path resolution was premature complexity.

5. **No other collection in the Toolwiki Astro repo uses `noLocaleSplit`.**
   Filesystem walk of `src/content/*/` confirmed all 8 other collections
   (`blog`, `comparisons`, `tools`, `ki-wissen`, `usecases`, `authors`,
   `tool-categories`, `special-landings`) have a `de/` subdirectory, so the
   slug-format bug was scoped exclusively to `categories`. Risk §R2
   ("Andere Collections haben gleichen Bug") is closed empty.

6. **`frontmatterFieldSetExample` now shows `parentSlug`** for `categories` —
   the new sample frontmatter includes a `parentSlug` field that the old
   inventory snapshot didn't capture. Pure schema drift inside the Astro
   repo, not introduced by this spec.

## Future-spec triggers

Re-evaluate the importer-robustness slug-collision issue (item #2 above)
when one of:

- A new `noLocaleSplit` collection is added to any tenant's Astro repo with
  a similar scope-collision pattern.
- Marcel differentiates two collision pairs (e.g. distinct translations or
  intentional content variance) so silent overwrites become user-visible.
- A new tenant ships with deeper nested directory structures inside a
  collection root.

The fix would belong in `UpsertArticlesStep` — either widen the unique key to
include `scope` (jsonb extraction), or normalize the slug to `<scope>/<slug>`
inside the importer. Either choice touches the unique constraint and the
`articles.slug` cardinality assumption used throughout the platform; not a
small refactor.
