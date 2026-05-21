# Discovery — Theme 63 Plan-Quality Probleme

**Modus: DISCOVERY ONLY. Keine Fixes, keine Spec-Änderungen. Erst Quellen verstehen, dann zurück mit Befund.**

## Symptom (aktueller Plan KW 21/2026)

Marcel hat in der UI den aktuellen Plan gesehen und mehrere Qualitäts-Probleme identifiziert:

| Beobachtung | Erwartung |
|---|---|
| 7 Cluster, alle aus topic_briefs Pool (RAG, OpenAI Codex, Show HN benchmark, etc.) | Mehr Topic-Vielfalt |
| **0 Comparisons** generiert | Sollte ComparisonDiscovery liefern (z.B. "Claude vs ChatGPT") |
| **1 KI-Wissen** (nur "Show HN benchmark") | Mehr KI-Wissen aus Trend-Synthesizer-Briefs |
| 14+ Social-Posts: alle Single-Tools (Stable Diffusion, Anyword, Copy.ai, Hedra, Flux Pro, Cursor, Udio, Ideogram, etc.) | Tools sind OK aber Use-Case-driven How-Tos fehlen ("wie hilft mir Claude bei Präsentationen") |
| Mehrere RAG-themed Cluster | Diversität — max 1 pro Topic-Cluster? |

**Marcel's Statement:**
- "tools wollen wir nicht ausschließen, tools sind ja gut aber wir brauchen mehr Varianz"
- "neue Vergleiche fehlen" (claude vs chatgpt, etc.)
- "Insta-friendly How-Tos fehlen" (wie hilft mir claude bei präsentationen)
- "wir haben nicht für alles social templates, daher sollten wir das etwas differenzieren"

## Discovery-Aufgaben

### Schritt 1 — Was sind aktuell topic_briefs?

```sql
-- Wieviele topic_briefs, gruppiert nach source?
SELECT 
  source,
  status,
  COUNT(*) as count,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM topic_briefs
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
GROUP BY source, status
ORDER BY source, status;

-- Was sind die Topics konkret (sample)?
SELECT source, topic_title, suggested_title, status, created_at
FROM topic_briefs
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
  AND status = 'approved'
ORDER BY created_at DESC
LIMIT 30;
```

**Erwartung:** Sehe ich was die Source-Verteilung ist (trend_discovery vs cluster_creator vs comparison_discovery vs manual).

### Schritt 2 — Warum 0 Comparisons im Plan?

Spec 62.3 hat ComparisonDiscovery. Aktuelle topic_briefs mit `source='comparison_discovery'`:

```sql
SELECT COUNT(*) FROM topic_briefs
WHERE source = 'comparison_discovery'
  AND project_id = (SELECT id FROM projects WHERE slug = 'toolwiki');
```

**Hypothesen:**
- H1: 0 comparison_discovery briefs existieren — Discovery-Mechanik läuft nicht oder produziert nichts
- H2: Comparison-Briefs existieren aber sind nicht 'approved' — Marcel hat sie nicht durchgewunken
- H3: Comparison-Briefs gibt's, aber SelectFloorItemsStep filtert sie aus (collectionType='comparisons' vs anderen)

**Wenn 0 Briefs:** ComparisonDiscovery-Code untersuchen
```bash
grep -A 30 "comparisonDiscovery\|ComparisonDiscovery" packages/planner/src/
grep -A 30 "comparisonDiscovery\|ComparisonDiscovery" apps/api/src/workers/
```

- Läuft ComparisonDiscovery überhaupt? Cron-State prüfen
- Welche Tool-Paare werden erzeugt? Filter-Restrictions?
- Wann lief sie zuletzt?

### Schritt 3 — Wie werden Trend-Discovery-Briefs erzeugt?

Trend-Synthesizer macht topic_briefs aus external_signals.

```sql
SELECT topic_title, suggested_title, metadata->>'seedSignalIds' as seed_signals, created_at
FROM topic_briefs
WHERE source = 'trend_discovery'
  AND project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
ORDER BY created_at DESC LIMIT 20;
```

