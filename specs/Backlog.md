# Phase-E Backlog — Consolidated v2 (2026-05-23 EOD)

_Update of 2026-05-23 Discovery output, refreshed after 64.11 + 64.14 deployed + 64.15 + 64.16 in flight._

## Changelog vs Discovery Original

**Promoted to ERLEDIGT (5 items):**
- M6 Stalled-render reconciliation → done in **64.11**
- M8 Pipeline completion push notifications → done in **64.11**
- L7 originalR2Key in batch path → done in **64.15 Phase A** (in flight)
- M1 Longitudinal Plan-Diversity (cross-week) → done in **64.15 Phase B** (in flight)
- M2 Precomputed topic_briefs.embedding column → done in **64.15 Phase C** (in flight)

**New discoveries added (3 items):**
- E16 (NEW) ki-wissen content-type miss-classification → done in **64.14**
- E17 (NEW) Synthesizer drama injection ("Leitplanken") → done in **64.16** (in flight)
- L11 (NEW) Body+Translation Glossar → potential 64.17 if drift persistent after 64.16 deploy

**Recommended Next 3 update:** Discovery's Top-1 (Stalled-Render Bundle) and Top-2 (originalR2Key) both completed. **Only Top-3 (Comparison-Discovery Cluster-Routing H2) remains** — but Multi-Domain merge-risk now flagged.

**Multi-Domain context added:** Refactor startet 2026-05-24 morgen. Conflict-risk markers on planner-touching items.

---

## Section 1 — Items ERLEDIGT (updated)

| # | Item | Spec | Status |
|---|---|---|---|
| E1 | Hero-Image Quality bundle | 64.6/6b/6c/6d | ✅ done |
| E2 | Bidirectional translation (DE↔EN) | 59.2 / 64.3-64.5 | ✅ done |
| E3 | 62.5.1 Batch-aware Cost Estimation | 62.5.1 | ✅ done |
| E4 | HN Algolia query rewrite | 63.9 | ✅ done |
| E5 | ProductHunt votes-key snake_case | 63.8 Item B | ✅ done |
| E6 | Push Cluster Build Link FK race guard | commit 8836c5c | ✅ done |
| E7 | Reddit signal adapter (code-complete) | — | ✅ done in code, awaits OAuth creds |
| E8 | signal_collector_* JSON ↔ cron_state alignment | 63.8 Item A | ✅ done |
| E9 | Render duration metrics | — | ✅ done |
| E10 | /automate content-gaps endpoint | — | ✅ done |
| E11 | min_signal_thresholds per-source config | — | ✅ done |
| E12 | Cold-start backend (11 endpoints) | — | ✅ done |
| E13 | Article discovery post-draft timing | — | ✅ done (design choice) |
| E14 | social_auto_render_locales wiring | — | ✅ done |
| E15 | R2 orphan-hero cleanup (22 deleted) | 64.10 | ✅ done + Marcel --apply executed |
| **NEU heute (deployed):** | | | |
| E16 | Stalled-render startup reconciliation | **64.11 Fix A** | ✅ done |
| E17 | Pipeline completion push notifications | **64.11 Fix B** | ✅ done |
| E18 | ki-wissen content-type miss-classification (HN→ki_wissen overage) | **64.14 Phase A+B+C** | ✅ done |
| **NEU heute (in flight, deploying):** | | | |
| E19 | originalR2Key in batch path | **64.15 Phase A** | 🔄 in flight |
| E20 | Longitudinal Plan-Diversity (cross-week) | **64.15 Phase B** | 🔄 in flight |
| E21 | Precomputed topic_briefs.embedding column | **64.15 Phase C** | 🔄 in flight |
| E22 | Synthesizer drama injection fix (Leitplanken/Kampf um) | **64.16** | 🔄 in flight |

---

## Section 2 — Items OBSOLET (unchanged from original)

