# Spec: Mini-Cleanup-Followups

_Branch: `feature/mini-cleanup-followups`_
_Codebase: Marketing-Tool-Monorepo_
_Status: Draft._
_Aufwand: ~4-5h, 3 Sprints._
_Voraussetzung: Cleanup-Cycle vollständig abgeschlossen (Spec 001 + Spec 000 + Bucket-C + Bucket-D + Anomaly-A-Fix)._
_Parallel-Branches: keine — alle drei Fixes isoliert._

---

## 1. Problem

Aus dem Cleanup-Cycle (Post-Cleanup-Verification-Discovery) sind drei kleine Footguns ans Tageslicht gekommen, die nicht blocking für nächste Feature-Wellen sind, aber jetzt geschlossen werden sollen damit Backlog sauber ist.

**F1 — `forecast-re-import-state.ts` `noLocaleSplit`-Bug**

Aus Anomaly-D der Verification-Discovery:

- Script matched `categories`-Collection (no-locale-split) gegen DB-Rows mit `locale=null`
- Re-Import schreibt `categories`-Rows aber als `locale='de'`
- Resultat: 30 neue `categories`-Rows zeigten im Forecast als unbekannt
- Folge: Forecast war approximative-Count, nicht akkurat

**F2 — Pipeline-Observability bei `astro:repo-import`**

Aus Anomaly-E der Verification-Discovery:

- Pro Re-Import-Trigger werden 11 `pipeline_runs` geloggt
- Nur 1 davon (93s) hat substantiell gearbeitet, 10 sind No-Op-Runs (0-16s)
- Beide Re-Imports (14:57 + 15:29) zeigten exakt das gleiche Pattern → reproduzierbarer Trigger-Mechanismus
- Keine Failures, keine Data-Corruption, aber Pipeline-History unleserlich
- Vermutete Ursache: BullMQ-Dedup loggt deduplicated Jobs trotzdem als `pipeline_runs`

**F3 — `schema_json_ld` Soft-Guard wird durch HTTP-Routes umgehbar**

Aus Bucket-D BD2-Output:

- `POST /api/articles/:id/extend-schema` ([articles.ts:1729-1754](../../routes/articles.ts)) ist source-agnostic
- `POST /api/articles/:id/sync` ([articles.ts:1612-1630](../../routes/articles.ts)) ist source-agnostic
- `enqueueSchemaExtension` ([trigger.ts:5-38](../../pipelines/src/schema-extension/trigger.ts)) gated auf `status ∈ {final_review, schema_extending}` aber NICHT auf `source`
- Imported Article + Marcel-Click auf `/extend-schema` würde `schema_json_ld` in eine `source='imported'`-Row schreiben
- Heute dormant weil Toolwiki-Collections kein `schema:`-Field in `astro_collection_schemas` deklarieren → `RenderMdxStep` filtert silent
- Wenn Astro-Collection-Schema das ändert: live-Bug

## 2. Ziel

Drei kleine Fixes mit klarem Scope. Jeder Fix unter 2h Aufwand, alle drei in einer Sitzung machbar.

**In Scope:**

- F1: `noLocaleSplit`-Behandlung in Forecast-Script korrigieren
- F2: Pipeline-Run-Logging-Cleanup oder Idempotency-Visibility
- F3: `source != 'imported'` Filter in `enqueueSchemaExtension` ergänzen
- Smoke-Tests pro Fix
- Backlog-Einträge schließen

**Out of Scope:**

- Importer-Robustness-Fixes (Slug-Rename + Mirror-Step-Ordering) — eigene Spec
- Cluster-Toolification — deferred
- BK-Onboarding-Vorbereitung — eigene Spec

## 3. Architektur

### 3.1 Sprint F1 — Forecast-Script `noLocaleSplit`-Fix (1h)

**F1.1 Bug-Repro** (10min)

Datei: `apps/api/src/scripts/discovery/forecast-re-import-state.ts`

Aktueller (vermuteter) Pattern:

```ts
// PSEUDO-CODE — Code-Read im Script erforderlich
for (const [collection, info] of Object.entries(repoInventory.byLocale)) {
  // matched gegen DB-Rows mit locale != null
  diff(repoSlugs, dbSlugs);
}
for (const [collection, info] of Object.entries(repoInventory.noLocaleSplit)) {
  // matched gegen DB-Rows mit locale = null
  // BUG: Re-Import schreibt aber locale = 'de'
  diff(repoSlugs, dbSlugsWhereLocaleIsNull);
}
```

