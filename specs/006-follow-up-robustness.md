# Spec: F1.5 — Categories Slug-Format Reconciliation

_Branch: `feature/f15-categories-slug-format`_
_Codebase: Marketing-Tool-Monorepo_
_Status: Draft._
_Aufwand: ~2-3h, 2 Sprints._
_Voraussetzung: Mini-Cleanup-Followups Spec 004 implementiert (F1 ist Pre-Req für diese Erkenntnis)._
_Parallel-Branches: keine — Importer-Robustness wartet auf diese Spec._

---

## 1. Problem

Aus Mini-Cleanup-Followups Spec 004 Implementation Discovered §3:

Während der F1-Manual-Verify gegen Toolwiki kam ein latenter Bug ans Tageslicht: `categories`-Collection zeigt im Forecast **31 inserts + 30 dbOnly** statt 0 inserts + 30 matched.

**Root-Cause:** Slug-Format-Mismatch zwischen Inventory + DB.

| Source | Slug-Format | Beispiel |
|---|---|---|
| `repo-inventory.json` | mit path-prefix | `blog/comparisons`, `blog/ethics-law`, `knowledge/fundamentals` |
| `articles`-Tabelle (Importer-Output) | bare slug | `comparisons`, `ethics-law`, `fundamentals` |

**Folge:**
- F1-Fix (locale-Matching) funktioniert korrekt, aber: er kann die 30 Rows nicht matchen weil die Slugs unterschiedlich sind
- Forecast-Report zeigt: 31 "neue Inserts" + 30 "DB-only" obwohl es eigentlich 30 Updates sein sollten
- Cross-Side-Bug: entweder Inventory-Generator strippt path-prefix nicht, ODER Importer strippt path-prefix wo er das nicht sollte

**Verification-SQL:**

```sql
SELECT slug FROM articles 
WHERE collection = 'categories' 
  AND project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
LIMIT 5;
```

Expected: Output zeigt bare Slugs (z.B. `comparisons`) ohne Path-Prefix.

## 2. Ziel

Slug-Format-Mismatch zwischen `repo-inventory.json` und `articles`-Tabelle auflösen. Forecast-Script zeigt für `categories`-Collection korrekte Diff-Counts (0 inserts + 0 dbOnly bei unverändertem Repo-State, oder accurate inserts/dbOnly bei Drift).

**In Scope:**

- F1.5-Decision: welche Seite ist canonical (Inventory ODER Importer)?
- Fix in der nicht-canonical-Seite
- Smoke-Test gegen `categories`-Collection
- Forecast-Verify zeigt 0 dbOnly + 0 inserts post-fix
- Backlog-Eintrag schließen

**Out of Scope:**

- Importer-Robustness (IR1 Slug-Rename, IR2 Mirror-Step-Ordering) — separate Spec
- Andere Collections mit potentiellen Slug-Format-Issues — falls weitere existieren, separat behandeln
- Cluster-Toolification — deferred
- BK-Onboarding

## 3. Architektur

### 3.1 Sprint F15.1 — Decision: welche Seite canonical (1h)

**F15.1.1 Code-Read** (45min)

Dateien zu lesen:

1. **Inventory-Generator-Script** (vermutlich):
  - `apps/api/src/scripts/discovery/generate-repo-inventory.ts` (oder ähnlich)
  - Wer baut `repo-inventory.json`? Wie wird `slug` für `categories` konstruiert?
  - Wird Path-Prefix bewusst included? (z.B. weil Astro `categories/blog/comparisons.md` als Filepath hat)

2. **Importer für `categories`-Collection**:
  - `packages/adapters/astro-sync/src/import/steps/parse-frontmatter-batch.ts`
  - `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts`
  - Wie wird `slug` aus dem File-Path extrahiert?
  - Wird Path-Prefix bewusst gestrippt? Warum?

3. **Astro-Render-Side** (Toolwiki-Repo):
  - `src/content/categories/*` Collection-Schema
  - Welches Slug-Format brauchen die Render-Komponenten?
  - Beispiel: `getCategoryLabel(slug, scope, locale)` — was erwartet die Funktion?

**Output:** Notiz in `docs/discovery/f15-categories-slug-format-codeRead.md` mit:
- Inventory-Seite: aktueller Algorithmus + Begründung
- Importer-Seite: aktueller Algorithmus + Begründung
- Astro-Render-Seite: erwartetes Format
- Welche Seite ist canonical (3-way-Analyse)?

**F15.1.2 Decision** (15min — Marcel-Action)

Drei Optionen:

- **A) DB canonical (bare slugs):** Inventory-Generator strippt Path-Prefix
  - Pro: DB ist heute schon bare slugs, weniger Migration-Risiko
  - Pro: Astro-Side liest Files direkt, kein Slug-Lookup über DB nötig
  - Contra: Inventory verliert Path-Information (welcher Scope?)
  - Mitigation: separates `scope`/`group`-Feld im Inventory falls nötig

