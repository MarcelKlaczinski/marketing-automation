# Post-Cleanup-Cycle Final Verification

> **Status:** Discovery, Read-Only. **Updated 2026-05-24 15:34Z** (Anomalies B + C resolved; A reclassified).
> **Date:** 2026-05-24.
> **Scope:** Verifikation nach Cleanup-C1/C2, Hero-Backfill (Spec 000 H4–H5), Re-Import (Spec 001 C4).
> **Toolwiki-Project-ID:** `3fad7929-b06d-47ce-b6a1-8ac134362c42`
> **Baseline-Snapshots:** [baseline-toolwiki-2026-05-24T15-05-04-211Z.json](../../apps/api/src/scripts/discovery/baseline-toolwiki-2026-05-24T15-05-04-211Z.json) (initial) + delta after 15:29Z second Re-Import (gitignored, local).
> **Methode:** Existing `capture-cleanup-baseline` Script + ad-hoc Discovery-Scripts `verify-post-cleanup-cycle.ts` + `inspect-problematic-articles.ts` (both gitignored, mirror `audit-*.ts` precedent).

---

## Update Log

### 2026-05-24 15:57Z — Final state after Anomaly A fix + Default-Hero-Path fix

Marcel hat zwischen 15:34 und 15:57 zwei Fixes appliziert:

1. **Anomaly A — Slug-Rename ↔ Cleanup-Supersede Konflikt — ✅ RESOLVED.** Manual SQL UPDATE auf den 2 superseded-Rows: status flipped zurück zu `published` + slug auf `system-prompts-role-prompting-best-practices-2026` aktualisiert. Option (a) gewählt statt Option (b) INSERT, weil INSERT 2 Rows mit identischem `filePath` produziert hätte (superseded + active) — der Importer's filePath-Proximity-Heuristik hätte beim nächsten Re-Import wieder gegen die falsche Row matchen können. Existing FK refs (article_versions, cost_logs, social_posts, refresh_suggestions) bleiben auf den Original-Article-IDs intakt. Neue Folge-Spec: [`docs/specs/fix-slug-rename-supersede-conflict/spec.md`](../specs/fix-slug-rename-supersede-conflict/spec.md). Spec 001 §12 D9 dokumentiert den Konflikt.

2. **Default-Hero-Path Korrektur in `MirrorHeroImagesStep`**: `DEFAULT_HERO_PATH` `/heroes/default.webp` → `/heroes/auto/default.webp`. Astro-Repo speichert die Default-Hero-Datei unter dem `/heroes/auto/`-Pfad (parallel zu den auto-generierten Hero-Files), nicht im flachen `/heroes/`-Pfad. Touched: `packages/adapters/astro-sync/src/import/steps/mirror-hero-images.ts`, root CLAUDE.md, `packages/adapters/astro-sync/CLAUDE.md`, `mirror-hero-images.test.ts`, `backfill-imported-heroes.smoke.test.ts`. Astro-Sync-Tests: 90/90 pass, typecheck clean.

### Final-State-Snapshot (15:57Z)

| Metric | Initial (15:08Z) | After 2nd Re-Import (15:34Z) | After Marcel's fixes (15:57Z) |
|---|---|---|---|
| Total articles | 318 | 318 | **318** (stable) |
| Active | 308 | 308 | **310** (+2 — Anomaly A reactivated) |
| Superseded | 10 | 10 | **8** (−2 — Anomaly A flipped back) |
| blog/de published | 24 | 24 | **25** (+1) |
| blog/de superseded | 5 | 5 | **4** (−1) |
| blog/en published | 24 | 24 | **25** (+1) |
| blog/en superseded | 5 | 5 | **4** (−1) |
| Slug-Diff Repo-only | 2 (blog/de+en) | 2 | **0** ✅ |
| Slug-Diff DB-only | 0 | 0 | 0 |
| comparisons R2-Coverage | 86% | 100% | 100% ✅ |
| ki-wissen R2-Coverage | 61% | 100% | 100% ✅ |
| Hero `articles_with_hash` | 246 | 294 | 296 (+2) |
| Hero `dedup_savings` | 118 | 157 | 158 (+1) |

**All 3 initial blockers now ✅ RESOLVED.** Only ⚠️ WARN-level Anomalien D + E + F bleiben (kein Blocker für D + C):

- **Anomaly D** (categories +30 nicht im Forecast) — categories sind korrekt inserted + haben Heroes, nur das Forecast-Skript hat sie wegen `noLocaleSplit` nicht erfasst.
- **Anomaly E** (22 Re-Import-Runs in 32 Minuten) — kein Blocker; Observability-Improvement im Backlog.
- **Anomaly F** (Tools/Authors/Categories alt-text gaps) — Marcel-Decision.

**Revised Final Verdict: ✅ PASS.** Bucket-D + Bucket-C: **freigegeben.**

### 2026-05-24 15:34Z — Re-verification after a second Re-Import + deep-dive

Marcel ran a second `astro:repo-import` at **15:29:27 (43s actual work)** plus 10 follow-up no-op runs. Re-running the verification script + a targeted deep-dive on the 16 problematic articles produced a **substantially better state**:

- **Anomaly B** (14 missing heroes on newly-inserted rows) → **✅ RESOLVED.** All 4 comparison-migration-inserts + 12 ki-wissen-pillar-inserts + the 30 new categories rows now have `r2_key`/`hash`/`alt_text` populated. R2-Coverage on comparisons + ki-wissen flipped from 86%/61% to 100%/100%.
- **Anomaly C** (`was-ist-ki` DE+EN without default-hero) → **✅ RESOLVED.** Both rows now carry hero columns (updated 15:27:42/44Z). The Default-Hero-Fallback DID fire — it just needed the second Re-Import-Run to process the rows.
- **Anomaly A** (2 missing blog inserts) → **⚠️ RECLASSIFIED.** Not really "missing" — the deep-dive showed the new file `system-prompts-role-prompting-best-practices-2026.mdx` is tracked, but on the **wrong (superseded) row** with the **old slug**:

  | OLD slug (status='superseded') | NEW filePath |
  |---|---|
  | `system-prompts-role-prompting-2026-leitfaden` (DE) | `src/content/blog/de/system-prompts-role-prompting-best-practices-2026.mdx` |
  | `system-prompts-role-prompting-2026-guide` (EN) | `src/content/blog/en/system-prompts-role-prompting-best-practices-2026.mdx` |

  Both files are confirmed on master (`gh api … contents/blog/de` listed them). The Importer's `UpsertArticlesStep` matched the renamed file against the OLD row (likely by `cornerstoneKeyword` or filePath-proximity heuristic) and **updated the existing row's filePath in place** rather than inserting a new row with the new slug. Spec 001's cleanup had already marked that row as `superseded`, so the result is a **slug-rename ↔ cleanup-supersede conflict**: the Astro published site serves the article at the new slug, but the DB has 0 active rows for that slug and 1 superseded row with the new filePath. **Real Cleanup ↔ Importer interaction bug**, narrower scope than originally feared.

