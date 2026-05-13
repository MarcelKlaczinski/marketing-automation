# Spec 54b — Discovery-Backfill als Claude-Code-Task

**Type:** One-Shot Migration / Data-Population
**Estimate:** 2-3h Claude Code session + 30min für DB-Migration vorbereiten
**Depends on:** keine — kann sofort laufen
**Goal:** `article_discovery`-Tabelle für alle 281 existing Articles populated

---

## Context

Wir haben aktuell:
- 281 Articles in `articles` Tabelle (268 imported, 13 generated)
- `article_discovery` Tabelle existiert (durch DB-Audit-Run aus Spec-Vorbereitung)
- Phase 2-Felder (contentHooks, suggestedTemplates) sind aktuell mit Regex-Heuristik gefüllt, nicht mit echtem LLM

**Diese Spec:** Ersetze Regex-Phase-2 mit echter LLM-Klassifikation. Läuft als **Claude-Code-Task** (du startest via `/start-task`), NICHT als API-Pipeline. Saubere Baseline für alles weitere.

**Warum Claude-Code statt API-Script:**
- Claude Code hat existing quota — keine zusätzliche API-Kosten
- Edge-Case-Detection: Claude kann während Klassifikation reportieren wenn Patterns auftauchen die kein bestehendes Template abdeckt
- Interactive: bei unklaren Cases kann Claude pausieren und fragen statt blind klassifizieren
- One-shot: läuft einmal, danach nicht mehr — passt zu Claude-Code-Task-Modell

Future imports werden durch Spec 54c automatisch enrichted, dann ist diese One-Shot-Task obsolete.

---

## Task-Definition für Claude Code

Diese Datei ist NICHT eine traditionelle Code-Spec — sondern ein **Prompt-Skript** das du via `/start-task` an Claude Code übergibst. Claude Code arbeitet die Steps sequenziell ab, fragt bei Unklarheiten zurück.

---

## Pre-Flight Checks (Claude führt aus, USER approved)

Bevor Claude irgendwas in der DB ändert:

```sql
-- Check 1: article_discovery Tabelle existiert
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'article_discovery'
);
-- Expected: true. Falls false: erst Migration 0028 ausführen.

-- Check 2: Wie viele Records sind schon drin?
SELECT 
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE enrichment_mode = 'llm_enriched') AS llm_enriched,
  COUNT(*) FILTER (WHERE enrichment_mode = 'deterministic') AS deterministic_only,
  COUNT(*) FILTER (WHERE enrichment_mode IS NULL) AS not_enriched
FROM article_discovery;

-- Check 3: Articles ohne Discovery
SELECT COUNT(*) AS articles_without_discovery
FROM articles a
LEFT JOIN article_discovery d ON d.article_id = a.id
WHERE d.id IS NULL
  AND a.collection != 'authors';  -- authors excluded

-- Check 4: Articles mit veralteter (Regex-)Enrichment
SELECT COUNT(*) AS articles_with_regex_enrichment
FROM article_discovery
WHERE enrichment_mode = 'deterministic'
  AND content_hooks IS NOT NULL
  AND jsonb_array_length(content_hooks) > 0;
```

Claude reports an User:
- Wie viele Articles brauchen full LLM-Enrichment? (= articles_without_discovery + articles_with_regex_enrichment)
- Geschätzter Cost: count × ~$0.005 = total cost estimate
- Geschätzte Zeit: bei sequenziell mit Haiku ~30s pro Article, bei batch von 10 entsprechend ~10s pro Article

**User-Approval-Pause:** "Proceed? (y/n)"

---

## Phase 1: Deterministic-Backfill (falls noch nicht geschehen)

Für Articles die noch GAR KEINEN article_discovery-Record haben, erst deterministic-Felder berechnen.

Pro Article:
1. Lies `articles` row + `articles.import_metadata` (JSONB) + `articles.frontmatter_extras` (JSONB)
2. Berechne:
  - `word_count` aus `import_metadata.wordCount` (oder `articles.word_count` für generated)
  - `header_count_h2/h3` aus `import_metadata.headings[]`
  - `header_slugs[]` aus `import_metadata.headings[].id`
  - `link_count_internal/external` aus `import_metadata.internalLinks` + `body_md`-parsing für external
  - `paragraph_count`, `code_block_count`, `table_count`, `list_count_ul/ol` aus `body_md`-parsing
  - `has_affiliate_links` aus `import_metadata.hasAffiliateLinks`
  - `referenced_tools[]` collection-spezifisch:
    - `comparisons`: `frontmatter_extras.toolSlugs`
    - `usecases`: `frontmatter_extras.featuredToolSlugs`
    - `tools`: [own slug]
    - `blog`: `frontmatter_extras.primaryTool` if exists
  - `container_form_hint` aus Container-Form-Mapping (siehe unten)
  - `completeness_score` per Heuristik (Frontmatter-Felder befüllt / required Felder)
  - `estimated_angles` = h2-Count
3. INSERT in `article_discovery` mit `enrichment_mode = 'deterministic'`

**Container-Form-Mapping** (korrigiert für echte Collections):

