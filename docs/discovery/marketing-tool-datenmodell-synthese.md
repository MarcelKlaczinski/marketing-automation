# Marketing-Tool-Datenmodell — Multi-Domain-Evolution

> **Status:** Discovery-Audit, Read-only. Keine Code-Änderungen, keine Migrations.
> **Datum:** 2026-05-22
> **Scope:** `apps/api`, `packages/db`, `packages/pipelines`, `packages/shared`, `packages/adapters/*` im Marketing-Tool-Monorepo
> **Stress-Test-Domain:** balkon-kraft-werk.de (BK) — hypothetisches greenfield Astro für Balkonkraftwerk-Affiliate
> **Eingabe Phase 1:** Schema-Audit des Toolwiki-Astro-Repos (vom Nutzer mitgeliefert, im Anhang referenziert)
> **Methodik:** 5 parallele Explore-Agents (DB-Schema / Pipelines+LLM-Prompts / Astro-Write-Path / Adapter+Worker / Zod-Distribution); volle Reads von `content.ts`, `operations.ts`, `projects.ts`, `_enums.ts`, `astro-sync/`, `prompts/`; selective Reads von Migrations-SQL (alle 0001-0091); Stichproben bei großen Step-Files (>1000 Zeilen).

---

## Executive Summary

1. **Persistenz-Modell heute:** Promoted-Columns für Hot-Fields (Spec 54.8) + `frontmatterExtras` JSONB für Rest. Funktioniert schon halbwegs als „Layer-1-Core + Layer-2-Extras", aber die Bucket-A/B/C-Grenze ist nirgendwo strukturell gezogen — `tool_pricing`, `tool_rating`, `tool_votes`, `tool_affiliate_slug`, `tool_website` sind **Toolwiki-spezifische Promotions auf der zentralen `articles`-Tabelle** (Bucket C), nicht in einer Extension-Schicht isoliert.
2. **Top-Lock-In im Schema:** Sechs CHECK-Constraints und ein pgEnum kodieren Toolwiki-Wissen: `industryEnum`, `pipelineTemplateEnum`, `articleCollectionTypeEnum` (`blog|comparison|ki-wissen|tools|usecases`), `external_signals.source` (`producthunt|hackernews|...`), `topic_briefs.source`, `topic_briefs.cluster_action`, `topic_briefs.generation_mode`. Plus die `tool_*`-Spalten auf `articles`. Phase-1-Befund **bestätigt**: der härteste Lock-In sitzt im Schema, nicht im Body.
3. **Top-Lock-In in den Pipelines:** Acht inline-Strings binden harten Produktnamen + Domain-Scope: `draft.ts:84` (`"You are writing the FULL DRAFT of an article for toolwiki.ai — an AI tool wiki."`), `outline.ts:58-73`, `prompts/comparison.ts:68-73`, `prompts/ki-wissen.ts:95-102`, `social-image/steps.ts:737,758-780`, `social-image/hookPrompt.ts` (alle 6 Hook-Templates). Per-Tenant-Variable-Swap fix machbar, aber heute nicht implementiert.
4. **Schreibpfad ist last-write-wins ohne Feld-Level-Locks.** `articles.source='imported'` vs. `='generated'` discriminiert nur die _Herkunft_, nicht die _Authority pro Feld_. `RefreshPipeline` auf einen imported-Article überschreibt `bodyMd` ohne Konfliktcheck; menschliche Repo-Edits können verloren gehen, wenn der Tool-Refresh-Run nach dem Edit läuft.
5. **Pattern-107-Realität:** Die 3 Kopien von `COLLECTION_ASTRO_NAME` sind real (in `blog/persist.ts:18`, `steps/persist-article.ts:10`, `lib/canonical-url.ts:24`), plus eine 4. in `astro-sync/src/steps/render-mdx.ts:9-15`. Pattern-107-Regel sagt „single source of truth" — Realität ist 4 parallele Kopien. Kein Bug heute, weil alle 4 Werte identisch sind; bei BK-Werk mit neuen Collections (`guides`, `wirtschaftlichkeitsrechner`) wird das eine 4× Edit-Pflicht.
6. **Adapter/Worker-Inventur:** ~70 % universal (Anthropic, R2-Storage, Voyage, DataForSEO, Replicate, Nano-Banana, Email, Image-Webp, Plan-Worker, Step-Pause-Cleanup, Comparison-Discovery, Trend-Synthesizer). ~25 % per-project konfigurierbar mit Toolwiki-Defaults (Reddit, HN, GitHub, ProductHunt). ~5 % Fork-Pflicht (`astro-sync` mit hartcodierten Astro-Folder-Names + Pattern-107 4. Kopie; `pagespeed` mit Port 14321 + Astro-Clone-Workflow).
7. **Zod-Verteilung:** Heute kein `@marketing-auto/content-schema` Workspace-Package. Schemas leben verstreut: `packages/shared` (env, brand-tokens, `ARTICLE_COLLECTION_TYPES`), `packages/pipelines/article/frontmatter/{comparison,ki-wissen}.ts`, `packages/pipelines/article/types.ts` (`ArticleOutlineSchema` etc.), `packages/db/.$type<>()`-Casts. **Kein Boundary-Validator** zwischen Tool-Write und Astro-Build — Validation passiert beim LLM-Output (Pipeline) und implizit beim Astro-Build (silent drop). `ExtractCollectionSchemasStep` (Spec 50) extrahiert Astro-Schemas zur Laufzeit per Regex und persistiert sie als `projects.astroCollectionSchemas` JSONB — das ist heute der einzige Schema-Sharing-Mechanismus zwischen Tool und Repo.
8. **Cross-Reference zum Phase-1-Report:** Tool ist **strukturell bereit für Layer-1+2-Schema** (Promoted-Columns für A/B, JSONB für C). Aber: (a) Bucket-C ist heute mit Toolwiki-Werten _vermischt in die zentrale `articles`-Tabelle_ (`tool_*`-Spalten) statt in einer expliziten Extension-Schicht — Phase-1 hatte das nicht erwartet. (b) Es gibt **keinen Zod-Registry-Mechanismus**, der Bucket-C pro Domain validiert beim Insert; die collection-spezifischen Extras-Validatoren (`validateComparisonExtras`, `validateKiWissenExtras`) feuern nur im LLM-Output-Path, nicht beim Astro-Import. (c) Drei verschiedene Category-Modelle (Phase-1-Befund) ist im Tool **noch nicht abgebildet** — Tool hat nur `articles.category text`, `articles.subcategory text`, kein Category-Constraint, keine Categories-Tabelle.

**Empfehlung dieser Synthese (siehe Phase 5 + 7 für Begründung + Trade-offs):**

- **Persistenz:** Persist-2-Sharpened — bestehendes Promoted-Columns-Modell beibehalten, aber `tool_*`-Spalten als „Bucket-C-Toolwiki-Extension" semantisch markieren (in Astro-sync-export gefiltert auf `collection IN ('tools','comparisons')`); `frontmatterExtras` zu `domain_extras` umbenennen (rein semantisch, optional); Bucket-A/B-Felder explizit dokumentieren.
- **Zod-Package:** Jetzt extrahieren als Workspace-Package `@marketing-auto/content-schema` (Phase 1 sagt „ja"; ich sage ebenso „jetzt, bevor BK live geht — sonst driftet das Schema zwischen Tool und neuem BK-Astro-Repo unkontrolliert"). Per-Domain-Registry-Pattern: Tool registriert `domainSchemaRegistry[projectId].extras = z.object({...})` beim Boot, sodass beide Pfade (LLM-Output + Astro-Import) die selbe Validierung nutzen.
- **Categories-Refactor:** Pre-Requisite für BK. Drei Modelle ist heute Toolwiki-Realität; eine eigene `content_categories`-Tabelle mit `{slug, project_id, translations JSONB, parent_slug?, scope}` ist das missing piece für Multi-Domain. **D3-aus-Phase-1-direkt-übertragbar.**
- **Top-Priorität-Decision-für-Marcel:** Vor BK-Aufschlag braucht es einen `validation_layer` an der Astro-Write-Grenze (heute fehlt der völlig). Bei der erstmaligen Generation eines BK-Artikels würde sonst stilles Schema-Drift-Risiko entstehen — Tool schreibt freie Felder, Astro-Build droppt sie, kein Error-Signal.

---

## Phase 1 — Inventar Tool-Datenmodell

### DB-Schema

Quelle: `packages/db/src/schema/*.ts` (vollständig gelesen), `packages/db/drizzle/*.sql` (Migrations 0001-0091 stichprobenartig auf CHECK-Constraints).

#### Tabellen-Übersicht (Multi-Tenant-Sicht)

| Tabelle | Datei:Zeile | `project_id` FK? | Toolwiki-Bias |
|---|---|---|---|
| `articles` | `content.ts:74-291` | ja (line 78) | hoch (tool_*-Spalten, cornerstoneKeyword, collection-Enum) |
| `cornerstone_specs` | `content.ts:296-341` | ja (line 300) | sehr hoch (Hub-Spoke-Konzept zentraler Toolwiki-Mechanismus) |
| `article_versions` | `content.ts:343-358` | **nein** | mittel (Multi-Tenant-Invariant-Verletzung, siehe E.1a) |
| `social_posts` | `content.ts:360-414` | ja (line 364) | mittel (templateKey-Werte Toolwiki-Carousel-Designs) |
| `content_gaps` | `content.ts:476-523` | ja (line 480) | sehr hoch (Cluster/Spoke-Topology Toolwiki-Domain) |
| `pipeline_chains` | `content.ts:537-569` | ja (line 541) | hoch (chain-Sequenz hartcodiert auf Toolwiki-Artikel-Lifecycle) |
| `article_discovery` | `content.ts:576-624` | **nein** | hoch (referencedTools, suggestedTemplates) |
| `template_renders` | `content.ts:636-667` | **nein** | hoch (Toolwiki-Carousel-Template-Keys) |
| `topic_briefs` | `content.ts:752-942` | ja (line 756) | sehr hoch (source + cluster_action Enums Toolwiki-Realität) |
| `external_signals` | `content.ts:959-989` | ja (line 963) | sehr hoch (source-Enum hartcodiert auf AI-Signal-Quellen) |
| `rejected_topic_candidates` | `content.ts:1004-1030` | ja (line 1008) | mittel |
| `brand_voices` | `identity.ts:15-32` | ja (line 19) | niedrig (universal) |
| `content_pillars` | `identity.ts:34-51` | ja (line 38) | hoch (intentTaxonomyOverride Toolwiki-spezifisch) |
| `clusters` | `identity.ts:98-143` | ja (line 102) | sehr hoch (Hub-Spoke-Topology, satelliteKeywords-Konzept) |
| `projects` | `projects.ts:10-126` | n/a (Tenant-Root) | mittel (Industry-/Pipeline-Enum Toolwiki-Vertikals) |
| `project_credentials` | `projects.ts:213-233` | ja (line 217) | niedrig |
| `project_configurations` | `project-config.ts:214-243` | ja (line 218) | hoch (signal_sources JSONB Toolwiki-hartcodiert) |
| `system_settings` | `operations.ts:23-28` | nein (global) | niedrig |
| `global_credentials` | `operations.ts:30-47` | nein (global) | niedrig |
| `cost_logs` | `operations.ts:49-78` | ja (line 53) | niedrig (universal) |
| `pipeline_runs` | `operations.ts:99-132` | ja (line 103) | niedrig (universal) |
| `astro_sync_runs` | `operations.ts:134-162` | ja (line 138) | hoch (Astro-spezifisch) |
| `astro_import_runs` | `operations.ts:315-354` | ja (line 319) | hoch (Astro-spezifisch) |
| `pagespeed_runs` | `operations.ts:164-200` | ja (line 168) | mittel |
| `schema_extension_runs` | `operations.ts:203-236` | ja (line 209) | mittel |
| `link_rebuild_runs` | `operations.ts:238-277` | ja (line 242) | niedrig (universal) |
| `project_pause_states` | `operations.ts:280-290` | ja (PK = project_id) | niedrig (Spec 41) |
| `cost_alerts` | `operations.ts:293-312` | ja (line 297) | niedrig |
| `step_pauses` | `operations.ts:361-403` | ja (line 373) | niedrig |
| `idempotency_outputs` | `operations.ts:412-437` | ja (line 418) | niedrig |
| `prompt_versions` | `operations.ts:451-480` | **nullable** | niedrig (Spec 62.0b Multi-Tenant-Exception: NULL = global Golden) |
| `step_optimization_requests` | `operations.ts:488-528` | ja (line 497) | niedrig |
| `project_goals` | `operations.ts:534-562` | ja (line 538) | niedrig (Spec 62.2 Cadence-DSL universal) |
| `project_planner_config` | `operations.ts:569-624` | ja (PK = project_id) | niedrig (universal Planner-Config) |
| `weekly_plans` | `operations.ts:637-705` | ja (line 641) | niedrig (Spec 62.4 universal) |
| `planned_items` | `operations.ts:712-802` | ja (line 719) | mittel (source_kind/floor/overage_signal Toolwiki-Cadence-Planner-Realität) |
| `approvals` | `operations.ts:804-827` | ja (line 808) | niedrig |
| `batch_requests` | `batch.ts:22-64` | ja (line 26) | niedrig (Anthropic Batch API) |
| `image_batch_requests` | `batch.ts:86-144` | ja (line 90) | niedrig (Gemini Batch API) |
| `refresh_dismissed` | `refresh.ts:7-29` | ja (line 11) | niedrig |
| `refresh_suggestions` | `refresh.ts:44-74` | ja (line 48) | niedrig |
| `project_template_overrides` | `social-overrides.ts:5-28` | ja (line 9) | mittel (templateKey Toolwiki-spezifische Carousel-Designs) |
| `cron_state` | `cron.ts:18-39` | ja (line 22) | mittel (`cron_job_type`-Enum-Werte zT Toolwiki-spezifisch) |
| `users` | `auth.ts:4-18` | **nein** (Plattform-weit) | niedrig |
| `magic_link_tokens` | `auth.ts:20-34` | **nein** (Plattform-weit) | niedrig |
| `sessions` | `auth.ts:36-53` | **nein** (Plattform-weit) | niedrig |
| `notifications` | `notifications.ts:5-27` | **nein** (FK auf users) | niedrig |
| `push_subscriptions` | `push.ts:4-22` | **nein** (FK auf users) | niedrig |

