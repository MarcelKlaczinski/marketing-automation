# Discovery — Phase-E Backlog Reality Check 2026-05-23

**Modus: INSPECT ONLY. Keine Code-Changes. ~60-90 Min.**

## Kontext

Marcel hat drei verschiedene Backlog-Dokumente in den letzten Wochen geführt:

1. **`phase-e-backlog-2026-05-21.md`** — Konsolidierter Stand nach Theme 63 (Top + Mid + Low Priority Items)
2. **`master-backlog-2026-05-18.md`** — Master Backlog nach Theme 58 + Reality Check (Tier 1/2/3 + Smart-Deferred)
3. **`phase-e-deferred-from-62.md`** — Items aus Theme 62 (Content-Planner)

Seitdem ist viel passiert:
- Theme 63 vollständig abgeschlossen (63.1-63.9 inkl. Algolia OR fix, HN cron, FK race)
- Theme 64 (Translation Quality + Hero-Image + Trends-Approve): 64.1, 64.2, 64.3, 64.4, 64.5, 64.6, 64.6b, 64.6c, 64.6d, 64.7, 64.9 deployed; 64.8 wartet auf samples; 64.10 läuft
- 64.6 reset-cleanup hat 34 generated articles + 1 plan + 68 items + 13 routed briefs gelöscht
- Memory D124-D148 plus D20-D27 hinzugefügt (Theme 62/63/64 patterns)

**Ziel der Discovery:** Backlog-Items aus allen 3 docs gegen aktuellen Code-Stand verifizieren. Pro Item: **erledigt / obsolet / noch offen / unklar**. Output ist EIN konsolidiertes Backlog dokument das Marcel als Tier-3 / Tier-4 (post-Theme-64) Roadmap nutzen kann.

## Discovery-Schritte

### Schritt 1 — Items die wahrscheinlich ERLEDIGT sind (verify)

Marcel-Hypothese aus heutiger Session:

**a) Hero-Image Quality (Phase-E #5 aus doc1)**
- Hypothese: ✅ erledigt durch 64.6 (Nano Banana 2 adapter) + 64.6b (cost + resolution) + 64.6c (WebP adapter) + 64.6d (resolution-injection + audit + rebake)
- Verify:
  - Image-Prompt ist auf English? → grep outline.ts heroImagePrompt Rule 6
  - Negative constraints "no text"? → grep "NO text labels" outline.ts
  - Image-Model Nano Banana 2 (statt DALL-E)? → packages/adapters/nano-banana/
  - OCR-Check via Tesseract? → vermutlich NICHT implementiert (low-priority finding)

**b) 62.5.1 Batch-aware Cost Estimation**
- doc2 sagt "Implemented" → doc3 sagt "deferred" — Discrepancy
- Verify:
  - `specs/62.5.1-batch-aware-cost-estimate.md` existiert?
  - `projects.llm_mode = 'batch'` flow funktioniert? → 64.7 hat Batch implementiert
  - Cost-Estimator nutzt batch-discount factor 0.5? → Memory D138 confirmed
- Hypothese: ✅ implemented via 64.7 (Batch-Mode integrated)

**c) HackerNews + ProductHunt-Filter (Phase-E #4 aus doc3 / doc1)**
- HN-Filter-Tuning → ✅ Spec 63.9 (Algolia OR silent degradation, single-word queries)
- PH-Votes Key-Mismatch → ✅ Spec 63.8 Item B (votes_count snake_case)
- Verify: grep packages/adapters/hackernews/ + product-hunt/ für aktuelle field names

**d) "Push Cluster Build Link Error" (Phase-E #7 aus doc1)**
- Heutige Session erwähnt "Push-Cluster-Link FK Race Fix" — wahrscheinlich gleicher Bug
- Verify: ist BullMQ stall-detect aktiviert für cluster:link-rebuild? Existiert Defense in runner.ts (Memory D151)?
- Hypothese: ✅ fixed in heutiger Session

### Schritt 2 — Items die wahrscheinlich OBSOLET sind (verify)

**a) Cluster D Bidirectional translation EN→DE (doc2)**
- doc2 sagt "Translation pipeline is entirely hardcoded DE→EN. 3-4d"
- Theme 64.3 / 64.4 / 64.5 haben translation pipeline massiv refactored
- Verify:
  - Translation pipeline supports beide directions? → grep `targetLocale` `sourceLocale` in pipeline.ts
  - Memory D24 (Bridge-Sparser-Reconstruction) mentions DE→EN als forward case mit EN→DE als bridge-test
  - Hypothese: teilweise erledigt — needs Verify ob explizite EN→DE happy-path tested

**b) Cluster A Article Content Variants (doc2)**
- doc2 sagt "1-3d für prompt-variant improvements"
- Theme 63 + 64 haben Content-Pipeline weiter ausgebaut
- Status unklar: ist die intent-type-aware structural guidance in DraftStep prompt implementiert?
- Verify: grep `intentType` in steps/draft-step.ts oder steps/outline.ts

