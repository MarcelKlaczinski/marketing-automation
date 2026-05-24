# Spec: Bucket-C Cleanup (Schwesterkonzept-Drift in Cluster-Tabellen)

_Branch: `feature/bucket-c-cleanup`_
_Codebase: Marketing-Tool-Monorepo_
_Status: Draft._
_Aufwand: ~1 Tag, 3 Sprints._
_Voraussetzung: Post-Refactor-State-Audit (`docs/discovery/post-refactor-state-audit.md`) gemerged, Cluster-Toolification approved (Toolwiki-Spec, Marcel-Decision 2026-05-24)._

_Parallel-Branches:_
- _`feature/db-cleanup-post-refactor` (Cleanup-Spec) — kein Konflikt_
- _`feature/bucket-d-fixes` (Bucket-D-Spec) — kein Konflikt_
- _Cluster-Toolification-Implementation — DEFERRED, würde diese Tabellen sowieso ersetzen_

---

## 1. Problem

Aus `docs/discovery/post-refactor-state-audit.md` §6.1 Bucket C ("Unerwartet, harmlos"):

Vor-Eingriffs-Zustand der Cluster-Tabellen ist akkumulierter Daten-Müll aus mehreren früheren Pipeline-Runs (Cluster-Creator + ColdStart + Sync-Clusters-from-Frontmatter):

**C1 — `content_pillars`-Tabelle mit Schwesterkonzept-Drift**
- 20 Rows mit Mix aus EN-Slug-style (`audio-music`, `business-productivity`), DE-Display-Names (`Praxis`, `Grundlagen`, `Vergleiche`), und Cluster-style-Slugs (`ki-regulierte-branchen-2026`)
- Beispiele für Doppel-Naming: `Praxis` + `Praxis & Use Cases` parallel
- Heute kein aktiver Bug (keine Code-Pfade nutzen Pillars-Tabelle als authoritative Source), aber verwirrend bei jedem Audit
- Cluster-Toolification (Toolwiki-Spec, approved) macht Tabelle obsolet → trotzdem Wert in Cleanup, weil Implementation deferred ist

**C2 — `clusters`-Tabelle mit Doppel-Sprach-Slugs**
- 44 Rows, davon mehrere Sprach-Dubletten (z.B. `code-assistants-2026` + `code-assistenten-2026` als separate Rows obwohl semantisch derselbe Cluster)
- Audit zeigte explizit: `tool-codeium` und `tool-windsurf` haben unterschiedliche `clusterKey`-Werte in DE vs. EN
- Heute keine Funktions-Auswirkung (per-Article `cluster_key` String-Lookup, nicht über Cluster-PK)
- Wichtig für künftige Cluster-Toolification: Doppel-Slugs müssen vor Tool-Side-Import konsolidiert werden

**C4 — `content_categories` ohne `parent_slug`-Feld**
- 31 Rows in Tabelle haben kein `parent_slug`-Feld
- Hierarchie wird heute nur in MDX-Files via `parentSlug`-Frontmatter referenziert
- Tool kennt die Tool-Top → Tool-Sub-Hierarchie nicht in DB-Form
- Out-of-scope wenn keine Cross-Tenant-Hierarchie-Queries gebraucht werden

## 2. Ziel

Schwesterkonzept-Drift in `clusters` + `content_pillars` Tabellen bereinigen. Doppel-Naming entfernen, Slug-Conventions vereinheitlichen, Audit-Trail-Snapshot vor + nach Cleanup. Vorbereitung für künftige Cluster-Toolification (wenn der Trigger zieht).

**In Scope:**
- Pre-Cleanup Snapshot der Cluster + Pillars Tabellen
- C1: `content_pillars` Schwesterkonzept-Drift Cleanup — Doppel-Naming-Resolution
- C2: `clusters` Doppel-Sprach-Slug-Konsolidierung — EN-canonical-Slug Convention
- Post-Cleanup Verification
- Re-Referencing: Articles mit `cluster_key` der konsolidierten alten Slugs updaten auf neuen canonical Slug