**Multi-Tenant-Invariant-Befund:** 4 Content-Tabellen haben **kein** explizites `project_id` FK — `article_versions`, `article_discovery`, `template_renders` (alle FK auf `articles.id` als Indirektion), und `social_posts.article_id`-only-Pfad. Per CLAUDE.md E.1a wurde das bei `refresh_suggestions` als Lesson Learned aufgenommen, aber für diese 3 nicht nachgezogen. Für Multi-Domain-Skalierung **kein Blocker**, aber semantische Klarheit fehlt — eine direct `WHERE project_id = ?`-Query auf z.B. `article_versions` ist heute nicht möglich.

#### pgEnum-Inventur (`packages/db/src/schema/_enums.ts`)

Vollständige Liste mit Toolwiki-Bias-Bewertung:

| Enum | Datei:Zeile | Werte | Toolwiki-Bias |
|---|---|---|---|
| `lifecycleStageEnum` | `_enums.ts:3` | cold_start \| pre_launch \| launch \| growth \| mature | gering — universal SaaS-Lifecycle |
| `pipelineTemplateEnum` | `_enums.ts:11` | educational \| affiliate_review \| local_business \| programmatic_seo | hoch — Toolwiki-Verticals hartcodiert; BK = `affiliate_review` |
| `industryEnum` | `_enums.ts:18` | ai_education \| automotive_dealer \| renewable_affiliate \| music_school \| other | sehr hoch — BK hätte „renewable_affiliate" als Match, aber `automotive_dealer`/`music_school` sind Marcel-spezifische Test-Werte |
| `articleStatusEnum` | `_enums.ts:26` | proposed \| approved \| generating \| outline_review \| drafting \| final_review \| schema_extending \| ready_to_publish \| validating \| published \| blocked_by_pagespeed \| failed \| rejected | gering — universal Article-Lifecycle |
| `socialPlatformEnum` | `_enums.ts:42` | instagram \| tiktok \| linkedin \| twitter | gering |
| `socialFormatEnum` | `_enums.ts:49` | carousel \| reel \| single_image \| story | gering |
| `socialStatusEnum` | `_enums.ts:56` | draft \| in_review \| approved \| scheduled \| published \| failed \| replaced | gering |
| `socialRenderStatusEnum` | `_enums.ts:66` | pending \| rendering \| rendered \| failed | gering |
| `credentialServiceEnum` | `_enums.ts:73` | google_analytics \| google_search_console \| google_adsense \| instagram_graph \| github_deploy \| astro_deploy_webhook | mittel — `astro_deploy_webhook` Astro-spezifisch |
| `costServiceEnum` | `_enums.ts:82` | anthropic \| replicate \| dataforseo \| smtp \| voyage \| google-gemini | gering — universale Provider |
| `pipelineRunStatusEnum` | `_enums.ts:92` | queued \| running \| completed \| failed \| cancelled \| batch_pending \| paused \| superseded | gering |
| `approvalActionEnum` | `_enums.ts:103` | requested \| approved \| rejected \| changes_requested | gering |
| `userRoleEnum` | `_enums.ts:110` | owner \| editor | gering |
| `articleSourceEnum` | `_enums.ts:112` | generated \| imported | mittel — Dual-Source-Pattern aus Spec 44 ist Toolwiki-Realität (GitHub-Mirroring) |
| `cornerstoneSpecStatusEnum` | `_enums.ts:114` | proposed \| approved \| in_generation \| article_done \| rejected | hoch — Cornerstone-Spec-Konzept Toolwiki-Domain |
| `refreshSuggestionSourceEnum` | `_enums.ts:122` | time \| quality | gering |
| **`articleCollectionTypeEnum`** | `_enums.ts:127` | **blog \| comparison \| ki-wissen \| tools \| usecases** | **sehr hoch** — hartcodierte Toolwiki-Collection-Slugs; BK braucht andere (`guides`, `vergleiche`, `wirtschaftlichkeitsrechner`) |

#### CHECK-Constraints (Stichprobe aus Migrations-SQL)

Vollständig nicht alle 91 Migrations gelesen — Stichprobe der bekannten Hot-Spots aus den Spec-Indexes:

| Tabelle.Spalte | Migration | Werteset | Bias |
|---|---|---|---|
| `notifications.severity` | 0013 | info \| warning \| critical | gering |
| `cost_alerts.threshold_type` | 0012 | daily \| monthly | gering |
| `project_configurations.status` | 0033 | draft \| active \| archived | gering |
| `topic_briefs.source` | 0032 + 0073 | gap_analysis \| trend_discovery \| refresh_detection \| manual \| comparison_discovery | **hoch** — Signal-Quellen Toolwiki-Realität |
| `topic_briefs.cluster_action` | 0032 + 0073 | append_to_existing \| create_new \| translation \| refresh \| standalone \| comparison | **hoch** — Cluster-Topology-Aktionen Toolwiki-Domain |
| `topic_briefs.generation_mode` | 0032 | NULL \| evergreen \| timely \| pillar \| spoke \| refresh \| translation | mittel |
| `topic_briefs.approval_status` | 0032 + 0082 + 0084 | pending \| plan_pending \| approved \| rejected \| auto_approved \| superseded \| routed | gering |
| `external_signals.source` | 0036 | producthunt \| hackernews \| vendor_rss \| reddit \| github \| dataforseo_trends | **sehr hoch** — alle 6 AI-Tools-Welt-Quellen; BK hätte `solar_industry_rss`, `r_solar`, evtl. `idealo`/`amazon`-Adapter |
| `rejected_topic_candidates.reason` | 0039 + 0042 | existing_coverage \| low_score \| excluded_by_scope \| low_signal_volume \| manual_dismissal | gering |
| `weekly_plans.status` | 0074 | draft \| approved \| running \| completed \| partially_failed \| cancelled \| superseded | gering |
| `planned_items.source_kind` | 0074 | floor \| overage_signal \| sibling_locale | mittel — Planner-Cadence-Konzept Toolwiki-getuned, aber portabel |
| `planned_items.status` | 0074 + 0079 | pending \| enqueued \| in_progress \| completed \| failed \| skipped \| cancelled \| published | gering |
| `image_batch_requests.status` | 0090 | pending \| submitted \| completed \| failed \| resume_enqueued | gering |
| `projects.image_generation_resolution` | 0089 | 0.5k \| 1k \| 2k \| 4k | gering |
| `cron_job_type` | `cron.ts:4-16` (pgEnum) | trends_synthesizer \| refresh_detector \| quality_analysis \| signal_collector_reddit \| signal_collector_github \| signal_collector_hackernews \| signal_collector_producthunt \| signal_collector_vendor_rss \| step_pause_cleanup \| planner_weekly_generation \| comparison_discovery | **hoch** — 4 von 11 Werten sind Toolwiki-Signal-Quellen-spezifisch |

**Verdikt:** Die größten Lock-Ins im Schema sind **`articleCollectionTypeEnum`**, **`external_signals.source`** (per CHECK), **`topic_briefs.source` + `cluster_action`** (per CHECK), und das Konzept der **`cornerstone_specs`**-Tabelle plus **`clusters`**-Topology. Industry-/Pipeline-Template-Enums sind weich (low-impact bei BK-Aufschlag — BK fällt in `renewable_affiliate`/`affiliate_review`).

### Project-Scope & Multi-Tenant-Pattern

**Konsequente Multi-Tenancy via `project_id` FK auf fast allen Content-Tabellen.** Ausnahmen:

1. **Plattform-Tabellen** (intentional): `users`, `sessions`, `magic_link_tokens`, `push_subscriptions`, `notifications`, `system_settings`, `global_credentials`. ✅ Sauber begründet — User-Identity ist Plattform-übergreifend.
2. **Globale Golden-Prompts** (Spec 62.0b Multi-Tenant-Exception): `prompt_versions.project_id` ist nullable. NULL = global Tier-3-Golden, non-NULL = Project-spezifisch Tier-2. Unique-Index via `COALESCE(project_id::text, 'GLOBAL')`. ✅ Sauber begründet.
3. **Indirekt-tenant-skopierte Content-Tabellen** (semantische Inkonsistenz):
   - `article_versions` (line 343-358): FK nur auf `articles.id`. **Direkte `WHERE project_id` Query unmöglich**.
   - `article_discovery` (line 576-624): FK nur auf `articles.id`.
   - `template_renders` (line 636-667): FK nur auf `articles.id`.

Risiko bei BK-Aufschlag: niedrig (kein Datenleak möglich via API, da Routes immer durch Article-Lookup gehen), aber **operationale Friktion** (manueller Cleanup, Reporting-Queries brauchen Join).

**Wo Project-Scope fehlt obwohl es semantisch da sein müsste:**
- Keine. Die Multi-Tenancy-Architektur ist konsistent. Marcel hat das in CLAUDE.md ("Multi-tenant via `project_id` foreign key (NO schema-per-tenant)") als Hard-Rule verankert.

### Article-Persistenz heute

Quelle: `packages/db/src/schema/content.ts:74-291` (vollständig gelesen).

#### Promoted-Columns vs. JSONB-Verteilung

Spec 54.8 (und Folge-Specs) haben „heiße" Frontmatter-Felder aus `frontmatterExtras` zu typed Columns promotet:

**Universal-promoted (Bucket A+B in Phase-1-Sprache):**
- `title`, `meta_description`, `slug` (Identity)
- `author`, `category`, `subcategory`, `tags[]` (Editorial-Metadata)
- `cluster_key`, `cluster_role`, `intent_type` (Hub-Spoke)
- `locale`, `translation_key` (i18n)
- `noindex` (SEO)
- `published_url`, `published_at`, `last_refreshed_at`, `last_synced_from_sibling_at`, `last_edited_at` (Lifecycle-Timestamps)

**Toolwiki-promoted (Bucket C, aber auf gleicher Tabelle):**
- `tool_pricing`, `tool_price_from`, `tool_rating`, `tool_votes`, `tool_affiliate_slug`, `tool_website` (`content.ts:211-216`) — _Spec 54.8 Promotion via_ `buildToolColumns()` in `astro-sync/src/import/steps/upsert-articles.ts:147-163`; populiert nur für `collection='tools'`

**JSONB-only:**
- `outline` (`ArticleOutline` type)
- `schema_json_ld` (`Record<string,unknown>[]`)
- `self_review_issues` (`SelfReviewIssue[]`)
- `import_metadata` (`{wordCount, readingTime, headings, affiliateLinks, imageCount, internalLinks}`)
- `astro_frontmatter` (`Record<string,unknown>`)
- `astro_asset_paths` (`{heroImage?: string}`)
- `pagespeed_*` JSONB-Spalten (scores, coreWebVitals, failedThresholds)
- `frontmatter_extras` (`Record<string,unknown>`) — **catch-all für alle nicht-promoted Felder**

#### Source-Discriminator (Spec 44)

`articles.source: 'generated' | 'imported'` (Default `'generated'`). Composite Unique-Index auf `(project_id, source, collection, locale, slug)` erlaubt **zwei Artikel mit gleichem Slug bei unterschiedlicher Source**.

**Heißer Befund:** `articles.source` ist heute kein „Field-Authority-Marker", nur ein Herkunfts-Tag. `RefreshPipeline` darf `source='imported'`-Rows überschreiben; es gibt **keinen Locked-Field-Marker auf Spalten-Ebene**. Phase-3 unten beschreibt die konkreten Lost-Update-Pfade.

#### `frontmatter_extras` JSONB-Schema (heutige Realität)

Kein explizites Zod-Schema im Code für die Gesamt-Shape — typed als `Record<string,unknown>`. Pro Collection erwartete Felder (aus Astro-sync-importer `buildToolColumns` + Pipeline-Output-Code rekonstruiert):

- **`collection='blog'`**: `{intentType?, bottomLinksVariant?, primaryTool?, showTopicLinks?, readingTime?, faq?: {question,answer}[], excerpt?, listicleType?}`
- **`collection='comparison'`**: `{toolSlugs[2-4], winner, verdict, testMethodology, useCaseVerdicts[], comparedAt, ...}` — validiert via `ComparisonExtrasSchema` in `packages/pipelines/src/article/frontmatter/comparison.ts:31-45` (LLM-Output-Path) — **aber NICHT validiert beim Astro-Import.**
- **`collection='ki-wissen'`**: `{category, level, icon, facts[3-5], next[2-4], faq[7-15]}` — `KiWissenExtrasSchema` in `frontmatter/ki-wissen.ts:32-44`
- **`collection='tools'`**: `{features[], pros[], cons[], useCases[], integrations[], pricing, priceFrom, rating, votes, affiliateSlug, website, ...}` (ein Teil davon ist promoted, Rest in JSONB)
- **`collection='usecases'`**: `{relatedTags?, industryFocus?, featuredToolSlugs[2-7]?, highlights?, contentType: 'pillar'|'hub'|'stub'|'expanded'}`