Real-State im DB nach Re-Import: `categories`-Rows haben `locale='de'`, nicht `NULL`.

**F1.2 Fix** (20min)

Drei Optionen:

- **A) noLocaleSplit-Collections gegen ALLE locale-Werte matchen** (ignore locale-column): einfachster Fix
- **B) Explizit `locale='de'` für `noLocaleSplit`-Collections** annehmen: bricht wenn andere Collections später mit `locale='en'` oder `null` arrive
- **C) `astro_collection_schemas` lesen** um zu wissen ob Collection no-locale-split ist, dann passenden Match anwenden: korrekt aber komplexer

Empfehlung: **A** — pragmatischer Fix. `noLocaleSplit`-Collections sind global-collections, locale-column ist Importer-Implementation-Detail.

```ts
// Pseudo-Patch
if (info.type === 'noLocaleSplit') {
  // Match ignoring locale column
  const dbSlugs = await db.execute(sql`
    SELECT slug FROM articles
    WHERE project_id = ${projectId}
      AND collection = ${collection}
      AND status != 'superseded'
    -- locale-column nicht filtern für noLocaleSplit
  `);
  diff(repoSlugs, dbSlugs);
}
```

**F1.3 Smoke-Test** (15min)

Datei: `apps/api/test/scripts/forecast-re-import-state.smoke.test.ts`

Test-Cases:
1. **noLocaleSplit-Collection matched alle locales:** mock DB hat `categories` mit `locale='de'`, Forecast erkennt sie als bekannt
2. **byLocale-Collection respektiert locale-Filter:** mock DB hat `blog` DE+EN getrennt, Forecast diff't pro Locale
3. **Mixed:** beide Collection-Types in einem Lauf, korrekte Behandlung

**F1.4 Manual-Verify** (15min)

```bash
bun --filter @marketing-auto/api forecast-re-import-state --project=toolwiki

# Erwartung: categories-Slugs erscheinen als "bekannt", nicht als "neue Inserts"
```

**Acceptance F1:**
- F1.2 Fix in `forecast-re-import-state.ts` angewendet
- F1.3 3 Smoke-Tests grün
- F1.4 Manual-Verify zeigt korrektes Forecast-Verhalten
- Backlog-Eintrag in `docs/backlog/post-cleanup-followups.md` schließen

### 3.2 Sprint F2 — Pipeline-Observability bei `astro:repo-import` (2-3h)

**F2.1 Code-Read** (1h)

Drei Stellen zu untersuchen:

1. **HTTP-Endpoint** `apps/api/src/routes/projects.ts` Route `POST /:slug/astro-import` (Spec-Verification sagt Zeile 549)
  - Was passiert beim Trigger? Wird ein Job direkt enqueued? Mehrere?
  - Gibt es Retry-Logic im Endpoint?

2. **`enqueueAstroImport`-Wrapper** (vermutlich in `apps/api/src/lib/` oder `packages/pipelines/src/`)
  - Wie viele Jobs werden pro Trigger enqueued?
  - Gibt es deterministische jobId für Idempotency?

3. **BullMQ-Worker** `apps/api/src/workers/astro-sync.worker.ts` (oder ähnlich)
  - Wie verhält sich der Worker bei deduplicated Jobs?
  - Schreibt er trotzdem `pipeline_runs`-Row?

**Output:** Notiz-File `docs/discovery/f2-pipeline-observability-codeRead.md` mit:
- Welcher Code-Pfad führt zu den 11 Runs?
- Warum 10 No-Ops?
- Welche Fix-Option ist sauber?

**F2.2 Fix-Decision** (15min — Marcel-Action)

Basierend auf Code-Read-Output:

- **A) No-Op-Runs nicht loggen:** `pipeline_runs`-Row nur erzeugen wenn Worker echte Arbeit anfängt
- **B) No-Op-Runs als `kind='no-op'` taggen:** Trennt sie visuell von echten Runs, History bleibt komplett
- **C) Deterministische jobId verwenden:** BullMQ deduped auf Queue-Ebene, kein zweiter Worker-Pickup
- **D) Status-Quo behalten + Doku ergänzen:** Wenn Code-Read zeigt dass das by-design ist (z.B. Cron-Sweep)

Empfehlung: Hängt von Code-Read-Output ab. Wahrscheinlichste richtige Antwort: **C** (deterministische jobId).

**F2.3 Implementation** (1h)

Je nach F2.2-Entscheidung:

- Bei **C**: jobId-Generation im Wrapper anpassen, BullMQ `removeOnComplete + removeOnFail` config
- Bei **A**: Worker-Code so anpassen dass `pipeline_runs`-Insert erst beim ersten substantiellen Step passiert
- Bei **B**: enum-Erweiterung für `pipeline_runs.kind` + Worker-Side Tagging

**F2.4 Smoke-Test** (30min)

Test-Cases:
1. **Single Trigger → Single Run:** ein Re-Import-Click produziert genau 1 `pipeline_runs`-Row
2. **Concurrent Trigger → Dedup:** zwei Clicks innerhalb 5s produzieren ≤1 Run
3. **Real Work persisted:** der substantielle Run hat korrekte Output-Felder

**F2.5 Manual-Verify** (15min)

```bash
# Trigger
curl -X POST http://localhost:3001/api/projects/toolwiki/astro-import

# Wait 60s, check
psql -c "SELECT COUNT(*) FROM pipeline_runs 
         WHERE kind = 'astro:repo-import' 
         AND created_at > NOW() - INTERVAL '2 minutes';"

# Erwartung: 1 statt 11
```

**Acceptance F2:**
- F2.1 Code-Read-Output dokumentiert
- F2.2 Marcel-Decision festgehalten
- F2.3 Fix implementiert
- F2.4 3 Smoke-Tests grün
- F2.5 Manual-Verify zeigt 1 Run statt 11
- Backlog-Eintrag schließen

### 3.3 Sprint F3 — Schema-Extension `superseded`-Filter (30min)

**F3.1 Code-Read** (10min)

Datei: `packages/pipelines/src/schema-extension/trigger.ts`

Aktueller (vermuteter) Code:

```ts
// PSEUDO
export async function enqueueSchemaExtension(articleId: string) {
  const article = await db.query.articles.findFirst({ where: eq(id, articleId) });
  if (!['final_review', 'schema_extending'].includes(article.status)) {
    return { skipped: 'wrong-status' };
  }
  // BUG: kein source-Filter
  await queue.add('schema-extension', { articleId });
}
```

**F3.2 Fix** (5min)

```ts
export async function enqueueSchemaExtension(articleId: string) {
  const article = await db.query.articles.findFirst({ where: eq(id, articleId) });
  
  if (!['final_review', 'schema_extending'].includes(article.status)) {
    return { skipped: 'wrong-status' };
  }
  
  // NEW: imported articles don't go through schema-extension
  if (article.source === 'imported') {
    return { skipped: 'imported-article' };
  }
  
  await queue.add('schema-extension', { articleId });
}
```

**F3.3 Smoke-Test** (10min)

Test-Cases:
1. **Generated + final_review:** enqueued
2. **Generated + draft:** skipped (wrong-status)
3. **Imported + final_review:** skipped (imported-article) ← NEW
4. **Imported + schema_extending:** skipped (imported-article) ← NEW

**F3.4 Doc-Update** (5min)

Update `packages/db/src/schema/content.ts` `schemaJsonLd`-Doc-Comment:

```diff
- * Soft-Guarded: HTTP-Routes /extend-schema and /sync are source-agnostic. Today
- * dormant because no Toolwiki collection declares `schema:` field. Trigger-Filter
- * is the canonical mitigation if activation conditions trigger.
+ * Trigger-Filter applied 2026-MM-DD: enqueueSchemaExtension now skips imported
+ * articles. HTTP-Routes /extend-schema and /sync remain source-agnostic at the
+ * route level, but the pipeline-trigger guards against imported-article
+ * extensions reaching RenderMdxStep.
```

**Acceptance F3:**
- F3.2 `source='imported'` Filter in trigger.ts
- F3.3 4 Smoke-Tests grün
- F3.4 Doc-Comment aktualisiert
- Backlog-Eintrag schließen

### 3.4 Sprint F4 — Documentation + Spec-Close (30min)

**F4.1 Backlog-Update**

`docs/backlog/post-cleanup-followups.md`:
- F1 ✅ COMPLETED
- F2 ✅ COMPLETED (oder dokumentierter Status falls F2 partial-fix bekommen hat)
- F3 ✅ COMPLETED
- Astro_frontmatter (F5 aus Strategie-Plan) bleibt dormant by design

**F4.2 IMPLEMENTED.md schreiben**

`docs/specs/mini-cleanup-followups/IMPLEMENTED.md` mit:
- Files-Touched
- Test-Counts
- Vor/Nach-Metrics (Pipeline-Run-Count, Forecast-Accuracy)
- Discovered & Deviations

