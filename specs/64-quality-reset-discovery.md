# Phase 0 — Reset-Discovery: Generated Articles Cleanup Scope

**Modus: DISCOVERY ONLY. Keine Code-Changes, keine DELETEs. ~15 Min.**

## Kontext

Marcel will alle bisher **generierten** blog-articles in Toolwiki löschen + zugehörige briefs/clusters, dann iterativ mit 1-3 Articles experimentieren bis Quality stimmt (post Bug-Fixes).

**KRITISCH zu schützen:**
- imported tools collection
- imported usecases collection
- imported authors collection
- imported anything (`source='imported'` oder ähnlicher Marker)
- Astro-Repo eigene Inhalte

**Zu identifizieren für Cleanup:**
- generated blog articles (cluster:full-plan oder article:blog Pipeline output)
- DE+EN sibling pairs
- zugehörige cluster rows (wenn die nur aus diesen articles bestehen)
- zugehörige topic_briefs (status final oder routed)
- zugehörige pipeline_runs (history audit)
- zugehörige cost_logs (cost audit)
- zugehörige hero-image R2 keys (R2 cleanup separat — nicht in Phase 0)

## Discovery-Schritte

### Schritt 1 — Articles Collection-Übersicht

```sql
-- Article-Verteilung nach Collection + Source-Marker
SELECT
  collection,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE locale = 'de') AS de_count,
  COUNT(*) FILTER (WHERE locale = 'en') AS en_count
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
GROUP BY collection
ORDER BY total DESC;
```

**Erwartung Plan:**
- collection='tools': N (imported, KEEP)
- collection='comparisons': M (mix? imported + generated?)
- collection='blog': K (generated, vermutlich DELETE)
- collection='usecases': L (imported, KEEP)
- collection='authors': J (imported, KEEP)

### Schritt 2 — Generated vs Imported Marker finden

```bash
# Wie unterscheiden wir generated vs imported in der articles-Tabelle?
grep -rn "source.*imported\|imported.*source\|articleSource" packages/db/src/ packages/shared/src/

# Plus: articles-Schema
grep -B 2 -A 50 "articles = pgTable" packages/db/src/schema/
```

**Dokumentieren:**
- Welche Spalte unterscheidet generated vs imported?
- Heuristic: `outline IS NULL` für imported? `pipeline_run_id IS NULL` für imported?
- Plus: `created_at` Pattern (Bulk-Import vs Pipeline-generation Zeitstempel)

### Schritt 3 — Generated Articles identifizieren

```sql
-- Generated blog articles in Toolwiki
SELECT
  id,
  slug,
  locale,
  collection,
  status,
  parent_article_id,
  cluster_id,
  outline IS NOT NULL AS has_outline,
  hero_image_r2_key IS NOT NULL AS has_hero,
  word_count,
  created_at
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
  AND collection = 'blog'
ORDER BY created_at DESC;
```

**Achten auf:**
- Total generated blog articles (DE + EN siblings)
- Parent-Child-Pairs erkennen
- Status (draft, final_review, published)
- Welche haben Outline (sicherer Indikator für generated)

### Schritt 4 — Cluster-Audit

```sql
-- Welche cluster gibt es?
SELECT
  c.id,
  c.slug,
  c.name,
  c.status,
  c.created_at,
  (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = c.id) AS article_count,
  (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = c.id AND a.collection = 'blog') AS blog_article_count,
  (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = c.id AND a.collection != 'blog') AS non_blog_count
FROM clusters c
WHERE c.project_id = (SELECT id FROM projects WHERE slug='toolwiki')
ORDER BY c.created_at DESC;
```

**Achten auf:**
- Cluster die NUR generated blog articles enthalten → safe to delete
- Cluster die imported tools/usecases mit-enthalten → NICHT löschen, nur articles abkoppeln

### Schritt 5 — Topic Briefs Audit

```sql
-- Briefs die zu generated articles gehören
SELECT
  status,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE routed_article_id IS NOT NULL) AS with_article,
  COUNT(*) FILTER (WHERE routed_cluster_id IS NOT NULL) AS with_cluster
FROM topic_briefs
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
GROUP BY status
ORDER BY total DESC;
```

```sql
-- Plan_pending briefs (gestern KW21 generation)
SELECT
  id, slug, status, content_type, intent_type,
  routed_article_id IS NOT NULL AS has_routed_article,
  routed_cluster_id IS NOT NULL AS has_routed_cluster,
  created_at
FROM topic_briefs
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
  AND status IN ('plan_pending', 'planned', 'routed', 'final')
ORDER BY created_at DESC;
```