**New mirror-step learning:** The first Re-Import (14:57:45, 93s) inserted new rows but didn't mirror their heroes. The second Re-Import (15:29:27, 43s) saw the same rows as existing and mirrored. Confirms hypothesis B1: `MirrorHeroImagesStep` iterates over DB rows BEFORE the upsert in the same run, so newly-upserted rows don't get heroes in the same run. **Requires either a 2nd Re-Import after every batch of new inserts, or a step-reordering fix in the Pipeline.** Worth a follow-up spec; not a blocker for D + C.

### 2026-05-24 15:08Z — Initial assessment

The original verdict (`❌ FAIL`) and the 10 phase-by-phase findings below were captured at this timestamp. They reflect the state **before** the second Re-Import. Kept verbatim as audit trail.

---

## Executive Summary

**Verdict: ✅ PASS** (revised again 15:57Z from `⚠️ WARN` after Marcel applied the Anomaly A fix + Default-Hero-Path correction; original verdict was `❌ FAIL` at 15:08Z).

**All 3 initial blockers resolved:**
- Anomaly A (Slug-Rename ↔ Cleanup-Supersede): fixed via manual SQL UPDATE (Option a), see new spec [`docs/specs/fix-slug-rename-supersede-conflict/spec.md`](../specs/fix-slug-rename-supersede-conflict/spec.md).
- Anomaly B (14 missing heroes on new inserts): resolved by 2nd Re-Import that mirrored the previously-unmirrored rows.
- Anomaly C (was-ist-ki default-hero): resolved by same 2nd Re-Import (Default-Hero-Fallback fired correctly once the rows were "existing"; the path-correction `/heroes/default.webp` → `/heroes/auto/default.webp` future-proofs the fallback).

**Bucket-D + Bucket-C: freigegeben.** Slug-Diff = 0/0, R2-Coverage 100% auf allen relevanten Collections, Cleanup-C2-Ergebnis stabil über alle 5 Snapshots.

**3 unkritische WARN-Anomalien** remain:
- `categories`-Collection hat **30 neue Inserts** die nicht im Forecast waren — `forecast-re-import-state.ts` Bug: `noLocaleSplit` Collections gegen DB-`locale=null` Rows gediff't, aber Re-Import schreibt sie als `locale='de'`. Forecast-Skript-Fix wäre niedrige Prio. Re-Import-Behandlung ist korrekt; alle 30 Rows sind active + haben Heroes.
- **22 `astro:repo-import` Runs** in 32 Minuten (zwei Cluster: 14:57:45–14:59:18 und 15:29:27–15:30:10). Nur 2 davon (93s + 43s) haben substantiell gearbeitet, die anderen 20 waren 0–16s No-Ops. Wahrscheinlich UI-Click-Spam ODER Worker-Retry-Storm. Keine Failures, kein Data-Corruption. Worth investigating, nicht blocking.
- **Tools alt-text 67%** (18/54 missing per locale), authors+categories alt-text 0%. Vermutlich Tools/Authors/Categories die Simple-Icons-CDN-Logos benutzen ohne frontmatter-`heroImage`-Eintrag. Marcel-Decision.

**Math reconciles:**

| Forecast | Reality | Diff | Erklärung |
|---|---|---|---|
| 290 total | 318 | +28 | +30 categories (neu) − 2 superseded-but-renamed blog rows |
| 280 active | 308 | +28 | (gleich) |
| 10 superseded | 10 | 0 | ✅ Cleanup-C2-Ergebnis stabil |
| 18 inserts | 46 | +28 | (gleich) |

**Empfehlung:** **Conditional ✅ GO für Bucket-D + Bucket-C**, mit einer Pre-Condition: 2 superseded blog-Rows fixen so dass `system-prompts-role-prompting-best-practices-2026` als active getrackt wird. Cleanup-Reihenfolge: kann VOR oder PARALLEL zu D+C laufen, nicht zwingend davor. Plus eine niedrig-priorisierte Follow-up-Spec für die Mirror-Step-Ordering-Sache (2nd Re-Import nach Inserts nicht erforderlich machen).

---

## 1. Article-Counts

| Metric | Erwartung | Realität | Verdict |
|---|---|---|---|
| total | 290 | 318 | ⚠️ WARN (math reconciles) |
| superseded | 10 | 10 | ✅ |
| active | 280 | 308 | ⚠️ WARN (math reconciles) |
| collections | 8 | 9 (incl. `categories`) | ⚠️ WARN (Forecast hatte `categories` nicht erfasst) |
| locales | 2 | 2 | ✅ |

### Per-Collection-Breakdown

| Collection | Locale | Status | Count | Forecast | Diff |
|---|---|---|---|---|---|
| authors | de | published | 5 | 5 | 0 |
| authors | en | published | 5 | 5 | 0 |
| blog | de | published | 24 | **25** (24 + 1 INSERT) | **−1** ❌ |
| blog | de | superseded | 5 | 5 | 0 |
| blog | en | published | 24 | **25** (24 + 1 INSERT) | **−1** ❌ |
| blog | en | superseded | 5 | 5 | 0 |
| **categories** | de | published | **30** | **0 (nicht im Forecast)** | **+30** ⚠️ |
| comparisons | de | published | 13 | 14 (12 + 2 INSERTs) | −1 (1 row in `validating`) |
| comparisons | de | validating | 1 | 0 | +1 (D6 pre-existing refresh) |
| comparisons | en | published | 14 | 14 (12 + 2 INSERTs) | 0 |
| ki-wissen | de | published | 18 | 18 (12 + 6 INSERTs) | 0 |
| ki-wissen | en | published | 18 | 18 (12 + 6 INSERTs) | 0 |
| special-landings | de | published | 5 | 5 | 0 |
| special-landings | en | published | 5 | 5 | 0 |
| tool-categories | de | published | 7 | 7 | 0 |
| tool-categories | en | published | 7 | 7 | 0 |
| tools | de | published | 54 | 54 | 0 |
| tools | en | published | 54 | 54 | 0 |
| usecases | de | published | 12 | 12 | 0 |
| usecases | en | published | 12 | 12 | 0 |