**Out of Scope:**
- C4 (`content_categories.parent_slug` Feld) — separate Spec falls Cross-Tenant-Hierarchie-Queries gebraucht werden
- Cluster-Toolification Implementation — separate Spec (deferred)
- Bucket-D Bug-Fixes — eigene Spec
- Post-Refactor Cleanup (Orphans + Stale-Comparison-Fields) — eigene Spec
- Hero-Image-Mirror — abgeschlossen
- BK-Onboarding

## 3. Architektur

### 3.1 Sprint BC1 — Inventur + Decisions (Tag 1 Morgen)

**BC1.1 Snapshot bestehender State** (1h)

Datei: `apps/api/src/scripts/discovery/capture-bucket-c-baseline.ts`

Read-only Script, das den aktuellen State dokumentiert:

```ts
const baseline = {
  timestamp: new Date().toISOString(),
  projectId: TOOLWIKI_PROJECT_ID,

  // content_pillars: alle 20 Rows mit Logical-References
  contentPillars: await db.execute(sql`
    SELECT cp.id, cp.name, cp.created_at, cp.updated_at,
           (SELECT COUNT(*) FROM articles
            WHERE project_id = cp.project_id
              AND cluster_key = cp.name) AS articles_referencing
    FROM content_pillars cp
    WHERE project_id = ${TOOLWIKI_PROJECT_ID}
    ORDER BY cp.name
  `),

  // clusters: alle 44 Rows mit Article-Counts
  clusters: await db.execute(sql`
    SELECT c.id, c.cluster_key, c.created_at,
           (SELECT COUNT(*) FROM articles
            WHERE project_id = c.project_id
              AND cluster_key = c.cluster_key) AS article_count
    FROM clusters c
    WHERE project_id = ${TOOLWIKI_PROJECT_ID}
    ORDER BY c.cluster_key
  `),

  // Detected Schwester-Pairs für clusters
  clusterPairs: await db.execute(sql`
    SELECT
      c1.cluster_key AS de_slug,
      c2.cluster_key AS en_slug,
      c1.id AS de_id,
      c2.id AS en_id
    FROM clusters c1
    JOIN clusters c2
      ON c1.project_id = c2.project_id
      AND c1.cluster_key < c2.cluster_key
      AND (
        -- Heuristik 1: DE-Slug enthält "-2026", EN-Slug ebenfalls, aber Wortstamm anders
        REPLACE(c1.cluster_key, '-2026', '') ILIKE '%' || REPLACE(c2.cluster_key, '-2026', '') || '%'
        OR REPLACE(c2.cluster_key, '-2026', '') ILIKE '%' || REPLACE(c1.cluster_key, '-2026', '') || '%'
        -- Manuelle Heuristik für bekannte Pairs:
        OR (c1.cluster_key = 'code-assistenten-2026' AND c2.cluster_key = 'code-assistants-2026')
      )
    WHERE c1.project_id = ${TOOLWIKI_PROJECT_ID}
  `),
};

await writeFile(
  `apps/api/src/scripts/discovery/bucket-c-baseline-${baseline.timestamp.replace(/:/g, '-')}.json`,
  JSON.stringify(baseline, null, 2)
);
```

**BC1.2 Marcel-Decisions auf Snapshot-Basis** (30min — Marcel-Action)

Marcel reviewed Snapshot und trifft 3 Entscheidungen:

**Decision-1 (C1 Resolution-Strategy):**
- A) **Aggressive Cleanup:** Alle 20 Pillars-Rows DELETE, leere Tabelle übrig (Cluster-Toolification baut neue Tabellen sowieso)
- B) **Conservative Cleanup:** Nur die offensichtlichen Duplikate konsolidieren (`Praxis` + `Praxis & Use Cases` → 1 Row), Schwester-Konzepte (DE+EN-Mix) bleiben
- C) **No Cleanup:** Tabelle so lassen, Cluster-Toolification räumt später auf

Empfehlung: **B** — Cleanup the obvious, leave the rest for the Refactor.