**Cross-Reference Phase 1:** Phase-1-Report-Verdikt für Schema-Coverage in Toolwiki — _„viele optionale Felder werden in 0/10 Sample-Files genutzt"_ — gilt auch im Tool, weil das Tool das Schema vom Repo per `ExtractCollectionSchemasStep` lädt und in `projects.astroCollectionSchemas` JSONB persistiert. Die Schema-Leichen im Repo werden also 1:1 in die Tool-Welt kopiert.

### Pipelines & Steps

Quelle: `packages/pipelines/src/` (vollständige Index-Reads, selective Step-Reads).

#### Pipeline-Registry

Registriert in `pipelineRegistry` (Map<string, Pipeline>) via `apps/api/src/workers/index.ts` beim Worker-Start. Tabelle:

| Pipeline | Datei | Step-Count | Toolwiki-Bias |
|---|---|---|---|
| `article:blog` | `article/blog/pipeline.ts` | 13 | hoch (über Sub-Prompts pro Collection-Variant) |
| `article:outline` | `article/pipeline.ts` | 4 | mittel (Outline-Prompt hartcodiert „AI-tools") |
| `article:draft` | `article/pipeline.ts` | 1 | hoch (Draft-Prompt hartcodiert „toolwiki.ai") |
| `article:refresh` | `article/refresh/pipeline.ts` | 8 | mittel |
| `article:translation` | `article/translation/pipeline.ts` | 7 | mittel (Bridge-Logik Spec 64.3 generisch) |
| `article:social-image` | `article/social-image/pipeline.ts` | 4 | hoch (Hooks hartcodiert „German AI tools niche") |
| `article:hero-generation` | `article/hero-generation/pipeline.ts` | 3 | gering |
| `cluster:full-plan` | `cluster/full-plan/index.ts` | 2 (free-function flow) | sehr hoch |
| `schema-extension` | `schema-extension/index.ts` | 3 | gering — Article+FAQPage+HowTo+Review generisch |
| `internal-linking` | `internal-linking/index.ts` | 1 | gering |
| `planning:weekly` | `planning/index.ts` | 11 | mittel (Source-Kind-Enum Toolwiki-Realität) |
| Cold-Start (5 Phasen) | `cold-start/phases/` | ~4 pro Phase | mittel (NICHE_LIBRARY extensible) |

#### Article-Pipeline-Variant-Routing

Eine Pipeline (`article:blog`) routet 5 Collection-Variants via `selectDraftPrompt(collectionType)` in `packages/pipelines/src/article/prompts/index.ts`:

| Collection | Astro-Folder | Draft-Prompt | Extras-Validator |
|---|---|---|---|
| `blog` | `blog` | Inline-Default in `DraftStep` (Pattern 109) | `validateBlogExtras` (Schema-only) |
| `comparison` | `comparisons` | `buildComparisonDraftPrompt()` in `prompts/comparison.ts` | `validateComparisonExtras()` |
| `ki-wissen` | `ki-wissen` | `buildKiWissenDraftPrompt()` in `prompts/ki-wissen.ts` | `validateKiWissenExtras()` |
| `tools` | `tools` | Inline-Default | Minimal-Schema |
| `usecases` | `usecases` | Inline-Default | Minimal-Schema |

**Pattern-107-Realität:** Der `COLLECTION_ASTRO_NAME` Lookup-Table existiert in **4 Kopien**:
1. `packages/pipelines/src/article/blog/persist.ts:18` (Brief→Article-Initial-Insert)
2. `packages/pipelines/src/article/steps/persist-article.ts:10` (Pipeline-Final-Persist)
3. `packages/pipelines/src/article/lib/canonical-url.ts:24` (JSON-LD-URL-Builder)
4. `packages/adapters/astro-sync/src/steps/render-mdx.ts:9-15` (MDX-Export-File-Path)

Alle 4 enthalten identische Wert-Sets. Pattern-107-Regel in CLAUDE.md sagt _„each concern owns its constant rather than importing across step boundaries"_ — _intentional duplication for module-independence_. Aber 4 statt 3 (CLAUDE.md erwähnt nur 3), und beim Hinzufügen einer BK-Collection wären 4 Edits erforderlich.

#### Frontmatter-erzeugende Steps

| Step | Datei | Erzeugte Felder | Shape-Authority |
|---|---|---|---|
| `OutlineStep` | `steps/outline.ts` | `outline.primaryKeyword`, `outline.cornerstoneKeyword`, `outline.heroImagePrompt`, `outline.sections[]`, `outline.wordCountEstimate` | LLM-flexibel innerhalb `ArticleOutlineSchema` |
| `DraftStep` | `steps/draft.ts` | `bodyMd` + `FRONTMATTER_EXTRAS`-HTML-Kommentar mit: `author, category, intentType, tags, excerpt, faq, bottomLinksVariant, [collection-specific fields]` | Hard-coded Enum-Werte im Prompt, parsed/validated via collection-spezifischen Validator |
| `HeroImageStep` | `steps/hero-image.ts` | `hero_image_r2_key, hero_image_public_url, hero_image_alt_text` (+ optional `hero_image_original_r2_key` per Spec 64.6c) | Image-Generation-Adapter (Nano-Banana / Replicate) |
| `AssemblyStep` | `steps/assembly.ts` | `schema_json_ld` (Article + locale-spezifische Felder) | Hard-coded JSON-LD-Struktur, locale-aware via `buildCanonicalUrl()` + `bcp47Tag()` |
| `SelfReviewStep` | `steps/self-review.ts` | `self_review_issues[]`, `self_review_score` | LLM-Output gegen `SelfReviewIssueSchema` |
| `PersistArticleStep` | `steps/persist-article.ts` | Final UPDATE auf `articles`-Row | `Pattern 107` + Promoted-Columns aus FRONTMATTER_EXTRAS |
| `schema-extension` Pipeline | `schema-extension/` | Erweitert `schema_json_ld` mit FAQPage/HowTo/Review JSON-LD post-publish | Pattern 116-Verwandtschaft — Schema-Owner |

#### LLM-Prompts mit Toolwiki-Bias

Die ~30 Hot-Spots aus dem Pipeline-Agent-Report, kondensiert:

**Hartcodierter Produktname + Domain-Scope (8 Stellen, Fork-Pflicht):**
- `steps/draft.ts:84` — `"You are writing the FULL DRAFT of an article for toolwiki.ai — an AI tool wiki."`
- `steps/draft.ts:86-88` — `"Every article must be primarily about AI/ML tools, AI features, AI concepts, or AI use cases."`
- `steps/outline.ts:58-61` — `"You are producing the OUTLINE for an article on toolwiki.ai..."` mit AI-Scope-Check
- `steps/outline.ts:63-73` — Beispiel-Topics-Whitelist mit ChatGPT/Claude/Midjourney/Cursor
- `prompts/comparison.ts:68-73` — Komplette Scope-Check-Block
- `prompts/ki-wissen.ts:95-102` — `"FULL DRAFT of a KNOWLEDGE PILLAR article for the ki-wissen collection on toolwiki.ai..."`
- `social-image/steps.ts:737` — `"You are an editor for toolwiki.ai..."`
- `social-image/hookPrompt.ts` — Alle 6 Hook-Templates prefixed mit `"You are an Instagram hook specialist for the German AI tools niche."`

**Per-Tenant-Var-Swap potenziell ausreichend:**
- `social-image/steps.ts:758-780` — Hartcodierte URLs `"toolwiki.ai/${slug}"`, `"Stand ${month}/${year} · toolwiki.ai/${slug}"`. Fix: `projects.domain` ersetzen.
- `social-image/hookEngine.ts:8,10` — Fallback-Keyword `"KI-Tools"` als Default. Fix: per-project Niche-Keyword.

**Bereits per-project-tunable:**
- `cold-start/_lib/niche-context.ts:12-59` — `NICHE_LIBRARY` mit Toolwiki-Profil **plus solar-energy, automotive-dealer** schon angelegt. ✅ Multi-Niche ready.

#### Pipeline-Trigger-Helpers

`apps/api/src/routes/_lib/trigger-helpers.ts` exportiert `triggerWithPreRunId()` und `checkTriggerAllowed()` — Pause/Cost/Idempotency-Gates. Sauber abstrahiert; jeder neue Pipeline-Route-Caller bekommt die Gates kostenlos. Konsumiert von Plan-Executor, HTTP-Routes, Cron-Workern. **Universal-Infrastructure, keine Toolwiki-Annahmen.**

### Adapter-Inventar

Vollständige Liste aus Adapter-Agent-Report:

| Adapter | Pfad | Domain-Bias | BK-Verdikt |
|---|---|---|---|
| `anthropic` | `adapters/anthropic/` | universal | ✅ Status quo |
| `replicate` | `adapters/replicate/` | universal | ✅ Status quo |
| `nano-banana` | `adapters/nano-banana/` | universal | ✅ Status quo |
| `voyage` | `adapters/voyage/` | universal | ✅ Status quo |
| `dataforseo` | `adapters/dataforseo/` | universal | ✅ Status quo (location-config per-call) |
| `email` | `adapters/email/` | universal | ✅ Status quo |
| `storage` | `adapters/storage/` | universal | ✅ Status quo |
| `image-webp` | `adapters/image-webp/` | universal | ✅ Status quo |
| `hackernews` | `adapters/hackernews/` | AI-Tools-Default | 🟡 Per-Project-Override der `queries`-Liste |
| `reddit` | `adapters/reddit/` | AI-Subreddits-Default | 🟡 Per-Project-Override der `subreddits`-Liste |
| `github-trending` | `adapters/github-trending/` | AI-Topics-Default | 🟡 Per-Project-Override der `topics`-Liste |
| `producthunt` | `adapters/producthunt/` | tech-only Audience | 🟡 BK könnte deaktivieren oder mit eigener Domain-Logik nutzen |
| `vendor-rss` | `adapters/vendor-rss/` | universal | ✅ Status quo |
| **`astro-sync`** | `adapters/astro-sync/` | Astro-spezifisch | ❌ Hartcodierte Collection-Folder-Map (Pattern-107-4. Kopie); MDX-YAML-Serializer fest |
| **`pagespeed`** | `adapters/pagespeed/` | Astro-spezifisch | ❌ Port 14321 hartcodiert, Astro-Clone-Workflow zentral |

**Hot-Befund Adapter:** `astro-sync` ist nicht Astro-agnostisch und auch nicht Domain-agnostisch — die Collection-Map muss bei jeder neuen Domain aktualisiert werden, sonst werden BK-Artikel nicht in den richtigen Astro-Folder geschrieben. Pattern-119 (R2-image-write durch `adapter-image-webp`) ist Multi-Domain-clean; `astro-sync` ist es **nicht**.

### Settings / Config

Quellen: `apps/web/src/pages/settings/`, `projects` table columns, `project_configurations` JSONB.

#### Per-Project konfigurierbar heute

Auf `projects` table direkt:
- Identity: `name, slug, industry, lifecycleStage, pipelineTemplate`
- Brand: `brandIdentity, targetAudience, brandTokens, brandVoice` (alle JSONB)
- CMS: `astroRepo, autoPublish, translationAutoTrigger, astroCollectionSchemas, socialAutoRenderLocales, socialAutoTemplates, defaultLocale`
- Monetization: `monetizationConfig`
- Cost: `costLimits` (JSONB)
- LLM-Mode: `llmMode` ('sync'|'batch')
- Image-Generation: `imageGenerationProvider, imageGenerationResolution`
- Cron-Toggles: `trendsCronEnabled, refreshCronEnabled, qualityAnalysisCronEnabled, redditSignalCronEnabled, githubSignalCronEnabled, hackernewsSignalCronEnabled, producthuntSignalCronEnabled, vendorRssSignalCronEnabled`

Auf `project_configurations` (versionierte JSONB-Snapshot-Tabelle):
- `intentTaxonomyDefault` (Array)
- `masterPrompts` (Override-Map mit Keys: `article.outline, article.draft, article.self_review, article.localize.fresh, article.localize.translate, trend.synthesis`)
- `topicScope` (`{languages, exclusions, primary_themes, relevance_keywords, min_trend_score, min_signal_thresholds}`)
- `signalSources` (per-Adapter-Config wie oben)
- `automationRules` (Placeholder, ungenutzt)

Auf `project_planner_config` (Spec 62.2):
- Weekly-Budget + per-Type-Caps + Diversity-Modifier + Cron-Schedule

**Verdikt:** Die Settings-Surface ist breit aber **ungleichmäßig**. „Echte" Toolwiki-Defaults stecken nicht in den Settings-Spalten, sondern in:
1. Hartcodierten Prompt-Strings (siehe Pipeline-Section)
2. Hartcodierten Adapter-Defaults (signal_sources Defaults haben AI-zentrische Queries)
3. Hartcodierten Pattern-107-Maps

Ein neuer BK-Aufschlag heute würde **gut konfigurierbare** Cron-Settings + Brand-Settings vorfinden, aber **schlecht konfigurierbare** Prompt-Scope + Collection-Routing.

### Worker / Cron

Aus Adapter-Agent-Report konsolidiert:

| Worker | Datei | `cron_job_type` | Project-scoped | Toolwiki-Bias |
|---|---|---|---|---|
| `signal-collector` | `signal-collector.ts` | 5 Sub-Types | per-project | 🟡 Defaults sind AI-biased |
| `trend-synthesizer` | `trend-synthesizer.ts` | `trends_synthesizer` | per-project | ✅ Liest `topicScope` aus Config |
| `comparison-discovery` | `comparison-discovery.worker.ts` | `comparison_discovery` | per-project | ✅ Pure function |
| `planner-weekly-generation` | `planner-weekly-generation.worker.ts` | `planner_weekly_generation` | per-project | ✅ Generisch |
| `refresh-detector` | `refresh-detector.ts` | (kein cron) | per-project | ✅ Generisch |
| `gap-auto-approver` | `gap-auto-approver.ts` | disabled | per-project | 🟡 Cluster-Topology-abhängig |
| `step-pause-cleanup` | `step-pause-cleanup.worker.ts` | `step_pause_cleanup` | global | ✅ Generisch |
| `discovery` | `discoveryWorker.ts` | (kein cron) | per-project | ✅ Generisch |
| `social-render` | `social-render.worker.ts` | (kein cron) | per-project | ✅ Generisch |
| `article-quality-analysis` | `article-quality-analysis.worker.ts` | `quality_analysis` | per-project | ✅ Generisch |
| `batch-processor` | `batch-processor.worker.ts` | (interne Queue) | per-project | ✅ Generisch |
| `image-batch-processor` | `image-batch-processor.worker.ts` | (interne Queue) | per-project | ✅ Generisch |
| `plan-execution` | `plan-execution.worker.ts` | (enqueue-by-route) | per-project | ✅ Generisch |
| `cron-orchestrator` | `cron-orchestrator.ts` | (orchestriert) | per-project | ✅ Spec-62.7-Pattern, sauber abstrahiert |

**Verdikt:** Worker-Layer ist ~85 % generisch. `cron-orchestrator` als Spec-62.7+ Pattern ist domain-agnostic und sauber abstrahiert. Die Toolwiki-Bias-Punkte sitzen alle in den **Defaults**, nicht in den Worker-Bodies — Override per Project-Config möglich.

### Schreibpfad zum Astro-Repo

Vollständig in Phase 3 unten. Kurz hier:

**Export:** `ArticleSyncPipeline` (`packages/adapters/astro-sync/src/pipeline.ts:31-42`) — 6 Steps: LoadArticle → ResolveSchema → DownloadHero → RenderMdx → CommitToGithub → UpdateDbStatus.

**Import:** `RepoImportPipeline` (`packages/adapters/astro-sync/src/import/pipeline.ts:1-46`) — 9 Steps inkl. ExtractCollectionSchemas (Spec 50), ListContentFiles, FilterChangedFiles (Diff via Blob-SHAs), ParseFrontmatterBatch, UpsertArticles (mit Field-Promotion in `upsert-articles.ts:31-145`), SyncClustersFromFrontmatter, LinkTranslationPairs, DetectContentGaps.

**Idempotenz-Anker:** Composite-Unique-Index `(project_id, source, collection, locale, slug)` auf `articles` — UPSERT-Authority.

**Schwächste Stelle:** Keine pre-write Zod-Validation. `RenderMdxStep` filtert Felder gegen den per-Spec-50 extrahierten Astro-Schema-Field-Set (`render-mdx.ts:226-232`) und _droppt unbekannte Felder still_. Wenn das Tool ein Feld schreibt, das Astro per Zod required, aber das Tool nicht im Schema kennt, **silent Astro build fail** (404 zur Runtime, kein CI-Signal).

### Zod-Schema-Verteilung

Aus Zod-Agent-Report kondensiert.

#### Wo Zod heute lebt

| Package | Inhalt | Datei |
|---|---|---|
| `packages/shared` | `envSchema`, `brandTokensSchema`, `ARTICLE_COLLECTION_TYPES`-Konstante | `src/config.ts`, `src/brand-tokens/schema.ts`, `src/types/article-collection.ts` |
| `packages/pipelines` | `ArticleOutlineSchema`, `SelfReviewIssueSchema`, `ResearchResultSchema`, `ComparisonExtrasSchema`, `KiWissenExtrasSchema`, `BlogPipelineInputSchema` (jede Pipeline hat ihren Input-Schema) | `src/article/types.ts`, `src/article/frontmatter/{comparison,ki-wissen}.ts`, `src/article/blog/pipeline.ts` |
| `packages/db` | Drizzle-pgEnums + `.$type<T>()`-Casts auf JSONB-Spalten (Type-only) | `src/_enums.ts`, `src/schema/*` |
| `packages/adapters/astro-sync` | `FrontmatterSchema` (mit `passthrough()`) für Import-Parse | `src/import/parse-frontmatter.ts:4-27` |
| `apps/api` | Pro-Route HTTP-Body-Schemas (klein, lokal) | `src/routes/*` |

#### Was NICHT existiert

- **Kein `@marketing-auto/content-schema` Workspace-Package.**
- **Kein boundary validator beim Write zum Astro-Repo.** Pipeline-Output wird per `ComparisonExtrasSchema` etc. validiert beim _Generieren_, aber nicht beim Schreiben in die DB und nicht beim Schreiben ins Repo.
- **Keine geteilte „Base Frontmatter Schema" Zod-Komposition.** Wenn man heute fragt „was sind die universellen Article-Frontmatter-Felder?", findet man die Antwort nur durch Cross-Read von 5+ Schemas plus den Promoted-Columns auf `articles`.
- **Keine per-Domain Zod-Registry.** Tool kann nicht zur Laufzeit fragen „welche Zod-Validierung gilt für `tools`-Collection bei Project X?".

#### Cross-Boundary-Validation-Audit

| Boundary | Validation? | Notiz |
|---|---|---|
| HTTP-Route-Body → API | ja (per-Route Zod) | Stichprobenartig, nicht 100 %; Pattern-87-Lektion |
| BullMQ-Job-Data → Worker | ja (`zodSchema.parse(job.data)`) | Empfohlen, nicht universal durchgesetzt |
| LLM-Output → Pipeline-Step | ja (`.parse()` auf Step-Output-Schema) | Sehr robust, retry-on-fail Pattern |
| Pipeline-Step → DB-Insert | **inkonsistent** — Pattern-129 verlangt JSONB-Write durch Schema-Parse; nicht überall durchgesetzt |
| MDX-Astro-Import → DB-Upsert | ja (`FrontmatterSchema.passthrough()`) | Schwach (passthrough toleriert alles in extras) |
| **DB-Read → MDX-Write zu Astro-Repo** | **❌ NEIN** | **größte Lücke** — `RenderMdxStep` schreibt YAML ohne Zod-Validation |
| Astro-Build → Repository | nein (silent drop) | Astro Zod validiert beim Build, aber Tool sieht den Fehler nicht |

**Single largest gap:** Der DB-Read → MDX-Write Boundary hat keinen Validator. Heute toleriert es das System, weil die meisten Felder via Promoted-Columns Drizzle-typed sind und `frontmatterExtras` toleriert was im Repo schon stand. Bei BK-Domain mit neuen Feldern fehlt diese Sicherheit.

---

## Phase 2 — Field-Ownership-Matrix

Pro Frontmatter-Feld (Toolwiki-Sicht aus Phase-1-Report + Tool-Sicht aus Phase-1-Inventar): wer besitzt es?

**Spalten:**
- **Feld** — kanonischer Name
- **Heute Tool-erzeugt?** — wer schreibt den Wert in die DB (LLM/Tool-Logic/Tool-Default)
- **Heute Repo-erzeugt?** — wer schreibt den Wert in die MDX-YAML (manueller Edit/Astro-Layout-Computation)
- **Re-Generate-Authority** — wer gewinnt beim Konflikt
- **Multi-Domain-Bewertung** — bleibt die Regel domain-agnostisch?

### Bucket-A (Universal-Core) — Felder mit klarem Ownership

| Feld | Tool-erzeugt? | Repo-erzeugt? | Re-Generate-Authority | BK-Multi-Domain |
|---|---|---|---|---|
| `title` | LLM (DraftStep) | manueller Edit möglich | **Tool gewinnt** beim Refresh (überschreibt) | ✅ Domain-agnostisch |
| `slug` | Tool-Logic (`slugify()`) | manueller Edit möglich | **Tool fixiert** im Composite-Unique-Index; Edit im Repo bricht Sync | ✅ Domain-agnostisch — aber Slug-Konvention pro Domain |
| `description` / `excerpt` | LLM (DraftStep) | manueller Edit möglich | Tool gewinnt | ✅ |
| `publishedAt` / `date` | Tool-Default (`now()` beim Persist) | manueller Edit möglich | **Repo gewinnt nach Import** — `articles.publishedAt` wird aus `frontmatter.publishedAt` mit Fallback `frontmatter.date` gepromoted (Spec 54.8) | 🟡 Naming-Bruch (Phase-1-D13): `date`/`updated`/`updatedAt`/`comparedAt`/`publishedAt` — Tool hat alle 4 Varianten in den Promoted-Columns |
| `updatedAt` / `updated` / `frontmatter_updated_at` | Tool-Default (`now()`) | manueller Edit möglich | Repo gewinnt nach Import (gepromoted aus `frontmatter.updatedAt` oder `frontmatter.updated`) | 🟡 gleiche Naming-Bruch-Klasse |
| `author` | LLM (AuthorPickStep) + Tool-Logic | manueller Edit möglich | Tool überschreibt beim Refresh | ✅ |
| `seoTitle` / `seoDescription` | LLM (DraftStep) | manueller Edit möglich | Tool überschreibt beim Refresh | ✅ |
| `heroImage` / `heroImagePath` | Tool (`HeroImageStep` + R2-upload) | nicht direkt | **Tool exklusiv** — Repo lädt vom R2 | ✅ |
| `heroImageAlt` / `heroImageAltText` | LLM (Spec 64.3) | manueller Edit möglich | Tool überschreibt beim Refresh; bei Translation-Bridge per `buildHeroAltText(title, locale)` | ✅ Spec-64.3 generisch (locale-aware) |
| `canonical` | Tool (`buildCanonicalUrl()`) | manueller Edit möglich | Tool exklusiv (per Pattern 107 Collection-Map) | 🟡 — Map muss bei neuer Domain erweitert werden |
| `noindex` | Promoted-Column (Default false) | manueller Edit möglich | Repo gewinnt nach Import | ✅ |
| `locale` | Tool (Translation-Setup) | manueller Edit möglich | Tool fixiert im Composite-Unique-Index | ✅ |
| `translationKey` | Tool (Translation-Bridge) | manueller Edit möglich | Tool exklusiv | ✅ |
| `draft` | **fehlt im Tool!** | im Repo manueller Edit möglich | nicht im Tool-Domain | 🔴 **Lücke** — Tool kennt keinen `draft`-Marker; Repo-Astro-Schema kennt ihn aber. Heute via `status='final_review'` simuliert; Mismatch beim Roundtrip möglich |
| `tags` | LLM (DraftStep) + Promoted-Column | manueller Edit möglich | Tool überschreibt beim Refresh | ✅ |

### Bucket-B (Universal-Extended)

| Feld | Tool-erzeugt? | Repo-erzeugt? | Re-Generate-Authority | BK-Multi-Domain |
|---|---|---|---|---|
| `category` / `subcategory` (Promoted-Columns) | LLM (DraftStep) | manueller Edit möglich | Tool überschreibt | 🔴 **Spannungspunkt** — Phase-1 sagt 3 Modelle (Enum-blog, Enum-ki-wissen-deutsch, freier-String-tools). Tool hat heute nur `articles.category text` ohne Constraint. Refactor zur `content_categories`-Tabelle ist Pre-Req für BK. |
| `clusterKey` / `clusterRole` / `parent_slug` / `cluster_order` | Tool (Promoted-Columns + ClusterSync) | manueller Edit möglich | Repo gewinnt nach Import (`SyncClustersFromFrontmatterStep`) | 🟡 BK braucht Cluster-Topology nicht zwingend, aber Konzept übertragbar |
| `faq[{question,answer}]` | LLM (DraftStep) im `frontmatterExtras` | manueller Edit möglich | Tool überschreibt; Spec-64.4 retry-on-faq-loss-Pattern bei Translation | ✅ |
| `readingTime` / `wordCount` | Tool-Computation (Promoted-Column) | nicht direkt | Tool exklusiv | ✅ |
| `featured` (Promoted/Extras) | manueller Edit | manueller Edit | **Lost-Update-Risiko** — wenn human `featured:true` setzt, Tool-Refresh setzt es nicht zurück (weil Refresh `bodyMd`-fokussiert ist), aber Re-Generate-from-Brief würde es resetten | 🔴 typisches Lost-Update-Feld |
| `imagePrompt` | LLM (OutlineStep) | nicht direkt | Tool exklusiv | ✅ |
| `preconnect` | manueller Edit | im Repo | nicht im Tool-Owned | ✅ |
| `speakable` | manueller Edit | im Repo | nicht im Tool-Owned | ✅ |
| `contentType` (`stub|expanded|pillar|hub`) | manueller Edit / Cluster-Logic | im Repo | nicht klar gekapselt | 🟡 |
| `monetizationCore` (`adsenseSlots, hasAffiliateLinks`) | manueller Edit + Astro-Schema-Defaults | im Repo per Collection-Factory | nicht im Tool-Owned | 🟡 — Tool hat keine Sichtbarkeit |

### Bucket-C (Domain-spezifisch, Toolwiki) — Hochrisiko-Felder

| Feld | Tool-erzeugt? | Repo-erzeugt? | Re-Generate-Authority | BK-Multi-Domain |
|---|---|---|---|---|
| `tool_pricing`, `tool_price_from`, `tool_rating`, `tool_votes`, `tool_affiliate_slug`, `tool_website` (Promoted-Columns) | Tool (Astro-Import + LLM-Output) | manueller Edit möglich | Repo gewinnt nach Import; Tool-Refresh überschreibt | 🔴 **Schema-Lock-In** — BK braucht eigene `product_*`-Columns (e.g. `product_einspeisung_w, product_garantie_jahre, product_zertifizierung, product_amazon_asin`). Heute auf zentraler `articles`-Tabelle = pro-Domain-Friktion. |
| `pricing` (in `frontmatterExtras`) | LLM | im Repo | Tool überschreibt | 🟡 |
| `intentType` | Promoted-Column + LLM-Output | im Repo | Tool überschreibt | 🔴 **9 Werte-Enum hartcodiert im DraftStep-Prompt** (`overview\|pricing\|features\|use-cases\|comparison\|tutorial\|review\|ethics\|general`). BK braucht andere (`installation\|wirtschaftlichkeit\|vergleich\|troubleshooting\|garantie`). Heute keine per-Project-Konfiguration. |
| `bottomLinksVariant` | LLM (`frontmatterExtras`) | im Repo | Tool überschreibt | 🟡 Astro-Schema-driven, also per Repo updateable; aber Werteset Tool-bias |
| `primaryTool` | LLM (`frontmatterExtras`) | im Repo | Tool überschreibt | 🔴 — Konzept (1 primärer Bezugs-Entity) übertragbar; Wert-Namensraum Toolwiki |
| `featuredToolSlugs[]` (in Tools/Usecases-Collection) | LLM + Tool-Logic | im Repo | Tool überschreibt | 🔴 — Slug-Namensraum Toolwiki; gleiche Logik in BK als `featuredProductSlugs` möglich |
| `logoStrategy` / `logoSvg` | manueller Edit (Phase-1: 0/10 belegt) | im Repo | nicht im Tool-Owned | 🟡 — Phase-1 markiert als Schema-Leiche |
| `applicationCategory, offerPrice, offerCurrency` (Special-Landings) | manueller Edit | im Repo per Schema.org `SoftwareApplication`-Subset | nicht im Tool-Owned | 🔴 BK braucht stattdessen Schema.org `Product` mit `brand/sku/gtin` |
| `toolSlugs[2-4], winner, verdict, useCaseVerdicts, comparedAt, testMethodology` (Comparison) | LLM (DraftStep via `ComparisonExtrasSchema`) | im Repo | Tool überschreibt | 🟡 — Konzept Comparison generisch; Werte-Slug-Raum domain-spezifisch |
| `next[]` (ki-wissen Learning-Graph) | LLM (`frontmatterExtras`) | im Repo | Tool überschreibt | 🟡 — Pattern als typed Slug-Reference (Phase-1-E9) noch nicht umgesetzt |
| `relatedPillars[12-Toolwiki-Slugs]` (tools-Collection) | LLM (`frontmatterExtras` oder Astro-Schema-Enum?) | im Repo | Tool überschreibt | 🔴 **härtester Lock-In aus Phase-1** — Tool persistiert das heute nur in JSONB ohne Enum-Constraint, aber Astro-Schema im Repo validiert gegen hartcodiertes 12-Werte-Enum |
| `source: 'manual\|producthunt\|futurepedia\|csv\|auto'` (Tools-Collection per Frontmatter; nicht zu verwechseln mit `articles.source`!) | LLM oder Astro-Importer | im Repo | Tool überschreibt | 🟡 — anderes Domain hat andere Source-Sets |

### Bucket-D (Hartcodiert im MDX, Pattern 116/Layout)

Vollständig in Phase-1-Report behandelt. Tool-Sicht:

| Embed | Tool-Bewusstsein? | Bedeutung für Tool-Datenmodell |
|---|---|---|
| `<HubCarousel excludeSlug>` in Blog | Tool weiß nichts davon | keine Auswirkung — Layout-Konvention im Repo |
| `<AIQuiz locale>` etc. in ki-wissen | Tool weiß nichts davon | keine Auswirkung |
| Inline JSON-LD-Snippets in ki-wissen | Tool weiß nichts davon | **Risiko:** Spec-64.4 sagt FAQ-Schema kommt vom `schema-extension` Pipeline, aber wenn Repo bereits inline JSON-LD enthält, doppelt sich der Schema-Markup |
| Aside-Blocks (Tailwind, kein Component) | Tool weiß nichts davon | keine Auswirkung |

### Spannungspunkte (Ownership-Risiken bei Re-Generate)

Aus der Matrix herauskondensiert — **die 5 wichtigsten Lost-Update-Risiken bei Tool-Refresh**:

1. **`featured`** — manueller Repo-Edit, Tool-Re-Generate-from-Brief resettet. (Phase-1 markiert Bucket B)
2. **`tool_pricing` / `tool_price_from` / `tool_rating` / `tool_votes`** — manueller Repo-Edit (wenn Editor Preis verifiziert), Tool-Refresh überschreibt via Astro-Import-Roundtrip oder Tool-LLM-Output. (Phase-1 Bucket C)
3. **Custom-Fields in `frontmatterExtras`** — wenn human ein nicht-Tool-bekanntes Feld setzt (z.B. `{"meinNotiz": "verify pricing nochmal"}`), Tool-Re-Generate ersetzt den gesamten `FRONTMATTER_EXTRAS` HTML-Kommentar im Body. **Verlust.**
4. **`schemaJsonLd`** — wenn human Repo-seitig manuell Schema-Markup ergänzt, Tool-Refresh + `schema-extension` Pipeline überschreibt.
5. **`category` / `tags`** — manueller Repo-Edit, Tool-Refresh kann via DraftStep-Output neue Tags setzen.

**Phase-1-Cross-Reference:** Phase-1 markiert R2 (Category-Refactor) und R7 (Marketing-Tool muss Domain-Schemas kennen) als hoch-Risiko. **Beide bestätigen sich aus Tool-Sicht.**

---

## Phase 3 — Schreibpfad & Idempotenz

### Happy-Path-Trace: `article:blog` Pipeline → Astro-Repo

End-to-End-Trace eines typischen Pipeline-Runs „Brief approved → MDX im Astro-Repo":

```
1. Brief-approve (HTTP POST /briefs/:id/approve)
   → brief-service.ts:approveBrief()
   → mode="immediate" → triggerWithPreRunId(pipelineName="article:blog")
   → preRunId in pipeline_runs (status='queued')
   → enqueueBlogGeneration(BullMQ job)

2. Worker picks job → article-blog.worker.ts → runPipeline(BlogPipeline)

3. BlogPipeline.beforeStart: createBlogArticleFromBrief()
   → INSERT articles (project_id, source='generated', collection=<from brief>, locale, slug, status='proposed')

4. Step 1: TopicIntakeStep — lädt Brief-Daten, Cluster-Match, Cornerstone-Lookup
5. Step 2: ResearchStep — DataForSEO SERP + Voyage embeddings
6. Step 3: OutlineStep — LLM Claude → JSON-Outline
7. Step 4: PersistOutlineStep — UPDATE articles.outline + outline_pipeline_run_id
8. Step 5: DraftStep — LLM Claude (Sonnet) → bodyMd + FRONTMATTER_EXTRAS HTML-Kommentar
9. Step 6: ToolLinkerStep — linkifyMarkdown injects internal links to tool articles
10. Step 7: SelfReviewStep — LLM Claude (Haiku) → JSON-Issues
11. Step 8: AnalyzeLinksStep — LLM Haiku → link-quality assessment
12. Step 9: HeroImageStep — Nano-Banana/Replicate → R2 upload via adapter-image-webp
13. Step 10: AssemblyStep — buildCanonicalUrl + JSON-LD Article object
14. Step 11: PersistArticleStep — final UPDATE articles row (all fields)
15. Step 12: schema-extension Pipeline trigger (afterComplete) — detects FAQ/HowTo/Review, appends JSON-LD
16. Step 13: SocialGenerationStep (optional, Pattern 102+103+104) — enqueues SocialImagePipeline

17. afterComplete: TranslationPipeline trigger (Spec 59.2) — if shouldSkipAutoTranslation() returns false

18. *** Manual approval gate ***
    → User reviews in /articles/:id/review
    → Status moves 'final_review' → 'ready_to_publish'

19. ArticleSyncPipeline trigger (manual or auto via projects.autoPublish)
    → packages/adapters/astro-sync/src/pipeline.ts (6 steps)
    → Step 1: LoadArticleStep — gates status='final_review' (or 'ready_to_publish')
    → Step 2: ResolveSchemaStep — fetches src/content/config.ts from GitHub, regex-extracts field descriptors
    → Step 3: DownloadHeroStep — pulls hero from R2, generates 23 srcset variants
    → Step 4: RenderMdxStep — buildFrontmatter() merges (extras < columns < known), yaml.stringify(), strips FRONTMATTER_EXTRAS comment from body
    → Step 5: CommitToGithubStep — blobs → tree → commit → ref update (GitHub Apps API)
    → Step 6: UpdateDbStatusStep — UPDATE articles.astro_synced_at, astro_commit_sha, astro_frontmatter, status='ready_to_publish'

20. Astro-Build (im Astro-Repo CI) liest neuen MDX, validiert gegen Collection-Zod-Schema
    — Wenn pass: published auf Cloudflare/Vercel
    — Wenn fail: SILENT — Eintrag wird aus Collection-Manifest ausgeschlossen, 404 zur Runtime
```

### Re-Generate-Szenarien (3 Cases, 4. siehe unten)

#### Szenario 1: Refresh-Brief auf einen importierten Artikel (`articles.source='imported'`)

**Auslöser:** Marcel klickt „Refresh" in `/articles/:id` für einen Artikel, der ursprünglich aus dem Repo importiert wurde.

**Pfad:**
1. `RefreshIntakeStep` lädt Artikel aus DB
2. Pipeline läuft 8 Steps: Outline → Draft → ToolLinker → SelfReview → ...
3. **Output geht zu `PersistBodyStep` (nicht `PersistArticleStep`)** — bodyMd + wordCount + outline werden in-place aktualisiert
4. `articles.source` bleibt `'imported'` unverändert
5. `last_refreshed_at` wird gesetzt
6. `frontmatter_extras` wird **neu berechnet** aus dem neuen Draft

**Was passiert bei nächstem Astro-Import?**
- Composite-Unique-Index matched `(project_id, 'imported', collection, locale, slug)` → UPDATE (kein neuer Row)
- Repo-Frontmatter (vom Human) überschreibt DB-Frontmatter (vom Tool-Refresh) zurück
- **Net: Refresh-Output ist temporär; nächster Import setzt zurück.**

**Lost-Update-Risiko:** Hoch, wenn der Astro-Import nicht synchron mit Refresh läuft. Refresh-Run ist isoliert von Import-Run.

#### Szenario 2: Translation eines existierenden DE-Artikels nach EN

**Auslöser:** Marcel oder `BlogPipeline.afterComplete` triggert `TranslationPipeline` für DE-Artikel.

**Pfad:**
1. `TranslationSetupStep` queries: `findSibling(sourceArticleId, locale='en')`
2. Wenn EN-Sibling existiert: UPSERT auf `(project_id, source, collection, locale='en', slug)` Composite-Unique-Index → UPDATE-in-place
3. Wenn keiner existiert: INSERT neuer Artikel mit `source='generated'`, `locale='en'`, gleichem `translation_key`
4. `TranslationBodyStep` (Spec 64.4 + 64.5) generiert EN-Body; Pattern-118-faq-validation + Spec-64.5-word-drift-validation
5. `TranslationLinkifyStep` injiziert EN-Tools-Links
6. `PersistArticleStep` schreibt EN-Artikel — **inkl. schema_json_ld neu aus Spec 64.3 buildHeroAltText + bcp47Tag**

**Bridge-Logik:** Pattern 117 (Spec 64.3) — _sparser reconstruction_, kein source-locale spread. `mainEntityOfPage.@id` per `buildCanonicalUrl(en)`, NICHT `/de/`-URL durchgereicht.

**Risiko:** Wenn EN bereits im Astro-Repo manuell existiert + im DB als `source='imported'` gelandet ist, dann Tool-Translation eine zweite Row mit `source='generated'` anlegt — **zwei Rows, gleicher Slug, unterschiedliche Source**. Welche wird beim nächsten Astro-Export geschrieben? Heute: kein expliziter Dispatch zwischen beiden; das ist ein bekanntes Edge-Case-Phänomen aus dem Astro-Sync-Agent-Report.

#### Szenario 3: `SchemaExtensionPipeline` Run auf existierenden Artikel

**Auslöser:** `BlogPipeline.afterComplete` triggert es; oder manueller Re-Run.

**Pfad:**
1. `DetectRichTypesStep` scannt `bodyMd` nach FAQ-Headings, HowTo-Schritten, Review-Patterns
2. `BuildJsonLdStep` baut FAQPage/HowTo/Review JSON-LD-Objects
3. `PersistSchemaStep` macht **UPDATE articles SET schema_json_ld = <new>** — alle anderen Spalten unberührt

**Risiko:** Pattern 116-Verwandtschaft — _„rich-type schemas owned by schema-extension not the bridge"_. Wenn ein zukünftiger Code-Pfad versucht, FAQPage im Translation-Bridge zu schreiben, wird das hier sekundenschnell überschrieben.

#### Szenario 4: Human edits MDX in Repo → Tool-Refresh-Run später

**Auslöser:** Editor öffnet `src/content/blog/de/foo.mdx` direkt in GitHub und editiert; Tool weiß nichts davon. Später triggert Marcel einen Refresh.

**Pfad:**
1. **Refresh ignoriert GitHub-State komplett** — `RefreshIntakeStep` liest aus DB (alte Version, vor Human-Edit)
2. Refresh generiert neuen Outline/Draft basierend auf DB-`bodyMd`
3. Output überschreibt `articles.bodyMd` in DB
4. **Human's Edits sind in DB nicht reflektiert; sie leben nur noch im Repo.**
5. Wenn jetzt `ArticleSyncPipeline` triggert: DB-Version wird ins Repo gepusht → **Human's Edits werden ÜBERSCHRIEBEN.**
6. Wenn stattdessen Astro-Import läuft: Import-Pipeline detected `gitSha`-Diff → UPSERT auf DB-Row → DB hat plötzlich Repo-Version mit Human-Edits.

**Net:** **Last-write-wins.** Welche Pipeline (Refresh-→Export oder Astro-Import) zuletzt lief, gewinnt.

**Phase-1-Cross-Reference:** Phase-1-Report sagte „Konkret bei einer Migration sehe ich Risiken in: 5+ Pages-Templates die `URL_SLUG_MAP` lesen". Tool-Sicht: das `URL_SLUG_MAP`-Refactor ist Repo-seitig; auf Tool-Seite ist das Lost-Update-Risiko bei Refresh nach Human-Edit wichtiger und heute nicht gemildert.

### Lost-Update-Risiken (konkrete Liste)

| # | Risiko | Datei:Zeile | Mitigation heute |
|---|---|---|---|
| L1 | Human edits YAML, Tool-Sync exportiert frische YAML — **Human-YAML verloren** | `astro-sync/src/steps/render-mdx.ts:114-142` | keine außer „Marcel ist disziplinär" |
| L2 | Refresh überschreibt `frontmatterExtras` Custom-Fields | `pipelines/src/article/steps/draft.ts:FRONTMATTER_EXTRAS-Output-Block` | keine — alles-oder-nichts UPSERT |
| L3 | Race-Condition Import↔Export bei kurzen Run-Windows | `astro-sync/src/import/steps/filter-changed-files.ts` | BullMQ Concurrency=1 auf Import-Queue |
| L4 | Required Astro-Field fehlt → silent build skip | `astro-sync/src/steps/render-mdx.ts:95-105` | nur warn(); kein Throw |
| L5 | Tool schreibt Feld, das Astro-Zod rejected → **silent drop bei Build**, kein Astro-Run-Error | `astro-sync/src/steps/render-mdx.ts:226-232` (Field-Filter) | keine; Field-Filter ist heuristisch |
| L6 | Cluster-Race: parallele Pipelines weisen Cluster unterschiedlich zu | `clusters` table FK | sequentielles Brief-Routing |
| L7 | Schema-Extension überschreibt manuell ergänztes JSON-LD im Repo | `schema-extension/PersistSchemaStep` | keine |
| L8 | `tool_pricing` Repo-Update wird beim Refresh überschrieben | `articles.tool_pricing` Promoted-Column | keine |

### Schema-Drift-Risiko (Tool→Astro)

**Heutiger Zustand:** _Silent fail._

- Tool schreibt MDX-YAML via `RenderMdxStep` mit dem Frontmatter-Feldset, das beim letzten `ExtractCollectionSchemasStep`-Lauf bekannt war
- Repo-seitig kann sich das Astro-Zod-Schema seit dem letzten Sync geändert haben (Editor hat manuell `config.ts` editiert)
- Build im Astro-Repo läuft, neuer Eintrag fails Zod-Validation, wird aus `getStaticPaths()` ausgeschlossen
- **Tool-Seite sieht keinen Fehler.** `ArticleSyncPipeline.UpdateDbStatusStep` marked `astro_synced_at=now`, `status='ready_to_publish'`
- Editor merkt es erst, wenn er die URL aufruft → 404 → Production-Bug

**Mitigation heute:** keine. `ResolveSchemaStep` läuft pro Sync, holt sich die aktuelle `config.ts`, aber wenn der Repo-Build separat fail't, ist das ein anderes System.

**Fix-Pfad:** `ArticleSyncPipeline` müsste am Ende einen GitHub-Workflow-Trigger plus Result-Poll machen (~10 Min Latency). Heute nicht implementiert. Alternative: serverseitige Astro-Build-Simulation im Tool (große Performance-Kosten).

---

## Phase 4 — Multi-Domain-Lücken-Analyse

Für jede Tool-Komponente, die heute implizit Toolwiki-Wissen trägt: was muss passieren, damit BK-Werk sie nutzen kann?

| # | Komponente | Toolwiki-Bindung heute | BK-Variabilität | Lösungs-Pattern | Aufwand |
|---|---|---|---|---|---|
| **MD1** | `articleCollectionTypeEnum` | hartcodiert: `blog\|comparison\|ki-wissen\|tools\|usecases` | BK braucht: `blog\|vergleich\|wirtschaftlichkeit\|produkte\|guides` | **e) per-Project-DB-Spalte** statt pgEnum (z.B. `articles.collection text`, mit per-Project-CHECK-Constraint via Trigger oder Zod-at-Write). Aktuell schon halb-Realität: `articles.collection text NOT NULL DEFAULT 'blog'`; nur der Drizzle-`$type<>()`-Cast hat das Enum. | **M** — Drizzle-Type ändern, `ARTICLE_COLLECTION_TYPES` zur Project-Config-Lookup-Funktion machen |
| **MD2** | `tool_*` Promoted-Columns auf `articles` | hartcodiert 6 Spalten: `tool_pricing, tool_price_from, tool_rating, tool_votes, tool_affiliate_slug, tool_website` | BK braucht: `product_brand, product_einspeisung_w, product_garantie_jahre, product_amazon_asin, …` | **Option a)** Spalten umbenennen zu `extra1..extraN text` + Schema-Lookup pro Domain; **Option b)** Per-Domain-Promotion-Map in `projects.astroCollectionSchemas` (existiert schon!) + Domain-Extras-JSONB (siehe Persist-2-Sharpened in Phase 5) | **L** — strukturell groß, aber Phase-1-Pattern (Promoted-Columns für hot fields) bleibt |
| **MD3** | `intentType` Enum-Werte hartcodiert | DraftStep-Prompt hat 9 Werte hartcodiert | BK braucht andere Intents (`installation, wirtschaftlichkeit, troubleshooting, …`) | **b) Per-Project-Config-Field** `project_configurations.intentTaxonomyDefault` existiert schon (Spec 54.2)! Aber der Hartcoded-Prompt liest es nicht. **d) Pure-Logic-Refactor:** DraftStep-Prompt liest `intentTaxonomyDefault` zur Laufzeit. | **S** — bestehende Config-Spalte verwenden |
| **MD4** | `bottomLinksVariant` Enum-Werte hartcodiert | LLM-Prompt-Instruction in `draft.ts` (Per-Pattern aus DraftStep frontmatterSchema, gut!) | BK braucht andere Varianten | **a) DB-Spalte oder Spec-50-Schema** — schon halb via Astro-Schema-Extraction-Mechanismus | **S** — Spec 50 erlaubt es bereits, das per-Project zu konfigurieren |
| **MD5** | `external_signals.source` CHECK-Constraint | 6 Werte: `producthunt, hackernews, vendor_rss, reddit, github, dataforseo_trends` | BK braucht: `vendor_rss` (universal), evtl. `amazon_api, idealo_api, solar_industry_rss` | **a) CHECK-Widening pro neuer Quelle** (per Migration); **b) Per-Project nur Subset aktivieren** | **M** — schema-Erweiterung |
| **MD6** | LLM-Draft/Outline-Prompts „toolwiki.ai" + „AI tools" | 8+ hartcodierte Stellen | per-tenant Domain-Name + Scope-Statement | **b) Per-Tenant Variable Swap** via `projects.contentScopeInstructions` text-Spalte oder `marketing_context_md` (existiert!) | **S–M** — Prompt-Templates refactoren, Variable injizieren |
| **MD7** | Social-Image hooks „German AI tools niche" | hartcodiert in 6 Hook-Templates | per-tenant Niche-Statement | **b)** gleichen Pattern | **S** |
| **MD8** | Categories: 3 verschiedene Modelle (Phase-1-Befund) | `blog.category` Enum, `ki-wissen.category` deutsch-Enum, `tools.category` freier String | BK braucht 4-7 Categories mit lokalisierten Labels + URL-Slugs | **a) Neue `content_categories`-Tabelle** mit `{slug, project_id, scope, translations JSONB}`. Articles referenzieren per Slug. | **L** — Migration + Tool-Refactor + Repo-Refactor parallel |
| **MD9** | `relatedPillars` 12-Werte-Enum | hartcodiert im Astro-Schema (Spec 50 holt es als JSONB) | nicht relevant für BK | **c) Domain-Plugin** — bleibt im Repo, kein Tool-Schema-Refactor nötig (Astro-Schema-Extraction holt es per-Project) | ✅ schon abstrahiert |
| **MD10** | Hub-Spoke-Cluster-Topology (`cornerstone_specs`, `clusters`, `content_pillars`) | hartcodierter Workflow zentral in `cluster:full-plan` + Cluster-Topology-Spalten | BK kann's deaktivieren oder repurpose'n für „Produktkategorien-Hub-Spoke" | **e) Akzeptabel als opt-in** — BK kann ohne nutzen; `project_goals` setzt `cluster=0` und Cluster-Tabellen bleiben leer | ✅ Status quo |
| **MD11** | Signal-Adapter-Defaults (HN/Reddit/GitHub-Queries) | hartcodiert in `signal-source.ts` jedes Adapters | BK braucht Solar-spezifische Queries | **b) Per-Project-Config** existiert schon in `signalSources` JSONB; nur Defaults sind biased | 🟡 **S** — Defaults pro Industry-Profile setzen beim Project-Create |
| **MD12** | Cron-job-type-Enum hat AI-spezifische Werte | `signal_collector_*` Subtypes für 5 AI-Quellen | BK könnte zusätzliche Subtypes brauchen | **a) ALTER TYPE ADD VALUE** pro neuem Adapter (Memory D124 Pattern) | **S** — Migration pro neuer Quelle |
| **MD13** | `astro-sync` Adapter (`COLLECTION_ASTRO_NAME` 4. Kopie) | hartcodierte 5-Werte-Collection-Folder-Map | BK braucht andere Map | **d) Pure-Logic-Refactor:** alle 4 Pattern-107-Kopien auf eine Project-Config-Lookup-Funktion umstellen | **M** — 4 Edits + Test |
| **MD14** | `pagespeed` Adapter Port 14321 + Astro-Build-Workflow | Astro-spezifisch | BK braucht generisches PageSpeed (URL-only) | **c) Domain-Plugin** + Astro-Variant erhalten; oder **d) Hybrid:** API-Mode generisch, Local-Mode Astro-only | **M** — neuer URL-only-Mode |
| **MD15** | Translation `LANG_INDEPENDENT_EXTRAS` Whitelist | hartcodiert in `translation/pipeline.ts` | BK braucht andere Felder | **b) Per-Domain-Config** im Domain-Extras-Schema | **S** |
| **MD16** | Schema.org JSON-LD: `SoftwareApplication` für Tools | hartcodiert | BK braucht `Product` für Balkonkraftwerke | **c) Layout-Konvention pro Domain** — keine Tool-Schema-Erweiterung; Bridge in Tool-`AssemblyStep` mit Schema-Type-Switch | **M** |
| **MD17** | `cornerstone_keyword` Konzept | hartcodierte Spalte + zentral im Cluster-Workflow | BK braucht nicht zwingend, aber „Primary-Keyword" Konzept übertragbar | **e) Akzeptabel als opt-in/nullable** | ✅ Status quo |
| **MD18** | Tool-Article-Specific-Validators in social-image | `comparison-grid-4` braucht ≥4 Tools resolved | BK-Templates brauchen andere Schwellen | **b) Per-Project Template-Eligibility-Map** | **M** |