- **B) Inventory canonical (mit path-prefix):** Importer behält Path-Prefix beim Insert
  - Pro: Inventory-Format strukturierter (Path = Hierarchie-Info)
  - Contra: DB-Migration nötig (30 Rows umbenennen)
  - Contra: Bricht potentiell Tool-internal Code der bare slugs erwartet
  - Mitigation: separate Migration + Code-Search nach `slug.startsWith()`-Patterns

- **C) Beide Seiten konsistent in jeweils einem neuen Field:** `slug` bare + `scope` separat
  - Pro: Saubere Trennung von Concerns
  - Contra: Schema-Change in DB + Inventory + Astro
  - Out-of-scope für 2-3h Aufwand

Empfehlung: **A — DB canonical**. Begründung:
- DB-Seite ist heute schon bare slugs (kein Code-Refactor)
- Astro-Side liest Files direkt, kein DB-Lookup nötig
- Forecast-Script ist der einzige Konsument, der vom Mismatch betroffen ist
- Fix auf Inventory-Generator-Seite ist eine Function-Change, nicht eine Migration

### 3.2 Sprint F15.2 — Implementation + Verify (1-2h)

**F15.2.1 Fix Implementation** (45min)

Je nach F15.1.2-Entscheidung:

**Bei Option A (DB canonical):**

Patch im Inventory-Generator-Script — vermutlich beim Building der `noLocaleSplit`-Slug-Liste:

```ts
// BEFORE
slug: filePath.replace(/^src\/content\/categories\//, '').replace(/\.md$/, ''),
// e.g. "blog/comparisons" (kept path-prefix)

// AFTER
slug: basename(filePath, '.md'),
// e.g. "comparisons" (bare slug)
```

Plus: wenn der Pfad-Prefix gebraucht wird für Disambiguierung (z.B. `blog/comparisons` vs `tools/comparisons`), separates Feld:

```ts
{
  slug: 'comparisons',           // bare
  scope: 'blog',                  // separate, optional
  // ...
}
```

Forecast-Script muss dann auf `slug` matchen, nicht auf den kombinierten String.

**Bei Option B (Inventory canonical):**

Migration 0103: UPDATE auf 30 categories-Rows um Path-Prefix nachzuholen. Plus Importer-Patch um Path-Prefix beim INSERT zu erhalten. Aufwendiger.

**F15.2.2 Smoke-Test** (30min)

Datei: `apps/api/test/scripts/forecast-categories-slug-format.smoke.test.ts`

Test-Cases:
1. **categories collection matched correctly:** repoSlug = `comparisons` (bare), dbSlug = `comparisons` → match
2. **No false-positive matches:** Slugs aus unterschiedlichen Scopes (z.B. `comparisons` aus blog vs aus tools) sind eindeutig oder über `scope` getrennt
3. **Regression-Test:** Repro die alte Situation (mit path-prefix) → assert dass das jetzt korrekt erkannt würde

**F15.2.3 Manual-Verify** (15min)

```bash
# Inventory neu generieren
bun --filter @marketing-auto/api regenerate-repo-inventory --project=toolwiki

# Forecast laufen lassen
bun --filter @marketing-auto/api forecast-re-import-state --project=toolwiki

# Erwartung: categories zeigt 0 inserts + 0 dbOnly (bei unverändertem Repo)
```

Plus DB-Check:

```sql
SELECT slug, COUNT(*) FROM articles
WHERE collection = 'categories'
  AND project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
GROUP BY slug
ORDER BY slug;
-- Erwartung: alle bare slugs, keine Path-Prefixes
```

### 3.3 Sprint F15.3 — Documentation (15min)

**F15.3.1 Backlog-Update**

`docs/backlog/post-cleanup-followups.md`:
- F1.5 ✅ COMPLETED

**F15.3.2 IMPLEMENTED.md**

`docs/specs/f15-categories-slug-format/IMPLEMENTED.md` mit:
- Files-Touched
- Vor/Nach-Metrics (Forecast-Output: 31 inserts + 30 dbOnly → 0 + 0)
- Discovered & Deviations

**F15.3.3 Doc-Update**

Falls Inventory-Format-Change: ergänze relevant Schema-Doc oder README im Inventory-Generator-Script.

## 4. Tests

**Per Sprint:**
- F15.2.2: 3 Smoke-Tests

**Cross-Sprint:**
- `bun typecheck` über alle Packages
- `bun test` über alle Packages

## 5. Acceptance

1. F15.1.1 Code-Read-Output dokumentiert
2. F15.1.2 Marcel-Decision festgehalten
3. F15.2.1 Fix in Inventory-Generator (Option A) ODER Importer (Option B)
4. F15.2.2 3 Smoke-Tests grün
5. F15.2.3 Manual-Verify zeigt 0 inserts + 0 dbOnly für `categories`
6. F15.3 Backlog + IMPLEMENTED.md

## 6. Cross-Cutting-Regeln

- **Read-Only zuerst.** Code-Reads + Manual-Verify VOR jedem Fix.
- **3-way-Analyse:** Inventory + Importer + Astro-Render-Side müssen alle berücksichtigt werden, nicht nur 2 Seiten.
- **Bei Option B (Migration):** sauberer Pre-Snapshot + Idempotenz-Check.
- **Pattern 121:** Dry-Run-Pfad falls Migration nötig.