**Decision-2 (C2 EN-canonical-Convention):**
- A) **EN-canonical:** Alle Doppel-Sprach-Slugs zu EN konsolidieren (`code-assistenten-2026` → `code-assistants-2026`)
- B) **DE-canonical:** Alle zu DE konsolidieren (deutscher Marketing-Tool-Vendor, deutscher Markt)
- C) **Per-Cluster-Decision:** Jedes Pair einzeln entscheiden, basierend auf Article-Count (Mehrheit gewinnt)

Empfehlung: **A** — EN-canonical, weil Branch-B-Refactor (Toolwiki) bereits EN-canonical-Slugs in `content_categories` etabliert hat. Konsistenz mit Branch-B.

**Decision-3 (Article-Re-Reference-Strategy):**
- Wenn Cluster konsolidiert wird: was passiert mit Articles, deren `cluster_key` auf den gelöschten Cluster-Slug zeigt?
- A) **UPDATE articles.cluster_key:** Auf neuen canonical Slug zeigen lassen
- B) **Leave-as-is:** Cluster-Key bleibt String, kein FK, kein technischer Bruch

Empfehlung: **A** — saubere Konsistenz. Cluster-Toolification-Import-Job hat dann auch konsistente Inputs.

**BC1.3 Cleanup-SQL-Skript draftet** (1-2h)

Datei: `apps/api/src/scripts/cleanup-bucket-c-drift.ts`

```ts
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    apply: { type: "boolean", default: false },
    only: { type: "string" }, // "pillars" | "clusters"
  },
});

if (!values.project) {
  console.error("Required: --project=<slug>");
  process.exit(1);
}

const project = await loadProject(values.project);
const doPillars = !values.only || values.only === "pillars";
const doClusters = !values.only || values.only === "clusters";

// PHASE 1: content_pillars Schwesterkonzept-Cleanup
if (doPillars) {
  // Marcel-decided pairs (siehe BC1.2 Decision-1 Outcome)
  const PILLAR_CONSOLIDATIONS = [
    // Beispiele — final-list kommt aus Marcel-Review von baseline.json
    { keep: "Praxis", drop: ["Praxis & Use Cases"] },
    // ggf. weitere — manuell aus Snapshot
  ];

  for (const { keep, drop } of PILLAR_CONSOLIDATIONS) {
    if (!values.apply) {
      console.log(`[PILLARS] DRY-RUN: would consolidate ${drop.join(", ")} → ${keep}`);
    } else {
      const result = await db.execute(sql`
        DELETE FROM content_pillars
        WHERE project_id = ${project.id}
          AND name = ANY(${drop})
        RETURNING id, name
      `);
      console.log(`[PILLARS] Consolidated ${drop.join(", ")} → ${keep}: ${result.length} rows deleted`);
    }
  }
}

// PHASE 2: clusters Doppel-Sprach-Slug-Cleanup
if (doClusters) {
  // Marcel-decided slug-mappings (siehe BC1.2 Decision-2 Outcome)
  const CLUSTER_CONSOLIDATIONS = [
    { keep: "code-assistants-2026", drop: ["code-assistenten-2026"] },
    // ggf. weitere — manuell aus Snapshot
  ];

  for (const { keep, drop } of CLUSTER_CONSOLIDATIONS) {
    if (!values.apply) {
      console.log(`[CLUSTERS] DRY-RUN: would consolidate ${drop.join(", ")} → ${keep}`);
      const articleCount = await db.execute(sql`
        SELECT COUNT(*) AS count
        FROM articles
        WHERE project_id = ${project.id}
          AND cluster_key = ANY(${drop})
      `);
      console.log(`[CLUSTERS] DRY-RUN: would re-reference ${articleCount[0].count} articles`);
    } else {
      // Articles re-reference auf canonical slug
      const articleResult = await db.execute(sql`
        UPDATE articles
        SET cluster_key = ${keep}, updated_at = NOW()
        WHERE project_id = ${project.id}
          AND cluster_key = ANY(${drop})
        RETURNING id, slug, locale
      `);
      console.log(`[CLUSTERS] Re-referenced ${articleResult.length} articles → ${keep}`);

      // Cluster-Rows DELETE
      const clusterResult = await db.execute(sql`
        DELETE FROM clusters
        WHERE project_id = ${project.id}
          AND cluster_key = ANY(${drop})
        RETURNING id, cluster_key
      `);
      console.log(`[CLUSTERS] Deleted ${clusterResult.length} duplicate cluster rows`);
    }
  }
}

console.log(values.apply ? "Bucket-C cleanup applied." : "Dry-run complete.");
```