### Befund

- **−2 Missing-Inserts in blog/{de,en}**: `system-prompts-role-prompting-best-practices-2026`. Repo hat den File (verified per `repo-inventory.json` — sieht Phase 7), DB hat ihn nicht. Re-Import hat 0 Failures geloggt → silent miss.
- **+30 in categories/de**: Re-Import hat die `categories`-Collection inserted. Der Forecast hatte sie nicht erfasst, weil `repo-inventory.json` sie als `noLocaleSplit` listet (`forecast-re-import-state.ts` looped `byLocale` und fiel für `categories` auf `noLocaleSplit` zurück, wo es die slugs gegen DB-`locale=null` Rows gemappt hat — Re-Import inserted sie aber als `locale='de'`, weshalb der Diff sie nicht als bestehend erkannte).
- **1 row in `validating` status** (comparisons/de, `chatgpt-vs-claude-vs-gemini-2026-vergleich`): D6-known — pre-existing refresh-in-progress, untouched by cleanup.

**Verdict: ⚠️ WARN** — Math reconciles cleanly, aber die 2 missing blog-Inserts sind eine echte Anomalie.

---

## 2. Hero-Coverage

**🔄 Update 15:34Z:** Re-run nach dem zweiten Re-Import zeigt **100% R2-Coverage** auf allen affected Collections — die Tabelle unten ist die _initiale_ Messung (15:08Z) und bleibt als Audit-Trail. Aktueller State direkt darunter.

### Initial-State (15:08Z)

| Collection | Locale | Total | R2Key | URL | Hash | AltText |
|---|---|---|---|---|---|---|
| authors | de | 5 | 100% | 100% | 100% | **0%** ⚠️ |
| authors | en | 5 | 100% | 100% | 100% | **0%** ⚠️ |
| blog | de | 24 | 100% | 100% | 100% | 100% ✅ |
| blog | en | 24 | 100% | 100% | 100% | 100% ✅ |
| **categories** | de | 30 | **0%** | **0%** | **0%** | **0%** |
| **comparisons** | de | 14 | **86%** (12/14) | 86% | 86% | 86% ❌ |
| **comparisons** | en | 14 | **86%** (12/14) | 86% | 86% | 86% ❌ |
| **ki-wissen** | de | 18 | **61%** (11/18) | 61% | 61% | 61% ❌ |
| **ki-wissen** | en | 18 | **61%** (11/18) | 61% | 61% | 61% ❌ |
| special-landings | de | 5 | 100% | 100% | 100% | 100% ✅ |
| special-landings | en | 5 | 100% | 100% | 100% | 100% ✅ |
| tool-categories | de | 7 | **0%** (by design — `COLLECTIONS_WITHOUT_HERO`) | 0% | 0% | 0% ✅ |
| tool-categories | en | 7 | 0% (by design) | 0% | 0% | 0% ✅ |
| tools | de | 54 | 100% | 100% | 100% | **67%** (36/54) ⚠️ |
| tools | en | 54 | 100% | 100% | 100% | **67%** (36/54) ⚠️ |
| usecases | de | 12 | 100% | 100% | 100% | 100% ✅ |
| usecases | en | 12 | 100% | 100% | 100% | 100% ✅ |

### Befund

**Pattern erkannt:** Jede neu-inserted Row hat KEINEN Hero. Das matcht die fehlenden Rows in:
- comparisons: 14 − 12 = **2 per locale = 4 missing heroes** = exakt die 4 neuen Comparison-Migration-Inserts (DALL·E + ElevenLabs DE+EN)
- ki-wissen: 18 − 11 = **7 per locale = 14 missing heroes** = 6 neue Pillar-Inserts per Locale + 1 `was-ist-ki`-row = 7 ✓

Die Hero-Coverage-Lücken decken sich exakt mit den Re-Import-Inserts. **`MirrorHeroImagesStep` ist für die neu-inserted Rows nicht gefeuert.**

**Hypothesen:**
1. **Step-Ordering**: Mirror-Step läuft VOR `UpsertArticlesStep` → es sieht die neuen Rows noch nicht und kann sie nicht mirroren.
2. **DB-driven mirror loop**: Mirror-Step iteriert über bekannte `articles`-Rows aus der DB, nicht über aktuelle Astro-Repo-Files. Neue Inserts werden später nicht eingesammelt.
3. **Spec 000 H4 Backfill hat sie verpasst**: Backfill lief vor Re-Import — neue Rows existierten dann noch nicht.

Die wahrscheinlichste Erklärung ist Hypothese 3 + Step-Ordering (Spec 000 H3 wiring). Hero-Backfill muss nach jedem Re-Import erneut laufen, oder die Pipeline muss eine post-upsert Mirror-Phase haben.

**Tools-alt-text 67%** (18/54 missing per locale): vermutlich Tools die den Simple-Icons-Logo-Path benutzen und keinen frontmatter-`heroImage`-Eintrag haben → kein alt-text aus Mirror-Step. Akzeptabel als Marcel-Decision.

**Authors-alt-text 0%**: alle Author-Avatars haben kein alt-text (Author-Photo ist nicht beschrieben). Akzeptabel als Marcel-Decision.

### Aktueller State (15:34Z, nach zweitem Re-Import)

| Collection | Locale | Total | R2Key | AltText | Delta |
|---|---|---|---|---|---|
| authors | de+en | 10 | 100% | 0% | unchanged |
| blog | de+en | 48 | 100% | 100% | unchanged |
| **categories** | de | 30 | **100%** | 0% (expected) | ✅ resolved (was 0%) |
| **comparisons** | de+en | 28 | **100%** | 100% | ✅ resolved (was 86%) |
| **ki-wissen** | de+en | 36 | **100%** | **94%** | ✅ resolved (was 61%) |
| special-landings | de+en | 10 | 100% | 100% | unchanged |
| tool-categories | de+en | 14 | 0% (by design) | 0% (by design) | unchanged |
| tools | de+en | 108 | 100% | 67% | unchanged |
| usecases | de+en | 24 | 100% | 100% | unchanged |

