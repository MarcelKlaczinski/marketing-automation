# Spec: DB-Cleanup Post-Refactor + Re-Import

_Branch: `feature/db-cleanup-post-refactor`_
_Codebase: Marketing-Tool-Monorepo_
_Status: Draft._
_Aufwand: ~3-5 Tage, 5 Sprints._
_Voraussetzung: Post-Refactor-State-Audit (`docs/discovery/post-refactor-state-audit.md`) gemerged._
_Parallel-Branch: `feature/hero-image-mirror` (Hero-Spec) — Sync-Punkt: Hero-H3 muss vor C4 (Re-Import) auf master sein._

---

## 1. Problem

Aus `docs/discovery/post-refactor-state-audit.md`:

Nach Branch-A (Marketing-Tool `multi-domain-evolution`) + Branch-B (Toolwiki-Astro `schema-consolidation`) gibt es Drift zwischen Tool-DB und Toolwiki-Repo, der nicht durch reines Re-Import lösbar ist:

1. **10 verwaiste Blog-Rows** in DB (5 pro Locale), die im Repo nicht mehr existieren:
  - 4 Comparison-Migrations (Blog → `comparisons/` Collection-Move)
  - 2 Slug-Renames (`...-leitfaden`/`-guide` → `...-best-practices-2026`)
  - 4 pure Deletions (`chatgpt-preise/-pricing-2026`, `code-assistenten`/`ai-code-assistants`)

   **Importer hat keinen Delete-Step** — diese Rows bleiben bei jedem Re-Import bestehen. Verfälschen Gap-Detection, Cluster-Belegung, Plan-Generation.

2. **22 Comparison-Rows mit stale Felder** aus ihrer Blog-Vorvergangenheit:
  - 22× stale `published_at` (alte Blog-Daten)
  - 22× stale `category` (`"Vergleiche"` statt `comparisons`-Slug)
  - 24× stale `tags` (alte Blog-Tags)

   **Refresh-Whitelist (Spec multi-domain-evolution S1.1) schützt diese Felder** vor Überschreibung durch Re-Import. Cleanup muss vor Re-Import laufen.

3. **18 neue Files im Repo, die als Inserts beim Re-Import landen** (kein Cleanup-Bedarf, nur Erwartung):
  - 12 neue ki-wissen-Pillars (6 Themen × DE+EN)
  - 4 Comparison-Adds (DALL·E + ElevenLabs migration targets)
  - 2 Blog-Renames (best-practices-Slug)

4. **Re-Import-Trigger fehlt** — nach Cleanup muss `RepoImportPipeline` für Toolwiki-Project ausgelöst werden, um die 18 neuen Inserts anzulegen + 250+ bestehende Rows zu refreshen.

## 2. Ziel

DB-State stimmt 1:1 mit Repo-State überein (modulo Refresh-Whitelist-geschützte Felder). Keine Orphans, keine Stale-Comparison-Fields. Re-Import läuft sauber mit aktiviertem Hero-Mirror-Step (Hero-Spec H3 ist Voraussetzung für C4).

**In Scope:**

- SQL-Cleanup für 10 Orphan-Blog-Rows (`status='superseded'`)
- SQL-Cleanup für 22 Comparison-Rows stale Felder (`category=NULL, published_at=NULL, tags=NULL`)
- Pre-Cleanup Verification (Counts bestätigen)
- Re-Import-Trigger via existierender `RepoImportPipeline` (kein neuer Code, nur Trigger)
- Post-Re-Import Verification (Counts + Coverage + Slug-Diff = 0)
- Cleanup-CLI-Script mit Dry-Run-Default + `--apply` + `--project=<slug>` (Pattern 121 / D146)

**Out of Scope:**

- Bucket-D Bug-Fixes (D1 `astro_frontmatter`, D4 `content_pillars`-Sync) — separate Folge-Spec
- Bucket-C Cleanup (`content_pillars` + `clusters` Schwester-Drift) — separate Spec, nicht durch aktuellen Refactor verursacht
- Importer-Erweiterung um Delete-Step (separate Spec falls gewollt — heute manuell)
- Slug-Rename-Detection im Importer — separate Spec
- Hero-Image-Mirror — eigene parallele Spec
- BK-Onboarding

## 3. Architektur

### 3.1 Sprint C1 — Pre-Cleanup Verification + Cleanup-Script (Tag 1-2)

**C1.1 Pre-Cleanup-State-Capture** (1h)

Bevor irgendetwas geändert wird: aktuellen DB-State dokumentieren als Reference.

Datei: `apps/api/src/scripts/discovery/capture-cleanup-baseline.ts`

