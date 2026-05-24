# Spec: Bucket-D Bug-Fixes (Post-Refactor-Footguns)

_Branch: `feature/bucket-d-fixes`_
_Codebase: Marketing-Tool-Monorepo_
_Status: Draft._
_Aufwand: ~2-3 Tage, 4 Sprints._
_Voraussetzung: Post-Refactor-State-Audit (`docs/discovery/post-refactor-state-audit.md`) gemerged._
_Parallel-Branches:_
- _`feature/db-cleanup-post-refactor` (Cleanup-Spec) — kein Konflikt_
- _`feature/hero-image-mirror` (Hero-Spec) — kein Konflikt, bereits gemerged_
- _Toolwiki-`discovery/cluster-audit` — D4-Output wird Input für deren Discovery_

---

## 1. Problem

Aus `docs/discovery/post-refactor-state-audit.md` §6.1 Bucket D ("Unerwartet, Bug-Verdacht"):

**D1 — `astro_frontmatter`-Spalte auf ALLEN 272 Rows leer**
- Spalte (`jsonb`) existiert in `articles`-Tabelle
- Importer (`UpsertArticlesStep`) referenziert sie nirgendwo
- Hypothese: Dead Column oder vergessener Write-Path
- Footgun: wenn der Renderer (`RenderMdxStep`) sie liest und etwas anderes erwartet als NULL

**D2 — `schema_json_ld`-Spalte auf ALLEN 272 Rows leer, aber `RenderMdxStep` liest sie**
- Bestätigt durch Audit §5.2 + Code-Read [render-mdx.ts:266-267](packages/adapters/astro-sync/src/steps/render-mdx.ts:266)
- Heute kein aktiver Bug (NULL bleibt NULL → leer geschrieben → durch `collectionInfo.fields`-Filter gedropt)
- Footgun: wenn `SchemaExtensionPipeline` für imported Articles ausgelöst wird, würde DB-Wert gefüllt und beim nächsten Sync ins MDX zurückgeschrieben → kollidiert mit Branch-B Layout-Renderer-Pfad (D143-Konflikt-Vorstufe)

**D4 — 12 neue ki-wissen-Pillars erscheinen NICHT in `content_pillars`-Tabelle**
- Branch-B-Spec dokumentierte: 12 neue Pillars (`neuronale-netze`, `backpropagation`, `eu-ai-act`, etc.)
- DB: `content_pillars` hat 20 Rows mit Schwesterkonzept-Drift, KEINE der 12 neuen Slugs
- Hypothese: `SyncClustersFromFrontmatterStep` seeded keine `content_pillars` aus Frontmatter, nur `clusters`
- Footgun: Pillars-Tabelle ist nicht authoritativ, wird inkonsistent — Plan-Generation könnte falsche Pillar-Liste sehen
- **Wichtig:** D4-Output wird Input für die Toolwiki `discovery/cluster-audit`-Spec (Cluster-Toolification-Frage)

**D3 ist NICHT in dieser Spec** — wird via Cleanup-Spec (Orphan-Supersede) manuell behandelt. Eine Folge-Spec „Auto-Delete-Step im Importer" wäre Architektur-Change, gehört nicht hierher.

## 2. Ziel

Drei Bug-Verdächte aus Bucket-D verifizieren, klassifizieren als entweder „echter Bug + Fix" oder „bestätigt als by-design + Dokumentation". Keine spekulativen Refactors. Output ist Klarheit über DB-Schema-State + ggf. Migrations/Code-Fixes.

**In Scope:**
- D1: Code-Investigation für `astro_frontmatter` — wer schreibt/liest? Dead Column oder vergessener Write-Path?
- D1: Migration falls Dead Column (`DROP COLUMN`) — oder Write-Path-Implementation falls vergessen
- D2: Investigation ob `SchemaExtensionPipeline` für `source='imported'` Articles getriggert werden kann
- D2: Falls ja: Kollisionsschutz mit Branch-B Layout-Renderer-Pfad (D143-Vorstufe)
- D2: Falls nein: Dokumentation als „by-design dormant"
- D4: Code-Read `SyncClustersFromFrontmatterStep` — was wird in `content_pillars` geschrieben?
- D4: Falls Lücke: Step-Erweiterung oder Dokumentation als „Pillars-Tabelle nicht authoritativ"
- Read-Only-Audit-Scripts unter `apps/api/src/scripts/discovery/` als Beweis-Lage

