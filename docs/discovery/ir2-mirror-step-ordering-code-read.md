# IR2 Code-Read — Mirror-Step ordering

_Spec: [specs/005-import-robustness.md](../../specs/005-import-robustness.md) Sprint IR2.1_
_Date: 2026-05-24_
_Branch: `feature/importer-robustness`_

## TL;DR

The spec's narrative ("`MirrorHeroImagesStep` iteriert über DB-Rows VOR dem Upsert → sieht die neuen Rows nicht") **does not match the actual code**. Mirror operates on the in-memory `parsed` entries from `ParseFrontmatterBatchStep`, stamps `hero: HeroFields | null` per entry, and Upsert reads `p.hero` during INSERT/UPDATE. Mirror DOES see new entries — it just runs synchronously before Upsert writes them.

The real Anomaly-B root cause was the **default-hero-path bug** (`/heroes/default.webp` vs `/heroes/auto/default.webp`), already fixed on 2026-05-24 15:57Z (see `docs/discovery/post-cleanup-final-verification.md`). Once the path was corrected, the existing in-memory flow correctly mirrored new INSERTs — no step-reordering was needed for the immediate symptom.

However, the **underlying weakness remains**: any Mirror failure (404, R2 error, GitHub API transient) leaves the article INSERTed without a hero. Manual recovery requires either re-running the import or invoking `backfill-imported-heroes --apply`. There's no self-healing on the next Re-Import unless the source MDX changes (gitSha-based skip).

Three fix paths fit the actual codebase. **My recommendation: Option B (post-Upsert backfill step) — additive, low-risk, no flow refactor.**

## 1. Current Pipeline Wiring

[`pipeline.ts:37-48`](../../packages/adapters/astro-sync/src/import/pipeline.ts:37):

```
ExtractCollectionSchemas
  → ListContentFiles
  → FilterChangedFiles      ← reads DB by filePath (no status filter pre-IR1; now status-aware post-IR1)
  → ParseFrontmatterBatch
  → MirrorHeroImages        ← reads `input.parsed`, stamps hero per entry, NO DB read
  → UpsertArticles          ← writes hero cols inline with INSERT/UPDATE
  → LinkTranslationPairs
  → SyncClustersFromFrontmatter
  → DetectContentGaps
  → UpdateImportRun
```

Bridge from Mirror → Upsert ([pipeline.ts:96-105](../../packages/adapters/astro-sync/src/import/pipeline.ts:96)) passes the hero-augmented parsed entries through. Upsert reads each entry's `hero` field at [upsert-articles.ts:67](../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts:67):

```ts
const hero = (p.hero as HeroFields | null | undefined) ?? null;
```

Then writes hero columns on INSERT unconditionally, on UPDATE only when `heroImageSourceSha256` changed (hash-equality refresh whitelist, [upsert-articles.ts:109-117](../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts:109)).

## 2. Mirror's Actual Data Flow

[`mirror-hero-images.ts:415-447`](../../packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts:415) iterates `input.parsed` (received from `ParseFrontmatterBatchStep` via bridge). For each entry:

1. Skip `COLLECTIONS_WITHOUT_HERO` (currently `{"tool-categories"}`).
2. Resolve hero ref from frontmatter (`heroImage` or `image`), or fall back to `DEFAULT_HERO_PATH` = `/heroes/auto/default.webp`.
3. Fetch bytes from GitHub-App API at `headCommitSha`.
4. Compute sha256, check in-run cache, check cross-run dedup via DB hash lookup.
5. Upload via WebP adapter on miss.
6. Push `{...entry, hero: outcome.fields}` to `augmented` array (or `{...entry, hero: null}` on failure).

**No DB-row iteration anywhere.** The only DB read is `findExistingByHash` for cross-run dedup. New parsed entries (not yet in DB) go through Mirror correctly. The spec's narrative is structurally wrong.

## 3. Anomaly-B Reconstruction

