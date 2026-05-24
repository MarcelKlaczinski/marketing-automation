# Bucket-D-Spec — UPDATE für BD3

_Patch-Datum: 2026-05-24_
_Patch-Status: Eingearbeitet in `spec.md` (oben)._
_Trigger: Cluster-Toolification als Architektur-Entscheidung approved (Option A), Implementation aber deferred._

Diese Änderung patcht die existierende Bucket-D-Spec (`docs/specs/bucket-d-fixes/spec.md`). Hintergrund: Cluster-Toolification ist als Architektur-Entscheidung approved (Option A), Implementation aber deferred. Damit ändert sich der Outcome-Pfad für BD3 (D4 — content_pillars-Sync).

## Was sich ändert

**Vorher:** BD3 hatte drei mögliche Outcomes:
- Step-Erweiterung (Pillars aus Frontmatter seeden)
- Dokumentation als „derived from cluster-keys"
- Warten auf Cluster-Toolification

**Jetzt:** Cluster-Toolification ist approved → BD3 ist klarerer Pointer. Keine Step-Erweiterung, keine Dokumentations-Ergänzung der bestehenden Logik. Stattdessen: Dokumentation als „obsolete bei Cluster-Toolification-Implementation".

## Konkrete Spec-Änderungen

### Section §1 (Problem) — D4-Block anpassen

**Alten Text:**

```
**D4 — 12 neue ki-wissen-Pillars erscheinen NICHT in `content_pillars`-Tabelle**
- Branch-B-Spec dokumentierte: 12 neue Pillars (`neuronale-netze`, `backpropagation`, `eu-ai-act`, etc.)
- DB: `content_pillars` hat 20 Rows mit Schwesterkonzept-Drift, KEINE der 12 neuen Slugs
- Hypothese: `SyncClustersFromFrontmatterStep` seeded keine `content_pillars` aus Frontmatter, nur `clusters`
- Footgun: Pillars-Tabelle ist nicht authoritativ, wird inkonsistent — Plan-Generation könnte falsche Pillar-Liste sehen
- **Wichtig:** D4-Output wird Input für die Toolwiki `discovery/cluster-audit`-Spec (Cluster-Toolification-Frage)
```

**Ersetzen durch:**

```
**D4 — 12 neue ki-wissen-Pillars erscheinen NICHT in `content_pillars`-Tabelle**
- Branch-B-Spec dokumentierte: 12 neue Pillars (`neuronale-netze`, `backpropagation`, `eu-ai-act`, etc.)
- DB: `content_pillars` hat 20 Rows mit Schwesterkonzept-Drift, KEINE der 12 neuen Slugs
- Hypothese: `SyncClustersFromFrontmatterStep` seeded keine `content_pillars` aus Frontmatter, nur `clusters`
- **Update 2026-05-24:** Cluster-Toolification ist approved (Toolwiki Spec `docs/specs/cluster-toolification.md`), Implementation deferred. Bei Implementation wird die `content_pillars`-Tabelle obsolet (siehe Toolwiki-Spec §D.2 — neue Tabellen `clusters` + `cluster_memberships`). D4 wird **nicht aktiv gefixt**, sondern als „obsolete bei Cluster-Toolification-Trigger" dokumentiert.
```

### Section §3.3 (Sprint BD3) — komplette Re-Definition

Alten Sprint-Inhalt komplett ersetzen mit:

````markdown
### 3.3 Sprint BD3 — D4 Investigation + Dokumentation (Tag 2)

**Update:** Cluster-Toolification ist als Architektur approved (Toolwiki Spec, Marcel-Decision 2026-05-24). Implementation ist deferred. BD3 macht daher **keine aktive Behebung** der content_pillars-Lücke, sondern dokumentiert den Status quo und verlinkt auf die Cluster-Toolification-Spec.

**BD3.1 Code-Read SyncClustersFromFrontmatterStep** (1h)

Datei: `packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts`

Fragen (für Dokumentation, nicht für Fix):
1. Schreibt der Step in `clusters`-Tabelle? Welche Logik?
2. Schreibt der Step in `content_pillars`-Tabelle? Welche Logik?
3. Welche bestehende Befüllungs-Logik existiert für `content_pillars`? (Cluster-Creator? ColdStart? Anderer Pipeline-Step?)

Output: Notizen in `docs/discovery/bd3-content-pillars-baseline.md` als Input-Material für künftige Cluster-Toolification-Implementation.

**BD3.2 Pillar-Source-Inventur** (1h)

Datei: `apps/api/src/scripts/discovery/audit-content-pillars-sources.ts`

SQL-Audit der heutigen 20 `content_pillars`-Rows:
- Welche Spalten sind populated?
- Wann wurden sie angelegt (`created_at`)?
- Welche Articles referenzieren sie via `cluster_key` (logischer Join, kein FK)?
- Existieren Duplikate (Schwesterkonzept-Drift wie Bucket-C)?

Output: Daten-Snapshot in `apps/api/src/scripts/discovery/content-pillars-state.json` für künftige Migrations-Planung.

**BD3.3 Dokumentation als Folge-Spec-Pointer** (1h)

Datei: `packages/db/src/schema/identity.ts` — Header-Kommentar zur `contentPillars`-Definition:

```ts
/**
 * content_pillars: legacy table, scheduled for refactor.
 *
 * Today this table is populated by ad-hoc inserts from various sources
 * (Cluster-Creator UI, ColdStart-Pipeline, sync-clusters-from-frontmatter).
 * It accumulates drift over time and is NOT authoritatively kept in sync
 * with the Astro repo's frontmatter pillar definitions.
 *
 * APPROVED REFACTOR PATH: Cluster-Toolification (Toolwiki-Repo
 * `docs/specs/cluster-toolification.md`, approved 2026-05-24, implementation
 * deferred). When implementation triggers (see Toolwiki spec §11), this table
 * is obsoleted in favor of new tables `clusters` + `cluster_memberships`
 * (tenant-aware, Postgres source-of-truth).
 *
 * Until then: read-only consumer code can use this table, but writes should
 * be rare and trackable. New pillar-related features should NOT extend this
 * table — they should wait for the refactor.
 *
 * See also:
 * - docs/discovery/post-refactor-state-audit.md §6.1 D4
 * - docs/discovery/bd3-content-pillars-baseline.md
 * - Toolwiki repo: docs/backlog/cluster-toolification.md
 */
```

Plus Eintrag in `docs/backlog/post-cleanup-followups.md`:

```markdown
## D4 — content_pillars-Sync (obsoleted by Cluster-Toolification)

Status: NOT FIXED, intentionally.

D4 originally proposed extending `SyncClustersFromFrontmatterStep` to seed
`content_pillars` from frontmatter. Decision 2026-05-24: do NOT fix because
Cluster-Toolification (Toolwiki spec, approved Option A) replaces the entire
table at implementation.

Triggers for re-evaluating D4 in isolation (if Cluster-Toolification stays
deferred indefinitely):
- New feature critically depends on accurate `content_pillars` (Plan-Generation
  or UI). Today: rare.
- `content_pillars` drift becomes blocker for cold-start or import pipelines.
  Today: not observed.

In both cases: re-open D4 as small spec, but be aware that any extension
will need to be unwound when Cluster-Toolification triggers.
```

**BD3.4 NICHTS implementieren (0h)**

- KEIN Step-Erweiterung
- KEIN Migration
- KEINE Test-Updates
- Nur Dokumentation + Discovery-Snapshots

**Acceptance BD3:**

- `docs/discovery/bd3-content-pillars-baseline.md` existiert mit Step-Code-Notizen
- `apps/api/src/scripts/discovery/audit-content-pillars-sources.ts` existiert + Output-Snapshot
- `packages/db/src/schema/identity.ts` `contentPillars`-Doc-Comment aktualisiert
- `docs/backlog/post-cleanup-followups.md` D4-Eintrag dokumentiert
````

### Section §7 (Decisions) — D-4 anpassen

**Alten Eintrag:**

```
| D-4 | D4 falls Lücke | Entscheidung NACH Code-Read | Drei Outcomes denkbar, kann nicht vorab gewählt werden |
```

**Ersetzen durch:**

```
| D-4 | D4 falls Lücke | NICHT fixen — Cluster-Toolification ersetzt content_pillars-Tabelle | Approved Architektur-Refactor macht D4-Fix obsolet. Nur dokumentieren. |
```

### Section §10 (Offene Fragen) — Fragen 2 + 5 anpassen

**Alte Fragen:**

```
1. D4-Output Reconciliation: Soll BD3 explizit auf den Toolwiki-Cluster-Discovery-Output warten (sequentiell)? Oder parallel und Outputs später reconcilen?
2. `content_pillars` Use-Cases: Wer/was liest die Tabelle heute? Falls niemand: BD3 ist trivial („derived only"). Falls Plan-Generation oder UI: BD3 hat höhere Priorität.
```

**Ersetzen durch:**

```
1. OBSOLET: Cluster-Toolification approved → BD3 macht keine Reconciliation, nur Dokumentation.
2. `content_pillars` Use-Cases: Welche aktuelle Code-Pfade lesen die Tabelle? Sind sie kritisch (Plan-Generation? UI?) oder „nice-to-have"? Falls kritisch + Cluster-Toolification weit weg: Re-Evaluation D4-Fix-Bedarf. Falls nicht: keep-as-is bis Refactor.
```

## Konsequenzen für Sync-Punkte

Section §8 Sync-Punkte-Tabelle bleibt im Wesentlichen gleich, aber der BD3-Sync-Punkt zur Toolwiki ist jetzt **bidirectional document-only** (keine Code-Abhängigkeit mehr):

```diff
| BD-Sprint | Parallel-Branch | Beziehung |
|---|---|---|
| BD1 (D1) | Cleanup C1-C3 | Unabhängig, parallel |
| BD2 (D2) | Cleanup C1-C3 | Unabhängig, parallel |
- | BD3 (D4) | Toolwiki `discovery/cluster-audit` | **D4-Output muss VOR Toolwiki-Discovery-Phase-B verfügbar sein** |
+ | BD3 (D4) | Toolwiki `docs/backlog/cluster-toolification.md` | Document-only Verweis. Cluster-Toolification approved, Implementation deferred. BD3 dokumentiert + linked, fixt nicht. |
| BD4 (Docs) | — | Konsekutiv |
```

## Aufwand

BD3 reduziert sich von „1-3h Investigation + 1-3h Fix oder Doku" auf 2h Investigation + 1h Dokumentation. Spart ca. 1 Tag.

Gesamt-Aufwand Bucket-D-Spec sinkt von 2-3 Tagen auf 2 Tage (BD1 + BD2 normal, BD3 verschlankt, BD4 normal).
