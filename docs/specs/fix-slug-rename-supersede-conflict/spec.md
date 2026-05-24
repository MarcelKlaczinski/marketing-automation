# Fix-Spec: Anomaly A (Slug-Rename ↔ Cleanup-Supersede Konflikt)

_Branch: `feature/fix-slug-rename-supersede-conflict`_
_Codebase: Marketing-Tool-Monorepo_
_Status: Implemented 2026-05-24._
_Aufwand: ~1-2 Stunden Marcel-Action + 30min Re-Verification._
_Vorgänger:_

- _Post-Cleanup-Verification-Discovery (`docs/discovery/post-cleanup-final-verification.md` v15:34Z)_
- _Cleanup-Spec 001 (DB-Cleanup Post-Refactor)_
- _Hero-Image-Mirror-Spec 000_

---

## 1. Problem

Aus `docs/discovery/post-cleanup-final-verification.md` Anomalie A:

**Was passierte:**

1. Branch-B-Refactor: `system-prompts-role-prompting-2026-leitfaden.mdx` (DE) + `-guide.mdx` (EN) wurden in `system-prompts-role-prompting-best-practices-2026.mdx` umbenannt
2. Cleanup-Spec 001 C2: erkannte die alten Slug-Namen als Orphans, markierte sie als `status='superseded'`
3. Re-Import (C4): Importer's `UpsertArticlesStep` erkannte die neuen Files als Slug-Rename, matched sie via `cornerstoneKeyword`/`filePath`-Heuristik gegen die alten (jetzt superseded) Rows, updatete den `filePath` in-place
4. Resultat: 2 superseded Rows mit altem Slug + neuem filePath, 0 active Rows für neuen Slug

**Heute-State der 2 Rows:**

| OLD slug (status='superseded') | NEW filePath (post-15:29Z Re-Import) | Locale |
|---|---|---|
| `system-prompts-role-prompting-2026-leitfaden` | `src/content/blog/de/system-prompts-role-prompting-best-practices-2026.mdx` | de |
| `system-prompts-role-prompting-2026-guide` | `src/content/blog/en/system-prompts-role-prompting-best-practices-2026.mdx` | en |

**Sichtbare Auswirkung:**

- Astro-Site serviert den Artikel unter neuem Slug (Astro liest direkt aus MDX-Files, ignoriert DB)
- Tool-DB hat 0 active Rows für den neuen Slug → Tool sieht den Artikel als „nicht imported"
- Plan-Generation würde den neuen Slug als „verfügbar für Generation" ansehen (Konflikt-Vector)
- Social-Media-Generation für den Artikel funktioniert nicht (kein active R2-Asset, kein Hero auf den superseded Rows)

## 2. Ziel

Den Daten-Drift in 2 Rows fixen, so dass:

- 2 active Rows existieren mit dem neuen Slug
- Hero-Mirror für die 2 Rows läuft
- Re-Verification zeigt 0 Repo-Only-Slugs, 100% Hero-Coverage auf den 2 Rows

**In Scope:**

- 2 SQL-UPDATE-Statements für die 2 Rows (Option a — siehe Decision F-1)
- Hero-Backfill für die 2 Rows
- Re-Verification mit dem existierenden `verify-post-cleanup-cycle.ts` Script oder ad-hoc SQL

**Out of Scope:**

- Importer-Architektur-Fix (Slug-Rename gegen superseded-Rows) — separate Folge-Spec
- Mirror-Step-Reordering (Step nach Upsert) — separate Folge-Spec
- Bucket-D / Bucket-C — können parallel laufen sobald dieser Fix durch ist

## 3. Fix-Strategie

### Decision: Option (a) UPDATE

**Option (a): UPDATE der superseded-Rows zurück zu published + neuer Slug**

```sql
UPDATE articles
SET status = 'published',
    slug = 'system-prompts-role-prompting-best-practices-2026',
    updated_at = NOW()
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND slug IN ('system-prompts-role-prompting-2026-leitfaden', 'system-prompts-role-prompting-2026-guide')
  AND status = 'superseded';
```

