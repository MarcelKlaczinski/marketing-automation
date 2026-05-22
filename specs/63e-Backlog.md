# Toolwiki Phase-E Backlog (Stand 2026-05-21)

Konsolidierter Stand nach Theme 63 fast-komplett (63.5 ausstehend).

---

## Top-Priority Phase-E Items

### 1. Social-Article Decoupling

**Problem:** Social-Posts haben aktuell Hard-Dependency auf Article-Frontmatter. Social-Generation läuft IM Article-Pipeline als post-Step — heißt: jeder Social-Post triggert Article-Generation als Vorbedingung.

**Konsequenzen:**
- Cost-Explosion bei Social-heavy Plans (jeder Social = €1+ via Article-Pipeline auch wenn Article schon existiert)
- Standalone-Social-Posts (z.B. nur Tool-Hochlights ohne Long-Form-Article) unmöglich
- Frontmatter-Lücken (z.B. fehlende description) crashen Social-Generation
- Topic-basierte Social-Posts (Trend-Posts, News-Recaps) brauchen Workaround

**Lösungsskizze (3 Ebenen):**

1. **Fallback-LLM für Frontmatter-Lücken**
  - Wenn `article.description` leer → LLM generiert aus title + intent + tools
  - Wenn `article.category` leer → ableiten aus cluster_id / Tool-Tags
  - Defensive Path damit Social-Generation nicht crasht bei unvollständigem Frontmatter

2. **Article-Reference statt Article-Generation**
  - Social-Pipeline akzeptiert `existingArticleId` als Input
  - Wenn Article existiert: lade Frontmatter aus DB, generate Social
  - Wenn nicht: optional triggern → oder skip / fallback to standalone

3. **Standalone-Social-Generation**
  - Social-Pipeline direkt von Brief → Social ohne Article-Pipeline
  - Input: brief.primaryKeyword + brief.topicTitle + brief.intentType + optional tool-IDs
  - Output: 3-5 Social-Slides (carousel template) basierend auf Topic, nicht Article

**Aufwand:** ~1-2 Tage, dependencies auf Template-Engine

**Trigger:** spätere News-Recap, Tool-Highlight, Trend-Posts ohne Long-Form-Content

---

### 2. Deterministisches Cluster-Routing für ComparisonDiscovery

**Problem (heute identifiziert):** ComparisonDiscovery erzeugt Briefs ohne clusterId. Comparison-Guard-Variante-2-Fix lässt sie durchlaufen mit clusterId=NULL. RelatedComparisons.astro nutzt nur toolSlugs (kein clusterKey), daher kein User-Visible-Bug.

**Aber langfristig:** ComparisonDiscovery sollte Briefs deterministisch zu existing Comparison-Cluster mappen (z.B. "ai-chatbots-vergleich", "translation-tools-vergleich") basierend auf Tool-Pair-Categories.

**Aufwand:** ~0.5 Tag

**Trigger:** bessere SEO via Hub-Spoke für Comparison-Cluster

---

### 3. GitHub-Tool-Inventory als eigenes Subsystem

**Problem:** etablierte AI-Tools (claude-code, simonw/llm, OpenAI codex CLI, etc.) als Content-Hooks behandeln — NICHT via signals-Tabelle weil sie nicht news-driven sind.

**Lösungsskizze:**
- Eigene `tool_inventory` Tabelle mit GitHub-Repo-Refs
- Periodisch Star-Count, Release-Notes, README-Updates lesen
- Brief-Generation aus Tool-Inventory für "Spotlight"-Articles
- Separater Pipeline von Trend-Discovery

**Aufwand:** ~1-2 Tage

---

### 4. Distribution-Layer auf Content-Planner

**Problem:** Content-Planner sagt WAS generiert wird (Theme 60). Aber WANN+WO posten fehlt.

**Lösungsskizze (gestaffelt):**
- V1: Statisches Time-Schema pro Channel (Mo 09:00 LinkedIn, Mi 16:00 Twitter, etc.)
- V2: Engagement-driven Scheduling (analytics-aware)
- Schichten klar trennen: Planner = WAS, Distribution = WANN+WO

**Aufwand:** V1 ~1 Tag, V2 ~3-5 Tage

---

## Mid-Priority Phase-E Items

### 5. Hero-Image Quality (Prompt-Optimierung)

**Symptom (Marcel 2026-05-21 Abend):** Bisher von `article:draft` Pipeline generierte Hero-Images sind qualitativ schlecht. Konkret:
- Random Pseudo-Schrift im Bild (typisches DALL-E/Ideogram Problem)
- Nichtssagende generische Stock-Art statt content-spezifischer Visuals
- Marcel-Vermutung: Image-Prompt wird auf Deutsch erzeugt obwohl Image-Models primär auf englischen Captions trainiert sind

**Hypothesen:**
- H1: Image-Prompt-Step nutzt deutsche topic_title/primary_keyword direkt ohne EN-Translation
- H2: Prompt-Template hat keine "kein Text im Bild" Negative-Constraints
- H3: Image-Generation läuft mit suboptimalem Model/Settings (DALL-E 2 statt 3, alte Ideogram-Version)
- H4: Hero-Image-Prompt zu kurz/abstrakt → Model improvisiert generisch