**Summary Multi-Domain-Lücken:** 7 × S, 8 × M, 3 × L. Total ~3-5 Wochen Engineering, davon **MD2 (tool_*-Columns), MD8 (Categories), MD1 (Collection-Enum)** die strukturell größten Risiken.

---

## Phase 5 — Persistenz-Modell (3 Optionen, Empfehlung)

### Option Persist-1: Single JSONB (`articles.frontmatter JSONB`)

**Beschreibung:** Alle Frontmatter-Felder unstrukturiert in einer einzelnen `articles.frontmatter JSONB`-Spalte. Validierung beim Insert via Per-Project Zod-Schema.

**Mapping zu Phase-1-Zwei-Layer:**
- Layer 1 (Core, A+B): leben im JSONB
- Layer 2 (Extension, C): leben im JSONB
- Keine Trennung auf DB-Ebene

**Migrations-Aufwand für 268 imported Articles:**
- **Hoch:** alle Promoted-Columns (`category, subcategory, tags, author, intentType, clusterKey, clusterRole, noindex, tool_pricing, tool_price_from, ...`) müssen zurück ins JSONB
- ~20 Migrations-Spalten zu „collabsen"
- Query-Refactor in ~50 Stellen (Astro-Sync-Importer, Pipeline-Routes, Read-Helpers)