Pro:

- Einfach (2 UPDATEs)
- Existing Article-ID bleibt → bestehende FK-Referenzen (article_versions, cost_logs, social_posts, refresh_suggestions) bleiben intakt
- Existing `created_at` + Article-History bleibt
- Re-Import erkennt die Rows beim nächsten Lauf wieder als matched (`(project_id, source, collection, locale, slug)` Composite-Unique-Tuple matched die neue Datei exakt)

Contra:

- Verliert die Rename-Audit-History (war mal als superseded markiert, dann wieder published). Audit-Trail ist in Git + diesem Fix-Spec + D9 in Cleanup-Spec 001 dokumentiert.
- Updated `superseded`-Total auf 8 statt 10 (Cleanup-C2-Spec-Output-Tabelle ist veraltet). Akzeptiert per Decision F-2.

**Option (b) — verworfen:** INSERT 2 neue active Rows, superseded-Rows bleiben.

Begründung der Ablehnung: Option (b) würde 2 Rows mit demselben `filePath` produzieren (eine superseded + eine active). Die filePath-Proximity-Heuristik im Importer (genau die, die diesen Konflikt überhaupt verursacht hat) könnte beim nächsten Lauf wieder gegen die falsche Row matchen → Drift-Recurrence-Risiko. Plus: 2 neue Article-IDs würden bestehende FK-Refs (article_versions, cost_logs, social_posts, refresh_suggestions) auf den superseded Rows orphanen.

### Sprint-Skizze

#### Sprint F1 — SQL-Fix

**F1.1 Pre-Snapshot der 2 Rows + targeted pg_dump backup**

```sql
SELECT
  id, slug, locale, status, file_path, created_at, updated_at,
  cluster_key, hero_image_r2_key IS NOT NULL AS has_hero
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND slug IN ('system-prompts-role-prompting-2026-leitfaden', 'system-prompts-role-prompting-2026-guide');
```

Targeted `pg_dump --data-only --inserts --table=articles ... WHERE id IN (<id1>, <id2>)` Output → `tmp/backup-anomaly-a-<timestamp>.sql` (lokal, gitignored — gleicher Schutz wie baseline-JSON-Snapshots aus Spec 001).

**F1.2 UPDATE der 2 Rows**

```sql
BEGIN;
-- Verify pre-state (sollte 2 zeigen)
SELECT COUNT(*) AS will_update
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND slug IN ('system-prompts-role-prompting-2026-leitfaden', 'system-prompts-role-prompting-2026-guide')
  AND status = 'superseded';
-- Apply
UPDATE articles
SET status = 'published',
    slug = 'system-prompts-role-prompting-best-practices-2026',
    updated_at = NOW()
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND slug IN ('system-prompts-role-prompting-2026-leitfaden', 'system-prompts-role-prompting-2026-guide')
  AND status = 'superseded'
RETURNING id, slug, locale, status;
-- Verify post-state (sollte 2 zeigen, beide published)
SELECT COUNT(*) AS active_with_new_slug
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND slug = 'system-prompts-role-prompting-best-practices-2026'
  AND status = 'published';
COMMIT;
```

**Acceptance F1.2:** RETURNING zeigt 2 Rows mit `status='published'` und neuem Slug.

**F1.3 Hero-Backfill für die 2 Rows**

```bash
bun --filter @marketing-auto/api backfill-imported-heroes --project=toolwiki --apply
```

Erwartung: 1-2 R2-Uploads (oder 0 Uploads + 2 reused falls der Hero schon von einer anderen Row gemirrored ist via cross-run sha256-dedup).

#### Sprint F2 — Re-Verification

**F2.1 Verify-Script erneut laufen lassen** (oder ad-hoc SQL falls das Script gitignored ist)