**Untersuchen:**
- Sind die Topics divers oder repetitiv? (Hat Marcel den Plan-Mix beklagt)
- Werden sie aus Hot-Signals geclustert (mehrere Signals → ein Brief) oder 1:1?
- Welche Synthesizer-LLM-Prompt erzeugt sie?

```bash
grep -rn "synthesizeTrendBrief\|trend_discovery\|TrendSynthesizer" packages/planner/src/
```

### Schritt 4 — Welche Article-Collections existieren?

Marcel hat erwähnt "wir haben nicht für alles social templates". Das deutet auf Collection-Vielfalt vs Template-Vielfalt Mismatch.

```sql
SELECT collection_type, COUNT(*) as articles, COUNT(DISTINCT translation_key) as translations
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug = 'toolwiki')
GROUP BY collection_type;
```

**Plus: welche Social-Templates existieren aktuell?**

```bash
# Liste der registrierten Templates
grep -A 5 "TemplateKey\|TEMPLATE_KEYS\|templateRegistry" packages/social/src/templates/
```

**Erwartet aus Memory (Stand): 4 production templates:**
- comparison-grid-4
- comparison-grid-3
- verdict-per-use-case
- single-tool-spotlight

**Phase-E-Backlog (laut Memory):**
- workflow-impact-stack
- feature-showcase
- definition-card
- alternative-to-x
- myth-vs-reality

### Schritt 5 — Eligibility-Mapping pro Item-Type → Template

Wie wird in der social-post-Generation entschieden welches Template für welches Item?

```bash
grep -A 20 "templateEligibility\|eligibleTemplates\|selectTemplate" packages/social/src/
```

**Untersuchen:**
- Wenn collectionType='ki-wissen' (How-To) — welche Templates sind eligible?
- Wenn collectionType='comparisons' — welche?
- Was passiert wenn 0 Templates eligible sind? Wird Item dann übersprungen oder fällt zurück auf default?

### Schritt 6 — Floor-Selector Diversität

Marcel: "Mehrere RAG-themed Cluster — vielleicht zu redundant".

```bash
grep -A 30 "SelectFloorItemsStep\|selectFloor" packages/pipelines/src/planning/steps/
```

**Untersuchen:**
- Wie sucht SelectFloor briefs aus? Pure rank-by-score? Random?
- Gibt es Topic-Diversity-Constraints? (z.B. "max 1 brief pro topic-cluster")
- Wenn nein: lohnt sich das einzubauen?

## Format der Rückmeldung an Marcel

**Strukturiert:**

```markdown
## Topic-Brief-Inventar

[Source-Breakdown, sample topics, status-Verteilung]

## Problem-Quellen identifiziert

### Problem A: 0 Comparisons
[Hypothese verifiziert. Konkrete Ursache: ...]

### Problem B: Wenig KI-Wissen 
[Trend-Synthesizer produziert X briefs/Woche, davon Y approved. Brief-Generation-Mechanik: ...]

### Problem C: Cluster-Redundanz
[Floor-Selector hat (keine?) Diversity-Constraint. Beobachtung: ...]

### Problem D: Template-Mapping zu Collection-Typen
[Aktuelle Templates: A, B, C. Eligibility-Mapping: ... 
 Lücken: keine How-To-Templates für ki-wissen-Items]

### Problem E: Author-Profile als Social-Source
[Quick-Fix läuft parallel als 63.1, hier nicht weiter untersuchen]

## Fix-Optionen pro Problem mit Aufwand

### Problem A — Comparisons
- Option 1: ComparisonDiscovery-Cron prüfen, eventuell Re-Triggern (1h)
- Option 2: Spec 63.x — Comparison-Tool-Paaring verbessern (1-2 Tage)
- ...

### Problem B — KI-Wissen
[...]

(etc.)

## Empfehlung Priorität

Marcel + ich entscheiden welche Fixes als 63.2, 63.3 etc. landen.
```

**NICHT IMPLEMENTIEREN.** Marcel entscheidet.

## Anti-Patterns