| Step | State |
|---|---|
| Pre-Branch-A | Toolwiki has 4 Comparisons + 12 ki-wissen pillar slugs not yet imported |
| Branch-A refactor | Adds 14 new MDX files (4 + 12) without `heroImage:` in frontmatter |
| Re-Import #1 (14:57:45) | Mirror falls back to `DEFAULT_HERO_PATH = /heroes/default.webp` → **404 from GitHub-App** (actual file lives at `/heroes/auto/default.webp`). All 14 entries get `hero: null`. Upsert INSERTs 14 rows without hero columns. |
| Default-hero-path fix | Marcel corrects `DEFAULT_HERO_PATH` to `/heroes/auto/default.webp` |
| Re-Import #2 (15:29:27) | Mirror now resolves the default-hero correctly. **But these 14 rows already exist — FilterChangedFilesStep marks them as "changed" only if gitSha differs.** Yet the discovery doc reports they were mirrored. Most likely path: the parent MDX files' gitSha changed enough (re-pull or actual content tweak) that FilterChanged returned them — OR Marcel manually ran `backfill-imported-heroes --apply` between runs. The doc is ambiguous; both produce the observed outcome. |
| Final state | All 14 rows have heroes populated. |

**Conclusion:** Anomaly-B's specific symptom (14 heroless INSERTs) was 100% explained by the default-hero-path bug + GitHub 404. **The step-ordering framing was a misread.**

However, the bug-class persists: **any Mirror failure (404 on a real hero ref, R2 outage, GitHub API rate-limit) on a NEW INSERT leaves the article without a hero**, with no automatic recovery on subsequent imports unless the source MDX itself is touched. That's a real durability gap worth closing in IR2.

## 4. Self-Healing Failure: Why Re-Import Doesn't Backfill

`FilterChangedFilesStep` ([filter-changed-files.ts:54-61](../../packages/adapters/astro-sync/src/import/steps/filter-changed-files.ts:54)) uses gitSha-equality as the skip predicate. A heroless row whose MDX file is unchanged is reported as "unchanged" → skipped from `changed` → never reaches Mirror → no retry. So a transient Mirror failure becomes permanent until either:

- The MDX file gets edited (gitSha changes) → re-enters the pipeline
- Marcel runs `backfill-imported-heroes --apply`
- Marcel runs Re-Import with `forceAll: true`

This is the actual durability gap. **The fix should ensure heroless rows get a retry shot on every Re-Import**, regardless of MDX gitSha.

## 5. Existing Backfill CLI

`apps/api/src/scripts/backfill-imported-heroes.ts` already implements exactly the "find heroless rows + re-mirror" pattern. Its `loadCandidates` predicate ([line 301](../../apps/api/src/scripts/backfill-imported-heroes.ts:301) area):

```ts
.where(and(
  eq(articles.projectId, projectId),
  eq(articles.source, "imported"),
  isNull(articles.heroImageR2Key),
  sql`${articles.collection} NOT IN ${excluded}`,
))
```

It reuses `mirrorOneArticle` from `mirror-hero-images.ts` — same dedup, same WebP adapter, same idempotency. Designed as the manual recovery path.

**The fix should fold this logic into the pipeline** so Marcel never has to remember to run the CLI.

## 6. Defense-in-Depth Check

Per v3 Lesson 1 (Spec 004 / F3): are there parallel writers to `articles.heroImage*` columns that bypass `UpsertArticlesStep` and could trip the same gap?

| Site | Writes hero cols? | Notes |
|---|---|---|
| [upsert-articles.ts:91-117](../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts:91) | Yes | INSERT + UPDATE path. In scope of IR2. |
| [backfill-imported-heroes.ts](../../apps/api/src/scripts/backfill-imported-heroes.ts) | Yes | Manual CLI. Same `mirrorOneArticle` helper. Out-of-scope for IR2 but inspiration for the fix. |
| `convert-existing-heroes.ts` (Spec 64.6c) | Yes (R2 key only) | Forensic-original migration. Not hero-bytes flow. Out-of-scope. |
| Generation pipeline `hero-image.ts` | Yes (different column flow) | Writes hero via DB UPDATE inside `HeroImageStep`. Only for `source='generated'` articles. Out-of-scope. |