```sql
-- Phase 1: Article-Counts
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'superseded') AS superseded,
       COUNT(*) FILTER (WHERE status != 'superseded') AS active
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42';
-- Erwartung: total=318, superseded=8 (war 10, -2 durch UPDATE), active=310 (war 308, +2)

-- Phase 6: Slug-Diff blog/de + blog/en
SELECT slug, locale, status
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND collection = 'blog'
  AND slug LIKE 'system-prompts-role-prompting-%';
-- Erwartung: nur noch 2 Rows mit dem NEUEN Slug, status='published'

-- Phase 2: Hero-Coverage für die 2 Rows
SELECT slug, locale, hero_image_r2_key IS NOT NULL AS has_hero
FROM articles
WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
  AND slug = 'system-prompts-role-prompting-best-practices-2026';
-- Erwartung: 2 Rows, beide has_hero=true
```

**Acceptance F2.1:**

- ✅ Total = 318 (unchanged)
- ✅ Superseded = 8 (war 10)
- ✅ Active = 310 (war 308, +2)
- ✅ Beide neuen Slugs als `published` getrackt
- ✅ Beide haben Hero-Spalten populated
- ✅ Slug-Diff = 0 für blog/{de,en}

**F2.2 Discovered-Section in Cleanup-Spec 001 ergänzen** — D9-Entry in `specs/001-db-cleanup-post-refactor.md` §12.

**F2.3 Backlog-Eintrag für Importer-Robustness-Follow-up** — merge mit existierenden Einträgen in `docs/backlog/post-cleanup-followups.md`.

#### Sprint F3 — GO-Signal für Bucket-D + Bucket-C

Nach F2.1 grün: Anomaly A ist resolved, Verdict ✅ PASS (statt ⚠️ WARN). Bucket-D + Bucket-C dürfen parallel starten.

## 4. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | UPDATE trifft falsche Rows | Pre-Snapshot in F1.1, BEGIN/COMMIT-Transaktion, RETURNING-Clause für visuelle Bestätigung, targeted pg_dump Backup |
| R2 | Hero-Backfill findet neuen Slug nicht | Hero-Backfill liest `WHERE source='imported' AND hero_image_r2_key IS NULL` — der Slug ist irrelevant für den Filter |
| R3 | Cluster-Memberships zeigen auf alte Slugs | `cluster_key`-Spalte auf Articles ist String, nicht FK. Slug-Änderung bricht keine Cluster-Membership. |
| R4 | Re-Import läuft erneut + überschreibt Slug zurück | Nächster Re-Import wird die Rows als matched erkennen (slug + filePath + cornerstoneKeyword stimmen). Slug bleibt korrekt — Re-Import würde nur Felder updaten, nicht Slug zurückrollen. |
| R5 | Snapshot-Konsistenz gebrochen (10→8 superseded) | Accepted — D9 dokumentiert die Begründung. Cleanup-C2-Spec-Output-Tabelle ist veraltet, sollte nicht als „source of truth" gegen aktuelle DB gehalten werden. |
| R6 | Unique-Index `articles_project_source_coll_locale_slug_unique` Konflikt | Discovery-Doc Section 6 confirmiert: 0 active Rows haben den neuen Slug. UPDATE produziert für jede Row ein neues unique Tuple `(toolwiki, imported, blog, {de,en}, new-slug)`. |

## 5. Acceptance

1. F1.2 SQL UPDATE durchgelaufen, RETURNING zeigt 2 Rows
2. F1.3 Hero-Backfill grün, 2 Rows haben Hero-Spalten
3. F2.1 Re-Verification zeigt:
   - Total = 318
   - Superseded = 8
   - Active = 310
   - Neue Slug existiert als `published` DE + EN
   - Hero-Coverage für die 2 Rows = 100%
4. F2.2 D9 in Cleanup-Spec 001 Discovered-Section ergänzt
5. F2.3 Backlog-Eintrag für Importer-Robustness-Follow-up
6. F3 GO-Signal für Bucket-D + Bucket-C

## 6. Was als nächstes (nach F3)

- **Sofort:** Bucket-D-Spec + Bucket-C-Spec parallel an Agents geben
- **Optional parallel:** Toolwiki-Backlog-Eintrag (Cluster-Toolification deferred markieren)
- **Langfristig (Backlog):** Importer-Robustness-Follow-up-Spec für Slug-Rename + Mirror-Step-Ordering

