# Marketing-Tool DB Article-Discovery Report

## Run-Metadata

| | |
|---|---|
| Run-Date | 2026-05-13 |
| Total Cost | $0.00 (filesystem-heuristic, kein LLM-API) |
| Articles verarbeitet | 258 (129 DE klassifiziert + 129 EN gespiegelt) |
| Nicht gefunden | 2 (in Astro aber nicht in DB — siehe Drift) |
| Migration | `0028_article_discovery` angewandt |

---

## Schema-Status

### Was war bereits in DB

| Feld | Quelle | Befund |
|---|---|---|
| `collection`, `locale`, `slug` | `articles` | vollständig ✓ |
| `source` | `articles.source` | `imported`/`generated` ✓ |
| `wordCount` (imported) | `articles.import_metadata.wordCount` | JSONB, alle 268 befüllt ✓ |
| `imageCount` | `articles.import_metadata.imageCount` | JSONB ✓ |
| `headings[]` | `articles.import_metadata.headings` | Array `{level,text,id}` ✓ |
| `internalLinks[]` | `articles.import_metadata.internalLinks` | ✓ |
| `hasAffiliateLinks` | `articles.import_metadata.hasAffiliateLinks` | ✓ |
| Tool-Metadaten | `articles.frontmatter_extras` | pros/cons/rating/pricing/toolSlugs etc. ✓ |

### Was in `article_discovery` neu angelegt wurde (Migration 0028)

Phase-1 (deterministisch aus body + import_metadata):
`word_count`, `image_count`, `header_count_h2/h3`, `header_slugs[]`,
`paragraph_count`, `link_count_internal/external`, `code_block_count`,
`table_count`, `list_count_ul/ol`, `has_affiliate_links`,
`referenced_tools[]`, `container_form_hint`, `completeness_score`, `estimated_angles`

Phase-2 (heuristisch aus Astro-Dateisystem):
`content_hooks` (JSONB), `suggested_templates` (JSONB),
`narrative_arc`, `estimated_carousels`, `enrichment_mode`

---

## Article-Distribution

### Nach Source

| Source | Count |
|---|---|
| `imported` | 268 |
| `generated` | 13 |
| **Total** | **281** |

### Nach Collection (DE + EN, imported)

| Collection | DE | EN | Total | Container Form |
|---|---|---|---|---|
| `tools` | 54 | 54 | 108 | single-tool-deep-dive |
| `blog` | 28 | 28 | 56 | opinion-piece / howto-guide / news-update |
| `ki-wissen` | 12 | 12 | 24 | concept-explainer |
| `usecases` | 12 | 12 | 24 | application-scenario |
| `comparisons` | 11 | 11 | 22 | comparison-2 / comparison-list |
| `tool-categories` | 7 | 7 | 14 | category-hub |
| `special-landings` | 5 | 5 | 10 | landing-page |
| `authors` | 5 | 5 | 10 | *(ausgeschlossen)* |

### Container-Form-Hint (DE only)

| Hint | n | avg Wörter | Completeness |
|---|---|---|---|
| `single-tool-deep-dive` | 54 | 212 | 0.389 |
| `opinion-piece` | 26 | 3.591 | 0.677 |
| `concept-explainer` | 12 | 2.820 | 0.667 |
| `application-scenario` | 12 | 1.260 | 0.575 |
| `comparison-2` | 7 | 1.103 | 0.543 |
| `category-hub` | 7 | 661 | 0.443 |
| `landing-page` | 5 | 856 | 0.500 |
| `comparison-list` | 4 | 547 | 0.475 |
| `howto-guide` | 2 | 4.147 | 0.700 |

---

## Content-Hook-Frequency (258 Articles DE+EN)

| Hook | Count | Abdeckung | Bar |
|---|---|---|---|
| `has_pricing_data` | 246 | 95 % | ██████████████████████████████████████████████████████████████ |
| `has_verdict` | 224 | 87 % | ████████████████████████████████████████████████████████ |
| `has_warnings` | 172 | 67 % | ███████████████████████████████████████████ |
| `has_technical_detail` | 180 | 70 % | █████████████████████████████████████████████ |
| `has_use_case_examples` | 168 | 65 % | ██████████████████████████████████████████ |
| `has_quotes_or_testimonial` | 152 | 59 % | ██████████████████████████████████████ |
| `has_glossary_terms` | 124 | 48 % | ███████████████████████████████ |
| `has_pro_con_lists` | 102 | 40 % | ██████████████████████████ |
| `has_visual_demo_refs` | 98 | 38 % | █████████████████████████ |
| `has_data_table` | 86 | 33 % | ██████████████████████ |
| `has_news_angle` | 64 | 25 % | ████████████████ |
| `has_step_sequence` | 38 | 15 % | ██████████ |
| `has_numbered_list` | 28 | 11 % | ███████ |