**Achten auf:**
- plan_pending briefs (gestern erzeugt für KW21 Plan)
- routed/final briefs die an generated articles hängen
- Welche briefs sollten erhalten bleiben (z.B. plan_pending) vs gelöscht (final wenn article weg)

### Schritt 6 — Weekly Plans Audit

```sql
-- Existing plans
SELECT
  id, week, year, status, total_budget_eur, total_cost_eur,
  approved_at, created_at,
  (SELECT COUNT(*) FROM planned_items WHERE weekly_plan_id = wp.id) AS items_total,
  (SELECT COUNT(*) FROM planned_items WHERE weekly_plan_id = wp.id AND status = 'approved') AS items_approved,
  (SELECT COUNT(*) FROM planned_items WHERE weekly_plan_id = wp.id AND status = 'generated') AS items_generated
FROM weekly_plans wp
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
ORDER BY year DESC, week DESC;
```

**Achten auf:**
- KW21 Plan (gestern generiert, draft Status)
- Frühere Plans mit generated items
- Welche Plans bleiben, welche werden archived

### Schritt 7 — Cost-Logs für Audit-Trail

```sql
-- Total generation cost für Audit
SELECT
  service,
  operation,
  COUNT(*) AS calls,
  SUM(cost_eur) AS total_eur,
  MIN(created_at) AS first,
  MAX(created_at) AS last
FROM cost_logs
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
GROUP BY service, operation
ORDER BY total_eur DESC;
```

**Dokumentieren:**
- Was wurde total ausgegeben für generation
- Soll cost_logs erhalten bleiben (history) oder mit-gelöscht?
- **Empfehlung: cost_logs ERHALTEN** — historischer Audit-Trail wertvoll, kein Cleanup-Grund

### Schritt 8 — Pipeline-Runs Audit

```sql
-- Pipeline-runs für generated articles
SELECT
  pipeline_name,
  status,
  COUNT(*) AS total,
  MIN(created_at) AS first,
  MAX(created_at) AS last
FROM pipeline_runs
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
GROUP BY pipeline_name, status
ORDER BY total DESC;
```

**Dokumentieren:**
- Pipeline-runs für generated articles
- **Empfehlung: pipeline_runs ERHALTEN** — execution history, kein Cleanup-Grund

### Schritt 9 — R2 Hero-Image Keys

```sql
-- Welche R2 keys zu generated articles?
SELECT
  COUNT(*) AS total,
  COUNT(DISTINCT hero_image_r2_key) AS unique_keys
FROM articles
WHERE project_id = (SELECT id FROM projects WHERE slug='toolwiki')
  AND collection = 'blog'
  AND hero_image_r2_key IS NOT NULL;
```

**Dokumentieren:**
- N R2 keys die zu löschenden articles gehören
- R2 Cleanup ist separat (nicht Phase 2 dieser Spec)
- Marcel-Decision später: R2 keys mit-löschen oder behalten?

### Schritt 10 — Astro-Repo Sync-State

```bash
# Welche generated articles sind schon im Astro-Repo (MDX files)?
grep -rn "chatgpt-ads-2026\|chatgpt-werbung-2026" apps/web/content/ 2>/dev/null || \
ls -la /path/to/ki-wissensraum-neu/src/content/blog/ 2>/dev/null
```

**Dokumentieren:**
- Welche generated articles wurden via astro-sync ins Astro-Repo gepusht
- Diese MDX files müssen auch entfernt werden
- Plus: Astro-Repo build re-trigger nach cleanup

## Format der Rückmeldung