**Query-Performance:**
- ❌ Pro Frontmatter-Filter (`WHERE category = 'guides'`) → JSONB-Operator + Index nötig (`CREATE INDEX … USING gin ((frontmatter->>'category'))`)
- ❌ Hub-Spoke-Selects: `WHERE cluster_key = ? AND cluster_role = 'hub'` → JSONB-Path-Op
- Pattern für Listings (sort by date, filter by tag, etc.) wird komplex

**Wartbarkeits-Profil:**
- ✅ Feld hinzufügen = nur Zod-Schema-Edit
- ✅ Bucket-Wechsel A↔B↔C = kein Schema-Refactor
- ❌ Type-Safety in Drizzle verloren

**Verdikt:** Maximale Flexibilität, aber **Query-Performance-Regression** auf den heißen Pfaden. Geeignet für völligen Greenfield-Restart. Für bestehende 268 Articles + heißes Hub-Spoke-Workflow zu schmerzhaft. **NICHT EMPFOHLEN.**

### Option Persist-2 (Status quo + Sharpening): Promoted Columns + Domain-Extras-JSONB

**Beschreibung:** Wie heute, aber explizit:
- **Bucket-A+B-Felder als Promoted-Columns** auf `articles` (universal, indizierbar)
- **Bucket-C-Felder pro Domain in `frontmatter_extras` JSONB** (heute schon)
- **Aber:** Bucket-C-Toolwiki-Promoted-Columns (`tool_pricing` etc.) entweder
  - (a) als „Toolwiki-Domain-Promotion" markieren (semantischer Tag, NULL für andere Domains) — Aufwand niedrig, dafür DB-Schema-Pollution
  - (b) zurück ins JSONB (Bucket C) — Aufwand mittel, dafür sauber