## 4. Tests

**Per Sprint:**
- F1: 3 Smoke-Tests
- F2: 3 Smoke-Tests
- F3: 4 Smoke-Tests

**Cross-Sprint:**
- `bun typecheck` über alle drei Packages
- `bun test` über alle drei Packages

## 5. Acceptance

1. F1: Forecast-Script korrekt für `noLocaleSplit`-Collections
2. F2: Pipeline-Run-Count bei `astro:repo-import` von 11 auf ≤2 reduziert (je nach Fix-Option)
3. F3: `enqueueSchemaExtension` filtert `imported`-Articles
4. Alle Tests grün (10 neue)
5. Backlog-Einträge geschlossen
6. IMPLEMENTED.md mit Discovered & Deviations

## 6. Cross-Cutting-Regeln

- **No DB-Writes außerhalb der Tests.** Read-only Code-Reads, dann Fix, dann Tests.
- **Pattern 121 / D146:** Keine destruktiven Operationen, falls Migration nötig.
- **F2 ist Plug-in Sprint:** wenn Code-Read zeigt es ist by-design, dann nur Doku-Output statt Fix. Acceptance entsprechend angepasst.
- **Englisch im Code/SQL, Deutsch im Fließtext** (Marcel-Convention).

## 7. Decisions

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| FU-1 | F1 Fix-Option (A/B/C) | A — ignore locale-column für noLocaleSplit | Pragmatisch, locale-column ist Importer-Detail |
| FU-2 | F2 Fix-Option | Defer to Code-Read | Hängt vom Root-Cause ab |
| FU-3 | F3 source-Filter Location | trigger.ts | Single-Point-of-Decision, alle HTTP-Routes profitieren |

## 8. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | F2 ist größer als 2-3h | Time-Box: wenn Code-Read >1h dauert, nur Doku-Output + Backlog-Spec für Fix |
| R2 | F3 bricht generated-flow | Smoke-Tests Case 1+2 verifizieren dass generated-Articles weiter enqueued werden |
| R3 | F1 categories-Special-Case übersehen | Smoke-Tests Case 1 verifiziert mit echtem `categories`-Daten-Pattern |
| R4 | Drei Fixes in einer Spec → Scope-Creep | Strikt 4-5h Time-Box. Bei Über-laufen: F2 in eigene Spec abspalten. |

## 9. Implemented

_Datum: 2026-05-24. Branch: `master` (Spec 004 + parallel Spec 002-follow-ups commit d521f56 landed in same session)._

Drei orthogonale Sprints + Doku abgeschlossen. Vollständiger Implementation-Log:
[`docs/specs/mini-cleanup-followups/IMPLEMENTED.md`](../docs/specs/mini-cleanup-followups/IMPLEMENTED.md).

| Sprint | Outcome | Files | Tests |
| ------ | ------- | ----- | ----- |
| F1 | Code-Fix + 2nd latent bug discovered+fixed in same change | 1 script (pure-helper extraction) + 1 new test file | 4 / 4 grün |
| F2 | Decision **D** — Status-Quo + Doku (per §3.2 F2.2) | 0 code, 1 discovery doc, 1 CLAUDE.md subsection | 0 (N/A) |
| F3 | Defense-in-depth code-fix an Trigger + HTTP-Route + CLI | 4 code files + 1 new test file + 1 doc-comment | 4 / 4 grün |
| F4 | Backlog close + IMPLEMENTED.md + 2 CLAUDE.md updates | 4 doc files | — |

**Workspace typecheck:** 0 errors across `@marketing-auto/pipelines`,
`@marketing-auto/api`, `@marketing-auto/db`. **Total: 8 new smoke tests** (45
expect() calls), all green.

## 10. Discovered & Deviations

### 1. F3 — Spec's fix-location only covered ½ the attack surface (Decision: defense-in-depth)

Spec §3.3 F3.1 proposed gating `enqueueSchemaExtension` on `source !== 'imported'`
with the rationale "Single-Point-of-Decision, alle HTTP-Routes profitieren"
(§7 FU-3). Code-read during implementation revealed the HTTP route
`POST /api/articles/:id/extend-schema` (the spec's stated attack vector,
§1 F3) does NOT delegate through `enqueueSchemaExtension` — it uses
`enqueueSchemaExtensionPipeline`, a parallel preRunId wrapper in
[`packages/pipelines/src/article/trigger.ts`](../packages/pipelines/src/article/trigger.ts:435).
The two enqueue paths are independent.