| Item | Why obsolete |
|---|---|
| Bidirectional EN→DE translation (3-4d) | Themes 59.2 + 64.3-64.5 covered DE↔EN |
| Cluster A "Article Content Variants" (intent-type prompt branching) | intentType is OUTPUT field, not INPUT selector. Prompt branching lives on collectionType (61.2 + 61.3 design) |
| Article discovery is post-draft only | Confirmed correct design |
| Cold-start cold_start_drafts table | Phantom — never existed |
| missing_hub / missing_translation automation chains | Implemented via different mechanisms |
| Per-source min_signal_thresholds config | Already config-driven |
| Render duration metrics | Confirmed implemented |
| Reddit-Auth aktivieren wenn Key ankommt | Awaits creds only — not code backlog |
| GitHub enabled:true JSON ↔ cron_state inconsistency | Fixed by 63.8 Item A |
| ProductHunt votes-key mismatch | Fixed by 63.8 Item B |
| HN-Cron-Bug fix | Fixed pre-63.9, then 63.9 (root cause) |

---

## Section 3 — Items NOCH OFFEN (updated)

### High Priority

| ID | Item | Effort | Trigger | Multi-Domain Risk |
|---|---|---|---|---|
| H1 | Social-Article Decoupling (3 layers) | 3-5d | News-recap / tool-highlight needs OR **Theme 65 65.5+65.10 löst das** | ❌ kein (separate concern) |
| H2 | Deterministic Cluster-Routing for ComparisonDiscovery | 1-2d | Comparison hub pages OR ≥10 comparison_discovery published articles | ⚠️ **Multi-Domain Sprint 3 (Categories) merge-risk** |
| H3 | GitHub Tool-Inventory (content_source_inventory table) | 2-3d | Recurring inventory-based content angles needed | ❌ kein |
| H4 | Distribution-Layer V1 (static schedule) | 1-2d | Planner stable 1 week + channels decision | ❌ kein |

### Mid Priority

| ID | Item | Effort | Trigger | Status |
|---|---|---|---|---|
| ~~M1~~ | ~~Longitudinal Plan-Diversity (cross-week)~~ | — | — | ✅ **DONE in 64.15** |
| ~~M2~~ | ~~Precomputed topic_briefs.embedding~~ | — | — | ✅ **DONE in 64.15** |
| M3 | DataForSEO_trends bulk signal source | 1-2d | Strategy + budget decision first | offen |
| M4 | Bulk approve/dismiss for Gaps (168 items in Toolwiki) | 0.5d | Gap list >20 items — **gerechtfertigt heute** | offen, ready |
| M5 | Bulk approve/dismiss for Trends (22 items) | 0.5d | Trend list >20 items — borderline | offen, wait |
| ~~M6~~ | ~~Stalled-render reconciliation~~ | — | — | ✅ **DONE in 64.11** |
| M7 | rejected_topic_candidates 30-day physical prune (Toolwiki: 1 row) | 30 min | Table grows past ~10k rows | offen, low urgency |
| ~~M8~~ | ~~Pipeline completion push notifications~~ | — | — | ✅ **DONE in 64.11** |
| M9 | Distribution-Layer V2 (engagement-driven) | 3-5d | V1 deployed + ≥2 months engagement data | offen, wait |

### Low Priority / Smart-Deferred

| ID | Item | Trigger | Status |
|---|---|---|---|
| L1 | news-slide social template | News social posts needed | stub, offen |
| L2 | concept-explainer-deck template | Education social posts needed | stub, offen |
| L3 | price-comparison template | Pricing-comparison social posts needed | stub, offen |
| L4 | Adjustable trend score weights per project | Multi-tenant divergence | ⚠️ **Multi-Domain Sprint 4 territory** |
| L5 | Worker process recycling (maxJobsPerWorker) | Worker heap growth visible | offen |
| L6 | maxAgeDays per-source config | RSS feed produces stale content | offen |
| ~~L7~~ | ~~originalR2Key in batch path~~ | — | ✅ **DONE in 64.15** |
| L8 | cost_logs.metadata.augmented field | Spec 64.8 consumes it | offen, lands with 64.8 |
| L9 | RefreshQueuePage.vue spec coverage docs | Context warm | doc-task, 15min |
| L10 | projects/search.ts spec coverage docs | Context warm | doc-task, 15min |
| **NEU heute (potential follow-up):** | | | |
| L11 | Body+Translation Glossar (full-scope) | If 64.16 prompt-only fix isn't enough — body/translation drift persistent | wait 2-4 weeks post-64.16 |