**Wichtige Punkte:**
- `CONSOLIDATIONS`-Arrays werden manuell aus Snapshot ausgefüllt nach Marcel-Decisions
- Article-Re-Reference VOR Cluster-Delete (Reihenfolge wichtig — sonst orphaned cluster_keys)
- `--only=pillars` / `--only=clusters` für selektive Re-Runs
- DRY-RUN-Output zeigt auch Article-Re-Reference-Counts

**Pattern-Referenz:** D146 Backfill-Dry-Run-Default. Pattern 121.

### 3.2 Sprint BC2 — Tests + Apply (Tag 1 Nachmittag)

**BC2.1 Smoke-Tests** (1-2h)

Datei: `apps/api/test/scripts/cleanup-bucket-c-drift.smoke.test.ts`

Test-Cases:
1. **Dry-Run no-op:** Output zeigt erwartete Counts, keine DB-Mutation
2. **Apply Pillars-only:** `--only=pillars --apply` → Pillars konsolidiert, Clusters unverändert
3. **Apply Clusters-only:** `--only=clusters --apply` → Clusters + Articles re-referenced, Pillars unverändert
4. **Apply Both:** Default → beide Cleanups, korrekte Reihenfolge (Article-Re-Ref vor Cluster-Delete)
5. **Idempotent:** `--apply` zweimal → zweiter Run zeigt 0 Affected
6. **Missing project:** Falscher Slug → Error
7. **Cross-Tenant-Protection:** project_id-Filter überall aktiv
8. **Article-Reference-Order:** Cluster wird NICHT deleted bevor Articles re-referenced wurden (sonst orphaned cluster_keys)

**BC2.2 Dry-Run-Review** (15min Marcel-Action)

```bash
bun --filter @marketing-auto/api cleanup-bucket-c-drift --project=toolwiki
```

Erwartete Output (Beispiel):
```
[PILLARS] DRY-RUN: would consolidate Praxis & Use Cases → Praxis
[CLUSTERS] DRY-RUN: would consolidate code-assistenten-2026 → code-assistants-2026
[CLUSTERS] DRY-RUN: would re-reference 6 articles
Dry-run complete.
```

Marcel approves Counts, dann weiter.

**BC2.3 Apply** (15min Marcel-Action)

```bash
bun --filter @marketing-auto/api cleanup-bucket-c-drift --project=toolwiki --apply
```

**BC2.4 Post-Cleanup-Verification** (30min)

```bash
bun --filter @marketing-auto/api capture-bucket-c-baseline toolwiki
# Re-run baseline-script, vergleichen mit pre-cleanup snapshot
```

Verify:
```sql
-- Pillars: keine offensichtlichen Duplikate mehr
SELECT name, COUNT(*) FROM content_pillars
WHERE project_id = '<toolwiki-id>'
GROUP BY name HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- Clusters: keine Doppel-Sprach-Slugs mehr
SELECT cluster_key FROM clusters
WHERE project_id = '<toolwiki-id>'
  AND (cluster_key LIKE '%-assistenten-%' OR cluster_key LIKE '%-deutsch-%');
-- Expected: 0 rows (alle DE-Varianten konsolidiert)

-- Articles: alle cluster_keys haben matching cluster-row
SELECT a.cluster_key, COUNT(*) FROM articles a
WHERE a.project_id = '<toolwiki-id>'
  AND a.cluster_key IS NOT NULL
  AND a.cluster_key NOT IN (
    SELECT cluster_key FROM clusters WHERE project_id = a.project_id
  )
GROUP BY a.cluster_key;
-- Expected: 0 rows (kein orphaned cluster_key)
```

### 3.3 Sprint BC3 — Documentation (Tag 1 Spätnachmittag)