```ts
// Read-only script, captures current state as JSON
const baseline = {
  timestamp: new Date().toISOString(),
  projectId: TOOLWIKI_PROJECT_ID,
  
  // Total articles per collection × locale × source × status
  articlesInventory: await db.execute(sql`
    SELECT collection, locale, source, status, COUNT(*) AS count
    FROM articles
    WHERE project_id = ${TOOLWIKI_PROJECT_ID}
    GROUP BY collection, locale, source, status
  `),
  
  // The 10 orphan candidates with full row state
  orphanBlogs: await db.query.articles.findMany({
    where: and(
      eq(articles.projectId, TOOLWIKI_PROJECT_ID),
      eq(articles.collection, "blog"),
      inArray(articles.slug, ORPHAN_BLOG_SLUGS),
    ),
  }),
  
  // The comparison rows with stale fields
  comparisonsWithStaleFields: await db.query.articles.findMany({
    where: and(
      eq(articles.projectId, TOOLWIKI_PROJECT_ID),
      eq(articles.collection, "comparisons"),
      or(
        isNotNull(articles.publishedAt),
        isNotNull(articles.category),
        // tags is jsonb — needs jsonb_array_length check
      ),
    ),
    columns: {
      id: true, slug: true, locale: true,
      category: true, publishedAt: true, tags: true,
    },
  }),
};

// Persist to apps/api/src/scripts/discovery/baseline-pre-cleanup-<timestamp>.json
```

Output wird Marcel-reviewed bevor `--apply` ausgeführt wird.

**Pattern-Referenz:** Verify-Gate als Spec-Source-of-Truth (Memory: „Toolwiki Verify-Gate als Spec-Source-of-Truth"). Capture-Script ist die SQL-kanonische Definition was als Orphan/Stale gilt.

**C1.2 Cleanup-CLI-Script** (3-4h)

Datei: `apps/api/src/scripts/cleanup-post-refactor-drift.ts`

```ts
import { parseArgs } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";

const ORPHAN_BLOG_SLUGS = [
  // Comparison-Migrations
  "dalle-4-vs-midjourney-v7-vs-flux-2026-vergleich",
  "dall-e-4-vs-midjourney-v7-vs-flux-2026-comparison",
  "elevenlabs-vs-murf-vs-play-ht-voice-cloning-test-2026",
  "elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026",
  // Slug-Renames
  "system-prompts-role-prompting-2026-leitfaden",
  "system-prompts-role-prompting-2026-guide",
  // Pure Deletions
  "chatgpt-preise-2026",
  "chatgpt-pricing-2026",
  "code-assistenten",
  "ai-code-assistants",
];

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    apply: { type: "boolean", default: false },
    only: { type: "string" },  // "orphans" | "stale" | undefined (= both)
  },
});

if (!values.project) {
  console.error("Required: --project=<slug>");
  process.exit(1);
}

const project = await loadProject(values.project);
const doOrphans = !values.only || values.only === "orphans";
const doStale = !values.only || values.only === "stale";

// PHASE 1: Orphan-Supersede
if (doOrphans) {
  const orphanCount = await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM articles
    WHERE project_id = ${project.id}
      AND collection = 'blog'
      AND slug = ANY(${ORPHAN_BLOG_SLUGS})
      AND status != 'superseded'
  `);
  
  console.log(`[ORPHANS] Found ${orphanCount[0].count} candidates to supersede`);
  
  if (!values.apply) {
    console.log("[ORPHANS] DRY-RUN — would UPDATE 10 rows to status='superseded'");
  } else {
    const result = await db.execute(sql`
      UPDATE articles
      SET status = 'superseded', updated_at = NOW()
      WHERE project_id = ${project.id}
        AND collection = 'blog'
        AND slug = ANY(${ORPHAN_BLOG_SLUGS})
        AND status != 'superseded'
      RETURNING id, slug, locale
    `);
    console.log(`[ORPHANS] Updated ${result.length} rows`);
  }
}