- Comparison-Discovery-Code refactoren während Discovery
- Neue Templates implementieren
- Floor-Selector ändern
- 62.8-Implementation berühren (läuft parallel im anderen Chat)
- "Big-Bang" Solution-Vorschläge — wir wollen pro Problem 1-3 Optionen mit klaren Trade-offs

## Hintergrund

- Theme 62 fast komplett (62.8 läuft Implementation)
- 63.1 (Author-Filter) läuft als Mini-Task parallel
- Marcel will Theme 63 als Quality-Improvement-Theme vor Go-Live
- Distribution-Layer kommt erst nach Theme 63 als Phase E

Spec-Referenzen:
- 62.3 — Signal-Refresh + ComparisonDiscovery
- 62.4 — Planner-Engine (Floor-Selector, etc.)
- Theme 60 — Content-Planner Foundation (Brief-Generation)
- Phase E Template Backlog: workflow-impact-stack, feature-showcase, definition-card, alternative-to-x, myth-vs-reality

---

## Befund (2026-05-21)

Discovery run gegen Plan-ID `8ab95398-2730-4f69-b62f-1e6e567a97ec` (KW21/2026, status=draft, 31 items, €41.46, manuell getriggert).

### Topic-Brief-Inventar (Projekt toolwiki)

| Source | pending | approved | routed | Σ |
|---|---|---|---|---|
| gap_analysis | 156 | 0 | 4 | **160** |
| trend_discovery | 21 | 7 | 3 | 31 |
| refresh_detection | 0 | 1 | 0 | 1 |
| **comparison_discovery** | **0** | **0** | **0** | **0** |
| manual | 0 | 0 | 0 | 0 |

`cluster_action`-Verteilung: 156 gap-Briefs sind `append_to_existing`. Trend-Briefs sind `create_new` (15) bzw. `append_to_existing` (14) — **niemand hat `standalone` oder `comparison`**.

### Verifikation des Plans

Ist-Zustand der 31 Items (alle vom Floor/Overage-Selector):

| content_type | floor | overage | Σ Cost € |
|---|---|---|---|
| cluster | 7 | 1 | 33.60 |
| ki_wissen | 0 | 1 | 1.06 |
| social_post | 21 | 1 | 1.38 |
| **comparison** | **0** | **0** | **0** |

Plan-Goals (aus `inputSnapshot.goals`):
- cluster: min 1/day = 7/week ✅
- comparison: 1–3/week ❌ **null geliefert**
- ki_wissen: 3–5/week ❌ **1 statt 3**
- social_post: 3–5/day = 21–35/week ✅

### Problem-Quellen identifiziert

#### Problem A — 0 Comparisons im Plan

**Hypothese H1 verifiziert: 0 comparison_discovery briefs existieren** für toolwiki (alle Status).

Ursachen-Kette:

1. **ComparisonDiscovery hat nie gelaufen.** Code (`packages/planner/src/comparison-discovery.ts`) ist implementiert + getestet. Aber:
   - Kein BullMQ-Worker
   - Kein Cron-Eintrag (weder im `cron_state` noch im `cron_job_type` Enum)
   - Einziger Entry-Point: `POST /api/projects/:slug/comparison-discovery/run` — manueller HTTP-Trigger
2. **Selbst wenn Briefs existieren würden, gäbe es einen 2. Failure-Pfad:** `matchBriefToContentType` ([packages/pipelines/src/planning/steps/select-floor-items.ts:48](packages/pipelines/src/planning/steps/select-floor-items.ts:48)) routet nur Briefs mit `source='comparison_discovery'` ODER `cluster_action='comparison'` zur Goal-Bucket "comparison". Trend-Briefs mit `intent_type='comparison'` (haben aber `cluster_action='create_new'`) fallen in den Default-Bucket "cluster".

**Tatsache:** Ein Trend-Brief existiert sogar mit `intent_type='comparison' AND cluster_action='create_new'` (Cursor/Copilot etc. werden in der Synth-Phase getaggt) — aber er landet als "cluster", nicht als "comparison".