**BC3.1 Implemented-Section** (30min)

`docs/specs/bucket-c-cleanup/IMPLEMENTED.md` mit:
- Pillars-Consolidations-Liste + Row-Counts
- Clusters-Consolidations-Liste + Article-Re-Reference-Counts
- Commit-SHAs

**BC3.2 Cross-Reference zu Cluster-Toolification** (30min)

Update `docs/backlog/post-cleanup-followups.md`:

```markdown
## Bucket-C — Schwesterkonzept-Drift (COMPLETED 2026-MM-DD)

Status: ✅ DONE — both pillars + clusters consolidated.

Pre-Conditions for Cluster-Toolification implementation (Toolwiki-Spec):
- ✅ `clusters`-Tabelle hat keine Doppel-Sprach-Slugs mehr
- ✅ `content_pillars`-Tabelle hat keine offensichtlichen Duplikate
- Naming-Konflikt (bestehende `clusters`-Tabelle vs. neue Tabellen aus Toolwiki-Spec §D.2) ist
  vor Implementation zu klären (Option X/Y/Z aus Backlog-Eintrag)
```

**BC3.3 Schema-Doc-Update** (15min)

Update Drizzle-Schema-Header-Kommentare in `packages/db/src/schema/identity.ts`:

```ts
/**
 * clusters: per-tenant cluster definitions.
 *
 * Cleanup-status 2026-MM-DD (Bucket-C-Spec): EN-canonical-Slug-Convention applied.
 * Bilingual duplicates consolidated (e.g. code-assistenten-2026 → code-assistants-2026).
 *
 * SCHEDULED REFACTOR: Cluster-Toolification (Toolwiki-Spec, approved, deferred).
 * When implementation triggers, this table is either extended (Option X) or
 * replaced (Option Y/Z). See Toolwiki repo docs/backlog/cluster-toolification.md
 * for naming-conflict-resolution options.
 */

/**
 * content_pillars: legacy pillar storage, scheduled for refactor.
 *
 * Cleanup-status 2026-MM-DD (Bucket-C-Spec): obvious duplicates consolidated.
 * Schwester-concept drift (DE/EN-mix) NOT fully cleaned — waiting for refactor.
 *
 * APPROVED REFACTOR PATH: Cluster-Toolification (Toolwiki-Spec). At implementation,
 * this table is obsoleted in favor of new `clusters` + `cluster_memberships` tables.
 * See packages/db/src/schema/identity.ts content_pillars-Doc for details.
 */
```

## 4. Tests

**Pro Sprint:**
- 8 Smoke-Tests in `apps/api/test/scripts/`
- Bun-Test-Runner

**Cross-Sprint:**
- **Pre/Post-Snapshot-Diff:** baseline-files in `apps/api/src/scripts/discovery/` werden gediff't
- **Idempotenz:** `--apply` zweimal → zweiter Run zeigt 0 Affected
- **Article-Reference-Integrity:** Nach Cleanup kein orphaned `cluster_key` in Articles

## 5. Acceptance

1. Baseline-Snapshot vor Cleanup existiert
2. Marcel-Decisions zu C1-Resolution + C2-Convention + Re-Reference-Strategy dokumentiert
3. Cleanup-Script existiert mit Dry-Run-Default, `--apply`, `--project=<slug>`, `--only=`-Filter
4. 8 Smoke-Tests grün
5. Dry-Run-Output zeigt erwartete Counts
6. Apply: Pillars konsolidiert, Clusters konsolidiert, Articles re-referenced
7. Post-Cleanup-Snapshot zeigt 0 Duplikate, 0 orphaned cluster_keys
8. Schema-Doc-Kommentare aktualisiert (clusters + content_pillars)
9. Cross-Reference im Backlog zu Cluster-Toolification dokumentiert

## 6. Cross-Cutting-Regeln