**No parallel write path for `source='imported'` heroes** other than the backfill CLI. Single-Point-of-Decision via the pipeline.

## 7. Fix Options

### Option A (Spec recommendation): Step-Reorder + Refactor Mirror to read DB

```
Parse → Upsert → Mirror (reads heroless DB rows) → ...
```

**Required changes:**
- Move `MirrorHeroImagesStep` to after `UpsertArticlesStep` in `pipeline.ts`.
- Change Mirror's `InputSchema`: drop `parsed`, add `projectId + astroRepo + headCommitSha`.
- Change Mirror's `execute()`: load rows from DB via `WHERE source='imported' AND heroImageR2Key IS NULL AND collection NOT IN (...)`, then for each row reconstruct a synthetic `ParsedEntry`-like shape from `domainExtras + importMetadata + typed fields`, call `mirrorOneArticle`, write resulting hero columns via UPDATE.
- Change Upsert's hero-column logic: drop the inline write entirely (Mirror takes over).
- Update both bridges (`parse → mirror` no longer exists, `mirror → upsert` becomes `upsert → mirror`).
- Update `mirrorOneArticle` callers that depend on `ParsedEntry` shape, OR add a new helper that takes a `CandidateRow` (like the CLI has).

**Pro:** Single source of truth (DB) for what needs mirroring. Self-healing on every Re-Import. Clean architectural separation.

**Con:** Big refactor. The current code is well-tested; this rewrites 3+ files. The atomic Parse → Mirror → Upsert flow becomes Parse → Upsert → Mirror with a now-broken atomicity (Upsert commits, Mirror UPDATEs separately).

**Test impact:** Existing `mirror-hero-images-pipeline.test.ts`, `mirror-hero-images.test.ts`, `backfill-imported-heroes.smoke.test.ts` all break. Need rewrite.

### Option B (Recommended): Additive post-Upsert backfill step

Add a new step `MirrorBackfillHeroesStep` after `UpsertArticlesStep` (and after the existing `MirrorHeroImagesStep`, which keeps doing its current job). New step's job:

```
for each row WHERE source='imported' AND heroImageR2Key IS NULL AND collection NOT IN COLLECTIONS_WITHOUT_HERO:
  call mirrorOneArticle (same dedup, same WebP adapter)
  on success: UPDATE articles SET hero_* = ... WHERE id = $1
  on failure: log warn, continue (next Re-Import will retry)
```

**Pipeline becomes:**
```
... → ParseFrontmatterBatch → MirrorHeroImages (existing) → UpsertArticles
     → MirrorBackfillHeroes (NEW) → LinkTranslationPairs → ...
```

**Pro:**
- **Additive** — no changes to Mirror or Upsert. Existing tests stay green.
- **Self-healing on every Re-Import** — heroless rows get a retry shot regardless of MDX gitSha.
- **Pragmatic** — folds `backfill-imported-heroes` CLI logic into the pipeline, exactly Marcel's stated goal.
- **Idempotent** — re-running the pipeline with no heroless rows is a no-op SELECT (returns 0 candidates).
- **No atomicity regression** — Upsert still owns INSERT writes; backfill is a follow-up UPDATE-only step.