**c) Pre-generation discovery (doc2 Tech Debt #10)**
- doc2 sagt "move discovery before draft so signals can influence generation"
- Vermutlich erledigt durch Theme 60+62 Planner-Refactor
- Verify: pipeline-router routet briefs durch discovery-step BEFORE draft? Oder Linker/Discovery post-draft?

**d) `signal_sources.reddit.enabled` wartet auf credentials (doc1 #10 + doc3 smaller items)**
- Cosmetic — wenn Credentials nie kamen, bleibt offen aber niedrige Prio
- Verify: Toolwiki `cron_state.signal_collector_reddit.is_active`?

### Schritt 3 — Items die NOCH OFFEN sind (verify scope)

**Top-priority (eigene Spec nötig):**

**a) Social-Article Decoupling (doc1 #1 + doc2 references)**
- 3 Ebenen: Fallback-LLM für Frontmatter-Lücken, existingArticleId Input, Standalone-Social-Generation
- Verify:
  - Aktuelle social-pipeline-Struktur: `packages/pipelines/src/social/` oder ähnlich
  - Hard-Dependency auf Article-Frontmatter: `social/steps/` lesen
  - Plus: aktuelle social-types via `packages/social/src/templates/types.ts` enum
- Aufwand: 1-2 Tage geschätzt

**b) Deterministisches Cluster-Routing für ComparisonDiscovery (doc1 #2 + doc3)**
- ComparisonDiscovery erzeugt clusterless briefs
- Verify:
  - Wie viele Bestands-Comparisons sind clustered vs unclustered? SELECT collection='comparison' GROUP BY cluster_id IS NULL
  - Existiert `{subcategory}-comparisons-2026` Cluster-Pattern?
  - Wo lebt der "Comparison-Guard-Variante-2-Fix"? (doc1 sagt 2026-05-21)
- Aufwand: 0.5-1 Tag

**c) GitHub Tool-Inventory (doc1 #3 + doc2 + doc3)**
- Eigene `content_source_inventory` Tabelle, Filter minStars/lastActiveWithinDays/hasTopicTag
- Verify:
  - Existiert eine ähnliche Tabelle schon? (z.B. von Spec 63.x oder Theme 61?)
  - Cluster C aus doc2 nennt "Reddit + GitHub Trending Adapters" — verschieden vs Tool-Inventory?
- Aufwand: 2-3 Tage

**d) Distribution-Layer (doc1 #4 + doc3)**
- V1 statisches Time-Schema, V2 engagement-driven
- Verify:
  - Aktueller Stand des "Publishing"-Codes: existiert post-Render-step für social oder noch nicht?
  - Channels (LinkedIn, X, Instagram, Newsletter): welche connector-stubs existieren?
- Aufwand: V1 ~1d, V2 ~3-5d

**Mid-priority:**

**e) Longitudinal Plan-Diversity (doc1 #6)**
- Cross-week diversity (KW21 RAG → KW22 NOT RAG)
- Verify:
  - 63.5 Floor topic-diversity erledigt (doc1 sagt "Spec bereit, läuft Implementation" — verify ob deployed)
  - Cross-week Awareness im Floor-Selector?
- Aufwand: 0.5d Erweiterung

**f) Precomputed brief.embedding (doc1 #8)**
- Currently on-the-fly Voyage embeddings per plan-run
- Verify:
  - Aktuell Voyage usage in topic_briefs.embedding column nutzen?
  - HNSW-Index-Existenz?
- Trigger: > 5 Plan-Runs/Woche oder Latenz-Problem
- Aufwand: 0.5d

**g) DataForSEO_trends (doc1 #9 + doc3)**
- Source-Enum exists aber kein Adapter
- Verify:
  - signal-top-n.ts case-branch greift nie? grep
  - DataForSEO Trends-Endpoints Cost? ~$0.06/call
- Aufwand: 1-2 Tage nach Strategy-Decision

### Schritt 4 — Items NEU entdeckt durch heutige Sessions

Aus den Theme-64 Implementor-Reports:

**a) `originalR2Key` im batch path (Spec 64.7 §11 #7)**
- WebP-Adapter läuft NUR im sync path
- Batch-generierte heroes haben kein original backup
- Aufwand: ~30 LOC pipe batch result through webp-adapter

**b) cost_logs metadata `augmented` field für Spec 64.8**
- Spec 64.6d hat explizit geskipped weil "dead metadata bis 64.8 lands"
- Wenn 64.8 kommt → JSONB-additive 1-line code change

**c) ESM ti-icons / Tabler Replacements?**
- Memory D139 mentions apiPost behavior, kein direkt actionable item
- Skip unless other context

### Schritt 5 — DO-NOT-FIX Items dokumentieren