**Out of Scope:**
- D3 (Importer-Delete-Step) — separate Architektur-Spec
- Bucket-C Cleanup (`clusters` Schwester-Drift, `content_pillars` Schwester-Drift) — separate Spec, hängt von Cluster-Toolification-Entscheidung ab
- Cluster-Toolification — separate Toolwiki-Discovery
- `parent_slug` auf `content_categories` (Audit C4) — separate Spec
- SchemaExtensionPipeline-Refactor — falls D2 echten Bug findet, nur Mitigation in dieser Spec, kein Pipeline-Redesign

## 3. Architektur

### 3.1 Sprint BD1 — D1 Investigation: `astro_frontmatter` (Tag 1)

**BD1.1 Code-Read** (1h)

```bash
grep -rn "astroFrontmatter\|astro_frontmatter" packages/ apps/
```

Pro Treffer kategorisieren:
- **Schema-Definition** (`packages/db/src/schema/content.ts`): erwartet
- **Read** (Render-Step? Export-Pfad?): wer liest, wofür?
- **Write** (Import-Step? Generation-Pipeline? Manual-Edit-Endpoint?): wer schreibt, wann?

Erwartung basierend auf Audit:
- 1 Schema-Definition
- 1-2 Reads in `RenderMdxStep` oder `render-mdx-helpers`
- **0 Writes** → Dead Column bestätigt

Falls **doch ein Write-Path existiert**, der nie aufgerufen wird: das ist ein neuer Befund. Dann Untersuchung warum der Write-Path nie greift (z.B. Conditional-Logic, die immer false ist).

**BD1.2 Discovery-Script** (1h)

Datei: `apps/api/src/scripts/discovery/audit-astro-frontmatter-usage.ts`

Read-only Script, das die DB durchsucht:

```ts
// Pro Project: wie viele Rows haben astro_frontmatter populated?
SELECT projects.slug, COUNT(*) AS total,
       COUNT(*) FILTER (WHERE astro_frontmatter IS NOT NULL) AS populated,
       COUNT(*) FILTER (WHERE astro_frontmatter IS NOT NULL AND astro_frontmatter::text != '{}'::text) AS non_empty
FROM articles
JOIN projects ON projects.id = articles.project_id
GROUP BY projects.slug;
```

Falls **0 Rows in allen Projects**: Dead Column bestätigt cross-tenant.
Falls **partielle Befüllung**: untersuchen wann/warum.

**BD1.3 Entscheidung dokumentieren** (30min)

Pro Outcome:

| Befund | Action |
|---|---|
| Dead Column (0 Reads outside Schema-Def, 0 Writes anywhere) | Migration 0102 `DROP COLUMN`, Cleanup Render-Step-Read |
| Dead Column aber Reader existiert (RenderMdxStep liest aber irrelevant) | Code-Cleanup Reader entfernen, dann Migration DROP COLUMN |
| Hat Writer der nie greift | Investigation Bug, Fix oder dokumentieren |
| By-design dormant für späteren Use-Case | Dokumentation in `content.ts`-Schema-Kommentar + CLAUDE.md, kein Drop |

**BD1.4 Fix-Implementation** (1-3h, abhängig von Outcome)

Falls Migration nötig:

```sql
-- packages/db/drizzle/0102_articles_drop_astro_frontmatter.sql
ALTER TABLE articles DROP COLUMN astro_frontmatter;
```

Drizzle-Schema in `packages/db/src/schema/content.ts`:

```ts
// REMOVE: astroFrontmatter: jsonb("astro_frontmatter"),
```

Render-Step-Cleanup in `packages/adapters/astro-sync/src/steps/render-mdx.ts`:

```ts
// REMOVE: any references to astroFrontmatter
```