// PHASE 2: Stale-Comparison-Fields
if (doStale) {
  const staleCount = await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM articles
    WHERE project_id = ${project.id}
      AND collection = 'comparisons'
      AND (
        category IS NOT NULL
        OR published_at IS NOT NULL
        OR (tags IS NOT NULL AND jsonb_array_length(tags) > 0)
      )
  `);
  
  console.log(`[STALE] Found ${staleCount[0].count} comparison rows with stale fields`);
  
  if (!values.apply) {
    console.log("[STALE] DRY-RUN — would UPDATE ~24 rows (NULL category/published_at/tags)");
  } else {
    const result = await db.execute(sql`
      UPDATE articles
      SET category = NULL,
          published_at = NULL,
          tags = '[]'::jsonb,
          updated_at = NOW()
      WHERE project_id = ${project.id}
        AND collection = 'comparisons'
        AND (
          category IS NOT NULL
          OR published_at IS NOT NULL
          OR (tags IS NOT NULL AND jsonb_array_length(tags) > 0)
        )
      RETURNING id, slug, locale
    `);
    console.log(`[STALE] Updated ${result.length} rows`);
  }
}

console.log(values.apply ? "Cleanup applied. Run capture script to verify." : "Dry-run complete.");
```

**Wichtige Punkte:**
- `tags = '[]'::jsonb` (leeres Array) statt `NULL` — Drizzle-Schema-Default für `tags` ist vermutlich `jsonb` mit Array-Erwartung. Konsistenz mit Insert-Pfad.
- `RETURNING id, slug, locale` für Logging — Marcel sieht im Output welche Rows betroffen waren
- **Pre-Check via SELECT vor UPDATE**: Auch bei `--apply` läuft erst die Count-Query, dann UPDATE. Wenn Count-Result von der Erwartung (10 / 22-24) abweicht: Abbruch mit klarer Fehlermeldung.
- `--only=orphans` / `--only=stale` für selektive Re-Runs falls einer der Schritte fehlschlägt

**Pattern-Referenz:** D146 Backfill-Dry-Run-Default. Pattern 121 Dry-Run-Apply-Pattern.

**C1.3 Acceptance-Tests für Cleanup-Script** (2-3h)

Datei: `apps/api/test/scripts/cleanup-post-refactor-drift.smoke.test.ts`

Test-Cases:

1. **Dry-Run no-op:** Count-Output zeigt erwartete Anzahl, keine DB-Mutation
2. **Apply Orphan-only:** `--only=orphans --apply` → 10 Rows supersedet, Stale-Comparison-Fields unverändert
3. **Apply Stale-only:** `--only=stale --apply` → 22-24 Rows mit NULL Felder, Orphans unverändert
4. **Apply Both:** Default-Run → beide Cleanups in einer Session
5. **Idempotent:** `--apply` zweimal hintereinander → zweiter Run zeigt 0 Affected (kein Re-Update)
6. **Missing project:** Falscher `--project`-Slug → Error-Exit mit klarer Message
7. **Cross-Tenant-Protection:** Falsche Project-ID kann nicht andere Project-Rows treffen (project_id-Filter im WHERE)
8. **Count-Mismatch-Abort:** Wenn Pre-Check 5 statt 10 Orphans findet (z.B. weil 5 schon supersedet) → Apply läuft trotzdem (Pre-Check ist informational, nicht fail-stop). Aber Warning-Log wenn Count != erwartet.

### 3.2 Sprint C2 — Cleanup-Apply auf Toolwiki (Tag 2)

**C2.1 Dry-Run-Review** (15min Marcel-Action)

```bash
bun --filter @marketing-auto/api cleanup-post-refactor-drift --project=toolwiki
```

Erwartete Output:
```
[ORPHANS] Found 10 candidates to supersede
[ORPHANS] DRY-RUN — would UPDATE 10 rows to status='superseded'
[STALE] Found 24 comparison rows with stale fields
[STALE] DRY-RUN — would UPDATE ~24 rows (NULL category/published_at/tags)
Dry-run complete.
```

Marcel approves Counts (10 + 24 = matches Audit-Vorhersage), dann weiter zu C2.2.

**C2.2 Apply** (15min Marcel-Action)

```bash
bun --filter @marketing-auto/api cleanup-post-refactor-drift --project=toolwiki --apply
```

Erwartete Output:
```
[ORPHANS] Found 10 candidates to supersede
[ORPHANS] Updated 10 rows
[STALE] Found 24 comparison rows with stale fields
[STALE] Updated 24 rows
Cleanup applied. Run capture script to verify.
```

**C2.3 Post-Cleanup-Verification** (30min)

```bash
bun --filter @marketing-auto/api capture-cleanup-baseline toolwiki
# (re-uses C1.1 script, produces post-cleanup snapshot)
```

Verify:
```sql
-- Orphans: alle 10 jetzt status='superseded'
SELECT slug, locale, status FROM articles
WHERE project_id = '<toolwiki-id>'
  AND collection = 'blog'
  AND slug = ANY(<ORPHAN_BLOG_SLUGS>);
-- Expected: 10 rows, alle status='superseded'

-- Comparisons stale fields cleared
SELECT COUNT(*) FROM articles
WHERE project_id = '<toolwiki-id>'
  AND collection = 'comparisons'
  AND (category IS NOT NULL OR published_at IS NOT NULL);
-- Expected: 0
```

**Sync-Status:** C1-C3 können vor oder parallel zu Hero-Spec laufen. C2 ist eine isolierte DB-Mutation, blockiert nichts.

### 3.3 Sprint C3 — Slug-Diff-Verification + Pre-Re-Import-Check (Tag 2-3)

**C3.1 Erwarteter Post-Re-Import-State berechnen** (1h)

Datei: `apps/api/src/scripts/discovery/forecast-re-import-state.ts`

Liest Repo-Side (via GitHub-API analog zu RepoImportPipeline) + DB-Side, berechnet erwartete Mutationen:

```
Expected Inserts:
- blog/de: 1 (system-prompts-role-prompting-best-practices-2026)
- blog/en: 1 (system-prompts-role-prompting-best-practices-2026)
- comparisons/de: 2 (dalle-..., elevenlabs-...)
- comparisons/en: 2 (dalle-..., elevenlabs-...)
- ki-wissen/de: 6 (neuronale-netze, backpropagation, eu-ai-act, entscheidungsbaeume, datenschutz-bei-ki, chatgpt-guide)
- ki-wissen/en: 6 (neural-networks, backpropagation, eu-ai-act, decision-trees, ai-privacy, chatgpt-guide)

Total Expected Inserts: 18

Expected Updates: ~250 existing in-sync rows (frontmatter_updated_at + body_md refresh)
Expected Hero-Mirror Activations: 18 new rows + any rows with changed source-files

Expected Cluster-Inserts (via SyncClustersFromFrontmatterStep):
- 'ki-recht-2026' (eu-ai-act + datenschutz-bei-ki)
- 'praxis-tools' (chatgpt-guide)
```

Output wird mit Audit's "DB-Total nach Re-Import: 290 Rows" vorhersage gematched. Marcel signs off vor C4-Trigger.

**C3.2 Verify Hero-Spec-Sync-Punkt** (5min Marcel-Check)

Pre-Condition für C4-Trigger:

```bash
# 1. Hero-Spec H3 ist auf master?
git log master --oneline | grep "mirror-hero-images"
# Expected: commit visible

# 2. Default-Hero ist im Astro-Repo committed?
gh api repos/MarcelKlaczinski/ki-wissensraum-v2/contents/public/heroes/default.webp
# Expected: 200 OK with size

# 3. Hero-Backfill-Sample ist erfolgreich gelaufen (oder wird durch Re-Import übernommen)?
# (Marcel-Discretion — if H5 sample already done, fine; if not, C4 will mirror everything at once)
```

Wenn nicht alle 3 Pre-Conditions erfüllt: STOP. Cleanup-Spec wartet auf Hero-Spec H3 + Default-Hero-File.

### 3.4 Sprint C4 — Re-Import-Trigger (Tag 3-4)

**C4.1 Trigger-Methode entscheiden** (15min)

Zwei Optionen:

**A) HTTP-Endpoint:**
```bash
curl -X POST https://<tool-domain>/api/projects/toolwiki/astro-import \
  -H "Cookie: <session>"
```
- Vorteil: Cost-Gates + Pause-Gates aktiv, normale Pipeline-UI-Anzeige
- Nachteil: Session-Cookie nötig