**Auffall:** `has_pricing_data` (95 %) und `has_verdict` (87 %) sind fast universell — spiegelt die Redaktionslinie des Projekts (Tool-Vergleiche mit klarer Empfehlung). `has_step_sequence` (15 %) und `has_numbered_list` (11 %) sind selten — wenig How-to-Content, viel evaluativer Content.

---

## Pattern-Cluster-Analyse

### Cluster 1 — „Tool-Profil mit Pricing-Pflicht" (n=108, alle `tools`)
- **Hooks:** verdict=100 %, pricing=100 %, technical=59 %, warnings=59 %
- **Avg Wörter:** 212 — kurze, dichte Steckbriefe
- **Beispiele:** `deepl`, `chatgpt`, `midjourney`
- **Templates:** `single-tool-spotlight` (primär), `pro-con-verdict`, `price-comparison`
- **Besonderheit:** Kein H3-Body-Text, kein step-sequence — rein evaluativer Aufbau. Completeness 0.389 klingt tief, ist aber strukturell korrekt: der Content sitzt in Frontmatter-Arrays (pros/cons/features), nicht im Markdown-Body.

### Cluster 2 — „Investigativer Blog-Leitfaden" (n=26, `blog` → opinion-piece)
- **Hooks:** verdict=100 %, pricing=100 %, table=92 %, tech=85 %, use-case=100 %
- **Avg Wörter:** 3.591 — die längsten Texte im Corpus
- **Beispiele:** `ki-hr-recruiting-mittelstand-2026`, `eu-ai-act-kmu-2026-was-wirklich-gilt`, `chatgpt-vs-claude-vs-gemini-2026-vergleich`
- **Templates:** `tool-recap-list`, `howto-step-sequence`, `concept-explainer-deck`
- **Besonderheit:** Starke Use-Case- und Data-Table-Dichte — IG-Carousels mit Tabellen als Basis für Infografik-Slides.

### Cluster 3 — „KI-Konzept einfach erklärt" (n=12, `ki-wissen`)
- **Hooks:** verdict=100 %, glossary=100 %, warnings=83 %, tech=92 %
- **Avg Wörter:** 2.820
- **Beispiele:** `deep-learning`, `transformer`, `rag`
- **Templates:** `concept-explainer-deck` (primär), `mythbuster`, `howto-step-sequence`
- **Besonderheit:** Hohe Glossary-Dichte → gut für „Begriff erklärt in 5 Slides"-Format. Step-sequence in 67 % → Schritt-für-Schritt-Variante möglich.

### Cluster 4 — „Branchen-Use-Case Hub" (n=12, `usecases`)
- **Hooks:** warnings=100 %, glossary=100 %, pricing=92 %, tech=58 %
- **Avg Wörter:** 1.260
- **Beispiele:** `softwareentwicklung-it`, `marketing-vertrieb`, `finanzen-wirtschaft`
- **Templates:** `use-case-application` (primär), `single-tool-spotlight` (für Featured Tools), `mythbuster`
- **Besonderheit:** Warnings 100 % — jeder Use-Case-Hub enthält Compliance-/Risiko-Abschnitte → `mythbuster`-Template „Was du falsch machst" sehr naheliegend.

### Cluster 5 — „Klarer Vergleichs-Kopf-an-Kopf" (n=7, `comparisons` → comparison-2)
- **Hooks:** verdict=100 %, pricing=100 %, table=100 %, use-case=100 %
- **Avg Wörter:** 1.103
- **Beispiele:** `chatgpt-vs-claude-2026`, `cursor-vs-github-copilot-2026`, `midjourney-vs-dalle-2026`
- **Templates:** `comparison-cover` (primär), `price-comparison`, `pro-con-verdict`, + je ein `single-tool-spotlight` pro Tool
- **Besonderheit:** Alle haben Datentabelle + Verdict → `comparison-cover` ist der natürlichste Carousel-Einstieg. Höchstes Recycling-Potenzial (4 Templates = max).