- **Read-Only zuerst, dann schreiben.** Capture-Snapshot vor jedem Mutation-Step.
- **Article-Re-Reference VOR Cluster-Delete.** Sonst orphaned cluster_keys (kein technischer Bruch, aber Audit-Trail verloren).
- **Marcel-Decisions zwingend.** Cleanup-SQL-Skript hat hardcoded CONSOLIDATIONS-Arrays, die NACH Marcel-Review aus baseline.json gefüllt werden. KEINE automatische Heuristik-basierte Konsolidierung.
- **`--project=<slug>` Pflicht.** Cross-Tenant-Protection.
- **Idempotent:** Alle Operationen `WHERE cluster_key = ANY(<drop_list>)` → bei Re-Run keine Affected Rows.
- **No FK-Updates.** `articles.cluster_key` ist String, kein FK. Re-Reference ist reines UPDATE ohne Constraint-Checks.
- **Pattern 121 / D146:** Dry-Run-Default, `--apply` opt-in, count-based dry-run.

## 7. Decisions (zu klären mit Marcel im BC1.2)

| # | Decision | Empfehlung | Begründung |
|---|---|---|---|
| BC-1 | C1 Resolution-Strategy | B (Conservative) | Cluster-Toolification baut neue Tabellen sowieso. Trotzdem Wert in obvious-Duplicates-Cleanup. |
| BC-2 | C2 EN-canonical-Convention | A (EN-canonical) | Konsistenz mit Branch-B (`content_categories` ist auch EN-canonical) |
| BC-3 | Article-Re-Reference | A (UPDATE cluster_key) | Saubere Konsistenz, Tool-Toolification-Input |
| BC-4 | Soft-Delete vs. Hard-Delete für Cluster-Rows | Hard-Delete | Cluster-Rows haben keine FKs, Audit-Trail via snapshot.json |
| BC-5 | C4 (parent_slug auf content_categories) | OUT-OF-SCOPE | Separate Spec falls Cross-Tenant-Hierarchie-Queries gebraucht |

## 8. Sync-Punkte

| BC-Sprint | Parallel-Branch | Beziehung |
|---|---|---|
| BC1 (Snapshot + Decisions) | — | Unabhängig |
| BC2 (Apply) | — | Marcel-Action zwischen BC1.2 + BC2 |
| BC3 (Docs) | — | Konsekutiv |

**Cluster-Toolification:** Bucket-C ist Pre-Condition für Toolification-Implementation (siehe Toolwiki-Backlog). BC2 muss applied sein, bevor Toolification-Trigger-Conditions als „grün" gelten.

**Bucket-D BD3:** BC kann VOR oder NACH BD3 laufen. Beide sind dokumentations-fokussiert, kein Code-Konflikt.

## 9. Risiken & Mitigation

| # | Risiko | Mitigation |
|---|---|---|
| R1 | Cleanup-SQL konsolidiert falsche Pairs | Marcel-Review von baseline.json + hardcoded CONSOLIDATIONS-Arrays |
| R2 | Article-Re-Reference verliert Daten | UPDATE statt DELETE auf articles, `RETURNING id, slug, locale` für Audit |
| R3 | Cluster-Toolification-Implementation hat andere Naming-Vorstellung | Bucket-C konsolidiert auf EN-canonical, das ist konsistent mit Toolwiki-Audit (D.3 Tenant-Isolation, cluster_key tenant-namespace) |
| R4 | content_pillars-Cleanup zu aggressiv | Empfehlung Option B (Conservative) — nur obvious duplicates |
| R5 | Re-Run nach `--apply` mutiert nochmal | Idempotenz via `cluster_key = ANY(<drop_list>)`-WHERE — bei Re-Run keine Matches |
| R6 | Bestehende Pipeline-Step (`SyncClustersFromFrontmatterStep`) legt nach Cleanup neue Doppel-Slugs an | Step-Code-Read im Bucket-D BD3.1 — bei Bedarf separate Spec für Step-Fix |

## 10. Offene Fragen für Marcel

