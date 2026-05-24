# Spec: Importer-Robustness Fixes

_Branch: `feature/importer-robustness`_
_Codebase: Marketing-Tool-Monorepo_
_Status: Draft._
_Aufwand: ~1-2 Tage, 2 Sprints._
_Voraussetzung: Mini-Cleanup-Followups (F1-F3) durchgelaufen._
_Parallel-Branches: keine._

---

## 1. Problem

Aus dem Cleanup-Cycle 2026-05-24 wurden zwei distinkte Pattern-Konflikte im `RepoImportPipeline` Importer aufgedeckt. Beide sind heute durch manuelle Workarounds gelöst, aber jeder Slug-Rename oder Re-Import wird sie wieder treffen.

### IR1 — Slug-Rename gegen `superseded`-Rows

**Was passiert:**

1. Branch-B-Refactor: `system-prompts-role-prompting-2026-leitfaden.mdx` (DE) + `-guide.mdx` (EN) wurden in `system-prompts-role-prompting-best-practices-2026.mdx` umbenannt
2. Cleanup-Spec 001 C2: erkannte die alten Slug-Namen als Orphans, markierte sie als `status='superseded'`
3. Re-Import (C4): Importer's `UpsertArticlesStep` erkannte die neuen Files als Slug-Rename, matched sie via `cornerstoneKeyword`/`filePath`-Heuristik gegen die alten (jetzt superseded) Rows, updatete den `filePath` in-place
4. Resultat: 2 superseded Rows mit altem Slug + neuem filePath, 0 active Rows für neuen Slug
5. Manual-Fix nötig: SQL UPDATE flipt die Rows zurück zu `status='published'` + neuer Slug

**Problem:** `UpsertArticlesStep` filtert Match-Targets nicht nach `status`. Eine superseded-Row sollte nicht als Match-Target dienen — sie ist explizit aus dem aktiven Set entfernt.

**Pattern-Risiko:** Jeder zukünftige Slug-Rename während eines Cleanup-Cycles trifft das gleiche Problem.

### IR2 — Mirror-Step läuft vor `UpsertArticlesStep`

**Was passiert:**

1. Re-Import (Spec 001 C4) inserted 18 neue Articles
2. `MirrorHeroImagesStep` iteriert über DB-Rows VOR dem Upsert → sieht die neuen Rows nicht
3. Resultat: 14 neu-inserted Rows haben keinen Hero (4 Comparisons + 12 ki-wissen)
4. Manual-Fix nötig: zweiter Re-Import (oder `backfill-imported-heroes --apply`) — die Rows existieren jetzt in der DB, werden im zweiten Lauf gesehen

**Problem:** Step-Reihenfolge in der Pipeline ist `Mirror → Upsert` statt `Upsert → Mirror`. Oder Mirror-Step liest DB-State statt Pipeline-Input.

**Pattern-Risiko:** Jeder Re-Import mit neuen Inserts triggert das. Marcel muss zwei Klicks machen statt einem, oder Hero-Backfill manuell triggern.

### Was schon dokumentiert ist

- `docs/backlog/post-cleanup-followups.md` hat beide als Backlog-Einträge
- `docs/specs/fix-slug-rename-supersede-conflict/spec.md` ist der Data-Fix für die konkrete Anomaly-A (nicht der Code-Fix)
- `docs/discovery/post-cleanup-final-verification.md` Anomalie A + B haben die Forensik

## 2. Ziel

Beide Pattern-Konflikte mit Code-Änderungen im Importer schließen, sodass:

- IR1: `UpsertArticlesStep` matched nicht gegen `status='superseded'` Rows
- IR2: Mirror-Step sieht neu-inserted Rows im selben Run (entweder durch Reordering oder Pipeline-Input-Reading)

**In Scope:**

- IR1 Code-Fix in `UpsertArticlesStep` Match-Query
- IR2 Step-Reordering ODER Mirror-Step-Refactor
- Smoke-Tests pro Fix
- Regression-Tests gegen die Cleanup-Cycle-Anomalien

**Out of Scope:**

- Importer-Logging-Verbesserungen — separate Spec falls nötig
- Cleanup-Data-Fixes — schon erledigt
- Cluster-Toolification — deferred
- BK-Onboarding-Vorbereitung