**Deviation:** Implemented at BOTH layers (trigger function + HTTP route),
with matching `{ skipped: 'imported-article' }` discriminators. Added a new
root-CLAUDE.md DO-NOT rule prescribing the `grep -rn '<functionName>' apps/api/src/routes/`
pre-check for future trigger-function guards. The spec's §7 FU-3 rationale
stands — the trigger gate IS a Single-Point-of-Decision for callers that
flow through it — it just doesn't reach the HTTP route, contrary to the
spec's assumption.

### 2. F1 — Second latent bug found while implementing the locale fix

The spec described F1 as a locale-column matching problem only. Implementation
revealed a paired bug: `repo-inventory.json` serialises noLocaleSplit entries
with `"byLocale": {}` (empty object) ALONGSIDE the populated `noLocaleSplit`
block. The pre-fix truthy check `if (repoColl.byLocale)` short-circuited the
entry into the per-locale branch where `Object.entries({})` iterates zero
times → entire `categories` collection silently dropped out of the report.

**Deviation:** Tightened the check to also require
`Object.keys(repoColl.byLocale).length > 0`. Added a 4th smoke test
(test 3a) locking down the real `repo-inventory.json` shape. Same root
cause as the spec-described bug.

### 3. F1 — Discovered slug-format mismatch (out-of-scope, flagged for follow-up)

After my F1 fix, manual-verify against Toolwiki still showed `categories`
with 31 inserts + 30 dbOnly instead of 30 matching as updates. Root cause:
**separate** bug — `repo-inventory.json` lists categories slugs as
`blog/comparisons`, `blog/ethics-law`, `knowledge/fundamentals` (with
collection-scope path prefix) while the importer writes DB rows with bare
slugs (`comparisons`, `ethics-law`, `fundamentals`).

**Deviation:** Did NOT fix per §8 R4 strict 4-5h time-box. F1 locale fix is
correct on its own merits and will produce the spec-described behaviour
once the slug-format mismatch is resolved. Recommended follow-up: add
"F1.5 — categories slug-format reconciliation" to
[`docs/backlog/post-cleanup-followups.md`](../docs/backlog/post-cleanup-followups.md)
Priorität 3 when convenient.

### 4. F2 — Spec's premise was a misdiagnosis (Decision: doc-only)

Spec §1 F2 claimed: "11 pipeline_runs geloggt … 10 sind No-Op-Runs (0-16s)"
and hypothesized "BullMQ-Dedup loggt deduplicated Jobs trotzdem als
pipeline_runs". Code-read found this is incorrect:

- The 11 rows are 1 parent + 10 child substeps (one per pipeline step),
  INSERTed at [runner.ts:438-449](../packages/pipelines/src/engine/runner.ts:438).
- Pattern verified across pipelines: `1 + N steps` for any registered
  pipeline (`article:blog` 13 steps → 14 rows, `planning:weekly` 11 → 12).
- BullMQ-dedup hypothesis is wrong — `enqueueRepoImport` already uses
  deterministic `jobId: repo-import-${run.id}` ([trigger.ts:41](../packages/adapters/astro-sync/src/import/trigger.ts:41)).
- The "0-16s durations" measurement was taken against an incremental
  import; full imports show non-trivial step durations (mirror-hero 30s,
  upsert 26s, parse-frontmatter 10s).

**Deviation:** F2 closed as Decision **D** (Status-Quo + Doku) per spec
§3.2 F2.2. F2.3 (Implementation) + F2.4 (Smoke-Tests) + F2.5 (Manual-Verify
"1 statt 11") are not applicable. Full code-read at
[`docs/discovery/f2-pipeline-observability-codeRead.md`](../docs/discovery/f2-pipeline-observability-codeRead.md).

### 5. F3 — `article_status` enum has no `'draft'` value

Spec §3.3 F3.3 Test-Case 2 named "Generated + draft → skipped (wrong-status)".
The actual `article_status` enum has 14 values (`proposed`, `approved`,
`generating`, `outline_review`, `drafting`, `final_review`, `schema_extending`,
`ready_to_publish`, `validating`, `published`, `blocked_by_pagespeed`,
`failed`, `rejected`, `superseded`) but **no `'draft'`**.

**Deviation:** Test fixture uses `proposed` (the canonical pre-final_review
state) instead of `draft`. Functionally identical — verifies the throw path
for any non-`final_review`/`schema_extending` source state.