---

## Section 4 — DO-NOT-FIX Items (Confirmed Parked)

| Item | Memory-Ref | Trigger to revisit |
|---|---|---|
| Knowledge-Hub-Spoke in Tools-Cluster | Memory D12 + root CLAUDE.md:154 | Production semantic pollution visible |
| OCR-Check on hero images via Tesseract | Spec 64.6 explicit decision | Hero text-label regressions after 30+ days |
| cost_logs.metadata.augmented typed field (NOW) | Spec 64.6d skipped | Spec 64.8 consumes it (see L8) |

---

## Section 5 — Neu entdeckt während heute (post-Discovery)

| Item | Source | Action | Status |
|---|---|---|---|
| ki-wissen content-type miss-classification | Marcel observed "I've joined Anthropic" as KI-Wissen brief | Discovery → Spec 64.14 A+B+C | ✅ done |
| Synthesizer drama injection (Leitplanken, Kampf um, year-tag) | Marcel observed planned_item.title divergence vs source brief | Discovery → Spec 64.16 (prompt-only fix) | 🔄 in flight |
| Body+Translation glossar drift (English terms mistranslated) | Discovery side-effect of 64.16 | Defer — observe post-64.16 deploy 2-4 weeks | L11 in backlog |

---

## Section 6 — Updated Next-Specs Recommendation

**Discovery's original Top-3 status:**
- ~~Top-1: Stalled-Render + Push-Notif Bundle~~ → ✅ DONE in 64.11
- ~~Top-2: originalR2Key in batch path~~ → ✅ DONE in 64.15
- Top-3: Comparison-Discovery Cluster-Routing (H2) → **Still open, BUT Multi-Domain merge-risk**

**New Top-3 Recommendations (post 64.11-64.16):**

### 1. ⏸ DEFER until after Multi-Domain Sprint 3 — H2 Comparison-Discovery Cluster-Routing (1-2d)

Originally Discovery Top-3. Now with Multi-Domain Refactor startet morgen + Branch A Sprint 3 touches `content_categories` table → merge-risk. Wait until Sprint 3 lands, then revisit.

### 2. **M4 Bulk Approve/Dismiss for Gaps (0.5d)** — UX quick-win

Toolwiki has 168 gap_analysis briefs — trigger threshold (>20 items) clearly exceeded. Frontend-only, briefs page extension. Pattern exists (BulkApproveModal.vue per Reality Check).

**Why now:** zero Multi-Domain merge-risk, immediate Marcel-UX-impact (approving 168 briefs one-by-one is painful).

### 3. **64.8 Image-Prompt Audit (TBD when Marcel has samples)**

Discovery says "wartet auf samples". Marcel deferred. Not pushed from outside — lands when re-bake corpus ready.

### Honorable mentions

- **GitHub Tool-Inventory (H3)** — 2-3d, needs eigene Discovery-Spec, defer
- **Distribution-Layer V1 (H4)** — wait 1 more cycle (Theme 62 productive week)
- **L11 Body+Translation Glossar** — observe 64.16 first

---

## Section 7 — Consolidated Backlog v2 (single source of truth)