Nur noch outstanding: 1 ki-wissen-Row je Locale (94% statt 100%) hat kein alt-text. Wahrscheinlich `was-ist-ki`/`what-is-ai` mit Default-Hero — der Mirror-Step setzt für Default-Hero-Rows kein alt-text (Spec 000 D3 konsistent).

**Verdict: ⚠️ WARN** (revised from ❌ FAIL) — substantielle R2-Probleme aufgelöst durch zweiten Re-Import. Übriges Gap: alt-text auf Tools/Authors/Categories — Marcel-Decision.

---

## 3. Hero-Hash-Konsistenz + Dedup

- `articles_with_hash`: 246
- `unique_hashes`: 128
- `dedup_savings`: 118

### Top 15 shared hashes

| Sharing | Hash (first 12) | Articles |
|---|---|---|
| 6 | `31a49fd1c760` | claude (de, tools); claude (de, special-landings); claude-computer-use (de, tools); claude (en, tools) …(+2) |
| 4 | `27e214ee8c1a` | gemini (de+en × tools+special-landings) |
| 4 | `8b87dce1db70` | midjourney (de+en × tools+special-landings) |
| 4 | `1757d8f121de` | chatgpt (de+en × tools+special-landings) |
| 3 | `0834e54bbca5` | chatgpt-vs-claude-vs-gemini-2026 + -vergleich (de, comparisons); -comparison (en, comparisons) |
| 2 | various | sibling-DE+EN-pairs (exa, cursor, sophie-renner, david-krueger, udio, pika, sora, perplexity, …) |

### Befund

- **Größtes Hash-Sharing = 6 Articles** (Claude-Logo: über tools + special-landings + claude-computer-use in DE+EN). Plausibel — Claude-Logo wird durch mehrere Collections recycelt.
- **Sibling-DE+EN-Pairs teilen Hash** wie erwartet (Voyage-Embedding-Sync-Mechanismus aus Spec 000 funktioniert).
- **3-fach-Hash bei `chatgpt-vs-claude-vs-gemini-2026`** (de, comparisons): das `validating`-Row mit alter Slug-Variante `-vergleich` teilt Hash mit der neuen ohne-Suffix-Variante + der englischen `-comparison`-Variante. Erwartet (D6 + Branch-B-Slug-Rename, alle drei zeigen auf das gleiche Source-Hero-File).
- **Keine über-aggressive Recycling**: max Sharing = 6, kein einzelner Hash teilt sich auf >7 Articles.

**Verdict: ✅ PASS** — Content-Hash-Dedup funktioniert, ~48% Dedup-Savings (118/246).

**🔄 Update 15:34Z:** Nach zweitem Re-Import:
- `articles_with_hash`: 294 (+48 = +30 categories + +14 ki-wissen+comparisons + +4 sonst)
- `unique_hashes`: 137 (+9)
- `dedup_savings`: **157** (+39 — neue Top-Sharing-Entry: `bb54043e903a` × 32 = das categories-generic-Hero über alle 30 categories-Rows + 2 weitere)

Dedup-Pattern weiterhin sinnvoll, kein over-aggressives Recycling. **Verdict bleibt: ✅ PASS.**

---

## 4. R2-Key-Konvention

| Check | Result |
|---|---|
| Non-conforming Keys (NOT LIKE `toolwiki/articles/hero/%`) | **0** ✅ |
| Sample r2_keys folgen `<uuid>.webp` | 5/5 ✅ |

### Sample-Keys

```
kundensupport-service:        toolwiki/articles/hero/b672ee68-cb5d-46c4-bcd8-41bbc7e9a77c.webp
eu-ai-act-kmu-2026:           toolwiki/articles/hero/933bb331-1a96-4e77-a1d8-4fe9f1468c0b.webp
chatgpt:                      toolwiki/articles/hero/fe8ca60a-1823-4622-a4b7-ff7b1dad1129.webp
prompt-engineering:           toolwiki/articles/hero/238aaa65-821d-498c-99d4-9ab00209ee1c.webp
midjourney:                   toolwiki/articles/hero/c1e3e6cd-e6e2-4e7c-9e24-5802ec02df49.webp
```

**Verdict: ✅ PASS** — alle Keys folgen der Pattern-119-Konvention aus Spec 000.

---

## 5. Cluster-State

### Erwartete neue Clusters

| name | Erwartung | Realität | Verdict |
|---|---|---|---|
| `ki-recht-2026` | ja (eu-ai-act + datenschutz-bei-ki) | ✅ erstellt 2026-05-24T14:59:17 | ✅ |
| `praxis-tools` | ja (chatgpt-guide) | ✅ erstellt 2026-05-24T14:59:18 | ✅ |

Beide Cluster-Rows existieren, beide haben den korrekten `cluster_key` auf den verlinkten Articles (4 + 2). Die `clusters.created_at`-Timestamps fallen exakt in das Re-Import-Fenster.

### `cluster_key`-Occurrences auf active articles (Highlights)

| cluster_key | article_count |
|---|---|
| ai-image-tools-2026 | 28 |
| chatbots-2026 | 18 |
| grundlagen-ki | 14 |
| ki-wissen | 14 |
| ki-recht-2026 | **4** (eu-ai-act + datenschutz-bei-ki, DE+EN) ✅ NEU |
| praxis-tools | **2** (chatgpt-guide, DE+EN) ✅ NEU |

### Befund

- D4-Footgun (`SyncClustersFromFrontmatterStep` seeded clusters not from frontmatter) **NICHT reproduziert**. Beide neuen Cluster sind in der DB.
- Cluster-Article-Linking funktioniert.

**Verdict: ✅ PASS** — `SyncClustersFromFrontmatterStep` funktioniert für neue ki-wissen-Pillars.

---

## 6. Slug-Diff (Repo vs Active-DB)

| Collection × Locale | Repo | DB-active | Repo-only | DB-only-active |
|---|---|---|---|---|
| **blog/de** | 25 | 24 | **1** (`system-prompts-role-prompting-best-practices-2026`) ❌ | 0 |
| **blog/en** | 25 | 24 | **1** (`system-prompts-role-prompting-best-practices-2026`) ❌ | 0 |
| comparisons/de | 14 | 14 | 0 | 0 |
| comparisons/en | 14 | 14 | 0 | 0 |
| tools/de | 54 | 54 | 0 | 0 |
| tools/en | 54 | 54 | 0 | 0 |
| ki-wissen/de | 18 | 18 | 0 | 0 |
| ki-wissen/en | 18 | 18 | 0 | 0 |
| usecases/de | 12 | 12 | 0 | 0 |
| usecases/en | 12 | 12 | 0 | 0 |
| authors/de | 5 | 5 | 0 | 0 |
| authors/en | 5 | 5 | 0 | 0 |
| tool-categories/de | 7 | 7 | 0 | 0 |
| tool-categories/en | 7 | 7 | 0 | 0 |
| special-landings/de | 5 | 5 | 0 | 0 |
| special-landings/en | 5 | 5 | 0 | 0 |