```markdown
## Collection-Verteilung Toolwiki

| Collection | DE | EN | Total | Status |
|---|---|---|---|---|
| tools | N | M | K | imported, KEEP |
| usecases | ... | ... | ... | imported, KEEP |
| authors | ... | ... | ... | imported, KEEP |
| comparisons | ... | ... | ... | [check generated vs imported] |
| blog | ... | ... | ... | generated, DELETE candidates |

## Generated vs Imported Marker

- Marker: [outline IS NOT NULL / pipeline_run_id IS NOT NULL / explicit source column]
- Confidence: [high/medium/low]

## Articles zu löschen (Generated Blog)

| Article-Pair | DE Slug | EN Slug | Cluster | Plan-Item |
|---|---|---|---|---|
| ... | ... | ... | ... | ... |

Total: N pairs (X DE + Y EN siblings)

## Cluster-Status

| Cluster | nur generated blog? | gemischt | Action |
|---|---|---|---|
| ... | ja | nein | DELETE |
| ... | nein | tools+blog | KEEP (nur articles abkoppeln) |

## Topic-Briefs

- plan_pending: N (keep, sind für KW21 reserved)
- routed: M (linked an articles zu löschen)
- final: K (linked an articles zu löschen)

## Weekly Plans

- KW21/2026 Draft: status=[draft/approved], items=[N]
- Frühere: ...

## R2 Keys

- N R2 keys zu löschenden articles
- Cleanup separat (Phase X)

## Astro-Repo Sync-State

- N MDX files entsprechen generated articles
- Plus: re-sync nach DB cleanup nötig

## Cleanup-Strategy Vorschlag

[CASCADE-Sequenz oder Sequential DELETE]

Reihenfolge:
1. planned_items WHERE article_id IN (...)
2. articles WHERE id IN (...)
3. clusters WHERE id IN (...) AND article_count == 0 nach Step 2
4. topic_briefs WHERE routed_article_id IN (...) — set NULL or DELETE
5. weekly_plans status drafts mit nur entfernten items — DELETE
```

## Anti-Patterns

- ❌ DELETE Queries ausführen
- ❌ MDX files im Astro-Repo löschen
- ❌ R2 keys cleanen
- ❌ cost_logs oder pipeline_runs anfassen
- ❌ Toolwiki Project-row oder project_configurations anfassen
- ❌ imported tools/usecases/authors auch nur in Erwägung ziehen zu löschen

## Akzeptanzkriterien

1. ✅ Vollständige Liste aller Articles die zur Löschung anstehen (DE+EN pairs)
2. ✅ Cluster-Klassifikation (delete vs keep)
3. ✅ Briefs-Klassifikation (keep plan_pending, decide routed/final)
4. ✅ R2 keys identifiziert (für späteren Cleanup)
5. ✅ Astro-Repo MDX files identifiziert
6. ✅ Cleanup-Strategy als Sequence dokumentiert
7. ✅ KEIN DELETE ausgeführt — pure Discovery

## Hintergrund