**a) Knowledge-Hub-Spoke in Tools-Cluster (Memory D147 + doc1 #13)**
- Spec 63.4 ließ Knowledge-Briefs in Tools-Cluster zu
- Marcel reviewt via 63.6 plan_pending vor LLM-Cost
- Documented in root CLAUDE.md
- **Confirmed DO-NOT-FIX bis production-Schmerz auftritt**

### Schritt 6 — Master Backlog (doc2) Tier 1 Hardening verify

Fünf items aus doc2 Tier 1 (~3-4 Tage gesamt):

| Item | Aufwand | Verify |
|---|---|---|
| Stalled render reconciliation | 30 min | grep BullMQ stall-detect + `renderStatus='rendering'` cleanup |
| `rejected_topic_candidates` physical prune | 30 min | grep trend-synthesizer janitor + 30-day expiry |
| Worker process recycling (`maxJobsPerWorker`) | 1d | grep `maxJobsPerWorker` in worker configs |
| Pipeline completion push notifications | 1d | `Worker.on('completed')` für article:blog + social-render? Infrastructure exists per doc2 |
| `maxAgeDays` per-source config | 0.5d | grep `signal_sources` schema für maxAgeDays field |

### Schritt 7 — Master Backlog (doc2) Cluster B Social Templates verify

Drei Templates: news-slide, concept-explainer-deck, pro-con-verdict.

Verify:
- `packages/social/src/templates/types.ts` TemplateKey union — welche commented out?
- `bootstrap.ts` line 18 area — welche enabled?
- composition/eligibility files per template existieren?

Hypothese: vermutlich noch nicht implementiert (Theme 64 fokussierte auf Article-Quality).

## Format der Rückmeldung

```markdown
# Phase-E Backlog Reality Check Results (2026-05-23)

## Section 1 — Items ERLEDIGT (verify confirmed)

| # | Item | Source | Status | Evidence |
|---|---|---|---|---|
| 5 | Hero-Image Quality | doc1 | ✅ done | Spec 64.6/6b/6c/6d (file refs) |
| ... | ... | ... | ... | ... |

## Section 2 — Items OBSOLET (no longer relevant)

| Item | Why obsolete |
|---|---|
| Cluster D Bidirectional Translation | Theme 64.3-64.5 covered DE↔EN |
| ... | ... |

## Section 3 — Items NOCH OFFEN (priorisiert)

### High Priority
| Item | Effort | Trigger |
|---|---|---|
| Social-Article Decoupling | 1-2d | News-Recap / Tool-Highlight needs |
| ... | ... | ... |

### Mid Priority
| ... | ... | ... |

### Low Priority / Smart-Deferred
| ... | ... | ... |

## Section 4 — DO-NOT-FIX Items (Confirmed Parked)

| Item | Memory-Ref | Trigger to revisit |
|---|---|---|
| Knowledge-Hub-Spoke | D147 + root CLAUDE.md | Production semantic pollution visible |

## Section 5 — NEU entdeckt durch Theme 64

| Item | Source-Spec | Effort | Priority |
|---|---|---|---|
| originalR2Key im batch path | 64.7 §11 #7 | 30 LOC | Low |
| cost_logs.metadata.augmented | 64.6d → 64.8 | 1 line | Lands with 64.8 |

## Section 6 — Recommended Next 3 Specs

Basierend auf:
- impact (Toolwiki Content-Stream value)
- effort (kleine Specs > große)
- dependencies (was blockt was)
- Marcel-Energy heute (eher kleine Specs)

1. **[Spec X]** — [reasoning]
2. **[Spec Y]** — [reasoning]
3. **[Spec Z]** — [reasoning]

## Section 7 — Consolidated Backlog (single source of truth)

| ID | Item | Status | Priority | Effort | Trigger | Last Updated |
|---|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... | 2026-05-23 |
```

## Anti-Patterns

- ❌ Code-Changes machen
- ❌ Spec schreiben
- ❌ Migration vorschlagen
- ❌ Items aggressiv as "done" deklarieren ohne file-evidence
- ❌ Marcel-Decisions vorgreifen ("priority X ist wichtiger als Y")

## Akzeptanzkriterien

1. ✅ Jedes Item aus allen 3 docs hat klaren Status (erledigt / obsolet / offen / unklar)
2. ✅ Erledigt-Items haben file/spec evidence
3. ✅ Obsolet-Items haben begründete reasoning (welche Spec hat's covered, oder why no longer relevant)
4. ✅ Offene Items haben aktualisierte effort + trigger
5. ✅ DO-NOT-FIX items separat dokumentiert mit Memory-Refs
6. ✅ Neu entdeckte Items aus Theme 64 (originalR2Key, cost_logs.augmented) erfasst
7. ✅ Section 6: 3 Recommendations für nächste Specs mit reasoning
8. ✅ Section 7: konsolidiertes single-source-of-truth Backlog

## Hintergrund

- Toolwiki project, post Theme 64 deploys
- 3 verschiedene Backlog-docs sind out-of-date
- Marcel will EINE konsolidierte Liste statt 3 widersprüchliche Snapshots
- Plus: Recommendation für 3 next Specs basierend auf real impact

Memory-Refs für context:
- D124-D148 (Theme 62/63 patterns + cluster routing)
- D20-D27 (heute hinzugefügt, Theme 64 patterns)