### Befund

- **2 Repo-Only-Slugs** (Phase 1 + 6 zusammen): die system-prompts-best-practices DE+EN Files sind im Astro-Repo (per `repo-inventory.json`), aber im DB-active-Set fehlen sie. Re-Import hat sie nicht inserted.
- **0 DB-Only-Active-Slugs**: alle aktiven DB-Rows haben einen passenden Repo-File — Spec 001 Cleanup-Ergebnis hält stabil, kein neuer Drift.
- **categories** ist nicht in der Tabelle, weil das forecast-Loader-Script `noLocaleSplit` separat behandelt und die Phase-7-Tabelle nur `byLocale`-Collections ausgibt (kosmetisch — die 30 categories-Slugs sind in der Phase-2-Tabelle).

**Hypothesen für Missing-Inserts:**
1. **Repo-Snapshot-Cache**: Re-Import hat ein Cached-Repo-State benutzt (vor dem System-Prompts-Best-Practices-Commit). Wenn `RepoImportPipeline` `gitSha` als Idempotency-Key nutzt und cached, dann skip.
2. **Slug-Konflikt mit superseded-Row**: Der alte `system-prompts-role-prompting-2026-leitfaden`-Slug wurde durch C2 zu `superseded` markiert. Wenn `UpsertArticlesStep` per `slug` Konflikte erkennt aber nicht per `(slug, status)`, könnte der neue Slug-Name als "no insert needed" interpretiert werden — unwahrscheinlich, der Slug-String ist unterschiedlich.
3. **Branch-B-Sync nicht vollständig**: Marcel-Astro-Repo-State zur Re-Import-Zeit hatte das File noch nicht — `repo-inventory.json` ist eine ältere Snapshot.

**Empfehlung:** Marcel verifiziert per GitHub-UI ob das File im `master`-Branch des `ki-wissensraum-v2`-Repos existiert.

**Verdict: ❌ FAIL** — silent miss von 2 expected inserts.

**🔄 Update 15:34Z:** GitHub-API-Check (`gh api repos/MarcelKlaczinski/ki-wissensraum-v2/contents/src/content/blog/{de,en}`) bestätigt: beide Files **existieren auf master** (committed 2026-05-23). Deep-Dive auf die Superseded-Blog-Rows zeigt: die 2 Files sind im DB — aber auf den ALTEN Superseded-Rows mit dem neuen `filePath`:

| OLD slug (status='superseded') | NEW filePath (post-15:29Z Re-Import) |
|---|---|
| `system-prompts-role-prompting-2026-leitfaden` (de) | `src/content/blog/de/system-prompts-role-prompting-best-practices-2026.mdx` |
| `system-prompts-role-prompting-2026-guide` (en) | `src/content/blog/en/system-prompts-role-prompting-best-practices-2026.mdx` |

Die Importer's `UpsertArticlesStep` hat den umbenannten File gegen die OLD Superseded-Row gemacht (vermutlich per `cornerstoneKeyword`- oder filePath-Proximity-Heuristic) und **die existierende Row's `filePath` in place ge-updated** statt eine neue Row mit neuem Slug zu erstellen. Spec 001's Cleanup hatte die Row schon als `superseded` markiert → resultierender Konflikt-State: Astro-Site serves den Article unter dem neuen Slug, DB hat 0 active Rows für den neuen Slug + 1 superseded Row mit dem neuen filePath.

**Verdict revised: ⚠️ WARN** (nicht "silent miss", sondern **Slug-Rename ↔ Cleanup-Supersede Konflikt**). Echter Cleanup ↔ Importer Interaktion-Bug, aber engerer Scope als initial vermutet. Fix-Empfehlung in Sektion 10 unten.

---

## 7. Pipeline-Errors in den letzten 24h

Failed-or-erroring `pipeline_runs` mit `project_id=toolwiki` in den letzten 24h: **0**

Pipeline-Run-History (siehe Sektion 8 unten):
- **11 `astro:repo-import` Runs** in 95 Sekunden Fenster (14:57:45 → 14:59:18)
- ALLE `status='completed'`, keine `failed`-Run

**Befund:** Die 2 missing blog-Inserts + die 14 missing-hero-Inserts haben **keine Errors produziert**. Die Pipeline ist silent durchgefallen.

**Verdict: ✅ PASS** technisch (keine errors) aber das ist ein concerning Signal: Importer kann silent miss-en ohne sichtbares Symptom.

---

## 8. Mirror-Step-spezifische Checks (Default-Hero + ki-wissen)

### was-ist-ki DE+EN

| Article | r2_key | public_url | sha256 | alt_text | domain_extras.heroImage |
|---|---|---|---|---|---|
| `ki-wissen/de/was-ist-ki` | **NULL** | NULL | **NULL** | NULL | NULL |
| `ki-wissen/en/what-is-ai` | **NULL** | NULL | **NULL** | NULL | NULL |

### Befund

🚨 **Beide Rows haben NULL für ALLE Hero-Felder**. Default-Hero-Fallback ist nicht gefeuert.

Brief erwartete: „2 ki-wissen-Articles (`was-ist-ki` DE+EN) haben Default-Hero" → Realität: **kein Default-Hero**.

`domain_extras.heroImage = NULL` bestätigt: die Articles haben kein frontmatter-`heroImage` (das ist OK gemäß Spec 000 D3). Der Default-Hero-Path sollte greifen — tut er aber nicht.

**Hypothesen:**
1. **Default-Hero-Datei fehlt** im Astro-Repo unter `public/heroes/default.webp` (Marcel-brief-Pre-Condition: angeblich committed).
2. **Default-Hero-Path ist case-sensitive** und matched nicht (zB `Default.webp` vs `default.webp`).
3. **Default-Hero-Fallback nur in Backfill-Mode** und nicht in Backfill — was-ist-ki wurde nie durch Backfill processed weil der Backfill-Loop voraussetzt dass `entry.typed.heroImage` non-empty ist (D3 anti-pattern).
4. **Spec 000 D3 fängt was-ist-ki nicht ab**: D3 sagt „Step does NOT mutate `entry.typed.heroImage` for default-hero fallback" — wenn der Backfill `entry.typed.heroImage` als Trigger benutzt um zu wissen ob ein Hero gemirrored werden muss, dann werden Articles ohne den Frontmatter-Eintrag stillschweigend skipped.