## 3. Architektur

### 3.1 Sprint IR1 — Slug-Rename-Filter (4-6h)

**IR1.1 Code-Read** (1h)

Dateien zu lesen:
- `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts`
- `packages/adapters/astro-sync/src/import/steps/parse-frontmatter-batch.ts`
- `packages/adapters/astro-sync/src/import/steps/filter-changed-files.ts`

Fragen:
1. Wie wird heute das Match gegen existing-Rows durchgeführt? `slug` direkt? Composite-Unique `(project, source, collection, locale, slug)`? Oder Heuristik (`cornerstoneKeyword`, filePath)?
2. Wann triggert eine in-place-Mutation vs. ein INSERT?
3. Gibt es heute schon einen `status`-Filter irgendwo in der Match-Logic?

**Output:** Notiz in `docs/discovery/ir1-upsert-articles-code-read.md` mit aktuellem Match-Pfad + vorgeschlagener Fix.

**IR1.2 Fix-Decision** (15min — Marcel-Action)

Drei Optionen:

- **A) WHERE-Clause-Filter:** Match-Query erweitern um `AND status != 'superseded'`
  - Wenn kein Match: insert as new row → 2 Rows mit gleichem filePath, eine superseded + eine active
  - Risiko: Importer-Cleanup-State wird inkonsistent

- **B) Match + Warning + Insert-instead:** Wenn Match auf superseded-Row: log Warning, abort in-place-Update, stattdessen INSERT
  - Sauberer Audit-Trail
  - Zwei Rows mit gleichem filePath (wie A)

- **C) Match + Resurrection:** Wenn Match auf superseded-Row: flip Status zurück zu `published` (mit Warning-Log)
  - Was Anomaly-A-Fix manuell gemacht hat, jetzt automatisiert
  - Verliert Rename-Audit-Trail
  - Risiko: superseded-Rows könnten unbeabsichtigt resurrektiert werden (z.B. wenn Cleanup-Spec sie absichtlich offline genommen hat)

Empfehlung: **A** mit Warning-Log. Sauberster Fix, bricht keine Cleanup-Pattern, Importer-Cleanup-State-Konsistenz ist Cleanup-Spec-Responsibility nicht Importer-Responsibility.

**IR1.3 Fix Implementation** (2h)

Patch in `upsert-articles.ts` Match-Query:

```ts
// BEFORE
const existing = await tx.query.articles.findFirst({
  where: and(
    eq(articles.projectId, projectId),
    eq(articles.source, 'imported'),
    eq(articles.collection, collection),
    eq(articles.locale, locale),
    eq(articles.slug, slug),
  ),
});

// AFTER
const existing = await tx.query.articles.findFirst({
  where: and(
    eq(articles.projectId, projectId),
    eq(articles.source, 'imported'),
    eq(articles.collection, collection),
    eq(articles.locale, locale),
    eq(articles.slug, slug),
    ne(articles.status, 'superseded'), // NEW
  ),
});
```

Plus Warning-Log wenn superseded-Row als „könnte-gewesen-Match" detected wird:

```ts
// Optional: detect potential superseded-match and log
const supersededMatch = await tx.query.articles.findFirst({
  where: and(
    eq(articles.projectId, projectId),
    eq(articles.source, 'imported'),
    eq(articles.collection, collection),
    eq(articles.locale, locale),
    eq(articles.slug, slug),
    eq(articles.status, 'superseded'),
  ),
});
if (supersededMatch && !existing) {
  logger.warn(
    { articleId: supersededMatch.id, slug, collection, locale },
    'Found superseded row with matching slug — inserting new active row instead of resurrecting',
  );
}
```

**Wichtig:** Wenn der Match auf `(slug, status='superseded')` greift UND Importer einen INSERT für die gleiche Slug versucht, kommt es zu Unique-Constraint-Violation falls der Constraint nicht `status` enthält. Pre-Implementation: schauen ob `articles_project_source_coll_locale_slug_unique` Constraint `status` einschließt oder nicht.

Falls Constraint `status` NICHT einschließt: erweitern via Migration (UNIQUE auf `(project, source, coll, locale, slug, status)`) ODER Insert-Path im Importer fängt Conflict ab.