#### Problem B — Nur 1 KI-Wissen statt 3

**Verifikation:** Das einzige ki_wissen-Item kam aus `source_kind='overage_signal'` (HackerNews "Show HN: benchmark for LLMs"), NICHT aus dem Brief-Pool.

Ursache: **Trend-Synthesizer kann strukturell keine ki_wissen-fähigen Briefs produzieren.**

- `emit-brief.ts` schreibt `cluster_action = matched ? 'append_to_existing' : 'create_new'` ([buildBriefFromCandidate](packages/pipelines/src/topic-sources/trend-discovery/emit-brief.ts:28))
- `matchBriefToContentType` routet zu "ki_wissen" nur bei `cluster_action='standalone' AND intentType IN ('knowledge','tutorial')`
- ⇒ kein Trend-Brief wird je zu ki_wissen

**Bonus-Befund:** Auch `intentType='knowledge'` kommt vom Synthesizer nie raus — der LLM-Prompt erlaubt nur `tutorial|use_case|news|review|comparison|best_practices|...`. Der einzige ki_wissen-Pfad ist (a) manueller Brief mit `cluster_action=standalone` oder (b) Overage von HN/GitHub.

**Bonus 2:** `registerTrendSynthesizerCron()` ist **auskommentiert** in [apps/api/src/workers/index.ts:307](apps/api/src/workers/index.ts:307). Die 28 trend_discovery briefs entstanden aus manuellen `bun --filter @marketing-auto/api trends:synthesize toolwiki` Runs.

#### Problem C — Cluster-Redundanz (RAG/Coding)

Verifikation aus den 8 Cluster-Items:
- 2× RAG (RAG-Tools 2026 / RAG & Context-Engineering)
- 3× Coding/Dev-Agents (Codex / Codex variants / Copilot)
- 1× AI Agents Observability
- 1× Voice-Agenten
- 1× GitHub Innovation Graph (overage)

⇒ **5 von 8 Items im Cluster-/Tooling-Topic-Cluster.**

Ursache: **SelectFloorItemsStep hat keinerlei Diversitäts-Constraint.** Es ist pure FIFO-Drain pro Bucket: `pool.splice(0, target)` ([select-floor-items.ts:143](packages/pipelines/src/planning/steps/select-floor-items.ts:143)). Briefs in der Reihenfolge ihrer Erstellung werden pickt — wenn der Trend-Synthesizer 5 RAG/Coding-Briefs in 2 Tagen produziert (sehr wahrscheinlich, weil aktuelle Signals dort konzentriert sind), bekommt der Plan exakt diese 5.

Es gibt KEINE pgvector-Cluster-Diversity-Bewertung im Floor-Selector. (Die `clusters.embedding` Backfill-Mechanik existiert, wird aber nur von `cluster-match.ts` für Brief-zu-Cluster-Routing genutzt.)

#### Problem D — Template-Eligibility-Lücke für Social-Posts

Aktuelle Production-Templates (`packages/social/src/templates/definitions/`):

| Template | Erlaubte article.collection |
|---|---|
| comparison-grid-4 | `comparisons` (genau 4 Tools) |
| comparison-grid-3 | `comparisons` (genau 3 Tools) |
| verdict-per-use-case | `comparisons` (≥3 Tools + ≥5 useCaseVerdicts) |
| single-tool-spotlight | `tools` (pros ≥ override.minProsCount, default 3) |
| pro-con-verdict | `tools` (pros ≥ 3 AND cons ≥ 3) |

⇒ **Eligible collections: `tools` + `comparisons` only.** Keine Templates für `blog`, `ki-wissen`, `usecases`, `tool-categories`, `authors`, `special-landings`.

Im aktuellen Plan picked Social-Source-Selector (`pickFromSuggestionPool`) folgendes:

| collection | items im Plan | eligible? |
|---|---|---|
| tools | 9 | ✅ |
| comparisons | 1 | ✅ |
| usecases | 2 ("Kundensupport", "Bildung") | ❌ — 0 Templates |
| authors | 1 ("Anna Weidner") | ❌ — 0 Templates (63.1-Filter im Code, aber Plan vor Worker-Restart generiert) |
| ki-wissen | 1 ("Bias und Fairness") | ❌ — 0 Templates |