## 7. Decisions

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| F15-1 | Welche Seite canonical | A (DB bare slugs) | Heute-State, kein Migration-Risiko |
| F15-2 | Scope-Field nötig? | Klären in F15.1.1 | Hängt von Disambiguierungs-Use-Cases ab |
| F15-3 | Migration falls Option B | Eigener Sprint | Nicht in 2-3h Time-Box |

## 8. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | Astro-Render-Side erwartet path-prefix-Slugs | F15.1.1 Code-Read-Step 3 verifiziert das vor Decision |
| R2 | Andere Collections haben gleichen Bug | F15.2.3 Manual-Verify checked alle Collections kurz |
| R3 | Inventory-Format-Change bricht andere Konsumenten | Code-Search nach `repoInventory.byLocale` + `repoInventory.noLocaleSplit` Konsumenten |
| R4 | Migration (Option B) trifft Cleanup-State | Pre-Check ob Anomaly-A-Fix-State unverändert bleibt |
| R5 | Fix versteht Importer-Behavior für `categories` (no-locale-split) nicht richtig | F15.1.1 Schritt 2 fokussiert spezifisch auf no-locale-split-Pfad im Importer |

## 9. Implemented

Closed 2026-05-24. Full implementation log at
[`docs/specs/f15-categories-slug-format/IMPLEMENTED.md`](../docs/specs/f15-categories-slug-format/IMPLEMENTED.md).

Headlines:

- ✅ F15.1.1 — Code-read note at
  [`docs/discovery/f15-categories-slug-format-codeRead.md`](../docs/discovery/f15-categories-slug-format-codeRead.md).
- ✅ F15.1.2 — Decision: **Option A (DB canonical / bare slugs)** + slug+scope
  separat field-shape + `--astro-repo` CLI flag.
- ✅ F15.2.1 — New
  [`apps/api/src/scripts/discovery/generate-repo-inventory.ts`](../apps/api/src/scripts/discovery/generate-repo-inventory.ts)
  + [`forecast-re-import-state.ts`](../apps/api/src/scripts/discovery/forecast-re-import-state.ts)
  type widening with optional `scopes?` map.
- ✅ F15.2.2 — 5 smoke tests at
  [`apps/api/test/scripts/forecast-categories-slug-format.smoke.test.ts`](../apps/api/test/scripts/forecast-categories-slug-format.smoke.test.ts).
- ✅ F15.2.3 — `forecast-re-import-state toolwiki` reports
  `categories: 0 inserts / 30 updates / 0 dbOnly` (was `31 inserts / 30 dbOnly`).
- ✅ F15.3 — Backlog entry + IMPLEMENTED.md + root CLAUDE.md index entry.

## 10. Discovered & Deviations

1. **The inventory generator was missing entirely.** Spec §3.1 assumed
   `apps/api/src/scripts/discovery/generate-repo-inventory.ts` already
   existed. The original (`audit-repo-inventory.ts`) was deleted in commit
   `32b0c54` as "obsolete" while the produced `repo-inventory.json` stayed
   committed. Re-created at the spec-assumed path so `regenerate-repo-inventory`
   actually works.

2. **Scope collision is real, not hypothetical** (Risk §R2 partial expansion).
   Toolwiki's `categories/` directory has 31 physical files but only 30
   unique bare slugs because both `blog/ethics-law.md` and
   `knowledge/ethics-law.md` declare `slug: "ethics-law"` in frontmatter.
   The importer's unique key doesn't include `scope`, so the second file
   silently UPSERT-overwrites the first. Practical impact today: zero
   (identical labels). Out of scope per §2; tracked in the Importer-Robustness
   backlog item for follow-up.

3. **Generator emits the colliding slug twice intentionally.** Rather than
   dedup at generator time (which would hide the collision from downstream
   tooling), the JSON faithfully lists all physical files in `slugs[]` and
   lets `computeForecastDiff()`'s `new Set(repoSlugs)` dedup at diff time.
   The `scopes` map captures only the last-write-winning scope per slug.

4. **Astro-repo path: `--astro-repo=<path>` flag, not `--project=<slug>`.**
   Spec §F15.2.3 listed `--project=toolwiki` but the generator doesn't
   otherwise touch the DB; adding a DB hop just for path resolution was
   premature complexity. The flag uses the original hardcoded path as
   default for back-compat with Marcel's local machine.

5. **`categories` is the only `noLocaleSplit` collection in Toolwiki today.**
   Filesystem walk of `src/content/*/` confirmed all 8 other collections
   (blog, comparisons, tools, ki-wissen, usecases, authors, tool-categories,
   special-landings) have a `de/` subdirectory. Risk §R2 closes empty.

6. **New `parentSlug` field appeared in the `frontmatterFieldSetExample`**
   for `categories` — pure schema drift inside the Astro repo since the
   pre-fix snapshot was generated, not introduced by this spec.