**IR1.4 Smoke-Tests** (1-2h)

Datei: `packages/adapters/astro-sync/test/upsert-articles-supersede.test.ts`

Test-Cases:
1. **Normal upsert into active row:** existing active-Row, gleicher Slug → in-place-Update wie heute
2. **Match against superseded row → insert new:** existing superseded-Row, neuer File mit gleichem Slug → INSERT new active Row, superseded bleibt
3. **Cleanup-cycle scenario:** Pre-Setup: 2 superseded Rows mit altem Slug + neuem filePath, neue Files mit neuem Slug → INSERTs für neue Slug, kein in-place-Update auf superseded-Rows
4. **Warning logged:** wenn potential superseded-match, log warning mit articleId + slug

**IR1.5 Regression-Test gegen Anomaly-A** (1h)

Datei: `packages/adapters/astro-sync/test/upsert-articles-regression-anomaly-a.test.ts`

Reproduziert das exakte Anomaly-A-Szenario:
1. Pre-Setup: 2 active Rows mit alten Slugs (`...leitfaden`, `...guide`)
2. Simulate Cleanup-C2: UPDATE status='superseded' auf beide
3. Simulate Re-Import: parse neuen MDX mit neuem Slug, gleicher cornerstoneKeyword, gleicher filePath-Stem
4. Assert: 2 neue active Rows mit neuem Slug, 2 alte Rows bleiben superseded
5. Assert: kein in-place-filePath-Update auf superseded-Rows

**Acceptance IR1:**
- IR1.1 Code-Read-Output dokumentiert
- IR1.2 Fix-Decision festgehalten (vermutlich A)
- IR1.3 Patch in `upsert-articles.ts` mit `status != 'superseded'` Filter + Warning-Log
- IR1.4 4 Smoke-Tests grün
- IR1.5 1 Regression-Test grün
- Backlog-Eintrag „Slug-Rename-Detection im Importer" schließen

### 3.2 Sprint IR2 — Mirror-Step-Ordering (4-6h)

**IR2.1 Code-Read** (1h)

Dateien zu lesen:
- `packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts`
- `packages/adapters/astro-sync/src/import/pipeline.ts` (oder wo die Steps assembliert werden)
- `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts` (Input/Output-Schema)

Fragen:
1. Liest Mirror-Step heute DB-Rows oder Pipeline-Input?
2. Welche Pipeline-Position hat Mirror-Step? Vor Upsert? Nach Upsert?
3. Welche Input-Daten braucht Mirror-Step? (slug, locale, frontmatter.heroImage?)
4. Hat Upsert-Step-Output bereits genug Info für Mirror? (z.B. die neue Article-ID)

**Output:** Notiz in `docs/discovery/ir2-mirror-step-ordering-code-read.md` mit aktuellem Pipeline-Diagramm + vorgeschlagener Fix.

**IR2.2 Fix-Decision** (15min — Marcel-Action)

Zwei Optionen:

- **A) Step-Reordering: Mirror NACH Upsert verschieben**
  - Pre: Mirror sieht alle Rows (inserts + updates) im selben Run
  - Risiko: Wenn Mirror failt, ist Upsert schon committed → inconsistente State (Articles ohne Hero)
  - Mitigation: Mirror-Step muss idempotent sein, kann beim nächsten Run nachholen

- **B) Mirror-Step liest Pipeline-Input statt DB**
  - Pre: Mirror operiert auf in-memory parsed-Files-Set, nicht auf DB
  - Saubere Trennung: Mirror ist preparation, Upsert ist persistence
  - Risiko: Wenn Pipeline-Input das `articles.id` noch nicht kennt (weil INSERT noch nicht gelaufen ist), wie wird `articles.hero_image_r2_key` per UPDATE auf richtige Row gemacht?
  - Mitigation: Mirror produziert eine Map `slug → r2_key`, Upsert wendet sie an (Mirror als Sub-Step von Upsert)

- **C) Post-Upsert Mirror-Pass innerhalb des gleichen Runs**
  - Pre: Behält Mirror-Step-Position vor Upsert (für existing rows), aber Upsert triggert für die new-inserted Rows einen Sub-Mirror-Pass
  - Komplex aber kompatibel zur aktuellen Architektur