```typescript
function getContainerFormHint(article: Article): string {
  switch (article.collection) {
    case 'tools':
      return 'single-tool-deep-dive';
    case 'comparisons': {
      const toolCount = (article.frontmatter_extras?.toolSlugs ?? []).length;
      return toolCount === 2 ? 'comparison-2' : 'comparison-list';
    }
    case 'ki-wissen':
      return 'concept-explainer';
    case 'usecases':
      return 'application-scenario';
    case 'blog': {
      // distinction howto-guide vs news-update vs opinion-piece
      const title = article.title.toLowerCase();
      const hasHowto = /how to|so |schritt|step|leitfaden|tutorial/i.test(title);
      if (hasHowto) return 'howto-guide';
      
      const ageInDays = differenceInDays(new Date(), article.published_at);
      if (ageInDays < 60) return 'news-update';
      return 'opinion-piece';
    }
    case 'tool-categories':
      return 'category-hub';
    case 'special-landings':
      return 'landing-page';
    case 'authors':
      return 'author-profile';  // wird excluded
    default:
      return 'unknown';
  }
}
```

---

## Phase 2: LLM-Enrichment (Claude liest body_md + klassifiziert)

Für jeden Article (außer authors):

Claude bekommt diesen Sub-Prompt pro Article (oder Batch von 10):

```
Klassifiziere diesen Article für Instagram-Carousel-Template-Routing.

ARTICLE-METADATA:
- Slug: {slug}
- Collection: {collection}
- Locale: {locale}
- Title: {title}
- Container-Form-Hint (deterministisch): {containerFormHint}
- Word-Count: {wordCount}
- H2-Headings: {headerSlugs[]}
- Referenced Tools: {referencedTools[]}

BODY-EXCERPT (first 2000 chars):
{body_md_excerpt}

FRONTMATTER-EXTRAS:
{JSON.stringify(frontmatter_extras)}

TASK:
1. Identifiziere welche der folgenden contentHooks im Article präsent sind:
   - has_verdict, has_step_sequence, has_numbered_list, has_pro_con_lists,
     has_use_case_examples, has_warnings, has_pricing_data, has_quotes_or_testimonial,
     has_technical_detail, has_visual_demo_refs, has_data_table, has_glossary_terms,
     has_news_angle
   
   Sei STRENG — nur tag wenn das Hook signifikant präsent ist, nicht bei einer
   einzelnen Erwähnung. Bsp: has_data_table NUR wenn echte Markdown-Tabelle existiert,
   nicht wenn das Wort "Tabelle" im Text vorkommt.

2. Schreibe einen narrativeArc-String (2-3 Sätze): was ist die Story-Logik des Articles?
   Vermeide generische Phrasen wie "stellt das Tool vor" — sei spezifisch.

3. Bestimme suggestedTemplates aus dieser Liste:
   - comparison-stunning           (eligibility: comparison-2 oder comparison-list)
   - use-case-verdict-per-tool     (eligibility: useCaseVerdicts >= 3 in frontmatter)
   - single-tool-spotlight         (eligibility: single-tool-deep-dive oder spotlight aus comparison)
   - news-slide                    (eligibility: news-update collection)
   - listicle-carousel             (eligibility: best-of-list patterns)
   - concept-explainer-deck        (eligibility: concept-explainer collection)
   - mythbuster                    (eligibility: has_warnings AND has_use_case_examples)
   - pro-con-verdict               (eligibility: has_pro_con_lists AND has_verdict)
   - price-comparison              (eligibility: has_pricing_data AND tools.length > 1)
   - howto-step-sequence           (eligibility: has_step_sequence AND wordCount > 1000)
   
   Pro Suggestion: confidence 0-1, primaryAngle (was wäre der Hook?), estimatedSlides

4. Wenn der Article ein Pattern hat das KEIN bestehendes Template abdeckt:
   Reporte das als "templateGap" mit Beschreibung.

5. Berechne estimatedCarousels = Anzahl suggestedTemplates mit confidence >= 0.6

GIB JSON ZURÜCK:
{
  "contentHooks": ["has_X", "has_Y"],
  "narrativeArc": "Spezifische 2-3 Sätze",
  "suggestedTemplates": [
    {
      "templateKey": "...",
      "confidence": 0.95,
      "primaryAngle": "...",
      "estimatedSlides": 4
    }
  ],
  "estimatedCarousels": 3,
  "templateGap": null  // oder { "pattern": "...", "description": "..." }
}
```

Claude verarbeitet Articles in Batches von 10, persistiert nach jedem Batch.

**Skip-Logic:**
- Wenn `article_discovery.enrichment_mode = 'llm_enriched'` UND `content_hash === current_hash` → skip
- Wenn `enrichment_mode = 'deterministic'` → re-enrich (Regex-Daten ersetzen)
- Wenn `enrichment_mode IS NULL` → full Phase 1 + Phase 2

**Content-Hash für Idempotenz:**