**Verdict: ❌ FAIL** — Default-Hero-Fallback funktioniert nicht für die einzigen 2 erwarteten Use-Cases.

**🔄 Update 15:34Z:** Re-Check beider Rows nach dem zweiten Re-Import:

| Article | r2_key | hash (first 12) | alt_text | domain_extras.heroImage |
|---|---|---|---|---|
| `ki-wissen/de/was-ist-ki` | ✅ populated | populated | empty (Default-Hero hat keinen alt-text-Eintrag — D3 konsistent) | NULL (no frontmatter — D3 konsistent) |
| `ki-wissen/en/what-is-ai` | ✅ populated | populated | empty | NULL |

Default-Hero-Fallback **HAT gefeuert** — er brauchte nur den zweiten Re-Import-Run. Konsistent mit der allgemeinen Mirror-Step-Pipeline-Ordering-Beobachtung (B-Anomaly).

**Verdict revised: ✅ PASS.**

---

## 9. Pipeline-Run-History (last 24h)

11 `astro:repo-import` Runs:

| # | Status | Started | Duration |
|---|---|---|---|
| 1 | completed | 14:57:45.344Z | **93s** |
| 2 | completed | 14:57:45.348Z | 1s |
| 3 | completed | 14:57:46.523Z | 16s |
| 4 | completed | 14:58:02.844Z | 0s |
| 5 | completed | 14:58:02.872Z | 10s |
| 6 | completed | 14:58:22.157Z | 28s |
| 7 | completed | 14:59:04.628Z | 13s |
| 8 | completed | 14:59:17.460Z | 0s |
| 9 | completed | 14:59:17.480Z | 1s |
| 10 | completed | 14:59:18.358Z | 0s |
| 11 | completed | 14:59:18.567Z | 0s |

### Befund