Konsequenz: **4 von 17 article-derived social_posts werden zur Generation-Zeit am Eligibility-Check sterben** und einen Fehler erzeugen (oder still skippen, je nach Verhalten von SocialImagePipeline).

`pickFromSuggestionPool` filtert nur auf `locale='de' AND status='published' AND no recent template_render AND collection != 'authors'` (63.1) — **keine collection-allow-list, keine collection-vs-template-eligibility-Vorprüfung.**

Marcel's Statement "wir haben nicht für alles social templates" trifft beide Enden:
- Engine pickt aus collections, für die es keine Templates gibt
- Es fehlen How-To-Templates ganz (kein Template kann ki-wissen/usecases-Hub bedienen — das ist die "Phase-E-Backlog"-Lücke: workflow-impact-stack, definition-card etc.)

#### Problem E — Author-Profile als Social-Source

Nicht weiter untersucht (läuft als 63.1 parallel). Beobachtung bestätigt: 1 Author-Profil im aktuellen Plan, wird durch 63.1's `ne(articles.collection, "authors")` Filter eliminiert sobald Worker mit neuem Code läuft.

### Fix-Optionen pro Problem

#### A — Comparison-Briefs

- **A.1 Manuell triggern + Wartemodus (15 min):** `POST /api/projects/toolwiki/comparison-discovery/run` einmalig. Test ob Algorithmus überhaupt Pairs findet (er braucht ≥2 Co-Mentions pro Pair). Wenn nicht, hat das Projekt zu wenig Comparison-Surface. **Zero-Risk-Schritt vor jedem anderen Fix.**
- **A.2 Cron + Worker für ComparisonDiscovery (0.5 Tag):** Neuer `cron_job_type` Enum-Wert `comparison_discovery`, Cron-Orchestrator-Integration analog `trend_synthesizer`. Wöchentlich (Sonntag pre-Plan-Run) ausführen.
- **A.3 Routing-Fix in `matchBriefToContentType` (1 h):** Erweitern um `if (brief.intentType === 'comparison') return 'comparison'`. Würde existierende Trend-Briefs mit `intent_type=comparison` zu Vergleichs-Artikeln machen, ohne neue Briefs zu brauchen. Klein, aber semantisch fragwürdig (Trend-comparison-Briefs haben oft keine konkreten Tool-Slugs in `comparisonToolSlugs`).
- **A.4 Empfehlung: A.1 sofort + A.2 als 63.x.** A.3 nur wenn A.1+A.2 nicht genug liefert.

#### B — Mehr KI-Wissen

- **B.1 Trend-Synthesizer-Prompt erweitern (2 h):** `intent_type` darf jetzt auch `knowledge` sein; `cluster_action` darf jetzt auch `standalone` sein. Plus `matchBriefToContentType` erweitern: `if (clusterAction === 'standalone' OR intentType === 'knowledge') return 'ki_wissen'`. Macht Synthesizer-Briefs ki_wissen-fähig. **Mittlerer Aufwand, gut testbar.**
- **B.2 Trend-Synthesizer-Cron einschalten (15 min + Test):** `registerTrendSynthesizerCron()` un-kommentieren. Cron-Pattern `30 1 * * *` läuft täglich 01:30 UTC. Erhöht den Brief-Druck ohne Marcel-Arbeit. Empfehlung: nach B.1, sonst kommen nur noch mehr "cluster"-Briefs.
- **B.3 Floor-Selector "borrow-down" (4 h):** Wenn ki_wissen-Bucket leer ist, einzelne `intentType='tutorial'/'knowledge'/'concept'` Briefs aus dem cluster-Bucket umrouten. Verschiebt nur, kreiert keine neuen Briefs.
- **B.4 Empfehlung: B.1 + B.2 (Reihenfolge!) als 63.x.** B.3 als Fallback wenn B.1 trotz mehr Daten zu wenig liefert.