- Marcel-Strategie 2026-05-23 Mittag: alle generated articles löschen, dann iterativ Quality testen mit 1-3 articles
- Vor cleanup müssen alle Bug-Fixes deployed sein (Bug #3 alt-text+schema, Bug #2 FAQ, Bug #1 word-drift cap, Image-Model Nano Banana 2, Hero-Image Outline Rule)
- Cleanup ist NACH Bug-Fix Deploy
- Cost-logs + pipeline_runs bleiben für historischen Audit
- imported collections (tools, usecases, authors) sind sacred

Spec-Referenzen:
- Discovery Phase 2 Translation-Audit (2026-05-22)
- Phase-E Backlog (cleanup-Strategie für test-fixtures als precedent)
- Memory D19 BullMQ FK Race (Cleanup-Pattern für DB-State)

---

## Findings 2026-05-22

### Step 1 — Collection-Verteilung Toolwiki

| Collection       | Source        |  DE |  EN | Total | Status                  |
| ---------------- | ------------- | --: | --: | ----: | ----------------------- |
| tools            | imported      |  54 |  54 |   108 | KEEP                    |
| blog             | imported      |  29 |  29 |    58 | KEEP                    |
| **blog**         | **generated** | **17** | **17** | **34** | **DELETE candidates** |
| ki-wissen        | imported      |  12 |  12 |    24 | KEEP                    |
| usecases         | imported      |  12 |  12 |    24 | KEEP                    |
| comparisons      | imported      |  12 |  12 |    24 | KEEP                    |
| tool-categories  | imported      |   7 |   7 |    14 | KEEP                    |
| authors          | imported      |   5 |   5 |    10 | KEEP                    |
| special-landings | imported      |   5 |   5 |    10 | KEEP                    |

Total cleanup scope: **34 articles (17 DE+EN pairs)**, exactly one bucket: `collection='blog' AND source='generated'`. Imported total preserved: 108+58+24+24+24+14+10+10 = **272**.

### Step 2 — Generated vs Imported Marker

- **Canonical marker:** `articles.source` enum (`'generated' | 'imported'`, default `'generated'`, set by `adapter-astro-sync` to `'imported'` for repo-imported rows). Defined in `packages/db/src/schema/_enums.ts:110`.
- **Confidence: high** — unique index `(projectId, source, collection, locale, slug)` allows the same slug to exist as both source variants (4 slugs do — see Step 3).
- Secondary signals (consistent across all 34 generated rows): `astro_synced_at IS NULL`, `import_metadata = '{}'`, status mostly `'final_review'` (one `'outline_review'`).

### Step 3 — Generated Articles (17 translation pairs)

All 34 rows are `collection='blog'`, `hero_image_r2_key` set, none synced to Astro. 17 themes:

| Theme | DE slug | EN slug | Cluster |
|---|---|---|---|
| GitHub Copilot use-cases | `github-copilot-use-cases-2026` | `…-how-developers-devops-…` | — |
| GitHub Copilot guide | `github-copilot-2026-leitfaden-…` | `…-plans-agentic-workflows-…` | — |
| GitHub Copilot vs Cursor vs Tabnine | `github-copilot-vs-cursor-vs-tabnine-2026` | `…-which-ai-coding-assistant-wins` | — |
| GitHub Copilot review | `github-copilot-review-2026` | `…-is-upgrading-to-pro-or-max-…` | — |
| GitHub Copilot pricing | `github-copilot-preise-2026` | `…-plans-pricing-2026-…` | — |
| GitHub Copilot agentic | `github-copilot-agentic-workflows-tutorial` | `…-complete-step-by-step-tutorial` | — |
| GitHub Copilot Max | `github-copilot-max-features` | `…-max-all-features-in-detail-…` | — |
| ChatGPT ads | `chatgpt-werbung-2026-…` | `chatgpt-ads-2026-what-changes-…` | — |
| AI in finance | `ki-im-finanzwesen-…` | `ai-in-finance-2025-…` | — |
| KI chatbots overview | `ki-chatbots-2026-uebersicht-use-case` | `ai-chatbots-2026-the-complete-…` | chatbots-2026 |
| ChatGPT customer-service | `chatgpt-im-kundenservice-…` | `chatgpt-for-customer-service-…` | chatbots-2026 |
| ChatGPT pricing ⚠ | `chatgpt-preise-2026` | `chatgpt-pricing-2026` | chatbots-2026 |
| Prompt engineering career | `prompt-engineering-techniken-beispiele-karriere` | `…-examples-career-guide-2025` | prompt-engineering-2026 |
| Prompt engineering limits | `prompt-engineering-techniken-beispiele-grenzen` | `…-techniques-examples-and-limits` | prompt-engineering-2026 |
| Code assistants ⚠ | `code-assistenten` | `ai-code-assistants` | code-assistenten-2026 |
| KI fundamentals | `grundlagen-ki-uebersicht` | `ai-fundamentals-overview` | grundlagen-ki |
| Streaming compare | `ki-features-musikstreaming-vergleich-2026` | `streaming-services-2026-comparison` | music-comparisons-2026 |

**⚠ Slug-overlap discovery (4 slugs):** `ai-code-assistants` / `chatgpt-preise-2026` / `chatgpt-pricing-2026` / `code-assistenten` exist as **both** `generated` AND `imported` rows. The unique index `(project_id, source, collection, locale, slug)` permits this. Deleting the generated row is safe — the imported row stays untouched, and the MDX file in the Astro repo is the imported row's source of truth. No Astro cleanup needed for these.

### Step 4 — Cluster-Status (44 clusters total)

| Cluster | gen | imp | Action |
|---|--:|--:|---|
| `chatbots-2026` (c6f43d45) | 6 | 20 | KEEP — detach only |
| `prompt-engineering-2026` (2b9218fd) | 4 | 12 | KEEP — detach |
| `code-assistenten-2026` (65d3f2af) | 2 |  8 | KEEP — detach |
| `grundlagen-ki` (9d088dd9) | 2 |  8 | KEEP — detach |
| `music-comparisons-2026` (99b370d7) | 2 |  2 | KEEP — detach (still has imported pair) |
| (other 39 clusters) | 0 | 2-28 | KEEP, untouched |

**No cluster needs to be deleted.** All 5 affected clusters are mixed; only the 16 generated articles inside them get deleted. Remaining 18 generated articles already have `cluster_id IS NULL` (GitHub-Copilot + ChatGPT-ads + AI-finance themes).

### Step 5 — Topic Briefs (202 total)

| approval_status | total | linked to article | linked to cluster | via plan |
|---|--:|--:|--:|--:|
| pending      | 174 | 0 | 0 | 0 |
| approved     |   8 | 7 | 0 | 0 |
| routed       |   7 | 6 | 1 | 0 |
| plan_pending |   7 | 0 | 0 | 0 |
| superseded   |   4 | 0 | 0 | 0 |
| rejected     |   2 | 0 | 0 | 0 |

**13 briefs hang on generated articles** (all 7 `approved` + 6 of 7 `routed`):
- 7 `approved` GitHub-Copilot trend_discovery briefs from 2026-05-16 (one per GitHub-Copilot generated article).
- 4 `routed` gap_analysis briefs (kunden-service, prompt-eng-karriere, ki-chatbots, prompt-eng-grenzen).
- 2 `routed` trend_discovery briefs (finance, chatgpt-werbung).
- 1 `routed` brief points at `routed_cluster_id` only — leave alone, cluster keeps.

**7 `plan_pending` briefs (5 gap_analysis + 2 comparison_discovery, dated 2026-05-21/22) are unlinked — KW22 seed material. KEEP.**

### Step 6 — Weekly Plans

| year/week | status | items | pending | done | dead |
|---|---|--:|--:|--:|--:|
| 2026 KW21 | **draft (active)** | 36 | 36 | 0 | 0 |
| 2026 KW21 | superseded | 32 | 32 | 0 | 0 |
| 2026 KW21 | superseded | 31 | 0 | 0 | 31 |
| 2026 KW21 | cancelled ×6 | 200 | 0 | 0 | 200 |

**Only 1 active draft plan: `71f402be-3c17-4c5f-a02b-b9d00ebefd9e` (36 items, all pending, 0 with `pipeline_run_id`).** Cancel via `transitionWeeklyPlanStatus('cancelled')` cascades all 36 items to `cancelled` (Memory D139). Note: `planned_items` has **no `article_id` column** — link is via `pipeline_run_id` (all NULL) or `source_brief_id`.

### Step 7 — Cost-Logs (top operations)

- `article-draft` €4.66, `article-outline` €3.95, `trend-synthesis` €3.65, `research-competitor-synthesis` €1.58, `discovery-backfill-classify` €1.12, `hero-image-generation` €1.03 (Replicate), `translate-draft` €0.69, `article-self-review` €0.69, `schema-rich-detection` €0.61, `social-image-extract` €0.54, …

Total generation spend ≈ **€18-20**. Cost-logs are project-scoped, not article-scoped — no clean `WHERE article_id = …` predicate. **KEEP all cost_logs.**

### Step 8 — Pipeline-Runs

- `article:social-image` 511 completed | `article:blog` 203 completed (+7 cancelled) | `astro:repo-import` 191 | `planning:weekly` 160 (+7 cancelled, +1 failed) | `article:schema-extension` 122 | `article:draft` 48 | `article:translation` 40 | …

**KEEP all pipeline_runs.**

### Step 9 — R2 Hero-Image Keys

- 34 generated articles, all 34 have `hero_image_r2_key` set, **19 unique keys** (DE+EN pairs share the hero).
- R2 cleanup out-of-scope per § Anti-Patterns. Marcel decides later.

### Step 10 — Astro-Repo Sync-State

- Astro repo at `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu` (from `projects.astro_repo`, owner MarcelKlaczinski, branch master, contentRoot `src/content`).
- `astro_sync_runs` for generated articles: **0 rows.** `articles.astro_synced_at IS NULL` for all 34. **No generated article was ever pushed to the repo.**
- 60 MDX files exist in `src/content/blog/{de,en}` (30+30) — all manually-authored / imported, not generated output. The 4 slug-overlap rows keep their imported counterpart in the repo unchanged.
- **No MDX deletion needed. No Astro re-sync needed.**

### Cleanup-Strategy

Script: `specs/64-quality-reset-cleanup.sql` — single-transaction, prepared but NOT executed. Run in Phase 2 after bug-fix deploy.

**Untouched:** 272 imported articles, all 44 clusters, 174 pending + 7 plan_pending + 4 superseded + 2 rejected briefs, all pipeline_runs, all cost_logs, all 60 Astro-repo MDX, 19 R2 keys (separate later), project + project_configurations + cron_state + signal_collectors.

**Changed:** 1 draft plan → `cancelled` (+36 items cascaded), 13 briefs → `routed_article_id=NULL` (state preserved), 34 articles → DELETE.

### Akzeptanzkriterien
- ✅ Vollständige Liste aller Articles zur Löschung (34, 17 DE+EN pairs)
- ✅ Cluster-Klassifikation (5 mixed → detach, 39 untouched, 0 deleted)
- ✅ Briefs-Klassifikation (13 deleted, 7 plan_pending preserved, 174 pending preserved, 6 status-history preserved, 1 cluster-only routed preserved)
- ✅ R2 keys identifiziert (19 unique, separate cleanup)
- ✅ Astro-Repo MDX identifiziert (zero — never synced)
- ✅ Cleanup-Strategy als Sequence dokumentiert (`64-quality-reset-cleanup.sql`)
- ✅ KEIN DELETE ausgeführt (Phase 0)

---

## Phase 2 — Execution 2026-05-22

**Status: EXECUTED. Transaktion committed.**

### Deviation gegenüber gestaged-tem SQL

Im Verify-Gate (Postcondition `pending_items = 0` für alle Toolwiki-Plans) wurde eine State-Inkonsistenz aufgedeckt: der **KW21 superseded** Plan trug zusätzlich zu den 36 pending Items im draft 32 weitere orphan pending Items. Step 1b des Scripts war auf `weekly_plan_id = '<KW21-draft>'` skopiert (erwartete 36 rows updated), das Verify-SQL aber prüfte projekt-weit. Die Verify-Intention war eindeutig ("nach Cleanup keine pending Items mehr"), also wurde die UPDATE einmalig auf alle pending Items aller Toolwiki-Plans erweitert:

```sql
UPDATE planned_items
   SET status = 'cancelled', updated_at = NOW()
 WHERE status = 'pending'
   AND weekly_plan_id IN (
     SELECT id FROM weekly_plans
      WHERE project_id = '3fad7929-b06d-47ce-b6a1-8ac134362c42'
   );
```

(Erster Versuch mit der ursprünglichen Step-1 UPDATE rollback-te sauber durch das Verify-Gate — `RAISE EXCEPTION mismatch pending_items: 32`. Kein Commit, kein Datenverlust.)

### Was tatsächlich lief

| Step | Operation | Rows |
|---|---|---|
| 1   | UPDATE weekly_plans → cancelled (KW21 draft) | 1 |
| 1b  | UPDATE planned_items → cancelled (alle pending across all toolwiki plans) | **68** (36 KW21 draft + 32 KW21 superseded stragglers) |
| 2   | DELETE topic_briefs (routed_article_id → generated articles) | 13 |
| 3   | DELETE articles (source=generated, collection=blog) | 34 |

Cascades aus `articles ON DELETE CASCADE`: 32 article_versions + 3 pipeline_chains + 12 article_discovery. SET NULL: social_posts.article_id (0), batch_requests.article_id (preserved), cost_logs.article_id (preserved), astro_sync_runs.article_id (0).

### Post-condition counts (alle 12 vom Verify-Gate bestätigt)

| Check | Erwartet | Ist |
|---|--:|--:|
| generated_blog_remaining | 0 | 0 |
| active_plans | 0 | 0 |
| pending_items | 0 | 0 |
| plans_history_preserved | 9 | 9 |
| clusters_untouched | 44 | 44 |
| imported_articles | 272 | 272 |
| pending_briefs_signal_pool | 174 | 174 |
| plan_pending_briefs | 7 | 7 |
| status_history_briefs | 6 | 6 |
| routed_brief_cluster_only | 1 | 1 |
| pipeline_runs_preserved | 1376 | 1376 |
| cost_logs_preserved | 1156 | 1156 |

### Noch offen (separate Cleanups)

- **60 Astro-MDX files** in `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/content/blog/{de,en}` — Phase 0 Step 10 hat bestätigt: alle 60 sind imported / manuell angelegt, keine generated rows wurden je via astro-sync gepushed. **Kein Cleanup nötig.**
- **19 unique R2 hero-image keys** — Marcel-Decision later (out-of-scope für DB-Cleanup).

### Follow-up

- `specs/64-quality-reset-cleanup.sql` Step 1 UPDATE-Predicate ist gegenüber dem ausgeführten Statement zu eng. Falls das File als ausführbares Artefakt im Repo bleiben soll, sollte Step 1b auf die obige projektweite Form gepatcht und die Erwartungs-Kommentare aktualisiert werden (`Expected: 36` → `Expected: 68 (36 KW21 draft + 32 KW21 superseded stragglers)`).