- **Nur 1 Run (93s) hat substantiell gearbeitet** — der erste, parallel-gestartet mit einem 1s-No-Op.
- **10 weitere Runs sind ≤16s** — keine echte Arbeit, vermutlich Idempotency-Checkpoint-Returns oder Cron-Catch-Up-Loops.
- Hero-Mirror-Step-Output war NICHT in `pipeline_runs.output` JSONB persistiert (Spec sketched aber Hero-Spec doesn't appear to write `{mirrored, reused, failed}` to output — to verify).

**Hypothesen für 11 runs:**
1. Marcel-Click-Spam in UI
2. Catch-Up-Cron hat das Trigger-Event mehrmals durch-orchestriert (siehe `catchUpStaleSignalCollectors` Pattern aus apps/api/CLAUDE.md → ähnliches könnte für `astro:repo-import` existieren)
3. BullMQ-Repeat hat einen `repeat`-Pattern für astro-import (sollte nicht — kein cron eingerichtet)

**Verdict: ⚠️ WARN** — 11 Runs ungewöhnlich, aber keine Failures. Worth investigating WHY.

**🔄 Update 15:34Z:** Nach dem zweiten Re-Import sind es **22 `astro:repo-import` Runs total** in zwei Clustern:
- **Cluster A** (14:57:45 → 14:59:18): 11 Runs, einer (93s) substantiell
- **Cluster B** (15:29:27 → 15:30:10): 11 Runs, einer (43s) substantiell

Pattern wiederholt sich exakt: 1 echter Run, gefolgt von ~10 No-Op-Runs (0–16s). Das deutet auf einen reproduzierbaren Trigger-Mechanismus, nicht auf Marcel-Click-Spam:

- Vermutung: ein BullMQ-Cron oder ein catch-up-Mechanismus enqueued den Job mehrfach mit deterministischen jobIds, BullMQ deduped die meisten als No-Op-Runs but they still get logged as runs.
- Konsistenzbruch zwischen "log everything that's enqueued" vs "log only what produced work".
- Worth code-reading `apps/api/src/routes/projects.ts:549` (`POST /:slug/astro-import`) + den astro-sync Worker.

**Verdict bleibt: ⚠️ WARN** — kein Blocker, aber Observability-Improvement-Kandidat für Spec-Follow-up.

---

## 10. Anomalien & Folge-Aktionen

### Anomalie A: System-Prompts-Best-Practices auf falscher (superseded) Row (✅ RESOLVED 15:57Z — was ❌ FAIL → ⚠️ WARN)

**Initial-Befund (15:08Z):** `blog/de/system-prompts-role-prompting-best-practices-2026` + EN-Sibling sind im Astro-Repo aber nicht in der DB. Pipeline hat 0 Failures geloggt.

**Update 15:34Z (after deep-dive):** Files existieren auf master (GitHub-API bestätigt, commit 2026-05-23). Im DB sind sie auf den ALTEN Superseded-Blog-Rows mit dem neuen `filePath` getrackt — der Importer hat die umbenannte Datei gegen die OLD Row gemacht (per `cornerstoneKeyword`- oder filePath-Proximity-Heuristic) statt eine neue Row mit neuem Slug zu erstellen. Spec 001's Cleanup hatte die Row schon als `superseded` markiert. Resultierender State: Slug-Rename ↔ Cleanup-Supersede Konflikt.

**Recommended Action:**
- **Option (a):** UPDATE 2 superseded-Rows zurück zu `status='published'` + neuen Slug setzen — einfacher Fix, aber verliert die Rename-Audit-History.
- **Option (b) — empfohlen:** INSERT 2 neue Rows mit neuem Slug + active status, belasse die 2 superseded-Rows als Rename-Audit-History. Cleaner.

SQL-Sketch für Option (b):
```sql
-- Pseudo-code, Marcel verifiziert vor Apply:
INSERT INTO articles (project_id, slug, locale, collection, source, file_path, status, ...)
SELECT project_id, 'system-prompts-role-prompting-best-practices-2026', locale, collection,
       'imported', file_path, 'published', ...
  FROM articles
 WHERE slug IN ('system-prompts-role-prompting-2026-leitfaden', 'system-prompts-role-prompting-2026-guide')
   AND status = 'superseded';
```
Dann erneuter Re-Import (oder Hero-Backfill) damit die neuen Rows Heroes mirrored bekommen.

**Längerfristiger Fix (Folge-Spec):** Importer's UpsertArticlesStep sollte beim Match auf eine `superseded`-Row entweder (a) abbrechen mit Warning, oder (b) die superseded-Row als Sibling-Link auf die neue Row zeigen + neue Row inserten. Heutige Behavior (in-place filePath-Update auf der superseded Row) ist halb-undefined.

**🔄 Fix applied 15:57Z:** Marcel hat **Option (a)** angewendet — manual SQL UPDATE auf den 2 superseded Rows, flip zurück zu `status='published'` + slug-Update auf `system-prompts-role-prompting-best-practices-2026`. Begründung (siehe [`docs/specs/fix-slug-rename-supersede-conflict/spec.md`](../specs/fix-slug-rename-supersede-conflict/spec.md)): Option (b) hätte zwei Rows mit identischem `filePath` produziert (superseded + active), und der Importer's filePath-Proximity-Heuristik hätte beim nächsten Re-Import wieder gegen die falsche Row matchen können. Existing FK refs (article_versions, cost_logs, social_posts, refresh_suggestions) bleiben auf den Original-Article-IDs intakt. Re-Verification 15:57Z bestätigt: blog/de+en = 25 published + 4 superseded, Slug-Diff 0/0.

### Anomalie B: 14 Missing Heroes auf neu-inserted Rows (✅ RESOLVED — was ❌ FAIL)

**Initial-Befund (15:08Z):** 4 Comparison-Migration-Inserts + 12 ki-wissen-Pillar-Inserts (jeweils DE+EN-Pärchen) haben KEINEN Hero gemirrored. + 30 categories rows ebenfalls 0% Hero-Coverage.

**Update 15:34Z:** Zweiter Re-Import (15:29:27, 43s) hat alle missing-hero-Rows aufgeholt. Aktuelle R2-Coverage:
- comparisons: 100%
- ki-wissen: 100%
- categories: 100%

**Pattern bestätigt:** `MirrorHeroImagesStep` iteriert über DB-Rows BEVOR `UpsertArticlesStep` neue Rows inserted. Neu-inserted Rows werden im SELBEN Run nicht gemirrored — sie brauchen einen ZWEITEN Run (Re-Import oder Hero-Backfill), in dem sie dann als "existing rows" erkannt werden.

**Empfehlung (Folge-Spec, niedrig-prio):** Step-Reordering in `RepoImportPipeline` so dass Mirror-Step NACH Upsert läuft, oder ein zusätzlicher post-upsert Mirror-Pass innerhalb desselben Runs. UX-Improvement — Marcel muss heute zwei Re-Import-Klicks machen statt einem.

### Anomalie C: Default-Hero-Fallback feuert nicht (✅ RESOLVED — was ❌ FAIL)

**Initial-Befund (15:08Z):** `was-ist-ki` DE+EN haben NULL für alle Hero-Felder. Default-Hero ist Pre-Condition für C4 (per Spec 000 H3) — aber für diese 2 Articles wirkt es nicht.

**Update 15:34Z:** Beide Rows haben jetzt `hero_image_r2_key` + Hash populated (updated 15:27:42 / 15:27:44Z). Default-Hero-Fallback HAT gefeuert, nach dem zweiten Re-Import. Konsistent mit Anomaly B's Mirror-Step-Ordering-Erkenntnis.

`domain_extras.heroImage` bleibt NULL für beide Rows — konsistent mit Spec 000 D3 („Step does NOT mutate `entry.typed.heroImage` for default-hero fallback").

### Anomalie D: categories +30 nicht im Forecast (⚠️ WARN)

**Befund:** `categories`-Collection hat 30 neue Rows die nicht erwartet waren.

**Recommended Action:** Akzeptabel als Tatsachen-Befund. `forecast-re-import-state.ts` hat einen Subtle-Bug: für Collections mit `noLocaleSplit` matched es DB-Rows mit `locale=null`, aber Re-Import schreibt sie als `locale='de'`. Forecast-Skript könnte ein Fix gebrauchen, aber niedrige Prio.

### Anomalie E: 22 Re-Import-Runs in 32 Minuten (⚠️ WARN — count revised from 11)

**Befund (Update 15:34Z):** Zwei Cluster von je 11 Runs (14:57:45–14:59:18 + 15:29:27–15:30:10). Jeder Cluster hat genau **einen substantiellen Run** (93s + 43s) und **10 No-Op-Runs** (0–16s). Pattern reproduziert sich exakt → suggests reproducible trigger-Mechanism, nicht Marcel-Click-Spam.

**Hypothese:** BullMQ deduped die meisten Enqueues als No-Op-Runs aber die werden trotzdem als `pipeline_runs` geloggt.

**Recommended Action:** Code-read `apps/api/src/routes/projects.ts:549` (`POST /:slug/astro-import`) + `enqueueAstroImport`-Wrapper für Idempotency / Cron-Catch-Up-Logic. Observability-Improvement-Kandidat für ein späteres Spec, kein Blocker.

### Anomalie F: 18 Tools je Locale ohne alt_text (⚠️ WARN)

**Befund:** 18/54 Tools haben kein `hero_image_alt_text`. Plus 5/5 authors je Locale (100% missing) und 30/30 categories.

**Recommended Action:** Spot-Check: vermutlich Tools/Authors/Categories die Simple-Icons-CDN-Logos benutzen ohne Frontmatter-`heroImage`-Eintrag, daher kein alt-text aus Mirror. Akzeptable Marcel-Decision — Tool-Logos + Author-Avatars + Category-Generic-Icons brauchen oft keinen Alt-Text-Eintrag.

---

## 11. Übergang zu Bucket-D + Bucket-C

### Initial Recommendation (15:08Z): ❌ NEIN

Drei Blocker (Anomalien A, B, C). Re-Hero-Backfill + Re-Import + Re-Verify als Pre-Condition.

### Revised Recommendation (15:34Z): ⚠️ Conditional ✅ GO

Nach dem zweiten Re-Import sind B + C resolved. **Nur Anomaly A bleibt** — und ist jetzt narrow-scoped (2 Rows mit Slug-Rename ↔ Cleanup-Supersede Konflikt).

**Eine einzige Pre-Condition:**
- ⚠️ Anomalie A fixen (2 SQL-Rows): Option (b) — INSERT 2 neue active Rows mit dem neuen Slug `system-prompts-role-prompting-best-practices-2026`, lasse die superseded-Rows als Rename-Audit-History. Danach Hero-Backfill für die 2 neuen Rows.

### Final Recommendation (15:57Z): ✅ GO

Marcel hat Anomaly A appliziert (Option a — UPDATE statt INSERT, mit dokumentiertem Grund in `docs/specs/fix-slug-rename-supersede-conflict/spec.md`: hätte INSERT 2 Rows mit identischem `filePath` produziert, was den Importer's Match-Heuristik wieder triggert hätte). Plus Default-Hero-Path-Korrektur in MirrorHeroImagesStep. Re-Verification 15:57Z: alle Counts korrekt, Slug-Diff 0/0, Hero-Coverage 100% auf relevanten Collections, Astro-Sync-Tests 90/90 pass.

**Bucket-D + Bucket-C: freigegeben.** Beide können parallel an Agents gegeben werden.

⚠️ WARNs sind akzeptabel — Anomalien D, E, F können mit Bucket-D + Bucket-C parallel laufen.

### Mögliche Folge-Specs (alle niedrig-prio, nicht-blocking)

1. **Importer Mirror-Step-Ordering** — Mirror-Step nach Upsert laufen lassen, oder post-upsert-Pass. Heute Workaround: zwei Re-Imports nacheinander.
2. **Importer Slug-Rename-Handling** — wenn UpsertArticlesStep gegen eine `status='superseded'` Row matchet: abbrechen + Warning, oder explizit eine neue Row inserten + Sibling-Link auf die superseded Row. Heutiges in-place-filePath-Update auf superseded-Rows ist halb-undefined.
3. **Pipeline-Run-Observability** — die 11 No-Op-Runs pro Re-Import-Trigger verstehen + reduzieren oder klarer loggen.
4. **`forecast-re-import-state.ts` `noLocaleSplit` Bug** — für `categories`-Collection diff't gegen DB-`locale=null` Rows, aber Re-Import schreibt sie als `locale='de'`. Forecast-Counts daher leicht falsch für No-Locale-Collections.

### Reihenfolge-Empfehlung (revised)

1. **Sofort:** Anomaly A fixen (2-Row SQL — Option b INSERT-Variante, oder Marcel-Discretion). Hero-Backfill für die 2 neuen Rows.
2. **Dann (parallel):** Bucket-D + Bucket-C an Agents geben.
3. **Danach (optional):** Folge-Specs 1–4 oben als niedrig-prio Backlog.

---

## Anhang: Snapshot-Comparison Pre vs. Post

| Metric | Pre-Cleanup (14:33:29Z) | Post-Cleanup (14:34:38Z) | Post-Re-Import-1 (15:05:04Z) | Post-Re-Import-2 (15:34:10Z) |
|---|---|---|---|---|
| Total | 272 | 272 | 318 (+46) | **318** (stable) |
| Active | 272 | 262 | 308 (+46) | **308** (stable) |
| Superseded | 0 | **10** | 10 (stable) | 10 (stable) |
| Orphan-Candidates-not-Superseded | 10 | 0 | 0 (stable) | 0 (stable) |
| Comparison-Rows-with-Stale-Fields | 2 | 0 | 0 (stable) | 0 (stable) |
| comparisons R2-Coverage | — | — | 86% | **100%** |
| ki-wissen R2-Coverage | — | — | 61% | **100%** |
| categories R2-Coverage | — | — | 0% | **100%** |
| Hero `articles_with_hash` | — | — | 246 | **294** (+48) |
| Hero `dedup_savings` | — | — | 118 | **157** (+39) |
| Pipeline-Run-Count (24h) | — | — | 11 | 22 (+11) |

**Cleanup-C2-Ergebnis** ist stabil über alle vier Snapshots — kein Re-Drift durch zwei Re-Imports. ✅

**Re-Import-Effekt** auf active-count = +46 (über beide Re-Imports gleich, weil zweiter Re-Import keine neuen Rows inserted hat, nur Hero-Mirror nachgezogen):
- +30 categories (neu)
- +4 comparisons (DALL·E + ElevenLabs DE+EN)
- +12 ki-wissen (6 Pillars DE+EN)
- = +46 (Forecast war +18, Diff +28 erklärt durch categories)

**Re-Import-2-Effekt** (15:29:27 → 15:30:10): kein neuer active-count-Delta, aber 14 Hero-Mirrors aufgeholt + 30 categories-Heroes mirrored + was-ist-ki Default-Hero gefeuert. Insgesamt **+48 articles_with_hash** zwischen Run-1 und Run-2.

**Bestätigte Auffälligkeiten:**
- −2 blog-Inserts (system-prompts-best-practices DE+EN) sind NICHT silent missed — sie sind auf den superseded-Rows mit dem neuen filePath. Slug-Rename ↔ Cleanup-Supersede Konflikt. Siehe Anomaly A.

---

## Methodik-Hinweise

- **Read-Only**: keine SQL-Writes, keine R2-Operations, keine Code-Mutations.
- **Discovery-Scripts** (alle gitignored, mirrors `audit-*.ts`-Precedents):
  - `apps/api/src/scripts/discovery/verify-post-cleanup-cycle.ts` — komplette Phase-2-bis-10-Verifikation in einem Pass. Kann erneut ausgeführt werden.
  - `apps/api/src/scripts/discovery/inspect-problematic-articles.ts` — Deep-Dive auf die 16 problematischen Articles (Anomalie A + B + C).
- **Baseline-JSONs**: Spec 001 `capture-cleanup-baseline.ts` Script wurde wiederverwendet — produzierte 4 JSON-Snapshots (Pre-Cleanup, Post-Cleanup, Post-Re-Import-1, Post-Re-Import-2). Alle gitignored.
- **Repo-Inventory-Source-of-Truth**: `apps/api/src/scripts/discovery/repo-inventory.json` (committed). System-Prompts-Best-Practices-Files wurden via `gh api repos/MarcelKlaczinski/ki-wissensraum-v2/contents/...` direkt gegen master verifiziert — sie existieren auf master, der Importer hat sie nur per Slug-Rename-Heuristik gegen die alten Rows gemappt.
- **Verification-Reproducibility**: alle Scripts können erneut laufen falls Marcel nach dem Anomaly-A-Fix re-verifizieren will.