#### C — Floor-Diversity

- **C.1 In-Bucket Topic-Diversity-Constraint (4 h):** Im `select-floor-items.ts` nach dem Bucket-Drain ein zweites Pass: greedy diverse pick via `clusters.embedding` cosine similarity. Pseudo: pick brief, dann reject alle remaining briefs mit sim > 0.7 zum gewählten, repeat. Cost: 1 zusätzlicher SELECT auf clusters + in-memory similarity. **Klein, hoch wirksam.**
- **C.2 Per-cluster max-pick limit (1 h):** Härteste Variante: max 1 Brief pro `cluster_id` und `cluster_action='create_new'` pro Plan. Schneller Filter, kein Embedding nötig. Risiko: Plan wird untererfüllt wenn Cluster-Diversity an sich klein ist.
- **C.3 LLM-Re-Rank Pass (1 Tag, €0.10/Plan):** Nach Floor-Drain ein Sonnet-Call "wähle 7 diverse Topics aus dieser Liste von 30". Teuer + nicht-deterministisch.
- **C.4 Empfehlung: C.1 als 63.x.** Embeddings sind eh da; das ist die natürliche Erweiterung.

#### D — Template-Eligibility/Source-Pool

- **D.1 Source-Pool collection-Filter erweitern (30 min):** `pickFromSuggestionPool` zusätzlich filtern auf `collection IN ('tools','comparisons')` (die einzigen mit Templates). Pro: keine Garbage-Picks. Con: shrinks pool sofort um ki-wissen/usecases-Hubs. **Quick-Fix, Marcel sieht es im Plan-Output.**
- **D.2 Phase-E Template-Backlog vorziehen (5–10 Tage):** workflow-impact-stack + definition-card etc. implementieren, damit ki-wissen + usecases endlich Social-Templates bekommen. Mit den Spec-60.x-Mustern (DsTokens, generateContentWithGate, validateAndReprompt) gut machbar, aber jeweils ~1–2 Tage pro Template.
- **D.3 Engine-Side eligibility-pre-check (2 h):** Im `SelectSocialPostItemsStep` für jeden Source-Candidate `templateRegistry.listEligibleFor(article, discovery)` aufrufen; nur picken wenn ≥1 Template eligible. Pro: kein Plan-Müll mehr. Con: Pool schrumpft hart, evtl. shortfall-warnings nehmen zu.
- **D.4 Empfehlung: D.1 als 63.x sofort** (verhindert kaputte Plans), **D.2 als Phase-E.1+** (löst Marcel's "Insta-friendly How-Tos fehlen" wirklich).

### Empfehlung Priorität (zur Diskussion)

| Order | Spec | Aufwand | Impact | Begründung |
|---|---|---|---|---|
| **1** | **63.1** (Author-Filter) | done, nur Worker-Restart | klein aber sichtbar | Bereits implementiert, nur deploy |
| **2** | **63.2** Source-Pool collection-Filter (D.1) | 30 min | mittel | Verhindert sofort kaputte Social-Posts |
| **3** | **63.3** ComparisonDiscovery-Cron + manual run (A.1+A.2) | 0.5 Tag | hoch | Schliesst Goal-Lücke "1–3 comparisons/Woche" |
| **4** | **63.4** Trend-Synthesizer ki_wissen support (B.1+B.2) | 0.5 Tag | hoch | Schliesst Goal-Lücke "3–5 ki_wissen/Woche" |
| **5** | **63.5** Floor topic-diversity via embeddings (C.1) | 0.5 Tag | mittel-hoch | Eliminiert RAG-Konzentration |
| Phase E | E.1+ Phase-E Template-Backlog (D.2) | 5–10 Tage | Marcel's "How-Tos fehlen" | Erst nach 63.2-63.5 sinnvoll |

Marcel + ich entscheiden Reihenfolge. 63.2 ist no-brainer first. 63.3/63.4 sind unabhängig, können parallel laufen. 63.5 kann nach 63.3+63.4 weil Diversity-Effekt erst sichtbar wird wenn der Pool diverser ist.