Tests:
- Existing tests müssen weiter grün sein (Spalten-Drop sollte kein Side-Effect haben wenn wirklich nie gelesen)
- Drizzle-Typecheck grün

**Pattern-Referenz:** D132 (Drizzle-Constraint-Widening eigene Migration — hier analog: Column-Drop eigene Migration, kein Mit-Bundling).

### 3.2 Sprint BD2 — D2 Investigation: `schema_json_ld` Footgun-Verifikation (Tag 1-2)

**BD2.1 Trigger-Path-Analyse** (2h)

Frage: Kann `SchemaExtensionPipeline` für `source='imported'` Articles getriggert werden?

Code-Reads:

1. **SchemaExtensionPipeline-Trigger-Points** — wo wird Pipeline enqueued?
   ```bash
   grep -rn "SchemaExtensionPipeline\|schema-extension" packages/pipelines/ apps/api/
   ```
   Pro Trigger: was sind die Bedingungen? Filtert auf `source='generated'` oder ist es source-agnostic?

2. **Frontend-Routes** — gibt es einen UI-Endpoint, der SchemaExtensionPipeline für ein beliebiges Article anwerfen könnte?
   ```bash
   grep -rn "schema-extension\|extendSchema\|enrichSchema" apps/api/src/routes/
   ```

3. **Cron-Jobs** — läuft ein Worker, der für alle Articles ohne `schema_json_ld` die Pipeline triggert?
   ```bash
   grep -rn "SchemaExtensionPipeline" packages/pipelines/src/_lib/cron/
   ```

**BD2.2 Verifikations-Test** (1h)

Datei: `apps/api/test/integration/schema-extension-imported-articles.test.ts`

Test-Case:
- Erstelle einen `source='imported'` Article in Test-DB
- Versuche `SchemaExtensionPipeline` zu triggern
- Erwartung: entweder Trigger blockiert (Filter aktiv) oder Trigger funktioniert (Footgun real)

**BD2.3 Outcome-Klassifikation** (30min)

| Befund | Action |
|---|---|
| Pipeline kann NICHT für imported Articles getriggert werden | Dokumentation als „by-design dormant", kein Code-Fix nötig |
| Pipeline kann getriggert werden, aber RenderMdxStep ignoriert `schema_json_ld` für imported | Dokumentation als Soft-Guard |
| Pipeline kann getriggert werden + RenderMdxStep schreibt `schema_json_ld` ins MDX | **Echter Bug, Fix nötig** — D143-Pre-Konflikt |

**BD2.4 Fix-Implementation falls D143-Pre-Konflikt** (2-3h)

Zwei Mitigation-Optionen:

**Option A: Trigger-Filter** — `SchemaExtensionPipeline` blockt `source='imported'`:

```ts
if (article.source === "imported") {
  log.warn({ articleId }, "SchemaExtensionPipeline skipped for imported article");
  return { skipped: "imported_source" };
}
```

**Option B: Render-Filter** — `RenderMdxStep` ignoriert `schema_json_ld` für imported:

```ts
const knownSchemaFields = article.source === "imported"
  ? {}  // Skip schema_json_ld for imported (Branch-B handles via howTo frontmatter)
  : { schema: article.schemaJsonLd, schemaJsonLd: article.schemaJsonLd };
```

Empfehlung: **Option A**, weil cleaner Trigger-Level-Defense. Plus Logging als Beweis dass Footgun nie greift.

Tests:
- Trigger-Filter-Test: Trigger für imported → skipped-Result
- Trigger-Filter-Test: Trigger für generated → läuft normal

### 3.3 Sprint BD3 — D4 Investigation: `content_pillars`-Sync (Tag 2-3)

**BD3.1 Code-Read SyncClustersFromFrontmatterStep** (1h)

Datei: `packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts`

Fragen:
1. Schreibt der Step in `clusters`-Tabelle? Ja/nein, basierend auf welchen Frontmatter-Feldern (`clusterKey`)?
2. Schreibt der Step in `content_pillars`-Tabelle? Ja/nein, basierend auf welchen Frontmatter-Feldern (`pillar`?)?
3. Welche Pillar-Frontmatter-Felder existieren überhaupt im Repo? (grep nach `^pillar:` in MDX-Files)
4. Wenn Pillars nicht geseedet werden: wo kommen die 20 bestehenden `content_pillars`-Rows her?