1. **C1 Resolution-Strategy:** Conservative B oder Aggressive A?
2. **C2 EN-canonical-Konvention:** Ja, oder per-Cluster-Decision?
3. **Pillars-Liste vom Snapshot:** Wie viele „obvious duplicates" sieht Marcel im baseline.json? Beispiele bereitstellen.
4. **Cluster-Pairs vom Snapshot:** Wie viele Doppel-Sprach-Slug-Pairs gibt es konkret? Heuristik-detected sind 2 (codeium/windsurf in code-assistants), aber weitere möglich.
5. **C4 (parent_slug):** Soll das mit-aufgenommen werden, oder separate Spec? Empfehlung: separate Spec falls Cross-Tenant-Hierarchie-Queries Use-Case haben.

## 11. Implemented

Applied 2026-05-24 against Toolwiki tenant. Full record:
[docs/specs/bucket-c-cleanup/IMPLEMENTED.md](../docs/specs/bucket-c-cleanup/IMPLEMENTED.md).

**Pillars (Phase 1):**
- 10 rows deleted from `content_pillars` (7 EN/DE pairs + 4-fold Praxis-drift)
- 1 cluster (`ki-business-2026`) re-pointed from `practice-use-cases.pillarId` → `practice.pillarId` (denormalized text field updated too)
- Toolwiki state: 29 → 19 pillars
- 3 ki-wissen pillars with `intentTaxonomyOverride` deliberately preserved
- Convention encoded in [packages/db/src/schema/identity.ts](../packages/db/src/schema/identity.ts) header doc: EN-canonical lowercase-slug-form

**Clusters (Phase 2) — Option Y:**
- DB-side consolidation rejected; per-locale split kept by design (DE+EN articles in separate clusters)
- 2 MDX files edited in Astro repo (`tools/en/cursor.mdx` + `tools/en/github-copilot.mdx` → `clusterKey: "code-assistants-2026"`)
- Marcel-action pending: Toolwiki Re-Import will sync DB to clean state (4 EN articles under `code-assistants-2026`, 4 DE under `code-assistenten-2026`)
- `CLUSTER_CONSOLIDATIONS_BY_PROJECT.toolwiki = []` in cleanup script with rationale comment

**Scripts:**
- [apps/api/src/scripts/discovery/capture-bucket-c-baseline.ts](../apps/api/src/scripts/discovery/capture-bucket-c-baseline.ts) — read-only snapshot (pillars + clusters + cluster_key distribution + heuristic schwester-pair detector)
- [apps/api/src/scripts/cleanup-bucket-c-drift.ts](../apps/api/src/scripts/cleanup-bucket-c-drift.ts) — `--apply` default false, `--project=<slug>` required, `--only=pillars|clusters` filter, per-tenant `*_CONSOLIDATIONS_BY_PROJECT` maps

**Tests:**
- 10/10 smoke-test cases in [apps/api/test/scripts/cleanup-bucket-c-drift.smoke.test.ts](../apps/api/test/scripts/cleanup-bucket-c-drift.smoke.test.ts) — in-memory `DatabasePort` DI fakes, no Postgres roundtrip
- New `__test_fixture_cluster_phase__` sentinel slug in the consolidation maps so cluster-phase logic stays testable after Toolwiki's array was emptied per Option Y

**Documentation:**
- Schema doc-headers on `content_pillars` + `clusters` in [packages/db/src/schema/identity.ts](../packages/db/src/schema/identity.ts) document the EN-canonical-slug convention + per-locale cluster semantics + the Astro-frontend-vs-DB ownership split
- [docs/backlog/post-cleanup-followups.md](../docs/backlog/post-cleanup-followups.md) Bucket-C section updated to ✅ COMPLETED + added "Uncategorized cluster reassignment" follow-up entry

## 12. Discovered & Deviations

1. **Snapshot count drift vs. spec text.** Spec §1 said "20 pillars" + "44 clusters"; actual Toolwiki state was 29 pillars + 46 clusters. The audit's number was based on an older read; the cleanup script's `countMismatchWarning` pattern (inherited from Spec 001) is the right escape hatch for this.