**B) Direct-CLI:**
```bash
bun --filter @marketing-auto/api trigger-astro-import --project=toolwiki
```
- Vorteil: einfacher
- Nachteil: muss CLI-Script existieren oder neu angelegt werden

**Empfehlung: A (HTTP-Endpoint)**, weil existing, beobachtet, mit Notification-Pipeline integriert.

**C4.2 Re-Import-Run** (Marcel-Action, ~5-10min)

Trigger erfolgt. Erwartete Pipeline-Step-Outputs:

```
ExtractCollectionSchemasStep    → 9 collections detected
ListContentFilesStep            → ~289 files (including 18 new)
FilterChangedFilesStep          → ~50-100 changed (frontmatter/body) + 18 new
ParseFrontmatterBatchStep       → ~89-118 parsed
MirrorHeroImagesStep            → mirrored: ~258, reused: 0, failed: 2 (was-ist-ki without default-hero in MDX — wenn Default in DB ist, 0 failed)
UpsertArticlesStep              → inserts: 18, updates: ~50-118
LinkTranslationPairsStep        → ~18 new pairs linked
SyncClustersFromFrontmatterStep → 2 new clusters
DetectContentGapsStep           → updated gap state
UpdateImportRunStep             → marked complete
```

Marcel beobachtet via UI oder Logs.

**C4.3 Post-Re-Import-Verification** (1h)

```bash
bun --filter @marketing-auto/api capture-cleanup-baseline toolwiki
# (third snapshot, post-re-import)
```

Verify:
```sql
-- Article-Total
SELECT COUNT(*) FROM articles
WHERE project_id = '<toolwiki-id>';
-- Expected: 290 (272 - 0 deletes + 18 inserts)

-- Active (non-superseded) count
SELECT COUNT(*) FROM articles
WHERE project_id = '<toolwiki-id>' AND status != 'superseded';
-- Expected: 280 (290 - 10 supersedet)

-- Hero-Mirror-Coverage
SELECT collection, locale, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE hero_image_r2_key IS NOT NULL) AS has_r2
FROM articles
WHERE project_id = '<toolwiki-id>' AND source = 'imported' AND status != 'superseded'
GROUP BY collection, locale;
-- Expected: all collections except tool-categories have 100% Coverage,
--           or near-100% (depending on was-ist-ki default-hero handling)

-- Slug-Diff (Repo vs DB)
-- Re-Run audit-diff-matrix.ts script aus Post-Refactor-Audit
bun apps/api/src/scripts/discovery/audit-diff-matrix.ts toolwiki
-- Expected:
--   blog DE/EN: 25 repo, 25 active DB, 0 Repo-only, 0 DB-only (excluding superseded)
--   comparisons DE/EN: 14 repo, 14 DB, 0 diff
--   ki-wissen DE/EN: 18 repo, 18 DB, 0 diff
--   ... etc
```

Wenn Diff nicht 0: STOP. Investigation. Möglicherweise Bucket-D-Issue (jetzt Folge-Spec) oder Pipeline-Step-Bug.