| ID | Item | Status | Priority | Effort | Trigger | Multi-Domain Risk |
|---|---|---|---|---|---|---|
| **ERLEDIGT (22 total)** | | | | | | |
| E1-E15 | (siehe Original Backlog) | ✅ done | — | — | — | — |
| E16 | Stalled-render reconciliation | ✅ 64.11 | — | — | — | — |
| E17 | Pipeline completion push notifications | ✅ 64.11 | — | — | — | — |
| E18 | ki-wissen content-type miss-classification | ✅ 64.14 | — | — | — | — |
| E19 | originalR2Key in batch path | 🔄 64.15A | — | — | — | — |
| E20 | Longitudinal Plan-Diversity | 🔄 64.15B | — | — | — | — |
| E21 | Precomputed topic_briefs.embedding | 🔄 64.15C | — | — | — | — |
| E22 | Synthesizer drama injection fix | 🔄 64.16 | — | — | — | — |
| **OFFEN — HIGH** | | | | | | |
| H1 | Social-Article Decoupling | ❌ open | High | 3-5d | Theme 65 65.5+65.10 löst das | ❌ kein |
| H2 | Comparison-Discovery Cluster-Routing | ❌ open | High | 1-2d | Comparison hub pages | ⚠️ Sprint 3 |
| H3 | GitHub Tool-Inventory | ❌ open | High | 2-3d | Recurring inventory content | ❌ kein |
| H4 | Distribution-Layer V1 | ❌ open | High | 1-2d | Planner stable + channels | ❌ kein |
| **OFFEN — MID** | | | | | | |
| M3 | DataForSEO_trends bulk signal | ❌ open | Mid | 1-2d | Strategy + budget | ❌ kein |
| M4 | Bulk approve/dismiss Gaps | ❌ open | Mid | 0.5d | **>20 items reached (168 in Toolwiki)** | ❌ kein |
| M5 | Bulk approve/dismiss Trends | ❌ open | Mid | 0.5d | >20 items (22 borderline) | ❌ kein |
| M7 | rejected_topic_candidates physical prune | ❌ open | Mid | 30min | Table >10k (Toolwiki: 1 row) | ❌ kein |
| M9 | Distribution-Layer V2 (engagement) | ❌ open | Mid | 3-5d | V1 + ≥2 months data | ❌ kein |
| **OFFEN — LOW / SMART-DEFERRED** | | | | | | |
| L1 | news-slide template | 🟡 stub | Low | 1d | News social posts needed | ❌ kein |
| L2 | concept-explainer-deck template | 🟡 stub | Low | 1d | Education social posts | ❌ kein |
| L3 | price-comparison template | 🟡 stub | Low | 1d | Pricing comparison posts | ❌ kein |
| L4 | Adjustable trend score weights per project | ❌ open | Low | 0.5d | Multi-tenant divergence | ⚠️ Sprint 4 |
| L5 | Worker process recycling | ❌ open | Low | 1d | Worker heap growth | ❌ kein |
| L6 | maxAgeDays per-source config | ❌ open | Low | 0.5d | RSS stale content | ❌ kein |
| L8 | cost_logs.metadata.augmented field | ❌ open | Low | 1 line | Spec 64.8 consumes | ❌ kein |
| L9 | RefreshQueuePage spec coverage docs | ❌ open | Low | 15min | Context warm | ❌ kein |
| L10 | projects/search.ts spec coverage docs | ❌ open | Low | 15min | Context warm | ❌ kein |
| L11 | Body+Translation Glossar full-scope | ❌ open | Low | 1-2d | If 64.16 prompt fix insufficient | ⚠️ Sprint 4.4 |
| **DO-NOT-FIX** | | | | | | |
| X1 | Knowledge-Hub-Spoke in Tools-Cluster | DO-NOT-FIX | — | — | Production semantic pollution | — |
| X2 | OCR validation via Tesseract on heroes | DO-NOT-FIX | — | — | Hero text regressions after 30+ days | — |

---

## Section 8 — Toolwiki Live State (DB-verified 2026-05-23 EOD)

### Articles by collection × clustering

| Collection | Total | Clustered | Unclustered |
|---|---|---|---|
| authors | 10 | 0 | 10 (by design) |
| blog | 58 | 58 | 0 |
| comparisons | 24 | 24 | 0 |
| ki-wissen | 24 | 24 | 0 |
| special-landings | 10 | 0 | 10 (by design) |
| tool-categories | 14 | 0 | 14 (by design) |
| tools | 108 | 108 | 0 |
| usecases | 24 | 24 | 0 |

**Plus:** Plan KW21 published mit KI-Wissen items (post-64.14 Phase C).

### Signal sources alignment ✅

| Source | JSON enabled | cron_state.is_active | Aligned? |
|---|---|---|---|
| hackernews | true | t | ✅ |
| producthunt | true | t | ✅ |
| vendor_rss | true | t | ✅ |
| reddit | false | f | ✅ (awaits OAuth) |
| github | false | f | ✅ |
| dataforseo_trends | false | n/a | ✅ |

### Topic briefs by source

| Source | Count | Change |
|---|---|---|
| gap_analysis | 168 | unchanged |
| trend_discovery | 22 | unchanged |
| comparison_discovery | 4 | unchanged (H2 motivates fix) |
| refresh_detection | 1 | unchanged |
| **manual** | **≥1** | **NEU — 64.14 Phase C: "Was ist RAG?" verified** |