## 7. Decisions

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| F-1 | Option (a) UPDATE vs. Option (b) INSERT | (a) UPDATE | Existing FK-Refs intakt, einfacher, Audit-Trail-Verlust akzeptabel, Re-Import-idempotent. Marcel delegated; entschieden mit Begründung „Drift-Recurrence-Risiko bei Option (b) durch 2 Rows mit demselben filePath". |
| F-2 | Snapshot-Konsistenz (10 superseded) bewahren? | NEIN | D9 dokumentiert die Begründung, 8 superseded ist korrekt |
| F-3 | Importer-Fix in dieser Spec? | NEIN | Separate Folge-Spec, nicht blocking |
| F-4 | Re-Import nach F1.3 erneut triggern? | NEIN | Riskiert dass der Importer die UPDATE überschreibt. Heute-State (UPDATE + Backfill) ist sufficient. |
| F-5 | Backup vor F1.2? | JA — targeted pg_dump | Marcel-Decision. Lokales Backup-File in `tmp/`, gitignored. |

## 8. Implemented

**Date: 2026-05-24** (single session, Marcel + Claude Opus 4.7).

### F0 — Spec file created

- [`docs/specs/fix-slug-rename-supersede-conflict/spec.md`](spec.md) — this file.

### F1.1 — Pre-snapshot + targeted backup

Pre-snapshot SELECT confirmed both rows in expected state:

| id | slug | locale | status | file_path | has_hero |
|---|---|---|---|---|---|
| `8b90f2f9-…` | `system-prompts-role-prompting-2026-leitfaden` | de | superseded | `src/content/blog/de/system-prompts-role-prompting-best-practices-2026.mdx` | t |
| `8f03daf2-…` | `system-prompts-role-prompting-2026-guide` | en | superseded | `src/content/blog/en/system-prompts-role-prompting-best-practices-2026.mdx` | t |

Backup written via `pg_dump --data-only --column-inserts --table=articles` filtered by ID:
`tmp/backup-anomaly-a-2026-05-24T17-52-55.sql` (3.6 KB, 2 INSERT statements, gitignored).

### F1.2 — UPDATE transaction

`BEGIN; <pre-count=2>; UPDATE … RETURNING …; <post-count=2>; COMMIT;` ran cleanly:

```
 will_update
-------------
           2

                  id                  |                       slug                        | locale |  status
--------------------------------------+---------------------------------------------------+--------+-----------
 8f03daf2-fbfc-4b56-bd14-f874931b3686 | system-prompts-role-prompting-best-practices-2026 | en     | published
 8b90f2f9-7fb2-4940-816f-8c443ec2a02c | system-prompts-role-prompting-best-practices-2026 | de     | published

UPDATE 2

 active_with_new_slug
----------------------
                    2

COMMIT
```

### F1.3 — Hero-backfill

`bun --filter @marketing-auto/api backfill-imported-heroes --project=toolwiki --apply` reported:

```
totalCandidates: 0
processed: 0
mirrored: 0
reused: 0
failed: 0
elapsedMs: 635
```