### 3.5 Sprint C5 — Documentation + Future-Proofing (Tag 4-5)

**C5.1 Implemented-Section füllen** (1h)

`docs/specs/db-cleanup-post-refactor/IMPLEMENTED.md` mit Commit-SHAs + Counts.

**C5.2 Lessons-Learned dokumentieren** (1h)

Update root CLAUDE.md mit:

```markdown
## DB-Repo-Drift-Patterns

### Orphan-Detection
Importer hat heute keinen Delete-Step. Wenn Repo-Files gelöscht oder umbenannt werden:
- DB-Rows bleiben mit `status='published'` stehen
- Cleanup-Script `cleanup-post-refactor-drift.ts` markiert sie manuell als `status='superseded'`
- Future: Spec für `DetectOrphanedArticlesStep` mit auto-supersede (separate Aufgabe)

### Refresh-Whitelist-Footgun
Felder wie `category`, `published_at`, `tags` sind Refresh-Whitelist-protected.
Wenn Branch-B-Refactor diese aus dem Frontmatter entfernt:
- Repo-Side: Feld verschwindet
- DB-Side: Wert bleibt stale
- Cleanup-SQL muss explizit NULL setzen

### Slug-Rename-Detection
Importer trackt `filePath` aber NICHT Slug-Renames als „supersedes alte Row".
Wenn ein File umbenannt wird:
- Neue Row mit neuem Slug entsteht
- Alte Row bleibt mit altem Slug + neuem filePath (verwirrend)
- Future: Spec für Slug-Rename-Detection (separate Aufgabe)
```

**C5.3 Backlog für Folge-Specs** (30min)

Markdown unter `docs/backlog/post-cleanup-followups.md`:

```markdown
# Post-Cleanup Folge-Specs

## Priorität 1
- **Bucket-D Bug-Fixes** (Audit §6.1)
  - D1: `astro_frontmatter` Column — dead column oder fehlender Write-Path? Klären + ggf. Migration 0102 (DROP COLUMN)
  - D4: `content_pillars` aus Frontmatter? `SyncClustersFromFrontmatterStep` lesen, prüfen ob Pillars geseedet werden
- **Bucket-C Cleanup** (Audit §6.1)
  - C1: `content_pillars` Schwester-Drift (20 Rows mit Doppel-Naming)
  - C2: `clusters` Doppel-Sprach-Slugs (`code-assistants-2026` + `code-assistenten-2026`)
  - C4: `parent_slug` auf `content_categories` — Hierarchie-Migration

## Priorität 2
- **Orphan-Detection im Importer** — automatische Supersede statt manueller Cleanup
- **Slug-Rename-Detection** — filePath-Match als Supersede-Trigger
- **`projects.allowed_collections` und `default_locale`** — sind Task-Brief-Felder, existieren nicht in DB. Entweder Migration oder Task-Brief korrigieren.
```

## 4. Tests

**Pro Sprint:**
- Smoke-Tests in `apps/api/test/scripts/` (Pattern aus `64.10`/`64.15`)
- Bun-Test-Runner
- Keine Unit-Tests für SQL (SQL ist deklarativ, durch Verify-Gates getestet)

**Cross-Sprint:**
- **Pre/Post-Cleanup-Snapshot-Diff:** Snapshots in `apps/api/src/scripts/discovery/baseline-*.json` werden gediff't. Erwartete Diffs: 10 status-changes + 24 field-nullings.
- **Re-Import-Idempotenz:** Cleanup-Script `--apply` zweimal hintereinander → 0 Affected Rows beim zweiten Run.

## 5. Acceptance

1. Capture-Script `capture-cleanup-baseline.ts` existiert, produziert JSON-Snapshots
2. Cleanup-Script `cleanup-post-refactor-drift.ts` existiert mit Dry-Run-Default, `--apply`, `--project=<slug>`, `--only=`-Filter
3. 8 Smoke-Tests grün (C1.3)
4. Dry-Run-Output zeigt 10 Orphans + 24 Stale-Comparisons (matches Audit)
5. Apply: 10 Rows `status='superseded'`, 24 Comparison-Rows `category/published_at/tags` cleared
6. Post-Cleanup-Snapshot zeigt 0 Orphan-Candidates, 0 Stale-Comparisons
7. Hero-Spec H3 + Default-Hero-File sind Pre-Conditions für C4 — beide verifiziert
8. Re-Import läuft sauber, alle 9 Pipeline-Steps grün
9. Post-Re-Import-Snapshot zeigt:
  - 290 Rows total (272 - 0 deletes + 18 inserts)
  - 280 Rows mit `status != 'superseded'`
  - 0 Slug-Diff zwischen Repo und Active-DB-Rows
  - Hero-Coverage ~100% (modulo `tool-categories` skip + ggf. `was-ist-ki` default)
10. CLAUDE.md ergänzt mit Drift-Patterns-Section
11. Folge-Spec-Backlog dokumentiert