### Brief approval status

| Status | Count |
|---|---|
| pending | 176 |
| plan_pending | 11 |
| superseded | 4 |
| rejected | 2 |
| approved | 1 |
| routed | 1 |

### image_batch_requests

0 rows — Spec 64.7 deployed but not yet exercised. **64.15 Phase A makes batch hero generation forensic-safe** when Marcel enables `projects.llm_mode='batch'`.

### Memory state

**28/30 entries** (2 slots headroom maintained per cleanup-rule):
- Removed today: D7 Phase E Backlog (superseded), D12 Article-Field-Promotion (bug fixed, code-doc)
- Added today: D27 Worker Lifecycle Pattern (64.11), D28 Content-Type Classification (64.14)
- D26 Theme 65 reminder still active

---

## Section 9 — Pending Marcel-Actions (heute EOD)

1. **64.15 + 64.16 abwarten** (Implementor läuft, ~1.5d + ~1h)
2. **Multi-Domain Refactor starten morgen** (Branch A Sprint 1 Safety-Layer)

### Post-Deploy Manual QA

3. **64.15 Phase C:** Backfill `--apply` für Toolwiki (`bun --filter @marketing-auto/api backfill-brief-embeddings --project=toolwiki --apply`) — ~180 briefs × Voyage ~€0.05
4. **64.15 Phase B:** Inspect cross-week diversity in next plan-run (KW22 vs KW21)
5. **64.16:** Trigger synthesize.ts cron → inspect 5-10 neue briefs → verify keine Leitplanken/Kampf-um/2026-tag drama
6. **64.11 passive:** Bei nächstem echten `article:blog` (5-10 min run) → check `notifications` table für `type='pipeline_completed:article:blog'`

### Trigger-based (zukünftig)

7. **64.8 Image-Prompt Refactor** — wartet auf re-bake samples ("Bilder später")
8. **64.17 Body+Translation Glossar** — wenn nach 2-4 Wochen Body/Translation drift trotz 64.16 persistent
9. **H2 Comparison-Discovery Cluster-Routing** — nach Multi-Domain Sprint 3 (Categories landing)
10. **M4 Bulk approve/dismiss Gaps** — quick-win nach Multi-Domain Sprint 1 (Safety-Layer)
11. **Theme 65 Decision** — wann starten (eigene Phase nach Multi-Domain stabilisiert)

---

## Section 10 — Multi-Domain Refactor Conflict Map

Multi-Domain Refactor startet morgen 2026-05-24. Items im Backlog mit potential merge-risk:

| Backlog Item | Sprint that touches similar code | Recommendation |
|---|---|---|
| H2 Comparison-Discovery Cluster-Routing | Sprint 3 (content_categories) | ⏸ defer until Sprint 3 done |
| L4 Adjustable trend score weights per project | Sprint 4 (LLM-Prompts Per-Project-Vars) | Consider inkorporieren in Sprint 4 |
| L11 Body+Translation Glossar | Sprint 4.4 (Tenant-Var-Swap) | If becomes needed, inkorporieren in 4.4 |

**Plus: 64.14's `signal_source_content_type_map` jsonb pattern** ist Referenz-Pattern für Multi-Domain Sprint 4 per-project configs. Already deployed, ready as reference.

---

## Cleanup of source docs (post Discovery)

Schon vorgeschlagen im Original Discovery:
- Delete or archive `specs/_drafts/backlog-reality-check.md`
- Delete or archive `specs/_drafts/62e-Backlog.md`
- Delete `specs/_drafts/64-backlog-discovery.md`
- Keep `specs/_drafts/diagnose-push-cluster-link.md` for history

**Plus heute:**
- Backlog v2 (this file) supersedes Backlog v1
- Original Discovery file kann als history bleiben oder gelöscht werden

---

*Updated 2026-05-23 EOD. Marcel startet Multi-Domain Refactor morgen. Total deployed today: 4 specs (64.11 + 64.14 + 64.15-in-flight + 64.16-in-flight). 5 backlog items promoted to ERLEDIGT.*