2. **Cluster Phase rejected entirely — Option Y replaces Option A.** Spec §3.1 BC-2 proposed EN-canonical DB-side consolidation (Option A). BC2.2 discovery surfaced two blockers that made the original plan wrong:
   - `articles.cluster_key` is NOT in the refresh-whitelist — DB UPDATE survives only until next Re-Import.
   - Astro public frontend reads `clusterKey` directly from MDX for related-articles widget — DB cleanup doesn't fix the actual public-site problem.

   Marcel-decision: do MDX-side fix instead (Option Y, per-locale-canonical), keep both clusters in DB as intentional per-locale split.

3. **Heuristic schwester-pair detector found 4 false positives, missed the 1 real pair.** The substring-after-`-2026`-strip heuristic in `capture-bucket-c-baseline.ts` returned `content-2026` ↔ `content-marketing-2026`, `video-2026` ↔ `video-ki-2026`, etc. (all sub-cluster relationships, not duplicates). The actual DE/EN duplicate (`code-assistants-2026` ↔ `code-assistenten-2026`) was missed because the words diverge structurally after the common stem. Manual-eye review on the 46-cluster snapshot was the only reliable detector.

4. **Discovery: 3 of the 4 "Misfit"-Pillars are NOT misfits.** Initial pre-implementation analysis flagged `ki-regulierte-branchen-2026`, `ki-sicherheit-datenschutz-2026`, `rag-context-engineering-2026` as cluster-slugs that landed in the pillars table by accident. Pre-cleanup check via `intentTaxonomyOverride IS NOT NULL` revealed they're the ONLY 3 pillars in the project with configured intent overrides — they're spec-conform custom configuration, not drift. Excluded from drop-list.

5. **`practice-use-cases` had 1 attached cluster (`ki-business-2026`).** Required Phase-1 re-point step before DELETE. Other 9 drop-pillars had 0 cluster references — re-point was a no-op for them. The FK `clusters.pillarId.references(contentPillars.id, onDelete: "restrict")` enforces this ordering structurally.

6. **Astro Toolwiki frontend ownership confirmed:** category labels come from `../ki-wissensraum-neu/src/content/categories/blog/comparisons.md` (with `translations.de.label: "Vergleiche"`) via `getCategoryLabel(slug, scope, locale)`. Our DB `content_pillars` is admin-internal taxonomy. No public-site impact from Pillars-Phase cleanup.

7. **Bug fix during BC2.1 smoke-test development:** the cleanup script initially used inline `db.select(...)` calls in the pillar count-loop instead of `database.resolvePillarIdByName` (the DI port). Tests revealed the issue (returned 0 instead of 1 for repoint count); fixed by routing the call through the port. Caught only because the tests existed.

8. **Test-fake "budget" semantics needed re-design.** Initial fake returned per-call counts, but the script calls per-consolidation and sums — so a budget=10 with 8 consolidations returned 80, not 10. Final fix: read-budget that drains per-call (so per-consolidation count sums to budget), separate apply-budget that drains naturally during mutation, optional `drainOnApply` flag that zeroes read-budget too (for idempotency test). Pattern reusable for any future multi-consolidation cleanup script.

9. **Test infrastructure: `__test_fixture_cluster_phase__` sentinel project slug.** Added to both `PILLAR_CONSOLIDATIONS_BY_PROJECT` and `CLUSTER_CONSOLIDATIONS_BY_PROJECT` so cluster-phase smoke tests (which would otherwise have nothing to exercise after Toolwiki's array was emptied) keep working. Comment in the script flags it as test-only. Real production tenants extend the maps with their own slugs.

10. **`articles.tags` is `text[]` not `jsonb`** (already noted in Spec 001 D2) — not directly relevant to Bucket-C but verified during the cluster_key distribution query.

11. **Sister project Spec 001 ORPHAN_BLOG_SLUGS list shares 2 entries with this spec's investigation:** `code-assistenten` + `ai-code-assistants` (blog collection). They're orphan blog rows that Spec 001 will mark `status='superseded'`. After Spec 001 apply + Bucket-C MDX-fix + Re-Import, the cluster_key distribution will naturally clean up to only the 8 active tools rows.

12. **Sister-project Spec 001 `articleStatusEnum` widening with `superseded` (migration 0102) is unrelated to this spec** — Bucket-C doesn't touch `articles.status`.