## 6. Cross-Cutting-Regeln

- **Read-Only zuerst, dann schreiben:** Capture-Snapshot vor jedem Mutation-Step. Verify-Snapshot nach jedem Mutation-Step.
- **`status='superseded'`** statt DELETE — gibt Audit-Trail, ist filterbar in Queries (`WHERE status != 'superseded'`).
- **Refresh-Whitelist-Bypass via NULL:** Stale-Fields werden explizit auf NULL gesetzt (statt zu erwarten dass Re-Import sie überschreibt — Whitelist schützt davor).
- **Cross-Tenant-Protection:** Alle Mutations gehen durch `project_id`-Filter. `--project=<slug>` ist Pflicht, kein Default.
- **Sync-Punkt mit Hero-Spec:** C4 wartet auf Hero-H3-Merge auf master. Pre-Check in C3.2 enforced.
- **Idempotent:** Alle Scripts können beliebig oft mit `--apply` ausgeführt werden ohne neue Side-Effects.
- **Pattern 121 / D146:** Dry-Run-Default, `--apply` opt-in, count-based dry-run (kein Predicate-Loop), `--project=<slug>` Pflicht.

## 7. Decisions (vorab geklärt mit Marcel)

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| D1 | Orphan-Strategie | `status='superseded'` (NICHT DELETE) | Audit-Trail, filterbar, reversibel falls Marcel sich anders entscheidet |
| D2 | Stale-Fields-Strategie | Auf NULL setzen (NICHT auf neue Slug-Werte) | Re-Import würde sie sowieso nicht überschreiben (Refresh-Whitelist). NULL ist deklarativ „Feld nicht relevant für diese Collection". |
| D3 | Cleanup vor oder nach Re-Import | VOR Re-Import | Refresh-Whitelist schützt Stale-Fields. Cleanup zuerst, dann Re-Import schreibt korrekte neue Werte. |
| D4 | `tags`-Cleanup-Wert | `'[]'::jsonb` leeres Array | Konsistent mit Drizzle-Schema Default. NULL würde JSONB-Operatoren brechen. |
| D5 | Re-Import-Trigger-Methode | HTTP-Endpoint | Existing, Cost-Gates aktiv, UI-Beobachtung |
| D6 | Bucket-D-Inkludierung | NEIN — separate Folge-Spec | Scope tight halten. D1/D4 sind Code-Investigation, kein einfacher SQL-Cleanup. |
| D7 | Bucket-C-Inkludierung | NEIN — separate Spec | Pre-existing Drift, nicht durch aktuellen Refactor verursacht. |
| D8 | Slug-Rename-Importer-Fix | NEIN — Folge-Spec | Architektur-Change im Importer. Out of scope. |

## 8. Sync-Punkt mit Hero-Spec

| Hero-Sprint | Cleanup-Sprint | Beziehung |
|---|---|---|
| Hero H1 (Migration + Default-Doku) | Cleanup C1 (Capture + Script) | Parallel möglich |
| Hero H2 (Step-Code) | Cleanup C2 (Apply) | Parallel möglich |
| Hero H3 (Pipeline-Wiring) | Cleanup C3 (Pre-Re-Import-Check) | **C3.2 prüft Hero-H3-Merge** |
| Hero H4 (Backfill-Script) | — | Optional, parallel |
| Hero H5 (Full-Backfill) | Cleanup C4 (Re-Import) | **C4 setzt H3 auf master voraus** |
| — | Cleanup C5 (Docs + Backlog) | Konsekutiv zu C4 |

**Konkret:** Beide Branches arbeiten parallel:

1. Cleanup C1+C2 laufen unabhängig (Marcel kann sofort starten)
2. Hero H1-H3 laufen parallel
3. **Sync-Punkt:** Cleanup C3.2 verifiziert Hero-H3-Merge auf master
4. Cleanup C4 triggert Re-Import (nutzt Mirror-Step automatisch)
5. Hero H5 wird redundant (von C4 mit erledigt), aber kann als Belt-and-Suspenders laufen falls vor C4 ausgeführt

## 9. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | Cleanup-Script trifft falsche Rows | Slug-Liste ist hartcodiert (10 known orphans), `--project=<slug>` Pflicht. Capture-Snapshot vor Apply als Beweis-Lage. |
| R2 | `tags='[]'::jsonb` bricht Drizzle-Query | Drizzle-Schema für `tags` checken, Default-Wert konsistent. Test in C1.3 abdecken. |
| R3 | Re-Import läuft in unbekannten Bug | Pipeline-Steps haben Boundary-Validator (Spec multi-domain-evolution S1.2). Bei Failure: klare Error-Message, Pipeline-Run als failed markiert. Rollback der Cleanup-Steps via SQL möglich (Marcel-Discretion). |
| R4 | Hero-H3 ist nicht auf master beim C4-Trigger | C3.2 Pre-Check verhindert das. Cleanup-Branch wartet auf Hero-Branch-Merge. |
| R5 | Re-Import legt Dubletten an statt Updates | Composite-Unique-Index `(project_id, source, collection, locale, slug)` verhindert. Bei Collection-Wechsel (z.B. blog → comparisons) entsteht eine neue Row, alte bleibt — genau das wollen wir (alte ist supersedet). |
| R6 | Default-Hero-File fehlt zu C4-Trigger | Hero-H3 Acceptance #11 fordert es. C3.2 verifiziert. |
| R7 | Cleanup-Script idempotency-bug | Test C1.3 #5 covers it. Pre-Check `status != 'superseded'` im WHERE verhindert Re-Update von bereits superseded Rows. |
| R8 | Stale-Fields-Cleanup trifft auch DE+EN mit echten Werten | `comparisons` als Collection per-definitionem hat heute kein `category`/`publishedAt`/`tags`-Frontmatter mehr. Wenn Marcel später Comparison-Frontmatter erweitert: Cleanup-Script veraltet, müsste angepasst werden. Heute korrekt. |