No-op as anticipated — the heroes were already on the (then-superseded) rows from a previous Re-Import (hash-equality refresh-whitelist preserves them across the supersede→published flip; UPDATE didn't touch the hero columns).

### F2.1 — Re-verification

All assertions met:

| Check | Expected | Actual | Match |
|---|---|---|---|
| total | 318 | 318 | ✓ |
| superseded | 8 | 8 | ✓ |
| active | 310 | 310 | ✓ |
| `system-prompts-role-prompting-*` rows | only 2, both `best-practices-2026`, both `published` | exactly that | ✓ |
| 2 new rows have `hero_image_r2_key` | both true | both true | ✓ |
| 2 new rows have `hero_image_source_sha256` | both true | both true | ✓ |
| 2 new rows have `hero_image_public_url` | both true | both true | ✓ |
| 2 new rows have `hero_image_alt_text` | both true | both true | ✓ |
| Leftover active rows with OLD slugs | 0 | 0 | ✓ |
| blog/de active | 25 | 25 | ✓ |
| blog/en active | 25 | 25 | ✓ |

### F2.2 — D9 added to Cleanup-Spec 001

D9 entry appended to [`specs/001-db-cleanup-post-refactor.md`](../../../specs/001-db-cleanup-post-refactor.md) §12 documenting the slug-rename ↔ supersede conflict, the fix decision, and the snapshot-consistency side-effect (10 → 8 superseded).

### F2.3 — Backlog updated

Refined the existing "Slug-Rename-Detection im Importer" entry in [`docs/backlog/post-cleanup-followups.md`](../../backlog/post-cleanup-followups.md) with the specific Anomaly-A footgun (matcher does not filter by `status`), and added a new "Mirror-Step-Ordering im Importer" entry capturing the second-Re-Import-needed observation from the 15:34Z verification.

### F3 — GO-Signal

Anomaly A resolved. Verdict ✅ PASS (from ⚠️ WARN). Bucket-D + Bucket-C dürfen parallel starten.

## 9. Discovered & Deviations

### D1: Hero-Backfill was a confirmed no-op (no surprise)

Pre-snapshot showed `has_hero=t` for both superseded rows, which seemed counter-intuitive — but the Re-Import had already mirrored the heroes onto those rows (since the rows existed, were tagged `superseded`, and the `MirrorHeroImagesStep` iterates over all imported-source DB rows regardless of status). The UPDATE preserved all hero columns. F1.3 verified: `totalCandidates: 0`. Acceptance #2 thus reads "the 2 rows already had heroes; backfill confirms no work remained" rather than "backfill mirrored 2 new heroes."

### D2: `pg_dump` can't WHERE-filter; used `awk` post-filter

Spec §3 sketched `pg_dump … WHERE id IN (…)` syntax. `pg_dump` doesn't support row-level WHERE clauses — the only built-in filter is `--table`. Worked around with:

```bash
pg_dump … --data-only --column-inserts --table=articles | awk '/^INSERT/ && /(id1|id2)/' > backup.sql
```

The 318-row dump is small (~tens of KB), so the post-filter is cheap. The `\COPY (SELECT *) TO …` alternative was considered but produces CSV, not replayable INSERTs.

### D3: D9 entry path-references

The D9 entry in `specs/001-db-cleanup-post-refactor.md` was originally drafted (in the command-args) with a placeholder `2026-MM-DD` date and a `docs/specs/db-cleanup-post-refactor/spec.md` path. Actual paths:

- Cleanup spec lives at `specs/001-db-cleanup-post-refactor.md` (root `/specs/`, not `/docs/specs/`)
- Fix spec lives at `docs/specs/fix-slug-rename-supersede-conflict/spec.md`
- Date filled in as 2026-05-24 to match the live fix.

### D4: Backlog merged, not appended

The command-args spec proposed a fresh "Importer-Robustness Follow-up-Spec" section in the backlog. The existing backlog already had a "Slug-Rename-Detection im Importer" entry from Spec 001 §5.3 — I refined it with the Anomaly-A footgun rather than introducing a duplicate section, and added the new "Mirror-Step-Ordering im Importer" item alongside. Effort-estimate combined for both.

### D5: Cluster-membership preserved

Both rows kept `cluster_key='prompt-engineering-2026'` through the UPDATE. Risk R3 confirmed accurate: `cluster_key` is a string column with no FK, so slug rename is invisible to cluster-membership lookups.

### D6: `created_at` preserved (2026-05-08)

The original `created_at` (2026-05-08) from when the rows were first imported survived the UPDATE — only `updated_at` got refreshed. Audit-trail of "this row has existed since the May-8 import" is intact. The Cleanup-C2 supersede flip also touched `updated_at`, so the gap between `created_at` and `updated_at` already encoded "this row was modified after creation"; the fix's UPDATE just extends that.