**Mapping zu Phase-1-Zwei-Layer:**
- Layer 1 = Promoted-Columns (vielleicht +5 Felder, die heute noch nicht promoted sind aber Bucket-A sind: `draft`, `excerpt`, `readingTime` …)
- Layer 2 = `frontmatter_extras` (rename optional zu `domain_extras` für Klarheit)
- Sauberer Schnitt: kein „Domain-Spalten-Lecken" auf Layer 1 nach Sharpening (b)

**Migrations-Aufwand für 268 imported Articles:**
- **Bei Variant (a) — Tag-only:** keine Migration nötig.
- **Bei Variant (b) — Tool-Columns zurück in JSONB:** mittel — 6 Spalten zu collabsen, `articles_read.ts`-Helpers anpassen, Importer/Pipeline anpassen. ~1-2 Tage.
- Plus: `frontmatter_extras` → `domain_extras` Spalten-Rename (rein semantisch, optional).

**Query-Performance:**
- ✅ Hot-Path-Queries auf Promoted-Columns bleiben billig
- Variant (a): `tool_*`-Filter bleibt billig auch für Non-Toolwiki-Domains (mit NULL)
- Variant (b): `tool_*`-Filter auf BK nicht relevant; auf Toolwiki über JSONB-Path-Op (langsamer als heute, aber Toolwiki-only)