**BD3.2 Pillar-Source-Inventur** (1h)

Datei: `apps/api/src/scripts/discovery/audit-content-pillars-sources.ts`

```sql
-- Heutiger State der content_pillars
SELECT id, project_id, name, created_at, updated_at,
       (SELECT COUNT(*) FROM articles WHERE cluster_key = content_pillars.name) AS articles_referencing
FROM content_pillars
ORDER BY name;
```

Plus Repo-Read:

```bash
# Pillar-Frontmatter-Werte aus MDX
grep -rn "^pillar:" /Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/content/
```

Plus Pipeline-Trace:
- Wo werden Pillars heute angelegt? Cluster-Creator? ColdStart? Manual-Endpoint?
- `grep -rn "content_pillars\|contentPillars\|insertPillar" packages/ apps/`

**BD3.3 Entscheidung** (30min)

Drei mögliche Outcomes:

| Befund | Action |
|---|---|
| `content_pillars` ist authoritative Source, nur nicht aus Frontmatter geseedet | Step-Erweiterung: Pillars aus `clusterKey`-Frontmatter seeden |
| `content_pillars` ist halb-redundant, wird kaum gelesen | Dokumentation als „derived from cluster-keys, not source of truth" + Folge-Spec falls Cleanup gewollt |
| `content_pillars` wird beim Cluster-Toolification-Refactor sowieso umgestaltet | NICHTS TUN — auf Cluster-Toolification-Spec warten, Output dort als Input einbringen |

**Wichtig:** Outcome ist Input für Toolwiki `discovery/cluster-audit`. Befunde aus BD3 müssen klar dokumentiert sein, damit die Toolwiki-Discovery sie nicht erneut machen muss.

**BD3.4 Fix-Implementation oder Dokumentation** (1-3h, abhängig von Outcome)

Falls Step-Erweiterung gewählt:

```ts
// In SyncClustersFromFrontmatterStep.execute()
// Nach existing cluster-write:
const distinctPillars = new Set<string>();
for (const article of input.articles) {
  if (article.clusterKey) {
    // Cluster-key kann auch als Pillar dienen wenn keine separate pillar-frontmatter
    distinctPillars.add(article.clusterKey);
  }
}
for (const pillarName of distinctPillars) {
  await db.insert(contentPillars).values({
    projectId: input.projectId,
    name: pillarName,
  }).onConflictDoNothing();
}
```

Tests:
- Unit-Test: Step mit 5 distinct clusterKeys → 5 content_pillars-Inserts
- Idempotenz-Test: Re-Run → 0 neue Inserts (onConflictDoNothing greift)
- Cross-Tenant-Test: Pillars sind project_id-scoped

**Falls Dokumentation gewählt:**

Datei: `packages/db/src/schema/identity.ts` Header-Kommentar zur `contentPillars`-Definition:

```ts
/**
 * content_pillars: derived from clusterKey frontmatter, not authoritative.
 *
 * Today this table is populated by ad-hoc inserts from:
 * - Cluster-Creator UI (manual)
 * - ColdStart-Pipeline (one-shot per project)
 * - Sync-from-frontmatter (cluster_key strings, not pillar-specific frontmatter)
 *
 * It accumulates drift over time (see Audit Bucket-C1). Future cleanup
 * via separate cluster-toolification spec (decide whether to authoritative-ize
 * this table or deprecate in favor of clusters table).
 */
```

### 3.4 Sprint BD4 — Documentation + Audit-Snapshot (Tag 3)

**BD4.1 IMPLEMENTED-Section** (1h)

`docs/specs/bucket-d-fixes/IMPLEMENTED.md` mit:
- D1-Outcome + ggf. Migration-SHA
- D2-Outcome + ggf. Filter-Code-SHA
- D4-Outcome + ggf. Step-Code-SHA oder Documentation-SHA