**Con:**
- Two steps now touch hero columns (Mirror via Upsert's INSERT path + the new step via UPDATE). Slightly more code surface. Mitigated by sharing `mirrorOneArticle`.
- New step has its own DB-read overhead, but the SELECT is indexed (the partial `articles_hero_image_source_sha256_idx` doesn't quite match — would benefit from a partial index `WHERE hero_image_r2_key IS NULL AND source='imported'` if performance matters; today's row counts make it irrelevant).

### Option C (Status Quo + Better Failure Surfacing)

Make Mirror failure abort the import. Force Marcel to fix the root cause before re-importing.

**Pro:** Forces awareness of failures.
**Con:** A transient GitHub 404 would block the entire Re-Import. Disruptive. The graceful-skip semantics are there for a reason.

**Rejected** — would have made Spec 001's Re-Import #1 fail entirely instead of inserting 14 heroless rows. The current "log + continue" is the right operational tradeoff.

## 8. Refresh-Whitelist (Spec §R4) Check

The hero columns appear in the refresh-whitelist via the hash-equality CASE expression in [`upsert-articles.ts:109-117`](../../packages/adapters/astro-sync/src/import/steps/upsert-articles.ts:109). This is application-layer, not DB-level — there's no central `REFRESH_WHITELIST` constant to update.

Under **Option B**, the new step's UPDATE writes hero columns directly. It must respect the same hash-equality semantics that Upsert does: only flip if the hash changed. The `mirrorOneArticle` helper computes the new sha256 — the step can compare against the existing column value via a CASE in the UPDATE statement, identical to the current Upsert pattern.

**Decision:** Option B requires duplicating the CASE WHEN refresh-whitelist logic in the new step's UPDATE. Acceptable — it's 5 SQL lines. Alternative: extract into a helper that returns the SQL fragment, share between Upsert and the new step. Worth doing.

Under **Option A**, same concern but in different file. Mirror takes over the hash-equality logic from Upsert.

## 9. Recommendation

**Option B + extract hash-equality SQL helper.**

Concrete changes:
1. New step file `packages/adapters/astro-sync/src/import/steps/mirror-backfill-heroes.ts` — wraps `mirrorOneArticle` with DB-driven candidate loading + DB UPDATE.
2. New helper in `mirror-hero-images.ts` exporting `heroRefreshWhitelistUpdateSet(hero: HeroFields): UpdateValues` — returns the CASE-WHEN fragment, used by both `UpsertArticlesStep` (already) and the new step.
3. Pipeline registration in `pipeline.ts` after `UpsertArticlesStep`.
4. Bridge for `upsert-articles → mirror-backfill-heroes` and `mirror-backfill-heroes → link-translation-pairs`.
5. Tests: 3 smokes + 1 regression for Anomaly-B (a Mirror failure on first INSERT auto-heals on second pipeline run).

**Synthetic ParsedEntry construction:** The new step needs to call `mirrorOneArticle` which expects a `ParsedEntry`. The CLI already does this via `candidateToParsedEntry` ([backfill-imported-heroes.ts](../../apps/api/src/scripts/backfill-imported-heroes.ts) area line 280-ish). Extract and re-export.

## 10. Open Questions for Marcel

1. **Option B (additive backfill step) vs Spec's Option A (Mirror refactor)?** B is my recommendation — smaller blast radius, additive, reuses existing code paths. A is cleaner architecture but invasive.
2. **Should I extract the hash-equality refresh-whitelist SQL fragment into a shared helper?** (My read: yes — duplication is small but it's the kind of drift that bites later.)
3. **Does the new step need its own pipeline-run cost-tracking?** (My read: no — `mirrorOneArticle` already routes through the WebP adapter which doesn't log to `cost_logs` because R2 + sharp are zero-cost. GitHub-App API calls are also zero-cost. So no new estimate needed.)
4. **The CLI `backfill-imported-heroes` becomes redundant once Option B lands.** Keep it for ad-hoc CLI usage / dry-run inspection, OR delete it?  (My read: keep for `--dry-run` audit value; it lives alongside other discovery scripts. Same posture as Spec 64.10's `cleanup-orphan-heroes`.)

## 11. Estimated Effort

- New step file: 1.5h
- Pipeline + bridge wiring: 30min
- Shared hash-equality helper: 30min
- Synthetic `ParsedEntry` extraction: 30min
- 3 smoke tests + 1 regression test: 2h
- /review-task: 30min

**Total: 5-5.5h** — within the spec's IR2 envelope (4-6h, slightly over because of the helper extraction; trim if needed by keeping the SQL duplicated).