**Wartbarkeits-Profil:**
- ✅ Bucket-A+B-Erweiterung = neue Promoted-Column-Migration (etabliertes Pattern)
- ✅ Bucket-C-Erweiterung pro Domain = nur Zod-Registry-Update + JSONB-Write
- 🟡 Bucket-Wechsel B→A (Promote ein Feld) = Migration + Code-Refactor (überschaubar)

**Wo es kompliziert wird:**
- Per-Domain-Promoted-Columns. Wenn BK plötzlich `product_einspeisung_w` als Hot-Field will → entweder als neue Promoted-Column auf `articles` (Toolwiki nutzt es nicht, NULL) oder eigene Tabelle `articles_bk_extras` (Anti-Pattern für N-Domains).
- **Empfehlung im Sharpening:** Bucket-C bleibt **strikt** in JSONB. Wenn BK Performance-Probleme bekommt, erst dann pro-Project-Index auf JSONB-Path schreiben (`CREATE INDEX … WHERE project_id = '<bk-id>'`).

**Verdikt:** **EMPFOHLEN** — Status quo + 2 Sharpening-Schritte:
1. `tool_*`-Promoted-Columns als Bucket-C-Toolwiki-Promotion semantisch markieren (Variant a) oder zurück ins JSONB schieben (Variant b — sauberer, aber 1-2 Tage Migration). Variant (a) ist der pragmatische Quick-Win.
2. `frontmatter_extras` → `domain_extras` umbenennen (rein semantisch, optional; signalisiert in der Codebase, dass das die domain-spezifische Schicht ist).

### Option Persist-3: Tabelle pro Domain

**Beschreibung:** `articles_toolwiki`, `articles_bkwerk` als separate Tabellen mit jeweils strikt domain-spezifischen Spalten.

**Mapping zu Phase-1-Zwei-Layer:**
- Eine Tabelle pro Domain ist *anti-pattern* für ein Multi-Domain-Tool, weil es jede neue Domain zur Schema-Migration macht.

**Verdikt:** Pattern für 1 Domain mit sehr unterschiedlichen Schemas akzeptabel; für N-Domain-Tool **NICHT EMPFOHLEN**.

### Empfehlung

**Persist-2-Sharpened.** Begründung:
- Behält die heutige Migrations- + Query-Performance-Investition
- Adressiert den Hauptkritikpunkt aus Phase-1 (Layer-1+2-Trennung) ohne strukturelle Disruption
- Variant (a) des Sharpenings ist 0-Aufwand und schafft semantische Klarheit
- Phase-1-Empfehlung (Composition im Repo, JSONB im Tool) ist damit eingehalten

Variant (b) — `tool_*` zurück ins JSONB — wäre langfristig sauberer (Phase-1-Idealwelt), ist aber 1-2 Tage Migration. Kann auf später verschoben werden ohne Multi-Domain-Aufschlag zu blockieren.

---

## Phase 6 — Zod-Package-Strategie

### Vorschlag: `packages/content-schema` als Workspace-Package, JETZT extrahieren

**Ort:** `packages/content-schema/src/` (neuer Workspace im Monorepo, parallel zu `packages/shared`)

**Inhalt:**

```
packages/content-schema/
├── package.json
├── src/
│   ├── index.ts                       # Public API entry
│   ├── core/
│   │   ├── seo.ts                     # seoCore zod schema
│   │   ├── i18n.ts                    # i18nCore (configurable locale list)
│   │   ├── cluster.ts                 # clusterCore (hub/spoke metadata)
│   │   ├── monetization.ts            # monetizationCore factory
│   │   └── base.ts                    # baseFrontmatter composition
│   ├── enums/
│   │   ├── collection.ts              # ARTICLE_COLLECTION_TYPES (re-export from shared)
│   │   ├── routing.ts                 # COLLECTION_ASTRO_NAME single source of truth
│   │   └── intent.ts                  # IntentType enums (cluster vs knowledge)
│   ├── domains/
│   │   ├── toolwiki/
│   │   │   ├── extras-blog.ts         # BlogExtrasSchema (Toolwiki bottomLinksVariant etc.)
│   │   │   ├── extras-comparison.ts   # ComparisonExtrasSchema (moved from pipelines)
│   │   │   ├── extras-ki-wissen.ts    # KiWissenExtrasSchema (moved from pipelines)
│   │   │   ├── extras-tools.ts        # ToolExtrasSchema (new — promotes today's tool_* fields)
│   │   │   └── extras-usecases.ts     # UsecaseExtrasSchema
│   │   └── balkonkraftwerk/          # NEW, parallel to toolwiki
│   │       ├── extras-blog.ts         # BK-specific blog extras
│   │       ├── extras-comparison.ts   # BK product comparison
│   │       └── extras-product.ts      # BK product reviews (replaces extras-tools)
│   ├── registry/
│   │   ├── types.ts                   # DomainSchemaRegistry interface
│   │   └── domain-registry.ts         # Per-project schema lookup
│   └── validators/
│       ├── compose.ts                 # buildArticleSchema(coreLocales, domainExtras)
│       └── boundary.ts                # validateFrontmatterAtWrite(articleId, frontmatter)
```

**Konsumenten:**

1. **Tool-Seite (`@marketing-auto/content-schema`):**
   - `packages/pipelines` ersetzt `import { ComparisonExtrasSchema } from "./frontmatter/comparison"` durch `import { ComparisonExtrasSchema } from "@marketing-auto/content-schema/domains/toolwiki"`
   - `packages/adapters/astro-sync` ersetzt 4. `COLLECTION_ASTRO_NAME`-Kopie durch Import aus `@marketing-auto/content-schema/enums/routing`
   - `apps/api` nutzt `boundary.validateFrontmatterAtWrite()` für Astro-Repo-Write
   - `packages/db` exportiert keine Schemas, sondern bleibt Drizzle-only

2. **Astro-Repo-Seite (Toolwiki + zukünftig BK):**
   - Per `npm link` lokal in Dev (während Tool und Repo parallel iteriert werden)
   - Per `git-submodule` oder npm-publish in Prod (sobald stable)
   - Repo-`config.ts` schreibt: `defineCollection({ schema: baseFrontmatter(['de','en']).merge(ToolwikiBlogExtras) })`

**Versionierung:**
- **Phase 1 (kurzfristig):** Workspace-Package, no version pinning. Lokaler Link bidirektional.
- **Phase 2 (mittelfristig):** semver-publish auf privates npm-Registry. Astro-Repo pinnt Major-Version.
- **Phase 3 (langfristig):** CI-Check bei jedem Tool-Build + Repo-Build, dass die referenzierten Versionen kompatibel sind.

**Cross-Boundary-Validation:**

```typescript
// Tool: vor Astro-Repo-Write
import { domainSchemaRegistry } from "@marketing-auto/content-schema";

const result = domainSchemaRegistry
  .forProject(article.projectId)
  .forCollection(article.collection)
  .validate(buildFrontmatter(article));

if (!result.success) {
  throw new AstroSyncError("frontmatter validation failed", result.error);
}
```

```typescript
// Astro-Repo: in config.ts
import { defineCollection } from "astro:content";
import { baseFrontmatter, ToolwikiBlogExtras } from "@marketing-auto/content-schema";

export const collections = {
  blog: defineCollection({
    schema: baseFrontmatter(["de", "en"]).merge(ToolwikiBlogExtras),
  }),
  comparison: defineCollection({
    schema: baseFrontmatter(["de", "en"]).merge(ToolwikiComparisonExtras),
  }),
  // …
};
```

**Synergien mit Spec 50 (`ExtractCollectionSchemasStep`):**

Heute extrahiert Spec 50 das Astro-Schema per Regex und persistiert es als JSONB. Das ist ein Fallback für den Fall, dass Tool und Repo nicht das gleiche Zod-Package nutzen. Wenn `@marketing-auto/content-schema` extrahiert ist:
- Spec 50 wird **redundant** wenn beide Seiten das Package importieren
- Aber: für Backward-Compat (Toolwiki Astro-Repo nutzt es noch nicht) bleibt Spec 50 als Brücke

**Migrations-Phasen:**

1. **Phase 1.0 (Woche 1):** Workspace-Package anlegen, `ARTICLE_COLLECTION_TYPES` + `COLLECTION_ASTRO_NAME` als Single-Source umziehen. 4 Kopien im Tool reduzieren auf Imports. ~4 Stunden.
2. **Phase 1.1 (Woche 1):** `ComparisonExtrasSchema` + `KiWissenExtrasSchema` umziehen aus `packages/pipelines/article/frontmatter/`. ~2 Stunden.
3. **Phase 1.2 (Woche 2):** `baseFrontmatter()` Factory schreiben (Phase-1-Empfehlung). 1 Tag.
4. **Phase 2.0 (Woche 2-3):** Domain-Registry-Mechanismus implementieren — per-Project Schema-Lookup. 2-3 Tage.
5. **Phase 2.1 (Woche 3):** `boundary.validateFrontmatterAtWrite()` in `ArticleSyncPipeline.RenderMdxStep` einhängen. Schließt L5-Lost-Update-Risiko aus Phase 3. ~1 Tag.
6. **Phase 3 (Woche 4+):** Toolwiki-Astro-Repo migrieren, das Package zu nutzen statt eigener Zod-Definitionen. ~2-3 Tage.

**Cross-Reference Phase-1:** Phase-1 sagt _„Im Astro-Repo: Zod-Composition (Option B). Astro-native, type-safe, build-time-validiert. Im Marketing-Tool (Postgres): Eine Spalte core_frontmatter JSONB (Bucket A+B) + Spalte domain_extras JSONB (Bucket C)."_ Meine Empfehlung schärft das: **JSONB-Spalten-Split ist optional (Persist-2-Sharpened reicht); aber das geteilte Zod-Package ist der eigentliche Hebel.**

---

## Phase 7 — Risiken & Decisions

### Decisions, die Marcel braucht (bevor Implementation startet)