**BD4.2 Cross-Reference zu Folge-Specs** (30min)

Update `docs/backlog/post-cleanup-followups.md` mit:
- D4-Befund-Synopsis als Input für Cluster-Toolification-Discovery
- Bucket-C entscheidet sich nach Cluster-Toolification-Outcome (siehe dort)

**BD4.3 Snapshot-Verify** (30min)

```bash
bun --filter @marketing-auto/api capture-cleanup-baseline toolwiki
# Re-run nach allen BD-Fixes, vergleichen mit pre-BD-Snapshot
```

Erwartete Diffs:
- D1 fix: `astro_frontmatter`-Spalte fehlt im Snapshot (falls DROP) oder unverändert (falls Dokumentation)
- D2 fix: keine DB-State-Änderung (nur Code/Filter)
- D4 fix: ggf. neue `content_pillars`-Rows für die 12 neuen Toolwiki-Pillars (falls Step-Erweiterung)

## 4. Tests

**Pro Sprint:**
- Unit-Tests / Smoke-Tests in `apps/api/test/` und `packages/adapters/astro-sync/test/`
- Bun-Test-Runner

**Cross-Sprint:**
- **Snapshot-Diff:** Baseline vor + nach BD-Sprints. Erwartete Diffs sind dokumentiert. Unerwartete Diffs sind Bugs.
- **Re-Import-Test (lokal):** Nach D4-Fix einen Test-Re-Import laufen lassen, prüfen ob content_pillars korrekt geseedet werden.

## 5. Acceptance

1. D1 investigated: 3 Outcomes klassifiziert, Action gewählt + ausgeführt
2. D2 investigated: Trigger-Path-Analyse + ggf. Filter implementiert
3. D4 investigated: Step-Analyse + Entscheidung dokumentiert (Code-Fix oder Folge-Spec-Pointer)
4. Discovery-Scripts in `apps/api/src/scripts/discovery/` existieren (2 neue Scripts)
5. Falls Migration: 0102 (oder höher) angewendet, Drizzle-Schema synchron
6. Falls Code-Filter: Tests grün, Snapshot-Diff erwartet
7. IMPLEMENTED.md + Backlog-Update
8. D4-Output ist Input-ready für Toolwiki Cluster-Discovery (klare Dokumentation)

## 6. Cross-Cutting-Regeln

- **Investigation zuerst, Action danach.** Pro Bucket-D-Befund erst Code-Read + Discovery-Script + Outcome-Klassifikation. Erst dann Fix oder Doku.
- **Migrations einzeln, nicht gebündelt.** Falls D1 + D4 beide Migrations brauchen → 2 separate Migrations (D132-Pattern).
- **D4-Output für Toolwiki-Discovery aufbereiten:** Befunde explizit dokumentieren in BD3 mit Querverweis auf Cluster-Toolification-Spec.
- **Keine spekulativen Refactors.** Wenn Outcome „by-design" lautet: Dokumentation, kein Fix.
- **Pattern 121 / D146:** Discovery-Scripts haben Dry-Run-Default (sind read-only ohnehin), `--project=<slug>` falls relevant.

## 7. Decisions (vorab geklärt mit Marcel)

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| D-1 | Investigation-Order | D1 → D2 → D4 | D1 + D2 sind isoliert. D4 hat Output-Abhängigkeit zu Cluster-Toolification-Discovery, daher zuletzt. |
| D-2 | D1 wenn Dead Column | DROP COLUMN via Migration | Cleaner als „leave as is + ignore". Reduziert Confusion bei künftigen Audits. |
| D-3 | D2 falls Footgun | Trigger-Filter (Option A) | Defense at trigger level ist robuster als Render-Filter. Plus Logging als Verifikation. |
| D-4 | D4 falls Lücke | NICHT fixen — Cluster-Toolification ersetzt content_pillars-Tabelle | Approved Architektur-Refactor macht D4-Fix obsolet. Nur dokumentieren. (Updated 2026-05-24 — siehe Patch-Datei.) |
| D-5 | Bucket-D im selben Branch wie Bucket-C? | NEIN — Bucket-C ist separate Spec | Bucket-C hängt von Cluster-Toolification-Outcome ab. Bucket-D ist isolierter Bug-Fix. |
| D-6 | Migration-Numbering | 0102 für D1-Migration (falls), Cleanup-Spec hat keine Migrations | Linear-numbering, parallel Cleanup-Branch hat keine Migrations |