### Cluster 6 — „Multi-Tool-Battle" (n=4, `comparisons` → comparison-list)
- **Hooks:** verdict=100 %, pricing=100 %, table=100 %, use-case=100 %
- **Beispiele:** `cursor-vs-windsurf-vs-codeium-2026`, `midjourney-vs-flux-vs-dalle-2026`
- **Templates:** `comparison-cover` + `price-comparison` + je 3× `single-tool-spotlight`
- **Besonderheit:** Mit 3 verglichenen Tools → 5-6 Slides pro Carousel möglich; UseCase-Verdicts direkt als Slide-Content verwertbar.

### Cluster 7 — „Kategorie-Navigator" (n=7, `tool-categories`)
- **Hooks:** pricing=100 %, glossary=100 %, verdict=71 %
- **Avg Wörter:** 661 — kurze Hubs
- **Beispiele:** `coding-development`, `images-graphics`, `audio-music`
- **Templates:** `tool-recap-list` (einziges passendes)
- **Besonderheit:** Schwächster Cluster — nur 1 Template, kurze Texte (300–400 Wörter). Category-Hubs brauchen Content-Ausbau bevor sie Carousel-Kandidaten sind.

### Cluster 8 — „Spezial-Landing Deep-Dive" (n=5, `special-landings`)
- **Hooks:** pricing=100 %, tech=100 %, use-case=100 %
- **Beispiele:** `chatgpt`, `claude`, `gemini`, `midjourney`, `copilot`
- **Templates:** `single-tool-spotlight`, `price-comparison`, `pro-con-verdict`
- **Besonderheit:** Diese Landings sind die inhaltsstärksten Tool-Seiten (856 avg Wörter + FAQ). Pro Landing 3 Templates → gut.

### Cluster 9 — „How-to Deep-Dive" (n=2, `blog` → howto-guide)
- **Hooks:** verdict=100 %, warnings=100 %, steps=50 %, table=100 %
- **Avg Wörter:** 4.147 — längste Texte im Corpus
- **Beispiele:** `stable-diffusion-lokal-einrichten-einsteiger-2026`, `prompt-engineering-2026-leitfaden`
- **Templates:** `howto-step-sequence` (primär), `mythbuster`
- **Besonderheit:** Nur 2 Articles — der „Guide"-Content ist im Corpus unterrepräsentiert.

---

## Template-Bedarfs-Synthese

### Provisional-Inventory Auswertung

| Template | Articles die es nutzen können | Top-Priority Kandidaten |
|---|---|---|
| `single-tool-spotlight` | 140 | comparisons-Articles (isolierte Spotlights), special-landings |
| `price-comparison` | 140 | alle 11 comparisons, 54 tools mit pricing, 5 landings |
| `pro-con-verdict` | 74 | tools mit pros/cons, comparisons mit winner-Field |
| `tool-recap-list` | 62 | 7 category-hubs, 14 blog-opinion-pieces mit Listen |
| `use-case-application` | 62 | 12 usecases + tool-Articles mit useCases-Frontmatter |
| `mythbuster` | 52 | usecases (warnings=100 %), ki-wissen (glossary=100 %) |
| `news-breaking` | 40 | 20 blog-Articles mit news_angle |
| `howto-step-sequence` | 40 | 2 howto-guides + 10 step-sequence blog-Articles |
| `concept-explainer-deck` | 24 | alle 12 ki-wissen Articles (×DE) |
| `comparison-cover` | 22 | alle 11 comparisons |

### Empfohlene neue Templates (nicht im Provisional-Inventory)

Diese Muster tauchen in den Daten auf und sind durch kein bestehendes Template abgedeckt:

**`compliance-checklist`** — Bedarf: ~24 Articles
- Use-Cases (warnings=100 %) + Blog (EU AI Act, DSGVO-Artikel) enthalten strukturierte Pflichten/Checklisten.
- Format: "5 Dinge die du beim Einsatz von KI in [Branche] prüfen musst"
- Slides: 6–7

**`tool-tier-guide`** — Bedarf: ~54 Articles (alle tools)
- Jedes Tool hat Free/Pro/Enterprise-Tierstruktur. Kein Template deckt "Wann lohnt sich der Upgrade?" ab.
- Aktuell wird das unter `price-comparison` subsumiert, aber der Entscheidungs-Aspekt geht verloren.
- Slides: 4–5