**Lösungsskizze:**
1. Image-Prompt immer auf Englisch — LLM-Translation-Step vor Image-Gen wenn Article DE
2. Negative Constraints im Prompt: "no text, no letters, no typography, no signage"
3. Composition-Hints je nach Article-Typ: "professional product photography, clean composition" / "modern abstract illustration, no UI"
4. Phase 0 prüfen welches Image-Model + Settings aktuell verdrahtet sind
5. Optional Quality-Eval: OCR-Check via Tesseract auf generiertem Bild → wenn random Schrift erkannt, re-generate

**Wann triggern:** wenn Prompt-Optimierung an die `image-prompt`-Phase kommt — Marcel signalisiert es. Nicht jetzt akut.

**Aufwand:** Diagnose ~30 Min, Fix ~0.5-1 Tag

---

### 6. Longitudinal Plan-Diversity

**Problem:** 63.5 macht Diversity innerhalb eines Plans. Aber wenn KW21 RAG hatte, sollte KW22 nicht wieder RAG haben.

**Lösungsskizze:** Floor-Diversity-Helper bekommt zusätzlich initial-set aus letzten 2-3 Plan-Wochen.

**Aufwand:** ~0.5 Tag (Erweiterung von 63.5)

---

### 7. "Push Cluster Build Link Error" Diagnose + Fix

**Symptom:** Marcel sieht gelegentlich BullMQ job failure für cluster:link-rebuild während paralleler Claude-Code-Streams.

**Bekannt:**
- Pipeline-Name cluster:link-rebuild
- Triggered von astro-sync + cluster-link CLI
- jobId = link-rebuild-CLUSTERID (BullMQ dedup)
- Sehr wahrscheinlich: Cluster lacks expected articles after partial sync

**Aufwand:** Diagnose ~30 Min, Fix abhängig vom Befund

---

### 8. Precomputed brief.embedding

**Problem:** 63.5 macht on-the-fly Voyage embeddings pro Plan-Run. Cost ~€0.01 pro Run.

**Wenn skaliert:** vorzucomputen wäre besser. Migration für topic_briefs.embedding column + HNSW-Index.

**Trigger:** Wenn Plan-Runs > 5/Woche oder Latenz-Problem auftritt.

**Aufwand:** ~0.5 Tag (Migration + Backfill)

---

### 9. DataForSEO_trends als Signal-Adapter

**Problem:** existing DataForSEO_trends Code ist nicht als first-class Signal-Adapter integriert. Trends-Signals kommen primär von HN/PH/RSS.

**Trigger:** zusätzliche Signal-Source für Trend-Synthesizer

**Aufwand:** ~1 Tag (Adapter analog 59.1a Pattern)

---

### 10. Reddit-Auth aktivieren wenn Credentials da

**Wartet auf OAuth-Credentials.** Adapter ist code-complete (Spec 63.8 hat zusätzlich cron_state row geseedet damit project-create alle 5 signal_collector_* aligned hat).

Wenn Credentials kommen:
- `global_credentials` Insert
- `signal_sources.reddit.enabled` → true
- `cron_state.signal_collector_reddit.is_active` → true
- Subreddit-Liste in Project-Config definieren

**Aufwand:** ~10 Min wenn Credentials vorliegen.

**Erledigt aus dieser Sektion (heute):**
- ✅ HN-Filter-Tuning → Spec 63.9 (Algolia OR silent degradation, 19 single-word queries)
- ✅ PH-Votes Key-Mismatch → Spec 63.8 Item B (votes_count snake_case)

---

## Low-Priority / Backlog-Notes

### 11. GitHub Enabled-JSON Inkonsistenz

**Problem:** GitHub-Signal-Adapter speichert enabled Status inkonsistent (sometimes JSON, sometimes bool column).

**Aufwand:** ~30 Min Cleanup

### 12. 62.5.1 done (Status-Update)

Spec 62.5.1 ist abgeschlossen, hier nur zur Erinnerung wenn jemand sucht.

### 13. Knowledge-Hub-Spoke DO-NOT-FIX Rule

Spec 63.4 ließ Knowledge-Briefs in Tools-Cluster zu (siehe Memory D147). Dokumentiert in CLAUDE.md.

Wenn später semantische Verschmutzung in production sichtbar wird: Schutz-Branch in emit-brief.ts hinzufügen. **Nicht jetzt.**

---

## Erledigt heute (zur Referenz)

- Theme 62 komplett (62.0a/b, 62.2, 62.3, 62.4, 62.5/5.1, 62.6, 62.7, 62.8)
- Theme 63 fast komplett (63.1, 63.2, 63.3a/b, 63.4, 63.6, 63.7a/b/c)
- Anthropic 400 Fix
- Comparison-Guard Mini-Fix
- 7 Briefs Rollback
- BriefsPage Filters + Approve Fixes
- loadToolInfo Fallback-Cascade
- Comparison-Goal Update (2/4)
- 3× KW21 Plan-Regenerate
- Cluster-Routing-Diagnose
- gap_analysis Discovery + Agent Suggest
- Memory-Updates D124-D148

## Ausstehend morgen

- 63.5 Floor topic-diversity (Spec bereit, läuft Implementation)
- Re-Approve 11 Briefs aus dem Pool
- Plan KW22 generieren mit allen Quality-Improvements
- Einzelner End-to-End-Test mit einem Cluster-Item