## 8. Sync-Punkte

| BD-Sprint | Parallel-Branch | Beziehung |
|---|---|---|
| BD1 (D1) | Cleanup C1-C3 | Unabhängig, parallel |
| BD2 (D2) | Cleanup C1-C3 | Unabhängig, parallel |
| BD3 (D4) | Toolwiki `docs/backlog/cluster-toolification.md` | Document-only Verweis. Cluster-Toolification approved, Implementation deferred. BD3 dokumentiert + linked, fixt nicht. (Updated 2026-05-24.) |
| BD4 (Docs) | — | Konsekutiv |

**Konkret:**
- BD1 + BD2 können sofort starten, kein Sync-Bedarf
- BD3 kann auch sofort starten — Outcome ist Dokumentations-only (siehe Patch-Datei `spec-patch-bd3-2026-05-24.md`)

## 9. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | D1-DROP COLUMN bricht Render-Code | BD1.4 Tests + Drizzle-Typecheck. Render-Code-Search VOR Migration. |
| R2 | D2-Trigger-Filter ist zu restriktiv (blockt legitime Use-Cases) | BD2.1 Trigger-Path-Analyse identifiziert alle Trigger-Points. Filter ist source-agnostic-bypass-bar via explicit force-flag falls Marcel später `SchemaExtensionPipeline` auf imported Articles laufen lassen will. |
| R3 | D4-Step-Erweiterung legt Pillars an, die später aufgeräumt werden müssen | Bucket-C ist separate Spec — falls dort Pillars als deprecated entschieden werden, müsste BD3-Erweiterung wieder rausgenommen werden. Mitigation: D-5 Decision — BD3 entscheidet sich nach Cluster-Toolification-Outcome (das bedeutet wahrscheinlich „Documentation only" in BD3). |
| R4 | Discovery-Output für Toolwiki ist nicht synchron mit deren Auditing-Methodik | BD3.4 Dokumentation explizit cross-link zu Toolwiki-Spec. Marcel coordinates. |
| R5 | Pre-existing typecheck errors in audit-scripts (3 Errors aus Hero-Spec-Deviation) | Touch nicht. Orthogonal. |

## 10. Offene Fragen für Marcel

1. **D1-Action falls Migration:** Brauchst du `astro_frontmatter` als Spalte für irgendeinen Future-Use-Case, der heute noch nicht implementiert ist? Falls ja: Dokumentation statt DROP.
2. **D2-Behavior bei legitimen Future-Use:** Falls du in der Zukunft `SchemaExtensionPipeline` doch für imported Articles laufen lassen willst (z.B. um JSON-LD für ältere Articles nachzugenerieren): Trigger-Filter wäre dann Hindernis. Force-Flag implementieren oder erst implementieren wenn Use-Case da ist?
3. OBSOLET (Updated 2026-05-24): Cluster-Toolification approved → BD3 macht keine Reconciliation, nur Dokumentation.
4. **Migration-Numbering Conflict:** Sowohl Bucket-D als auch Hero-Spec brauchten Migrations. Hero hatte 0101. Wenn Bucket-D auch eine braucht: 0102. Wenn Cleanup-Spec doch eine braucht: 0103. Reservierung machen?
5. **`content_pillars` Use-Cases:** Welche aktuelle Code-Pfade lesen die Tabelle? Sind sie kritisch (Plan-Generation? UI?) oder „nice-to-have"? Falls kritisch + Cluster-Toolification weit weg: Re-Evaluation D4-Fix-Bedarf. Falls nicht: keep-as-is bis Refactor. (Updated 2026-05-24.)

## 11. Implemented

_(wird beim Spec-Abschluss gefüllt)_

## 12. Discovered & Deviations

_(wird beim Spec-Abschluss gefüllt)_