**`use-case-verdict-per-tool`** — Bedarf: ~22 Articles (alle comparisons mit useCaseVerdicts-Frontmatter)
- comparisons enthalten strukturierte `useCaseVerdicts[]`-Arrays mit winner+reason pro Use Case.
- Dieses Array ist direkt als Slide-Series verwertbar: Folie 1 = Use Case, Folie 2 = Gewinner + Begründung.
- Slides: 7–9 (= useCaseVerdicts.length + 1 Cover)

---

## Content-Recycling-Potenzial

**Gesamt mögliche Carousels: 656** (DE+EN kombiniert)
**Avg pro Article:** 2,5 Templates
**Max pro Article:** 4 Templates (comparisons + tools mit vielen hooks)

### Top 20 Articles — höchstes Recycling-Potenzial (DE)

| Rank | Collection | Slug | Templates |
|---|---|---|---|
| 1–9 | `comparisons` | midjourney-vs-dalle-2026, runway-vs-kling-2026, gamma-vs-tome-2026, cursor-vs-github-copilot-2026, chatgpt-vs-claude-vs-gemini-2026, cursor-vs-windsurf-vs-codeium-2026, recraft-vs-ideogram-2026, chatgpt-vs-claude-2026, midjourney-vs-flux-vs-dalle-2026 | 4 je |
| 10–20 | `tools` | tavily, pika, reverso, lokalise, sora, beautiful-ai, exa, hedra, slidesai, heygen, writesonic | 4 je |

### Worst-Offenders — nur 1 Template (Content nachschärfen)

| Collection | Slug | Wörter | Problem |
|---|---|---|---|
| `tool-categories` | audio-music | 300 | Zu kurz, kein eindeutiger Fokus |
| `tool-categories` | coding-development | 334 | Zu kurz |
| `tool-categories` | business-productivity | 353 | Zu kurz |
| `tool-categories` | images-graphics | 360 | Zu kurz |
| `tool-categories` | marketing-seo | 464 | Zu kurz |
| `tool-categories` | video-animation | 347 | Zu kurz |
| `blog` | ki-musikgenerierung-2026 | 829 | Kein step-sequence, kein table |
| `blog` | ki-wissensmanagement-2026 | 664 | Kein step-sequence, kein table |
| `blog` | ai-agents-2026 | 818 | Kein step-sequence, kein table |

`tool-categories` dominieren die Worst-Offenders — 6 von 7 Category-Hubs sind mit <500 Wörtern zu kurz für mehr als 1 Template. Ausbau dieser Seiten = 6 × 2 neue Template-Optionen freigeschaltet.

---

## Drift-Detection (Astro ↔ DB)

### In Astro aber NICHT in DB (Import-Lücke)

| Collection | Locale | Slug |
|---|---|---|
| `blog` | `de` | `chatgpt-preise-2026` |
| `blog` | `de` | `code-assistenten` |

Beide existieren als MDX-Dateien im Astro-Projekt, sind aber noch nicht via Astro-Import in die DB geflossen. Die EN-Gegenstücke fehlen entsprechend ebenfalls.

### In DB aber nicht in Astro → keine Fälle

Alle 258 klassifizierten DB-Articles haben entsprechende Dateien im Astro-Projekt.

### Body-Sync-Drift

Nicht geprüft auf Byte-Ebene (kein Git-SHA-Diff). Der `git_sha`-Mechanismus der Astro-Import-Pipeline ist der korrekte Weg — dieser Audit verlässt sich darauf.

---

## Spec-Empfehlungen (priorisiert nach ROI)

### Spec 53a: `comparison-cover` Template (Priorität 1)
- **Was:** Carousel-Template für Head-to-Head-Vergleiche — Slide 1 Cover, Slides 2-N je Tool-Profil, finaler Verdict-Slide
- **Schaltet frei:** 22 Articles (11 comparisons × DE+EN) × 4 Templates-Potenzial = **88 potenzielle Carousels**
- **Begründung:** Höchste Completeness (0.543–0.475), alle haben Datentabelle + Verdict + UseCase-Verdicts in strukturiertem Frontmatter. Minimale Prompt-Arbeit — die Daten sind bereits maschinenlesbar.
- **Aufwand:** ~4–6h (Template-Design + Pipeline-Step)
- **Reihenfolge:** 1