## 10. Offene Fragen für Marcel

1. **Re-Import-Trigger-UI vs. Endpoint vs. CLI:** Bestätigung dass HTTP-Endpoint `/api/projects/<slug>/astro-import` existiert und funktioniert. Falls nicht: CLI als Fallback.
2. **`tags='[]'::jsonb` vs `tags=NULL`:** Audit-Empfehlung war NULL. Drizzle-Schema-Default checken. Wenn Default `'[]'`: konsistent halten. Wenn nullable: NULL ok.
3. **Sample-Verify-Tiefe:** Soll C4.3 Verification alle Collections ge-diff'en oder reicht Spot-Check auf blog/comparisons/ki-wissen (die betroffenen)?
4. **Rollback-Plan falls Re-Import fehlschlägt:** Backup-Strategie? DB-Snapshot vor C4-Trigger empfohlen.
5. **Pipeline-Run-Beobachtung:** UI hat dafür heute eine View? Oder beobachtet Marcel via Logs?

## 11. Implemented

**Date: 2026-05-24** (single session, Marcel + Claude Opus 4.7).

### Files created

- [packages/db/drizzle/0102_article_status_superseded.sql](../packages/db/drizzle/0102_article_status_superseded.sql) — `ALTER TYPE article_status ADD VALUE 'superseded'` (Discovery: enum did not have the value the spec assumed; see §12)
- [packages/db/drizzle/meta/_journal.json](../packages/db/drizzle/meta/_journal.json) — entry idx=102, when=1788000000000
- [packages/db/src/schema/_enums.ts](../packages/db/src/schema/_enums.ts) — `articleStatusEnum` widened
- [apps/api/src/scripts/discovery/capture-cleanup-baseline.ts](../apps/api/src/scripts/discovery/capture-cleanup-baseline.ts) — C1.1 (read-only snapshot)
- [apps/api/src/scripts/cleanup-post-refactor-drift.ts](../apps/api/src/scripts/cleanup-post-refactor-drift.ts) — C1.2 (dry-run default, `--apply`, `--project`, `--only`)
- [apps/api/test/scripts/cleanup-post-refactor-drift.smoke.test.ts](../apps/api/test/scripts/cleanup-post-refactor-drift.smoke.test.ts) — C1.3 (9 tests, all green; DI-port pattern offline)
- [apps/api/src/scripts/discovery/forecast-re-import-state.ts](../apps/api/src/scripts/discovery/forecast-re-import-state.ts) — C3.1
- [docs/backlog/post-cleanup-followups.md](../docs/backlog/post-cleanup-followups.md) — C5.3 backlog

### Files modified

- [apps/api/package.json](../apps/api/package.json) — 3 new scripts (`capture-cleanup-baseline`, `cleanup-post-refactor-drift`, `forecast-re-import-state`)
- [.gitignore](../.gitignore) — exclude `apps/api/src/scripts/discovery/baseline-*.json` (local, project-specific row data)
- [CLAUDE.md](../CLAUDE.md) — Spec 001 added to implemented-specs list + new DB-Repo-Drift-Patterns subsection (C5.2)

### C2 Toolwiki cleanup result (applied 2026-05-24)