```sql
ALTER TABLE article_discovery 
  ADD COLUMN IF NOT EXISTS content_hash text;

-- Nach jedem Enrichment:
UPDATE article_discovery
SET content_hash = md5(body_md || frontmatter::text),
    enrichment_run_at = now(),
    enrichment_mode = 'llm_enriched'
WHERE article_id = $1;
```

---

## Phase 3: Reporting

Nach Phase 2 erzeugt Claude einen Markdown-Report `/tmp/discovery-backfill-report.md`:

```markdown
# Discovery-Backfill Report

## Run-Stats
- Articles processed: N
- Already up-to-date (skipped): M
- Newly enriched: K
- Failed: J (siehe errors)

## Cost Summary
- LLM-Calls: total tokens, total cost USD
- Avg cost per article

## Pattern Distribution (post-enrichment)
Tabelle mit contentHooks-Frequencies (echte LLM-Daten jetzt)

## Template-Eligibility Summary
Wie viele Articles sind eligible für welches Template?

| Template | Eligible Articles | High-Confidence (>=0.85) |
|----------|---|---|
| comparison-stunning | X | Y |
| use-case-verdict-per-tool | X | Y |
| single-tool-spotlight | X | Y |
| ... | | |

## Template-Gaps gefunden
Liste der Pattern die kein bestehendes Template abdeckt — pro Pattern:
- Anzahl betroffener Articles
- Beispiel-Slugs (3)
- Vorgeschlagenes neues Template-Konzept

## Errors / Edge-Cases
Articles wo LLM-Klassifikation gescheitert ist oder ambiguous war.
Pro Error: article-slug, Grund, manual review nötig.

## Drift seit Regex-Audit
Wo unterscheiden sich LLM-Ergebnisse signifikant von Regex-Ergebnissen?
Z.B. "Regex sagte has_pro_con_lists für 92%, LLM sagt 40%."
Diese Drift ist erwartet (LLM strenger) — aber wenn LLM viel weniger streng wäre, ist das Signal für Prompt-Issues.

## Spec-Empfehlungen Update
Falls templateGaps gefunden: konkrete Spec-Vorschläge inkl. Article-Count + Aufwand.
```

User reviewed Report. Bei Surprises kann er entscheiden: re-run, fix prompt, oder akzeptieren.

---

## Phase 4: Cleanup-SQL (optional, USER approved)

Falls in Phase 0 herauskam dass alte Regex-Phase-2-Daten existieren und überschrieben werden sollen:

```sql
-- Backup vor Cleanup
CREATE TABLE article_discovery_regex_backup AS
SELECT * FROM article_discovery
WHERE enrichment_mode = 'deterministic'
  AND content_hooks IS NOT NULL;

-- Update wird via Phase 2 schon erledigt, dieser Step ist nur Bestätigung
SELECT COUNT(*) FROM article_discovery
WHERE enrichment_mode = 'llm_enriched';
-- Expected: ~281 (minus authors minus failures)
```

---

## Cost-Estimate

| Phase | Articles | Cost-Annahme | Total |
|-------|----------|--------------|-------|
| Phase 1 (deterministic) | ~50 (die noch keinen record haben) | $0 | $0 |
| Phase 2 (LLM via Claude Code quota) | ~258 | $0 (via Claude Code) | $0 |

Total Cost via Claude Code: **$0** (deine Quota wird verwendet).

Falls Claude Code Quota nicht reicht und Fallback auf Haiku-Batch-API:
- ~258 articles × ~5k input tokens + 500 output tokens = ~1.4M input + 130k output tokens
- Haiku batch pricing: ~$0.40 input + $0.10 output = **~$0.50 total**

---

## Acceptance

- ✅ `article_discovery` hat Record für jeden non-author Article in `articles`
- ✅ Alle Records haben `enrichment_mode = 'llm_enriched'` und `content_hash`
- ✅ contentHooks-Distribution ist realistic (Vergleich mit Regex-Audit: deutliche Drift erwartet, das ist GOOD)
- ✅ Mindestens 1 templateGap identifiziert UND als Spec-Empfehlung formuliert (oder explizit "keine Gaps gefunden")
- ✅ Backfill-Report im PR / Commit-Message

---

## How to Run

```bash
# Voraussetzung: lokale DB-Connection im Marketing-Tool-Setup funktional
cd ki-wissensraum-v2

# Starte Claude Code mit dieser Spec-File
claude /start-task /pfad/zu/spec-54b-discovery-backfill-task.md
```

Claude Code arbeitet die Phasen sequenziell ab, hält an User-Approval-Pausen, dokumentiert in `/tmp/discovery-backfill-report.md`.

Bei Underbruch (z.B. Quota erreicht): Resume durch erneuten `/start-task`-Call. Skip-Logic via content_hash sorgt für Idempotenz.

---

## Post-Run

Nach erfolgreichem Run:
1. Review Report
2. Falls templateGaps gefunden → neue Specs schreiben (außerhalb dieser Task)
3. `article_discovery` ist Foundation für Spec 54c (Discovery-Pipeline-Integration) und Spec 54d (Preview-Gallery)
4. Diese Spec-File kann archiviert werden — One-Shot ist done.