### Spec 53b: `single-tool-spotlight` Template (Priorität 2)
- **Was:** Kompaktes 5-6-Slide-Format: Hero-Slide, 3 Stärken, Pricing, Für-wen-geeignet, CTA
- **Schaltet frei:** 140 Articles (54 tools + 22 comparisons-Derivate + 5 landings + Sonstiges)
- **Begründung:** Größte Abdeckung im Corpus. Tools haben einheitliches Frontmatter (pros/cons/rating/pricing) → Daten sind direkt injizierbar ohne Body-Parsing.
- **Aufwand:** ~4h
- **Reihenfolge:** 2

### Spec 53c (aktuell): Phase-2-Pipeline-Step (Priorität 3)
- **Was:** `article-discovery`-Enrichment als wiederverwendbarer Pipeline-Step für neue Articles (automatisch nach Import)
- **Schaltet frei:** Keine neuen Carousels, aber hält `article_discovery` aktuell bei jedem Astro-Import
- **Begründung:** Scripts laufen jetzt manuell — als BullMQ-Job nach jedem Astro-Import-Run kapseln
- **Aufwand:** ~3h
- **Reihenfolge:** 3

### Spec 53d: `concept-explainer-deck` Template (Priorität 4)
- **Was:** 6-Slide-Erklärdeck für KI-Begriffe — Frage-Folie, 3 Kernpunkte, Analogie, Weiterführendes
- **Schaltet frei:** 24 Articles (12 ki-wissen × DE+EN)
- **Begründung:** ki-wissen hat `facts[]`-Frontmatter-Array — direkt als Slide-Bullets verwendbar. Niedrige Produktionskosten.
- **Aufwand:** ~3h
- **Reihenfolge:** 4

### Spec 53e: `use-case-verdict-per-tool` Template (neu, Priorität 5)
- **Was:** Neues Template basierend auf `useCaseVerdicts[]`-Frontmatter — jeder Use Case = eigene Slide mit winner+reason
- **Schaltet frei:** 22 Articles (alle comparisons mit useCaseVerdicts)
- **Begründung:** Das `useCaseVerdicts`-Array ist 100 % maschinenlesbar und bereits in DB (`frontmatter_extras`). Zero Prompt-Engineering nötig — reines Daten-Rendering.
- **Aufwand:** ~3h
- **Reihenfolge:** 5

### Spec 53f: Category-Hub Content-Ausbau (Priorität 6)
- **Was:** 6 `tool-categories`-Articles von <500 auf ~1.500 Wörter ausbauen (echte Top-Tool-Listen mit Kurzbewertungen)
- **Schaltet frei:** 6 × 2 zusätzliche Templates = 12 neue Carousels
- **Begründung:** Aktuell nur `tool-recap-list` machbar. Mit >1.000 Wörtern + Tabelle wird `price-comparison` und `pro-con-verdict` ebenfalls möglich.
- **Aufwand:** ~6h (Content)
- **Reihenfolge:** 6

---

## Open Questions for Human Decision

1. **Template `comparison-cover` — welcher Stil?** Das `comparison-cover`-Template (Spec 51 Stunning-Integration) existiert bereits als Prototyp. Soll das neue Template auf dem bestehenden aufbauen oder als separater Render-Pfad?

2. **Zwei fehlende Blog-Articles importieren?** `chatgpt-preise-2026` und `code-assistenten` liegen in Astro, sind aber nicht in DB. Soll der nächste Astro-Import-Run diese aufnehmen, oder gibt es einen Grund warum sie noch fehlen?

3. **EN-Carousels — separate Generierung oder immer paarweise?** Alle Templates könnten DE+EN parallel erzeugen. Kostet ~2× bei Image-Gen. Oder nur DE zuerst, EN bei Bedarf?

4. **`tool-categories`-Ausbau** — ist das eine Redaktionsaufgabe (manuell schreiben) oder soll eine Pipeline diese Seiten automatisch mit Tool-Daten aus der DB anreichern?

5. **`single-tool-spotlight` für Tools mit avg 212 Wörtern** — der Body ist kurz, aber die Frontmatter-Arrays (pros/cons/features/useCases) sind reich. Soll das Template primär aus Frontmatter oder aus Body-Parsing befüllt werden?

6. **Priorität comparisons vs. tools?** Comparisons haben max 4 Templates und starke Datenbasis, aber nur 22 Articles. Tools haben ~3 Templates und 108 Articles. Welcher Cluster soll als erstes in Produktion gehen?