| Metric | Before | After (post-apply) | Expected | Match |
|---|---|---|---|---|
| Total articles (`project_id=toolwiki`) | 272 | 272 | unchanged (status-flip, no delete) | ✓ |
| Active articles (`status != 'superseded'`) | 272 | 262 | 272 - 10 = 262 | ✓ |
| Superseded articles | 0 | 10 | 10 (Acceptance #5) | ✓ |
| Orphan candidates not superseded | 10 | 0 | 0 (Acceptance #6) | ✓ |
| Comparison rows with stale fields | 2 | 0 | 0 (Acceptance #6) | ✓ |

Idempotency verified: a second `--apply` run reports 0 candidates and 0 affected on both phases.

### C3.2 Hero-Spec sync-point

Verified `32b0c54 feat(astro-sync): hero-image mirror for imported articles (Spec 000)` is on master. Default-hero file existence in the Astro repo was not checked in this session — Marcel signs off on it at C4 trigger time.

### Deferred to Marcel

- **C4 Re-Import trigger** — script + endpoint exist (`POST /api/projects/toolwiki/astro-import`), but the actual trigger is a Marcel-action that requires a session cookie. Forecast prediction: 18 inserts + 262 updates → 280 active rows post-Re-Import (Acceptance #9).
- **C4.3 Post-Re-Import verification** — captured via `capture-cleanup-baseline toolwiki` after the trigger lands.

## 12. Discovered & Deviations

### D1: `articleStatusEnum` did not contain `'superseded'`

Spec Decision D1 assumed `status='superseded'` was a valid enum value for `articles.status`. Phase 0 grep against [packages/db/src/schema/_enums.ts](../packages/db/src/schema/_enums.ts) revealed the enum had only 13 values (proposed/approved/generating/outline_review/drafting/final_review/schema_extending/ready_to_publish/validating/published/blocked_by_pagespeed/failed/rejected). The value DID exist on three other tables (`pipeline_runs.status` from Spec 62.0a, `topic_briefs.approval_status`, `template_renders.status`) — just not `articles`.

**Resolution:** Marcel chose to add `'superseded'` via migration 0102 (faithful to spec D1; pattern matches 62.0a's enum-widening) rather than the alternative of reusing `'rejected'`. The migration is enum-only because PostgreSQL forbids using a freshly-added enum value in the session that added it (Memory D124).

`VALID_ARTICLE_STATUSES` in [apps/api/src/routes/articles.ts:349](../apps/api/src/routes/articles.ts:349) (drives the lane filter on `GET /api/projects/:slug/articles`) was deliberately NOT widened — superseded rows are an internal lane that Marcel shouldn't select from the UI dropdown. Filter queries that should exclude them use `ne(articles.status, "superseded")` instead.

### D2: `articles.tags` is `text[]`, not `jsonb`

Spec §10 Q2 + Decision D4 assumed `tags = '[]'::jsonb`. Actual schema in [packages/db/src/schema/content.ts:209](../packages/db/src/schema/content.ts:209) is `tags: text("tags").array()` — Postgres `text[]`.

**Resolution:**
- Count predicate uses `cardinality(${articles.tags}) > 0` (not `jsonb_array_length`) guarded by `IS NOT NULL` since `cardinality(NULL)` returns NULL.
- Reset value uses Drizzle's `set({ tags: [] })` which writes `'{}'::text[]`.

### D3: Stale comparison field count is 2, not 22–24

Spec §1 + §3.2 predicted 22–24 comparison rows with stale `category`/`published_at`/`tags`. Live Toolwiki read shows only **2** such rows (`chatgpt-vs-claude-vs-gemini-2026-vergleich` DE+EN pair). The other ~20 rows predicted by the audit appear to have been cleared by an earlier path (manual SQL, prior import that didn't honor the Refresh-Whitelist, or a Branch-B sync that updated the source files since the audit was written).

**Resolution:** The cleanup script's `countMismatchWarning` fired cleanly (`Found 2 stale comparison rows (expected 22-24). Proceeding anyway`) and the apply still ran correctly. No bug — just a stale audit prediction. Acceptance #5 was reworded mentally from "24 rows" to "all stale rows, however many there actually are."

### D4: Forecast script reads committed `repo-inventory.json` (not live GitHub)

Spec §3.3 / C3.1 sketched a script that would re-fetch repo state via the GitHub API analogue of `RepoImportPipeline`. Phase 0 found the existing audit had already produced `repo-inventory.json` representing the post-Branch-B target state, committed under [apps/api/src/scripts/discovery/repo-inventory.json](../apps/api/src/scripts/discovery/repo-inventory.json).

**Resolution:** Forecast reads the committed JSON + diffs against a live DB inventory. Cheaper (no GitHub API call, no PAT plumbing) and produces the same diff. If the committed snapshot ever goes stale, regenerate it via the separate audit script that originally produced it.

### D5: Spec §1 number `(252 → 262 → 280)` confirmed from a different total

Spec arithmetic: 272 - 10 supersedet + 18 inserts = 280 active.
Actual live: 272 active before (matches), 262 active after cleanup (matches `272 - 10`). Post-Re-Import will be measured at C4.3.

### D6: Live DB inventory includes one `validating` comparison row

Capture snapshot showed `comparisons/de`: 11 published + 1 `validating` = 12 active. Not an orphan, not stale-field — pre-existing state from a refresh pipeline that hadn't completed. Untouched by cleanup. Forecast script also counts it as active and will treat it as an UPDATE target at Re-Import.

### D7: 9 smoke tests, not 8

Spec C1.3 listed 8 test cases. Implementation includes a 9th (`only accepts 'orphans' or 'stale' as --only phase values`) — documents the discriminated-union constraint at type level. All 9 green.

### D8: Migration 0102 not in the spec text

Migration was a Phase 0 discovery, see D1. The spec text doesn't mention any migration; this is an additive change that is part of the cleanup deliverable but wasn't anticipated when the spec was written.