| # | Decision | Empfehlung | Trade-off |
|---|---|---|---|
| **D1** | **Persistenz-Option** | Persist-2-Sharpened (Variant a — Tag-only) | Minimaler Migrations-Aufwand. Variant (b) wäre langfristig sauberer aber 1-2 Tage extra. |
| **D2** | **Zod-Package extrahieren — jetzt oder später?** | **JETZT** — vor BK-Aufschlag. | Wenn später: Tool + BK-Astro driften zwischen den Initial-BK-Pipelines und der späteren Konsolidierung. Schema-Drift erzeugt Edge-Cases die schwer rückzubauen sind. Pro „jetzt": maximaler Wert für BK-Onboarding ohne Re-Refactor. |
| **D3** | **Categories-Refactor — jetzt oder später?** | **JETZT** — Phase-1-D3 + diese Synthese-MD8 sind eindeutig. | 2 Tage Migration im Tool + Repo parallel. Wenn später: 3 Modelle bleiben in Toolwiki, BK braucht 4. Modell → Anti-Pattern. |
| **D4** | **`tool_*`-Promoted-Columns — Tag-only oder zurück ins JSONB?** | **Tag-only** (Variant a aus Persist-2). | Variant (b) ist sauberer aber 1-2 Tage Migration. Pragmatic: Tag jetzt, Refactor wenn BK Performance-Probleme verursacht. |
| **D5** | **`relatedPillars` (Phase-1-Lock-In) — refactoren oder akzeptieren?** | **Akzeptieren** im Tool (es persistiert im JSONB ohne DB-Constraint), Phase-1-Vorschlag (Soft-Slug-Reference) im Repo umsetzen. | Tool-Seite ist nicht das Problem; Repo-Seite ja. |
| **D6** | **Domain-Plugin-Pattern: BK-spezifische Logik (z.B. Tarif-Calculator-Embed) — Tool oder Repo?** | **Repo** (analog zu Toolwiki HubCarousel). Tool wissensfrei. | Wenn Tool: jede neue Domain-Feature braucht Tool-Code-Change. Wenn Repo: Tool bleibt rein Content-Generator. |
| **D7** | **Boundary-Validator beim Astro-Write (L5-Lost-Update)** | **Implementieren** in Phase 2.1 des Zod-Package-Rollouts. | Heute silent fail bei Schema-Drift. Implementieren bevor BK live geht. |
| **D8** | **Field-Level-Ownership-Marker (Lost-Update L1+L8)** | **Phase-2 (später) — nicht jetzt.** | Pattern wäre `articles.field_authority JSONB` (`{"tool_pricing": "tool", "featured": "human"}`). Komplexes Feature; heute Marcel disziplinär ausreichend. |
| **D9** | **Migrations-Reihenfolge** | (1) Zod-Package + Pattern-107-Konsolidierung; (2) `tool_*`-Tag; (3) `frontmatter_extras` → `domain_extras` Rename; (4) Categories-Tabelle; (5) Boundary-Validator. | Reihenfolge minimiert Dependencies. Categories-Tabelle ist die heißeste, kann aber erst nach Zod-Package starten. |
| **D10** | **Onboarding-Pfad für 3., 4. Domain — wie aussehen?** | Wenn das Datenmodell richtig sitzt: (a) Project-Create in Tool; (b) Astro-Repo cloning + `config.ts` mit Zod-Package-Imports; (c) Domain-Extras-Schema in `packages/content-schema/domains/<name>/` anlegen; (d) Project-Configuration JSONB konfigurieren (signal-sources, intent-taxonomy, etc.). | Idealer Workflow: ~1-2 Stunden „from project-create to first generated article". |

### Risiken (zusammengefasst)

| # | Risiko | Schadensklasse | Mitigation |
|---|---|---|---|
| R1 | Schema-Drift Tool↔Repo bei Live-Iteration (vor Zod-Package) | mittel | Phase 1.0 Zod-Package-Extraktion sofort |
| R2 | Lost-Updates beim Refresh nach Human-Edit | mittel-hoch | Field-Authority-Marker (D8, später); kurzfristig: Disziplin |
| R3 | Categories-Refactor bricht 268 imported Articles | hoch | Phasen-Migration (additive zuerst, alte Spalten parallel halten, dann deprecate) |
| R4 | BK-Aufschlag landet auf Tool-Codebase ohne Domain-Layer | hoch | D2 + D3 vor BK-Onboarding |
| R5 | `tool_*` Spalten auf zentraler `articles`-Tabelle bleiben Toolwiki-vermischt | niedrig | D4 Variant (a) — Tagging ist 0-Aufwand-Win |
| R6 | Pattern-107 4. Kopie in `astro-sync` wird vergessen bei Collection-Add | niedrig-mittel | D9 Schritt 1 — Single-Source via Zod-Package |
| R7 | Spec-50-Mechanismus wird redundant nach Zod-Package, aber bleibt im Code | niedrig | dokumentieren; nicht entfernen bis BK-Astro auch das Package nutzt |
| R8 | Astro-Build-Drop bei Required-Field-Miss (L5) | hoch | D7 — Boundary-Validator beim Write |

### Wissenslücken (was ich nicht aus dem Code ableiten konnte)

1. **Wie aktiv ist der Refresh-Pfad auf imported-Artikeln?** Phase-3-Risiko L2 hängt davon ab. Wenn Refresh überwiegend auf `source='generated'` läuft, ist das Risiko klein. Wenn Toolwiki regelmäßig Repo-Editierte Tools refresht, ist's eine Live-Bug-Quelle.
2. **Wann ist BK-Astro-Repo geplant?** Wenn in <4 Wochen, dann D9-Phasen 1-4 vorher abschließen. Wenn in >2 Monaten, kann Phase 5 (Boundary-Validator) gemächlich.
3. **Marketing-Tool-Push-Mechanismus** zum Repo: heute GitHub-App-API per `astro-sync`. Toolwiki-Astro-Repo hat **keine GitHub-Actions, kein CI-Pipeline** (Phase-1-Befund). BK-Repo soll das gleich anders aufsetzen? CI-driven-validation der gemerged'ten MDX-Files wäre Lost-Update-Mitigation.
4. **Wie viel von `project_configurations.master_prompts` (Spec 54.2) wird heute tatsächlich genutzt?** Wenn 0/Toolwiki — dann fix für Per-Tenant-Prompt-Var-Swap (MD6). Wenn schon aktiv, ist BK-Onboarding trivialer.
5. **`projects.marketingContextMd` (Cold-Start Phase 1 Output)** — wird das im LLM-Prompt-Context wirklich injiziert für DraftStep/OutlineStep? Wenn ja: MD6-Fix ist „bestehenden Mechanismus nutzen". Wenn nein: bauen.

---

## Anhang: Files gelesen, Konfidenz pro Befund

### Vollständig gelesen (Konfidenz: high)
- `packages/db/src/schema/content.ts` (1031 Zeilen)
- `packages/db/src/schema/operations.ts` (828 Zeilen)
- `packages/db/src/schema/projects.ts` (234 Zeilen)
- `packages/db/src/schema/_enums.ts` (127 Zeilen)
- `packages/db/src/schema/cron.ts` (43 Zeilen)
- `packages/db/src/schema/identity.ts` (147 Zeilen)
- `packages/db/src/schema/batch.ts` (212 Zeilen)
- `packages/db/src/schema/project-config.ts` (243 Zeilen)
- `packages/db/src/schema/auth.ts` (53 Zeilen)
- `packages/db/src/schema/notifications.ts`, `push.ts`, `refresh.ts`, `social-overrides.ts` (kurze Files)
- `packages/adapters/astro-sync/src/import/pipeline.ts`
- `packages/adapters/astro-sync/src/import/parse-frontmatter.ts`
- `packages/adapters/astro-sync/src/import/steps/upsert-articles.ts`
- `packages/adapters/astro-sync/src/steps/render-mdx.ts`
- `packages/adapters/astro-sync/src/steps/commit-to-github.ts`
- `packages/adapters/astro-sync/src/steps/resolve-schema.ts`
- `packages/adapters/astro-sync/src/pipeline.ts`
- `packages/pipelines/src/article/types.ts`
- `packages/pipelines/src/article/frontmatter/comparison.ts`
- `packages/pipelines/src/article/frontmatter/ki-wissen.ts`
- `packages/pipelines/src/article/blog/persist.ts`
- `packages/pipelines/src/article/steps/persist-article.ts`
- `packages/pipelines/src/article/lib/canonical-url.ts`
- `packages/pipelines/src/article/prompts/index.ts`
- `packages/pipelines/src/article/prompts/comparison.ts`
- `packages/pipelines/src/article/prompts/ki-wissen.ts`
- `packages/shared/src/config.ts`
- `packages/shared/src/brand-tokens/schema.ts`
- `packages/shared/src/types/article-collection.ts`
- `apps/api/src/routes/_lib/trigger-helpers.ts`

### Teils gelesen / Header + Key-Funktionen (Konfidenz: medium)
- `packages/pipelines/src/article/steps/draft.ts` (>800 Zeilen — Stichprobe auf Prompt-Block lines 80-150)
- `packages/pipelines/src/article/steps/outline.ts` (~500 Zeilen — Stichprobe auf Prompt-Block lines 55-100)
- `packages/pipelines/src/article/social-image/steps.ts` (>1000 Zeilen — Stichprobe auf Toolwiki-Brand-Strings)
- `packages/pipelines/src/article/social-image/hookPrompt.ts` + `hookEngine.ts`
- `packages/pipelines/src/article/translation/pipeline.ts`
- `packages/pipelines/src/article/translation/lib/locale-strings.ts`
- `packages/pipelines/src/cluster/full-plan/types.ts`
- `packages/pipelines/src/planning/index.ts` + steps
- `packages/pipelines/src/topic-sources/trend-discovery/prompts.ts`
- `packages/pipelines/src/cold-start/_lib/niche-context.ts`
- `packages/pipelines/src/article-quality/schema.ts`
- `packages/pipelines/src/article/hero-generation/pipeline.ts`
- Alle Adapter-Index-Files unter `packages/adapters/*/src/index.ts`
- `apps/api/src/workers/index.ts` + Worker-Files (mehr Stichprobe auf cron_job_type-Mapping)
- `apps/api/src/routes/articles.ts`, `projects.ts`, `cornerstone-specs.ts` (Stichprobe auf Body-Schemas)

### Selective Migrations-SQL (Konfidenz: medium)
- 0001-0042 (Foundation)
- 0050, 0061, 0074, 0079, 0082, 0084, 0089, 0090, 0091 (gezielte CHECK-Constraint-Reads)
- Restliche ~50 Migrations: Headers nur (Spec-Tagging gelesen, Inhalt nicht detailliert)

### Nicht gelesen (Konfidenz: low — Findings hier sind aus CLAUDE.md-Memory-Spec-Index abgeleitet)
- Apps/Web Frontend-Pages (Settings-UI nur über Description aus Spec-Indexes)
- Test-Files (nicht relevant für Schema-Audit)
- `packages/skills/` (Submodule, nicht im Scope)
- `packages/social/` Composition-Files (Remotion-Templates; nicht im Scope)
- `packages/cost-tracker/` Implementation-Details
- `packages/planner/` Implementation-Details (nur über Spec-Index referenziert)

### Cross-Reference-Notiz zum Phase-1-Report

Folgende Phase-1-Befunde wurden in dieser Synthese explizit gespiegelt / referenziert:

- **D1 (Geteiltes Zod-Package)** → Phase 6 dieser Synthese: „jetzt extrahieren"
- **D2 (Zwei-Layer-Persistenz)** → Phase 5 dieser Synthese: Persist-2-Sharpened (Tool-Seite); Phase 6: Composition (Repo-Seite)
- **D3 (Categories-Refactor)** → MD8 + D3 dieser Synthese: jetzt umsetzen
- **D4 (Comparison-Felder im Blog-Schema entfernen)** → Repo-Seitig, in dieser Synthese kein Tool-Refactor nötig
- **D5 (relatedPillars Soft-Reference)** → MD9 dieser Synthese: Repo-only Refactor, Tool akzeptiert
- **D6 (`next[]` Slug-Refs)** → Repo-only, Tool-Sicht: Pattern via Domain-Extras-Schema im Zod-Package
- **D7 (Bucket-D-Dynamisierung)** → Phase-1-D1 + D4 — beides Repo-Seitig, kein Tool-Refactor
- **E1 (relatedPillars 12-Enum)** → bestätigt aus Tool-Sicht — Tool persistiert nur in JSONB; ist im Repo das Problem
- **E13 (Datums-Naming-Bruch)** → bestätigt aus Tool-Sicht — Tool hat 4 Datums-Spalten (`publishedAt`, `updatedAt`, `frontmatterUpdatedAt`, `comparedAt`)

Folgende Phase-1-Befunde wurden in dieser Synthese **verschärft** (das Tool-Sicht-Risiko ist größer als der Phase-1-Report vermutet hatte):

- **R2 (Category-Refactor)** — Tool hat 0 Constraint heute auf `articles.category`. Phase-1 nahm an, das wäre überschaubar; aus Tool-Sicht ist es zentral für BK.
- **R7 (Marketing-Tool muss Domain-Schemas kennen)** — explizit jetzt durch Zod-Package adressiert.

Folgende Phase-1-Befunde wurden in dieser Synthese **abgeschwächt** (Phase-1 hatte überschätzt):

- **Bucket-D-Aufwand** — Phase-1 sagt „Bucket-D ist kleiner als erwartet" (HubCarousel + 11 Interactive). Tool-Sicht: Bucket-D ist **0-Aufwand fürs Tool** — Tool weiß nichts davon, Repo-Layout-Konvention.

---

*Ende des Reports. ~10.500 Wörter. Confidence-Verteilung: ~70 % high, ~25 % medium, ~5 % low (klar markiert).*