Empfehlung: **A** (Step-Reordering). Einfachster Fix, Idempotenz des Mirror-Steps ist sowieso wichtig.

**IR2.3 Fix Implementation** (2h)

Patch in `pipeline.ts` Step-Assembly:

```ts
// BEFORE
const pipeline = createPipeline({
  steps: [
    listContentFilesStep,
    parseFrontmatterBatchStep,
    filterChangedFilesStep,
    mirrorHeroImagesStep,    // ← BEFORE upsert
    upsertArticlesStep,
    syncClustersFromFrontmatterStep,
    linkTranslationPairsStep,
    updateDbStatusStep,
  ],
});

// AFTER
const pipeline = createPipeline({
  steps: [
    listContentFilesStep,
    parseFrontmatterBatchStep,
    filterChangedFilesStep,
    upsertArticlesStep,
    mirrorHeroImagesStep,    // ← MOVED after upsert
    syncClustersFromFrontmatterStep,
    linkTranslationPairsStep,
    updateDbStatusStep,
  ],
});
```

Plus Verify dass Mirror-Step's DB-Query auch new-inserted Rows trifft:

```ts
// PSEUDO
const rows = await db.query.articles.findMany({
  where: and(
    eq(articles.projectId, projectId),
    eq(articles.source, 'imported'),
    isNull(articles.heroImageR2Key), // NEW: nur Rows ohne Hero
  ),
});
```

**IR2.4 Smoke-Tests** (1-2h)

Datei: `packages/adapters/astro-sync/test/mirror-after-upsert.test.ts`

Test-Cases:
1. **New insert + existing-with-hero:** Pipeline mit 1 INSERT + 1 UPDATE-only. Mirror-Step picked up the new INSERT, ignoriert UPDATE-only.
2. **New insert + existing-without-hero:** Pipeline mit 1 INSERT + 1 UPDATE auf existing-row die noch kein Hero hat. Beide werden gemirrored.
3. **Mirror-Idempotency:** Pipeline läuft 2x mit gleichem Input. Zweiter Lauf: keine R2-Uploads (alle Hashes match).

**IR2.5 Regression-Test gegen Anomaly-B** (1h)

Datei: `packages/adapters/astro-sync/test/mirror-after-upsert-regression-anomaly-b.test.ts`

Reproduziert das exakte Anomaly-B-Szenario:
1. Pre-Setup: leere DB
2. Simulate Re-Import: 18 neue Files (14 mit Hero im Frontmatter, 2 Default-Hero-Fallback, 2 in COLLECTIONS_WITHOUT_HERO)
3. Pipeline durchlaufen
4. Assert: 14 Rows + 2 Default-Hero-Rows haben `hero_image_r2_key` populated, 2 tool-categories-Rows NICHT
5. Assert: NO zweiter Re-Import nötig

**Acceptance IR2:**
- IR2.1 Code-Read-Output dokumentiert
- IR2.2 Fix-Decision festgehalten (vermutlich A)
- IR2.3 Step-Reordering in pipeline.ts
- IR2.4 3 Smoke-Tests grün
- IR2.5 1 Regression-Test grün
- Backlog-Eintrag „Mirror-Step-Ordering im Importer" schließen

### 3.3 Sprint IR3 — Documentation + Spec-Close (1h)

**IR3.1 Backlog-Update**

`docs/backlog/post-cleanup-followups.md`:
- Slug-Rename-Filter ✅ COMPLETED
- Mirror-Step-Ordering ✅ COMPLETED

**IR3.2 IMPLEMENTED.md**

`docs/specs/importer-robustness/IMPLEMENTED.md` mit:
- Files-Touched
- Test-Counts (8 Smoke + 2 Regression)
- Pipeline-Diagram Vor/Nach
- Discovered & Deviations

**IR3.3 CLAUDE.md ergänzen**

`packages/adapters/astro-sync/CLAUDE.md` Pattern hinzufügen:

```markdown
## Importer-Pattern: Status-aware Match

`UpsertArticlesStep` matched gegen existing rows mit Filter `status != 'superseded'`.
Wenn eine Row superseded ist + neuer File mit gleichem Slug arrive: INSERT statt
in-place-Update. Warning-Log dokumentiert den potential-match.

Begründung: Cleanup-Specs können Rows als superseded markieren um sie aus dem
aktiven Set zu entfernen. Importer darf solche Rows nicht resurrektieren.

## Pipeline-Reihenfolge: Mirror nach Upsert

`MirrorHeroImagesStep` läuft NACH `UpsertArticlesStep`. Begründung: new-inserted
Rows brauchen Hero-Mirror im selben Run. Mirror-Step ist idempotent (sha256-Hash-
Vergleich), kann safe nochmal laufen wenn Pipeline retried.
```

## 4. Tests

**Per Sprint:**
- IR1: 4 Smoke + 1 Regression = 5 Tests
- IR2: 3 Smoke + 1 Regression = 4 Tests

**Cross-Sprint:**
- `bun test` über `packages/adapters/astro-sync`
- `bun typecheck` über alle Packages

## 5. Acceptance

1. IR1: `UpsertArticlesStep` matched nicht gegen superseded-Rows, INSERT-Pfad funktioniert
2. IR2: Mirror-Step läuft NACH Upsert, new-inserted Rows haben Hero im selben Run
3. Regression-Tests reproduzieren beide Anomaly-Szenarien + verifizieren Fix
4. Backlog-Einträge geschlossen
5. CLAUDE.md mit beiden Patterns
6. IMPLEMENTED.md mit Discovered & Deviations

## 6. Cross-Cutting-Regeln

- **Test-First.** IR1.5 + IR2.5 Regression-Tests werden VOR dem Fix geschrieben — Test failt zunächst, dann Fix, dann Test passt. Klassisches TDD-Pattern.
- **Idempotenz beider Steps obligatorisch.** Re-Run der Pipeline mit gleichem Input → keine R2-Uploads + keine DB-Mutations.
- **Pattern 121:** Dry-Run-Pfad für künftige Cleanup-Scripts kompatibel halten.
- **Refresh-Whitelist berücksichtigen.** Mirror-Step UPDATE auf `hero_image_*`-Spalten muss in der Refresh-Whitelist sein (Spec 001 S1.1) — falls nicht: separater Migration-Sprint.

## 7. Decisions

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| IR-1 | IR1 Fix-Option (A/B/C) | A — WHERE-Clause + INSERT-instead | Sauberster Fix, kein Resurrection-Risk |
| IR-2 | IR2 Fix-Option (A/B/C) | A — Step-Reordering | Einfachster Fix, Idempotenz sowieso |
| IR-3 | Test-Strategie | TDD: Regression-Tests vor Fix | Beweist dass Fix das Problem wirklich löst |
| IR-4 | Unique-Constraint anpassen? | Klären in IR1.3 | Hängt von aktuellem Constraint ab |
| IR-5 | Refresh-Whitelist anpassen? | Klären in IR2.3 | Hängt von aktueller Whitelist ab |

## 8. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | IR1 Fix bricht legitime Slug-Renames | Smoke-Test #1 (normal-upsert-into-active) verifiziert dass aktive Rows weiter funktionieren |
| R2 | IR2 Step-Reordering bricht andere Pipeline-Konsumenten | Regression-Test + Pipeline-Schema-Validation |
| R3 | Unique-Constraint Violation bei IR1-INSERT-Pfad | Pre-Implementation Constraint-Audit, ggf. Migration 0103 |
| R4 | Mirror-Step's `hero_image_*` Spalten nicht in Refresh-Whitelist | Pre-Implementation Whitelist-Check, ggf. Whitelist-Erweiterung |
| R5 | Bestehende Tests brechen durch Step-Reordering | Full-Test-Run vor Fix, Diff der Failures |
| R6 | TDD-Regression-Test ist schwer zu schreiben | Start mit einfachem Setup, iterativ erweitern; bei >2h Test-Setup: refactor Test-Helper |

## 9. Implemented

_(wird beim Spec-Abschluss gefüllt)_

## 10. Discovered & Deviations

_(wird beim Spec-Abschluss gefüllt)_
