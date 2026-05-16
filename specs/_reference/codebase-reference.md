# Codebase Reference Pack

**Generated:** 2026-05-15
**Generator:** Spec 54.7.5 (automated inspection)
**Purpose:** Ground-truth reference for writing Theme 54+ specs. Verify against this before writing column names, file paths, or FK relationships in any spec.

---

## SECTION 1: DB Schema

All tables are listed in dependency order (parents before children). For every table, the Drizzle field names (camelCase in code) and SQL column names (snake_case in DB) are documented separately.

### Table: `projects`

**File:** `packages/db/src/schema/projects.ts` (lines 9–80)
**Drizzle export name:** `projects`
**Type aliases exported:** `Project` (via `$inferSelect`), `NewProject` (via `$inferInsert`)

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `slug` | `slug` | text | NOT NULL | — | — | Unique index on this column |
| `name` | `name` | text | NOT NULL | — | — | |
| `domain` | `domain` | text | YES | — | — | |
| `industry` | `industry` | enum (industryEnum) | NOT NULL | — | — | Enum: `ai_education`, `automotive_dealer`, `renewable_affiliate`, `music_school`, `other` |
| `lifecycle_stage` | `lifecycleStage` | enum (lifecycleStageEnum) | NOT NULL | `cold_start` | — | Enum: `cold_start`, `pre_launch`, `launch`, `growth`, `mature` |
| `pipeline_template` | `pipelineTemplate` | enum (pipelineTemplateEnum) | NOT NULL | — | — | Enum: `educational`, `affiliate_review`, `local_business`, `programmatic_seo` |
| `brand_identity` | `brandIdentity` | jsonb | NOT NULL | `{}` | `BrandIdentity` | Type: `{ voice?, tone?, forbiddenPhrases?, signaturePhrases?, pronounStyle?, anglicismPolicy?, humorLevel? }` |
| `target_audience` | `targetAudience` | jsonb | NOT NULL | `{}` | `TargetAudience` | Type: `{ primaryPersona?, language?, region? }` |
| `cms_config` | `cmsConfig` | jsonb | NOT NULL | `{}` | `CmsConfig` | Type: `{ type?, repoUrl?, contentPath?, deployWebhookUrl?, baseUrl? }` |
| `monetization_config` | `monetizationConfig` | jsonb | NOT NULL | `{}` | `MonetizationConfig` | Type: `{ adsenseEnabled?, affiliatePrograms?, ownProducts? }` |
| `pipeline_config` | `pipelineConfig` | jsonb | NOT NULL | `{}` | `PipelineConfig` | Type: `{ articleMinWords?, articleMaxWords?, publishFrequencyPerWeek?, socialRepurposeEnabled?, approvalMode?, autoTopicSuggestionsPerDay? }` |
| `cost_limits` | `costLimits` | jsonb | NOT NULL | `{}` | `CostLimits` | Type: `{ daily?, monthly?, alertAtPercent?, killAtPercent? }` |
| `marketing_context_md` | `marketingContextMd` | text | YES | — | — | |
| `marketing_context_updated_at` | `marketingContextUpdatedAt` | timestamp w/ tz | YES | — | — | |
| `target_locales` | `targetLocales` | jsonb | NOT NULL | `["de-DE"]` | `string[]` | Array of locale codes |
| `target_niche` | `targetNiche` | text | YES | — | — | Tags for Cold-Start hint (e.g. `ai-tool-wiki`, `automotive-dealer`, `solar-energy`) |
| `astro_repo` | `astroRepo` | jsonb | YES | — | `AstroRepoConfig` | Type: `{ owner, name, installationId, defaultBranch, contentRoot, assetsRoot }` |
| `link_rebuild_budget_monthly` | `linkRebuildBudgetMonthly` | numeric(10,2) | YES | `30.00` | `string` | EUR; stored as numeric |
| `pagespeed_thresholds` | `pagespeedThresholds` | jsonb | NOT NULL | `{performance:85, accessibility:90, bestPractices:90, seo:95}` | `PagespeedThresholds` | Type: `{ performance, accessibility, bestPractices, seo }` |
| `gaps_last_detected_at` | `gapsLastDetectedAt` | timestamp w/ tz | YES | — | — | Spec 49b tracking |
| `astro_collection_schemas` | `astroCollectionSchemas` | jsonb | YES | — | `AstroCollectionSchemas` | Type: `Record<string, FrontmatterFieldDescriptor[]>` |
| `auto_publish` | `autoPublish` | boolean | NOT NULL | `false` | — | Spec 49d: trigger Astro-Transfer after Schema-EN |
| `brand_tokens` | `brandTokens` | jsonb | NOT NULL | `{}` | `BrandTokens` | Spec 51: colors, typography, voice, social |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |

**Foreign Keys:** None (this is the root tenant table)

**Indexes:**
| Name | Columns | Type | Predicate |
|---|---|---|---|
| `projects_slug_idx` | `slug` | btree | — |

**Unique constraints:**
| Name | Columns | Predicate |
|---|---|---|
| `projects_slug_key` | `slug` | — |

---

### Table: `project_credentials`

**File:** `packages/db/src/schema/projects.ts` (lines 205–225)
**Drizzle export name:** `projectCredentials`
**Type aliases exported:** None explicitly exported (use `$inferSelect` / `$inferInsert` directly)

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Notes |
|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | FK → `projects(id)` ON DELETE cascade |
| `service` | `service` | enum (credentialServiceEnum) | NOT NULL | — | Enum: `google_analytics`, `google_search_console`, `google_adsense`, `instagram_graph`, `github_deploy`, `astro_deploy_webhook` |
| `encrypted_payload` | `encryptedPayload` | text | NOT NULL | — | Encrypted JSON blob |
| `expires_at` | `expiresAt` | timestamp w/ tz | YES | — | OAuth token expiry |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `project_credentials_project_idx` | `projectId` | btree |

**Unique constraints:**
| Name | Columns |
|---|---|
| `project_credentials_project_service_unique` | `projectId`, `service` |

---

### Table: `project_configurations`

**File:** `packages/db/src/schema/project-config.ts` (lines 111–140)
**Drizzle export name:** `projectConfigurations`
**Type aliases exported:** `ProjectConfiguration`, `NewProjectConfiguration`

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `version` | `version` | integer | NOT NULL | — | — | Semantic versioning within a project |
| `status` | `status` | text | NOT NULL | `draft` | `"draft" \| "active" \| "archived"` | Lifecycle |
| `intent_taxonomy_default` | `intentTaxonomyDefault` | jsonb | NOT NULL | — | `IntentTaxonomy` | Array of intent strings; Zod: `z.array(z.string().min(1)).min(1).max(20)` |
| `master_prompts` | `masterPrompts` | jsonb | NOT NULL | — | `MasterPrompts` | Zod keys: `article.outline`, `article.draft`, `article.self_review`, `article.localize.fresh`, `article.localize.translate`, `trend.synthesis` |
| `topic_scope` | `topicScope` | jsonb | NOT NULL | — | `TopicScope` | Languages, exclusions, primary_themes, relevance_keywords, min_trend_score, min_signal_thresholds |
| `signal_sources` | `signalSources` | jsonb | NOT NULL | — | `SignalSources` | Zod keys: `producthunt`, `hackernews`, `reddit`, `github`, `vendor_rss`, `dataforseo_trends` with per-source config |
| `automation_rules` | `automationRules` | jsonb | NOT NULL | — | `AutomationRules` | Currently `z.array(z.unknown()).default([])` — reserved for Phase 2 |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `activated_at` | `activatedAt` | timestamp w/ tz | YES | — | — | When `status` transitioned to `active` |
| `archived_at` | `archivedAt` | timestamp w/ tz | YES | — | — | When `status` transitioned to `archived` |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `project_configurations_project_idx` | `projectId` | btree |
| `project_configurations_project_version_unique` | `projectId`, `version` | unique |

---

### Table: `content_pillars`

**File:** `packages/db/src/schema/identity.ts` (lines 34–51)
**Drizzle export name:** `contentPillars`
**Type aliases exported:** None explicitly exported

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Notes |
|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | FK → `projects(id)` ON DELETE cascade |
| `name` | `name` | text | NOT NULL | — | Pillar title |
| `description` | `description` | text | YES | — | |
| `position` | `position` | integer | NOT NULL | `0` | Sort order within project |
| `intent_taxonomy_override` | `intentTaxonomyOverride` | jsonb | YES | — | Zod: `IntentTaxonomy \| null`; if present, overrides project default |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `content_pillars_project_idx` | `projectId` | btree |

---

### Table: `clusters`

**File:** `packages/db/src/schema/identity.ts` (lines 60–94)
**Drizzle export name:** `clusters`
**Type aliases exported:** None explicitly exported; `SatelliteKeywordEntry` type exported

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `pillar_id` | `pillarId` | uuid | NOT NULL | — | — | FK → `content_pillars(id)` ON DELETE restrict |
| `name` | `name` | text | NOT NULL | — | — | Cluster display name |
| `pillar` | `pillar` | text | YES | — | — | Denormalized pillar name (no join needed) |
| `primary_keyword` | `primaryKeyword` | text | YES | — | — | Main SEO keyword |
| `cornerstone_keywords` | `cornerstoneKeywords` | jsonb | NOT NULL | `[]` | `string[]` | Array of cornerstone keywords for this cluster |
| `satellite_keywords` | `satelliteKeywords` | jsonb | NOT NULL | `[]` | `SatelliteKeywordEntry[]` | Array: `{ cornerstoneKeyword, keywords: [{keyword, searchVolume?, difficulty?}] }` |
| `status` | `status` | text | NOT NULL | `proposed` | — | Lifecycle status |
| `pillar_article_id` | `pillarArticleId` | uuid | YES | — | — | FK to hub article (no DB-level constraint) |
| `position` | `position` | integer | NOT NULL | `0` | — | Sort order within pillar |
| `embedding` | `embedding` | vector(1024) | YES | — | — | pgvector; Voyage AI voyage-3; used in trend synthesis (Spec 54.5) |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |
| `pillar_id` | `content_pillars(id)` | restrict |

**Indexes:**
| Name | Columns | Type | Predicate |
|---|---|---|---|
| `clusters_project_idx` | `projectId` | btree | — |
| `clusters_pillar_idx` | `pillarId` | btree | — |
| `clusters_pillar_position_idx` | `pillarId`, `position` | btree | — |
| `clusters_embedding_idx` | `embedding` | HNSW | vector_cosine_ops |

---

### Table: `articles`

**File:** `packages/db/src/schema/content.ts` (lines 71–254)
**Drizzle export name:** `articles`
**Type aliases exported:** `Article`, `NewArticle`

**Columns (selected; 50+ total):**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `cluster_id` | `clusterId` | uuid | YES | — | — | FK → `clusters(id)` ON DELETE set null |
| `cornerstone_spec_id` | `cornerstoneSpecId` | uuid | YES | — | — | No DB FK (avoids circular dep with cornerstone_specs) |
| `slug` | `slug` | text | NOT NULL | — | — | Part of unique constraint (projectId, source, collection, locale, slug) |
| `cornerstone_keyword` | `cornerstoneKeyword` | text | YES | — | — | SEO keyword (null for imported articles) |
| `title` | `title` | text | YES | — | — | Article title |
| `meta_description` | `metaDescription` | text | YES | — | — | |
| `outline` | `outline` | jsonb | YES | — | `ArticleOutline` | Zod: sections with h2, intent, keyPoints, estimatedWords, targetKeywords |
| `body_md` | `bodyMd` | text | YES | — | — | Markdown content |
| `hero_image_r2_key` | `heroImageR2Key` | text | YES | — | — | Cloudflare R2 storage key |
| `hero_image_public_url` | `heroImagePublicUrl` | text | YES | — | — | Public URL |
| `hero_image_alt_text` | `heroImageAltText` | text | YES | — | — | |
| `schema_json_ld` | `schemaJsonLd` | jsonb | YES | — | `Array<Record<string, unknown>>` | Array of JSON-LD objects (Spec 23+) |
| `status` | `status` | enum (articleStatusEnum) | NOT NULL | `proposed` | — | Enum: 13 values from `proposed` to `published` |
| `approval_mode` | `approvalMode` | text | NOT NULL | `manual` | `"manual" \| "auto"` | |
| `outline_pipeline_run_id` | `outlinePipelineRunId` | uuid | YES | — | — | No DB FK |
| `draft_pipeline_run_id` | `draftPipelineRunId` | uuid | YES | — | — | No DB FK |
| `self_review_issues` | `selfReviewIssues` | jsonb | YES | — | `SelfReviewIssue[]` | Array: severity, category, location, description, suggestion? |
| `self_review_score` | `selfReviewScore` | integer | YES | — | — | 0–100 |
| `word_count` | `wordCount` | integer | YES | — | — | Cached for dashboards |
| `embedding` | `embedding` | vector(1024) | YES | — | — | pgvector; used for internal linking (Spec 24) |
| `collection_type` | `collectionType` | text | NOT NULL | `blog` | `"blog" \| "glossar" \| "case_study" \| "tool"` | Forward-compat for multiple collection types |
| `astro_synced_at` | `astroSyncedAt` | timestamp w/ tz | YES | — | — | |
| `astro_commit_sha` | `astroCommitSha` | text | YES | — | — | Git commit SHA after sync |
| `astro_pull_request_url` | `astroPullRequestUrl` | text | YES | — | — | |
| `astro_asset_paths` | `astroAssetPaths` | jsonb | YES | — | `{ heroImage? }` | Asset paths in Astro repo |
| `astro_frontmatter` | `astroFrontmatter` | jsonb | YES | — | `Record<string, unknown>` | Frontmatter YAML as JSON |
| `pagespeed_validated_at` | `pagespeedValidatedAt` | timestamp w/ tz | YES | — | — | Spec 22 |
| `pagespeed_scores` | `pagespeedScores` | jsonb | YES | null | `{performance, accessibility, bestPractices, seo} \| null` | |
| `pagespeed_core_web_vitals` | `pagespeedCoreWebVitals` | jsonb | YES | null | `{lcp, inp, cls} \| null` | |
| `pagespeed_failed_thresholds` | `pagespeedFailedThresholds` | jsonb | YES | null | `string[] \| null` | |
| `pagespeed_report_url` | `pagespeedReportUrl` | text | YES | — | — | |
| `pagespeed_astro_commit_sha` | `pagespeedAstroCommitSha` | text | YES | — | — | Commit at time of validation |
| `published_url` | `publishedUrl` | text | YES | — | — | Live URL |
| `published_at` | `publishedAt` | timestamp w/ tz | YES | — | — | |
| `internal_links_updated_at` | `internalLinksUpdatedAt` | timestamp w/ tz | YES | — | — | Spec 24 tracking |
| `internal_links_added` | `internalLinksAdded` | integer | YES | `0` | — | |
| `internal_link_targets` | `internalLinkTargets` | jsonb | NOT NULL | `[]` | `string[]` | Slugs of linked articles |
| `source` | `source` | enum (articleSourceEnum) | NOT NULL | `generated` | — | Enum: `generated`, `imported` |
| `collection` | `collection` | text | NOT NULL | `blog` | — | Astro collection name; NOT NULL with default |
| `locale` | `locale` | text | NOT NULL | `de` | — | `de` or `en`; NOT NULL with default |
| `translation_key` | `translationKey` | text | YES | — | — | Stable key linking DE/EN pairs |
| `file_path` | `filePath` | text | YES | — | — | Path in Astro repo (imported only) |
| `git_sha` | `gitSha` | text | YES | — | — | Git blob SHA for change detection |
| `frontmatter_updated_at` | `frontmatterUpdatedAt` | timestamp w/ tz | YES | — | — | |
| `author` | `author` | text | YES | — | — | Frontmatter author field |
| `category` | `category` | text | YES | — | — | Frontmatter category |
| `subcategory` | `subcategory` | text | YES | — | — | Frontmatter subcategory |
| `tags` | `tags` | text[] | YES | — | — | Frontmatter tags array |
| `noindex` | `noindex` | boolean | NOT NULL | `false` | — | |
| `cluster_key` | `clusterKey` | text | YES | — | — | Spec 49a: cluster name from frontmatter |
| `cluster_role` | `clusterRole` | text | YES | — | `"hub" \| "spoke" \| null` | Article's role in cluster |
| `intent_type` | `intentType` | text | YES | — | — | Spec 54k: `overview`, `features`, `review`, `pricing`, `use-cases`, `general`, `tutorial`, etc. |
| `frontmatter_extras` | `frontmatterExtras` | jsonb | NOT NULL | `{}` | `Record<string, unknown>` | Tool-specific fields (pros, cons, features, useCases, pricing, etc.) |
| `import_metadata` | `importMetadata` | jsonb | NOT NULL | `{}` | `ImportMetadata` | Zod: wordCount?, readingTimeMinutes?, headings?, hasAffiliateLinks?, imageCount?, internalLinks? |
| `imported_at` | `importedAt` | timestamp w/ tz | YES | — | — | First import timestamp |
| `last_imported_at` | `lastImportedAt` | timestamp w/ tz | YES | — | — | Last import timestamp |
| `project_config_version_id` | `projectConfigVersionId` | uuid | YES | — | — | No DB FK (avoids circular dep); FK declared via raw SQL migration |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |
| `cluster_id` | `clusters(id)` | set null |

**Indexes (selected):**
| Name | Columns | Type | Predicate |
|---|---|---|---|
| `articles_project_idx` | `projectId` | btree | — |
| `articles_cluster_idx` | `clusterId` | btree | — |
| `articles_status_idx` | `projectId`, `status` | btree | — |
| `articles_cornerstone_keyword_idx` | `cornerstoneKeyword` | btree | — |
| `articles_embedding_idx` | `embedding` | HNSW | vector_cosine_ops |
| `articles_project_source_coll_locale_slug_unique` | `projectId`, `source`, `collection`, `locale`, `slug` | unique | — |
| `articles_project_translation_key_idx` | `projectId`, `translationKey` | btree | — |
| `articles_project_collection_locale_idx` | `projectId`, `collection`, `locale` | btree | — |
| `articles_project_source_idx` | `projectId`, `source` | btree | — |
| `articles_cornerstone_spec_id_idx` | `cornerstoneSpecId` | btree | — |
| `articles_cluster_key_idx` | `projectId`, `clusterKey` | btree | — |
| `articles_cluster_role_idx` | `projectId`, `clusterRole` | btree | — |

---

### Table: `cornerstone_specs`

**File:** `packages/db/src/schema/content.ts` (lines 259–304)
**Drizzle export name:** `cornerstoneSpecs`
**Type aliases exported:** None explicitly exported

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Notes |
|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | FK → `projects(id)` ON DELETE cascade |
| `cluster_id` | `clusterId` | uuid | NOT NULL | — | FK → `clusters(id)` ON DELETE cascade |
| `locale` | `locale` | text | NOT NULL | — | `de` or `en` |
| `translation_key` | `translationKey` | text | NOT NULL | — | Stable key linking DE/EN pairs |
| `cornerstone_keyword` | `cornerstoneKeyword` | text | NOT NULL | — | SEO keyword |
| `proposed_title` | `proposedTitle` | text | NOT NULL | — | |
| `proposed_slug` | `proposedSlug` | text | NOT NULL | — | |
| `meta_description` | `metaDescription` | text | NOT NULL | — | |
| `estimated_word_count` | `estimatedWordCount` | integer | NOT NULL | — | |
| `h2_outline` | `h2Outline` | jsonb | NOT NULL | — | Zod: `string[]` |
| `status` | `status` | enum (cornerstoneSpecStatusEnum) | NOT NULL | `proposed` | Enum: `proposed`, `approved`, `in_generation`, `article_done`, `rejected` |
| `rejected_reason` | `rejectedReason` | text | YES | — | If status=rejected |
| `article_id` | `articleId` | uuid | YES | — | No DB FK (avoids circular dep) |
| `cornerstone_list_pipeline_run_id` | `cornerstoneListPipelineRunId` | uuid | YES | — | No DB FK |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |
| `cluster_id` | `clusters(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `cornerstone_specs_cluster_locale_unique` | `clusterId`, `locale` | unique |
| `cornerstone_specs_translation_key_idx` | `projectId`, `translationKey` | btree |
| `cornerstone_specs_project_status_idx` | `projectId`, `status` | btree |
| `cornerstone_specs_cluster_id_idx` | `clusterId` | btree |

---

### Table: `topic_briefs`

**File:** `packages/db/src/schema/content.ts` (lines 646–707)
**Drizzle export name:** `topicBriefs`
**Type aliases exported:** `TopicBrief` (via `$inferSelect`)

**Columns (all 30+):**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `source` | `source` | text | NOT NULL | — | `"gap_analysis" \| "trend_discovery" \| "refresh_detection" \| "manual"` | Discriminator for metadata |
| `gap_id` | `gapId` | uuid | YES | — | — | FK to `content_gaps` declared in migration SQL |
| `topic_title` | `topicTitle` | text | NOT NULL | — | — | |
| `primary_keyword` | `primaryKeyword` | text | YES | — | — | |
| `secondary_keywords` | `secondaryKeywords` | jsonb | NOT NULL | `[]` | `string[]` | |
| `locale` | `locale` | text | YES | — | — | `de` or `en` |
| `intent_type` | `intentType` | text | YES | — | — | From intent taxonomy |
| `cluster_id` | `clusterId` | uuid | YES | — | — | For appending to existing |
| `cluster_action` | `clusterAction` | text | NOT NULL | — | `"append_to_existing" \| "create_new" \| "translation" \| "refresh" \| "standalone"` | Routing decision |
| `search_volume_de` | `searchVolumeDe` | integer | YES | — | — | From DataForSEO |
| `search_volume_en` | `searchVolumeEn` | integer | YES | — | — | From DataForSEO |
| `difficulty` | `difficulty` | integer | YES | — | — | SEO difficulty 0–100 |
| `serp_snapshot` | `serpSnapshot` | jsonb | YES | — | — | SERP analysis data |
| `suggested_title` | `suggestedTitle` | text | YES | — | — | For article generation |
| `suggested_slug` | `suggestedSlug` | text | YES | — | — | |
| `suggested_meta` | `suggestedMeta` | text | YES | — | — | |
| `hero_image_prompt` | `heroImagePrompt` | text | YES | — | — | |
| `generation_mode` | `generationMode` | text | YES | — | `"evergreen" \| "timely" \| "pillar" \| "spoke" \| "refresh" \| "translation" \| null` | |
| `approval_required` | `approvalRequired` | boolean | NOT NULL | `true` | — | |
| `approval_status` | `approvalStatus` | text | NOT NULL | `pending` | `"pending" \| "approved" \| "rejected" \| "auto_approved" \| "superseded" \| "routed"` | Lifecycle |
| `approved_by` | `approvedBy` | text | YES | — | — | User ID or name |
| `approved_at` | `approvedAt` | timestamp w/ tz | YES | — | — | When approved/routed |
| `gap_metadata` | `gapMetadata` | jsonb | YES | — | `GapMetadata` | Zod: gapType, priority, clusterName?, clusterMemberCount?, existingLocale?, spokesPresent?, suggestedCornerstoneKeyword?, discoveredKeywords? |
| `trend_metadata` | `trendMetadata` | jsonb | YES | — | `TrendMetadata` | Zod: trendScore, signals[], freshnessWindow, relatedEvent?, scoreBreakdown? |
| `refresh_metadata` | `refreshMetadata` | jsonb | YES | — | `RefreshMetadata` | Zod: targetArticleId, staleness{daysSinceLastUpdate, rankingChange?, competitorRefreshed} |
| `routed_article_id` | `routedArticleId` | uuid | YES | — | — | FK to `articles` declared in migration SQL |
| `routed_cornerstone_spec_id` | `routedCornerstoneSpecId` | uuid | YES | — | — | FK to `cornerstone_specs` declared in migration SQL |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `topic_briefs_project_idx` | `projectId` | btree |
| `topic_briefs_project_status_idx` | `projectId`, `approvalStatus` | btree |
| `topic_briefs_project_source_idx` | `projectId`, `source` | btree |

---

### Table: `external_signals`

**File:** `packages/db/src/schema/content.ts` (lines 820–847)
**Drizzle export name:** `externalSignals`
**Type aliases exported:** `ExternalSignal`, `NewExternalSignal`

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `source` | `source` | text | NOT NULL | — | `ExternalSignalSource` | Enum: `producthunt`, `hackernews`, `vendor_rss`, `reddit`, `github`, `dataforseo_trends` |
| `external_id` | `externalId` | text | NOT NULL | — | — | Stable ID from source (dedup key) |
| `title` | `title` | text | NOT NULL | — | — | |
| `url` | `url` | text | YES | — | — | Source URL |
| `summary` | `summary` | text | YES | — | — | |
| `author` | `author` | text | YES | — | — | |
| `published_at` | `publishedAt` | timestamp w/ tz | YES | — | — | |
| `raw_payload` | `rawPayload` | jsonb | NOT NULL | — | `Record<string, unknown>` | Full response from adapter |
| `metrics` | `metrics` | jsonb | NOT NULL | `{}` | `Record<string, number>` | Engagement metrics (likes, comments, score, etc.) |
| `collected_at` | `collectedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `processed_at` | `processedAt` | timestamp w/ tz | YES | — | — | When janitor stamped it (Spec 54.5) |
| `processed_into` | `processedInto` | uuid | YES | — | — | FK to `topic_briefs(id)` declared in migration SQL |
| `expired_at` | `expiredAt` | timestamp w/ tz | YES | — | — | When signal became stale |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `external_signals_source_external_unique` | `source`, `externalId` | unique |
| `external_signals_project_source_idx` | `projectId`, `source` | btree |

---

### Table: `rejected_topic_candidates`

**File:** `packages/db/src/schema/content.ts` (lines 865–888)
**Drizzle export name:** `rejectedTopicCandidates`
**Type aliases exported:** `RejectedTopicCandidate`, `NewRejectedTopicCandidate`

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `topic_title` | `topicTitle` | text | NOT NULL | — | — | |
| `candidate_title_normalized` | `candidateTitleNormalized` | text | NOT NULL | — | — | Normalized for dedup matching |
| `reason` | `reason` | text | NOT NULL | — | `RejectedTopicReason` | Enum: `existing_coverage`, `low_score`, `excluded_by_scope`, `low_signal_volume`, `manual_dismissal` |
| `trend_score` | `trendScore` | integer | YES | — | — | Score at rejection time |
| `similarity_score` | `similarityScore` | numeric(4,3) | YES | — | — | 0–1 |
| `matched_article_id` | `matchedArticleId` | uuid | YES | — | — | If reason=existing_coverage |
| `source_signal_ids` | `sourceSignalIds` | jsonb | NOT NULL | — | `string[]` | IDs from signals that contributed |
| `rejected_at` | `rejectedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `expires_at` | `expiresAt` | timestamp w/ tz | NOT NULL | — | — | 30 days after rejectionat; resets every synthesis |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type | Predicate |
|---|---|---|---|
| `rejected_topic_candidates_project_active_idx` | `projectId`, `expiresAt` | btree | — |
| `rejected_topic_candidates_normalized_idx` | `projectId`, `candidateTitleNormalized` | btree | — |

---

### Table: `content_gaps`

**File:** `packages/db/src/schema/content.ts` (lines 395–439)
**Drizzle export name:** `contentGaps`
**Type aliases exported:** `ContentGap`, `NewContentGap`

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `cluster_id` | `clusterId` | uuid | YES | — | — | FK → `clusters(id)` ON DELETE cascade |
| `gap_type` | `gapType` | text | NOT NULL | — | `"missing_hub" \| "missing_translation" \| "missing_spoke_type" \| "cluster_too_small"` | |
| `locale` | `locale` | text | YES | — | — | For missing_translation: the missing locale |
| `intent_type` | `intentType` | text | YES | — | — | For missing_spoke_type: the absent intent |
| `translation_key` | `translationKey` | text | YES | — | — | For missing_translation: key of existing article |
| `priority` | `priority` | integer | NOT NULL | `2` | — | 1=critical, 2=high, 3=medium |
| `status` | `status` | text | NOT NULL | `open` | `"open" \| "in_progress" \| "resolved" \| "dismissed"` | Lifecycle |
| `resolved_at` | `resolvedAt` | timestamp w/ tz | YES | — | — | When filled/closed |
| `dismissed_at` | `dismissedAt` | timestamp w/ tz | YES | — | — | When manually dismissed |
| `metadata` | `metadata` | jsonb | NOT NULL | `{}` | `ContentGapMetadata` | Zod: clusterName?, clusterMemberCount?, existingLocale?, existingArticleSlug?, spokesPresent?, suggestedTitle?, suggestedSlug?, suggestedCornerstoneKeyword?, discoveredKeywords?, suggestedMetaDescription?, suggestedHeroImagePrompt? |
| `filled_by_article_id` | `filledByArticleId` | uuid | YES | — | — | No DB FK |
| `filled_by_spec_id` | `filledBySpecId` | uuid | YES | — | — | No DB FK |
| `generation_triggered_at` | `generationTriggeredAt` | timestamp w/ tz | YES | — | — | |
| `detected_at` | `detectedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |
| `cluster_id` | `clusters(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `content_gaps_project_idx` | `projectId` | btree |
| `content_gaps_cluster_idx` | `clusterId` | btree |
| `content_gaps_status_idx` | `projectId`, `status` | btree |
| `content_gaps_type_idx` | `projectId`, `gapType` | btree |

---

### Table: `pipeline_chains`

**File:** `packages/db/src/schema/content.ts` (lines 455–487)
**Drizzle export name:** `pipelineChains`
**Type aliases exported:** None explicitly exported; `ChainStatus`, `ChainStep` types exported

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `gap_id` | `gapId` | uuid | YES | — | — | No DB FK |
| `article_id` | `articleId` | uuid | YES | — | — | DE article; no DB FK |
| `sibling_article_id` | `siblingArticleId` | uuid | YES | — | — | EN article; no DB FK |
| `status` | `status` | text | NOT NULL | `queued` | `ChainStatus` | Enum: `queued`, `running`, `paused`, `completed`, `failed`, `cancelled` |
| `current_step` | `currentStep` | text | YES | — | `ChainStep` | Enum: `outline`, `draft`, `schema-de`, `localize`, `schema-en`, `astro-transfer` |
| `failed_step` | `failedStep` | text | YES | — | `ChainStep` | Which step failed |
| `failed_at` | `failedAt` | timestamp w/ tz | YES | — | — | Timestamp of failure |
| `error_message` | `errorMessage` | text | YES | — | — | Error details |
| `step_runs` | `stepRuns` | jsonb | NOT NULL | `{}` | `Partial<Record<ChainStep, string>>` | Maps step name to pipeline_run_id |
| `total_cost_eur` | `totalCostEur` | numeric(10,4) | NOT NULL | `0` | `string` | Accumulated cost |
| `auto_publish` | `autoPublish` | boolean | NOT NULL | `false` | — | Trigger Astro-Transfer after schema-en |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `completed_at` | `completedAt` | timestamp w/ tz | YES | — | — | |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `pipeline_chains_project_idx` | `projectId` | btree |
| `pipeline_chains_gap_idx` | `gapId` | btree |
| `pipeline_chains_article_idx` | `articleId` | btree |
| `pipeline_chains_status_idx` | `projectId`, `status` | btree |

---

### Table: `cost_logs`

**File:** `packages/db/src/schema/operations.ts` (lines 44–73)
**Drizzle export name:** `costLogs`
**Type aliases exported:** None explicitly exported

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `project_id` | `projectId` | uuid | NOT NULL | — | — | FK → `projects(id)` ON DELETE cascade |
| `service` | `service` | enum (costServiceEnum) | NOT NULL | — | — | Enum: `anthropic`, `replicate`, `dataforseo`, `smtp`, `voyage` |
| `operation` | `operation` | text | NOT NULL | — | — | From `COST_OPS` constant (never hardcoded string) |
| `cost_eur` | `costEur` | decimal(10,6) | NOT NULL | — | — | In EUR |
| `metadata` | `metadata` | jsonb | NOT NULL | `{}` | `Record<string, unknown>` | Operation-specific data |
| `pipeline_run_id` | `pipelineRunId` | uuid | YES | — | — | Correlation UUID (no DB FK) |
| `article_id` | `articleId` | uuid | YES | — | — | Correlation UUID (no DB FK) |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |

**Foreign Keys:**
| Column | References | ON DELETE |
|---|---|---|
| `project_id` | `projects(id)` | cascade |

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `cost_logs_project_service_time_idx` | `projectId`, `service`, `createdAt` | btree |
| `cost_logs_project_time_idx` | `projectId`, `createdAt` | btree |
| `cost_logs_pipeline_run_idx` | `pipelineRunId` | btree |

---

### Table: `global_credentials`

**File:** `packages/db/src/schema/operations.ts` (lines 25–42)
**Drizzle export name:** `globalCredentials`
**Type aliases exported:** None explicitly exported

**Columns:**

| Column (SQL) | Drizzle field | SQL type | Nullable | Default | Zod `$type<>()` | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | uuid | NOT NULL | random | — | Primary key |
| `service` | `service` | text | NOT NULL | — | — | Service name (e.g. `anthropic`, `replicate`) |
| `key` | `key` | text | NOT NULL | — | — | Credential key (e.g. `api_key`) |
| `encrypted_value` | `encryptedValue` | text | NOT NULL | — | — | Encrypted credential value |
| `metadata` | `metadata` | jsonb | YES | `{}` | `Record<string, unknown>` | Extra metadata |
| `created_at` | `createdAt` | timestamp w/ tz | NOT NULL | NOW() | — | |
| `updated_at` | `updatedAt` | timestamp w/ tz | NOT NULL | NOW() | — | |

**Foreign Keys:** None

**Indexes:**
| Name | Columns | Type |
|---|---|---|
| `global_credentials_service_key_unique` | `service`, `key` | unique |

---

## SECTION 2: JSONB Shapes

### JSONB: `projects.brand_identity`

**Schema:** `BrandIdentity`
**Defined in:** `packages/db/src/schema/projects.ts` (lines 82–90)

```typescript
type BrandIdentity = {
  voice?: string;
  tone?: string;
  forbiddenPhrases?: string[];
  signaturePhrases?: string[];
  pronounStyle?: "du" | "sie";
  anglicismPolicy?: "avoid" | "pragmatic" | "embrace";
  humorLevel?: "dry" | "pragmatic" | "pointed";
};
```

---

### JSONB: `projects.brand_tokens`

**Schema:** `BrandTokens` (Spec 51)
**Defined in:** `packages/db/src/schema/projects.ts` (lines 148–188)

```typescript
type BrandTokens = {
  colors?: {
    primary?: string;
    primaryHue?: number;
    accent?: string;
    surface?: string;
    surfaceDark?: string;
    ink?: string;
    inkMuted?: string;
    wikiCream?: string;
  };
  typography?: {
    fontFamily?: string;
    fontFamilyOptions?: string[];
    headingWeight?: number;
    bodyWeight?: number;
    eyebrowWeight?: number;
    captionWeight?: number;
    eyebrowLetterSpacing?: string;
    headingLetterSpacing?: string;
    bodyLetterSpacing?: string;
    headingSize?: number;
    subheadSize?: number;
    bodySize?: number;
    eyebrowSize?: number;
    headingLineHeight?: number;
    bodyLineHeight?: number;
  };
  voice?: {
    locale?: string;
    addressForm?: string;
    forbiddenWords?: string[];
    signaturePhrases?: string[];
  };
  social?: {
    instagramHandle?: string;
    websiteUrl?: string;
    logoAssetKey?: string;
  };
};
```

**Used by:**
- `apps/api/src/lib/brand-asset-service.ts` (reads/writes)
- `apps/api/src/routes/brand-tokens.ts` (route handlers)
- `apps/web` (renders in brand settings UI)

---

### JSONB: `project_configurations.intent_taxonomy_default`

**Schema:** `IntentTaxonomy`
**Defined in:** `packages/db/src/schema/project-config.ts` (lines 16–17)

```typescript
// Zod schema
const IntentTaxonomySchema = z.array(z.string().min(1)).min(1).max(20);
type IntentTaxonomy = z.infer<typeof IntentTaxonomySchema>;
// Result: string[] (min 1, max 20 items)
```

**Example:** `["overview", "features", "review", "pricing", "use-cases", "general", "tutorial"]`

**Used by:**
- `packages/pipelines/src/config/index.ts` `resolveIntentTaxonomy()`
- Cold-Start cluster generation
- Article generation steps

---

### JSONB: `project_configurations.master_prompts`

**Schema:** `MasterPrompts`
**Defined in:** `packages/db/src/schema/project-config.ts` (lines 29–39)

```typescript
const MasterPromptKey = z.enum([
  "article.outline",
  "article.draft",
  "article.self_review",
  "article.localize.fresh",
  "article.localize.translate",
  "trend.synthesis",
]);

const MasterPromptsSchema = z
  .record(
    MasterPromptKey,
    z.object({
      prompt: z.string().min(50),
      notes: z.string().optional(),
      updatedAt: z.string().optional(),
    }),
  )
  .default({});

type MasterPrompts = z.infer<typeof MasterPromptsSchema>;
```

**Used by:**
- `packages/pipelines/src/config/index.ts` `resolveMasterPrompt()`
- Every article generation step (Outline, Draft, SelfReview, Localize, TrendSynthesis)

---

### JSONB: `project_configurations.topic_scope`

**Schema:** `TopicScope`
**Defined in:** `packages/db/src/schema/project-config.ts` (lines 41–58)

```typescript
const TopicScopeSchema = z
  .object({
    languages: z.array(z.enum(["de", "en"])).min(1),
    exclusions: z.array(z.string()).default([]),
    primary_themes: z.array(z.string()).default([]),
    relevance_keywords: z.array(z.string()).default([]),
    min_trend_score: z.number().int().min(0).max(100).default(25),
    min_signal_thresholds: z
      .object({
        hackernews: z.number().int().default(3),
        producthunt: z.number().int().default(0),
        vendor_rss: z.number().int().default(0),
      })
      .default({}),
  })
  .default({ languages: ["de", "en"], exclusions: [] });

type TopicScope = z.infer<typeof TopicScopeSchema>;
```

**Used by:**
- Trend synthesis `TrendDiscoveryTopicSource`
- Gap analysis generation
- Cold-Start scope configuration

---

### JSONB: `project_configurations.signal_sources`

**Schema:** `SignalSources`
**Defined in:** `packages/db/src/schema/project-config.ts` (lines 69–103)

```typescript
const SignalSourcesSchema = z
  .object({
    producthunt: z.boolean().default(false),
    hackernews: z
      .object({
        enabled: z.boolean().default(false),
        queries: z.array(z.string().min(1)).default(HN_DEFAULT_QUERIES),
        hitsPerPage: z.number().int().min(1).max(100).default(50),
        minPoints: z.number().int().min(0).default(5),
      })
      .default({ enabled: false, queries: HN_DEFAULT_QUERIES, hitsPerPage: 50, minPoints: 5 }),
    reddit: z
      .object({
        enabled: z.boolean().default(false),
        subreddits: z.array(z.string()).default([]),
      })
      .default({ enabled: false, subreddits: [] }),
    github: z.boolean().default(false),
    vendor_rss: z
      .object({
        enabled: z.boolean().default(false),
        feeds: z.array(z.string().url()).default([]),
      })
      .default({ enabled: false, feeds: [] }),
    dataforseo_trends: z.boolean().default(false),
  })
  .default({ /* all false/defaults */ });

type SignalSources = z.infer<typeof SignalSourcesSchema>;
```

**Used by:**
- `packages/pipelines/src/signal-sources/` adapters
- `apps/api/src/workers/signal-collector.ts`

---

### JSONB: `articles.outline`

**Schema:** `ArticleOutline` (lightweight re-declaration in DB)
**Defined in:** `packages/db/src/schema/content.ts` (lines 28–43)

```typescript
type ArticleOutline = {
  title: string;
  slug: string;
  metaDescription: string;
  introAngle: string;
  sections: Array<{
    h2: string;
    intent: string;
    keyPoints: string[];
    estimatedWords: number;
    targetKeywords: string[];
  }>;
  heroImagePrompt: string;
  heroImageStyle: "photorealistic" | "illustrated" | "3d_render" | "minimalist";
  estimatedTotalWords: number;
};
```

**Used by:**
- `OutlineStep` (writes)
- `DraftStep` (reads)
- Dashboard/article detail views

---

### JSONB: `articles.self_review_issues`

**Schema:** `SelfReviewIssue[]`
**Defined in:** `packages/db/src/schema/content.ts` (lines 54–69)

```typescript
type SelfReviewIssue = {
  severity: "critical" | "warning" | "suggestion";
  category:
    | "voice_drift"
    | "factual_concern"
    | "weak_intro"
    | "weak_conclusion"
    | "section_imbalance"
    | "keyword_stuffing"
    | "missing_examples"
    | "verbose"
    | "other";
  location: string;
  description: string;
  suggestion?: string;
};
```

**Used by:**
- `SelfReviewStep` (writes)
- Article detail UI (displays issues)

---

### JSONB: `topic_briefs.gap_metadata`

**Schema:** `GapMetadata`
**Defined in:** `packages/db/src/schema/content.ts` (lines 585–602)

```typescript
const GapMetadataSchema = z.object({
  gapType: z.enum([
    "missing_hub",
    "missing_spoke_type",
    "missing_translation",
    "cluster_too_small",
  ]),
  priority: z.number().int().min(1).max(3),
  clusterName: z.string().optional(),
  clusterMemberCount: z.number().optional(),
  existingLocale: z.enum(["de", "en"]).optional(),
  existingArticleSlug: z.string().optional(),
  spokesPresent: z.array(z.string()).optional(),
  translationKey: z.string().optional(),
  suggestedCornerstoneKeyword: z.string().optional(),
  discoveredKeywords: z.array(z.string()).optional(),
});

type GapMetadata = z.infer<typeof GapMetadataSchema>;
```

**Used by:**
- `gap-analysis` source briefs (writes)
- `decideRoute()` routing logic (reads)

---

### JSONB: `topic_briefs.trend_metadata`

**Schema:** `TrendMetadata`
**Defined in:** `packages/db/src/schema/content.ts` (lines 604–632)

```typescript
const TrendMetadataSchema = z.object({
  trendScore: z.number(),
  signals: z.array(
    z.object({
      id: z.string().uuid(),
      source: z.enum([
        "producthunt",
        "hackernews",
        "reddit",
        "github",
        "vendor_rss",
        "dataforseo_trends",
      ]),
      externalId: z.string(),
      url: z.string().url().optional(),
      capturedAt: z.string(),
    }),
  ),
  freshnessWindow: z.enum(["breaking", "rising", "stable"]),
  relatedEvent: z.string().optional(),
  scoreBreakdown: z.object({
    communityBuzz: z.number(),
    searchVolumeGrowth: z.number(),
    officialAnnouncement: z.number(),
    serpVolatility: z.number(),
    existingCoveragePenalty: z.number(),
  }).optional(),
});

type TrendMetadata = z.infer<typeof TrendMetadataSchema>;
```

**Note:** `scoreBreakdown` field names are camelCase in the JSONB (`communityBuzz`, NOT `community_buzz`). The internal `ScoreBreakdown` type from `packages/pipelines/src/topic-sources/trend-discovery/types.ts` uses snake_case; the remapping happens in `emit-brief.ts`.

**Used by:**
- `TrendDiscoveryTopicSource` (writes)
- Trend UI dashboard (displays breakdown)

---

## SECTION 3: Entity Relationship Map

```
projects (root)
├── project_credentials (1:N, service-scoped)
├── project_configurations (1:N, version scoped)
├── content_pillars (1:N)
│   └── clusters (1:N, pillar-scoped)
│       ├── cornerstone_specs (1:N) ──┐
│       └── articles.cluster_id (many articles per cluster)
├── articles (1:N, project-scoped)
│   ├── article_versions (1:N)
│   ├── social_posts (1:N)
│   ├── article_discovery (1:1)
│   ├── template_renders (1:N) [Spec 54a]
│   └── pipeline_chains (N:1 via article_id, sibling_article_id)
├── cornerstone_specs (1:N, cluster-scoped)
│   └── articles (N:1 via cornerstone_spec_id)
├── topic_briefs (1:N, project-scoped)
│   ├── external_signals (N:1 via processed_into, optional) [Spec 54.1]
│   └── content_gaps (N:1 via gapId, optional)
├── external_signals (1:N, project-scoped)
├── rejected_topic_candidates (1:N, project-scoped)
├── content_gaps (1:N, project-scoped)
│   └── topic_briefs (1:N, auto-generated via gap analysis)
├── pipeline_chains (1:N, project-scoped)
│   └── pipelineRuns (referenced by step_runs JSONB, no DB FK)
├── cost_logs (1:N, project-scoped)
└── pipeline_runs (1:N, project-scoped)
```

**Key FK constraints:**
- `clusters.pillar_id` → `content_pillars(id)` : **NOT NULL, RESTRICT** (pillar cannot be deleted while clusters exist)
- `articles.cluster_id` → `clusters(id)` : nullable, SET NULL
- `articles.project_config_version_id` → `project_configurations(id)` : nullable, declared via raw SQL migration (avoids circular Drizzle ordering)
- `cornerstone_specs.cluster_id` → `clusters(id)` : NOT NULL, CASCADE
- `topic_briefs.project_id` → `projects(id)` : NOT NULL, CASCADE
- `external_signals.processed_into` → `topic_briefs(id)` : nullable, declared via raw SQL migration
- `content_gaps.cluster_id` → `clusters(id)` : nullable, CASCADE

**Semantics:**
- **Pillars vs Clusters:** 1:N relationship. Every cluster belongs to exactly one pillar. Pillars are organizational units; clusters are the content groupings. Both are project-scoped.
- **Article/Cluster relationship:** Many articles can reference the same cluster (via `cluster_id`). Articles from imported Astro repos may have no cluster assignment.
- **Pipeline Chains:** Orchestrate DE article → EN sibling article, storing step run IDs in `step_runs` JSONB. No DB-level FKs to articles/specs to avoid locking issues.

---

## SECTION 4: Routing Decisions

**File:** `packages/pipelines/src/routing/types.ts` (lines 9–38)

All `kind` values in the `RoutingDecision` discriminated union:

| kind | Input from | Handler Status | Notes |
|---|---|---|---|
| `create_article` | Any source (gap, trend, manual) | ✅ Implemented | Inserts article, marks brief routed |
| `create_cornerstone_spec` | gap_analysis (missing_hub) | ✅ Implemented | Inserts spec, marks brief routed |
| `create_translation` | gap_analysis (missing_translation) | ✅ Implemented | Creates EN sibling from DE source |
| `refresh_article` | refresh_detection source | ❌ **Not Implemented** | Throws `RoutingNotImplementedError` — future spec |
| `create_cluster` | gap_analysis (cluster_too_small) | ❌ **Not Implemented** | Throws `RoutingNotImplementedError` — Spec 54.7 |
| `skip` | Any (low score, excluded, etc.) | ✅ Implemented | Marks brief superseded |

**File:** `packages/pipelines/src/routing/execute-decision.ts` (lines 24–170)

- `executeDecision(decision, brief, tx)` runs inside a transaction passed by caller
- Returns `RoutingResult` discriminated union (6 values, mirrors decisions 1:1)
- Atomically INSERTs article/spec AND UPDATEs brief to `approval_status='routed'` in same transaction
- Custom Error class: `RoutingNotImplementedError` with property `routingKind` (NOT `kind` to avoid ES2022 reserved `cause`)

---

## SECTION 5: TopicBrief Sources

**Zod schema for `source` field:**

```typescript
source: z.enum(["gap_analysis", "trend_discovery", "refresh_detection", "manual"])
```

All source values and producers:

| source value | Producer file | Status | Notes |
|---|---|---|---|
| `gap_analysis` | `packages/pipelines/src/topic-sources/gap-analysis/source.ts` | ✅ Active | Detects missing hub/spoke/translation/cluster_too_small |
| `trend_discovery` | `packages/pipelines/src/topic-sources/trend-discovery/source.ts` | ✅ Active | Synthesizes `external_signals` into briefs (Spec 54.5) |
| `refresh_detection` | *Not yet implemented* | ❌ Future | Will detect stale articles needing refresh |
| `manual` | HTTP POST / UI | ✅ Active | User-created briefs with no source metadata |

**Validation rule (Spec 54.1):** Each source has required metadata:
- `gap_analysis` → must have `gap_metadata` + `gapId`
- `trend_discovery` → must have `trend_metadata`
- `refresh_detection` → must have `refresh_metadata`
- `manual` → must have NO source-specific metadata (all three null)

---

## SECTION 6: `cluster_action` enum

**Zod enum definition:**

**File:** `packages/db/src/schema/content.ts` (lines 666–668)

```typescript
clusterAction: text("cluster_action").notNull().$type<
  "append_to_existing" | "create_new" | "translation" | "refresh" | "standalone"
>()
```

All values and usage:

| Value | Assigned by | Meaning | Notes |
|---|---|---|---|
| `append_to_existing` | `TrendDiscoveryTopicSource` (cluster-match finds high similarity ≥0.65) | Add article to existing cluster | Links `clusterId` |
| `create_new` | `TrendDiscoveryTopicSource` (no cluster match, or similarity <0.65) | Create a new cluster | `clusterId` may be null (decision defers cluster creation) |
| `translation` | Routing logic (source=gap_analysis, gapType=missing_translation) | Create EN translation of DE article | Copies source article's `clusterId` |
| `refresh` | Not yet used | Refresh existing article | Reserved for Spec 54.7+ |
| `standalone` | Manual briefs or fallback routing | No cluster association | `clusterId` explicitly null |

---

## SECTION 7: File and Directory Layout

### API Routes

**File:** `apps/api/src/routes/`

Sampled first 10 files:

```
_lib/
├── trigger-helpers.ts      (triggerWithPreRunId, checkTriggerAllowed)
├── pagination.ts
├── gap-service.ts
├── brand-asset-service.ts
├── color-utils.ts
├── icon-resolver.ts
├── chain-orchestrator.ts
├── email.ts
└── system-service.ts

admin.ts                     (system settings, user mgmt, pruning)
articles.ts                  (article CRUD + generate/continue/sync/pagespeed)
auth.ts                      (magic-link, login, logout)
brand-assets.ts              (asset upload/delete, icon resolution)
brand-tokens.ts              (token get/patch/reset)
clusters.ts                  (cluster CRUD, list)
cold-start.ts                (phase triggers: voice, competitors, clusters, etc.)
cornerstone-specs.ts         (spec CRUD + approval)
cost.ts                       (cost dashboard, alerts)
```

### API Nested Routes (Projects)

**File:** `apps/api/src/routes/projects/`

Only one file sampled:

```
clusters.ts                  (cluster-specific routes under /api/projects/:slug/clusters)
```

Other routes mounted at `/api/projects/:slug/` directly from `apps/api/src/routes/` (e.g. `articles.ts` registers `/generate`, `/continue`, `/sync`).

### Server Registration

**File:** `apps/api/src/server.ts`

Routes are mounted via:
```typescript
app.route("/api", adminRoutes)
app.route("/api/auth", authRoutes)
app.route("/api/articles", articleRoutes)
app.route("/api/projects", projectsRoutes)
// ... etc
```

(Not inspected for full list due to complexity; see file directly)

### API Workers

**File:** `apps/api/src/workers/`

Files:

```
article-scheduler.ts         (polls + enqueues Article Pipeline per project on schedule)
discoveryWorker.ts           (Article Discovery pipeline executor)
index.ts                      (worker registration + startup)
signal-collector.ts          (daily signal collection from PH/HN/RSS/etc)
trend-synthesizer.ts         (daily trend synthesis from external_signals)
```

### Web Pages

**File:** `apps/web/src/pages/`

Sampled first 10 Vue files:

```
ActivityPage.vue
ArticleDetailPage.vue
ArticlesPage.vue
AuthVerifyPage.vue
ClustersManagementPage.vue
ColdStartPage.vue
CornerstoneApprovalPage.vue
CostDashboardPage.vue
ErrorNotFound.vue
ErrorUnauthorized.vue
```

(All `.vue` files; framework is Vue 3 + Quasar)

### Router Setup

**File:** `apps/web/src/router/`

Files:

```
guards.ts                    (beforeEach guards: auth check, etc.)
index.ts                      (createRouter setup)
routes.ts                     (route definitions)
```

Routes are registered in `routes.ts` as a flat array passed to `createRouter()`.

### I18n Structure

**File:** `apps/web/src/i18n/`

Structure:

```
i18n/
├── de/                       (German translations)
│   └── index.ts              (merged translation keys)
├── en/                       (English translations)
│   └── index.ts              (merged translation keys)
└── index.ts                  (vue-i18n v10 setup: `createI18n()`)
```

Translations are NOT hardcoded in component templates — all user-facing strings come from `$t()` calls. vue-i18n v10 is in use (NOT v9; `$tc()` for pluralization removed in v10, use `$t()` with custom message format instead).

---

## SECTION 8: Environment Variables

**File:** `packages/shared/src/config.ts` (lines 6–91)

All environment variables with metadata:

| Name | Type | Required | Default | Consumer packages | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | enum: `development`, `production`, `test` | NO | `development` | All | Logging + behavior gating |
| `LOG_LEVEL` | enum: `trace`–`fatal` | NO | `info` | All | Pino logger level |
| `DEPLOYMENT_MODE` | enum: `lokal`, `self_hosted` | NO | undefined | — | Reserved; not yet used |
| `DATABASE_URL` | URL | **YES** | — | @marketing-auto/db | PostgreSQL connection |
| `REDIS_URL` | URL | **YES** | — | pipelines, workers | BullMQ + caching |
| `API_PORT` | number 1–65535 | NO | `3000` | @marketing-auto/api | HTTP server port |
| `API_HOST` | string | NO | `0.0.0.0` | @marketing-auto/api | Bind address |
| `APP_BASE_URL` | URL | NO | `http://localhost:3000` | @marketing-auto/api | Frontend origin (for redirects, magic-link emails) |
| `CORS_ORIGIN` | URL | NO | `http://localhost:3051` | @marketing-auto/api | Frontend origin for CORS |
| `ENCRYPTION_KEY` | hex string, length 64 | **YES** | — | @marketing-auto/core | AES encryption for credentials (generate: `openssl rand -hex 32`) |
| `ANTHROPIC_API_KEY` | string, startsWith `sk-ant-` | NO | undefined | @marketing-auto/adapter-anthropic | Claude API key |
| `ANTHROPIC_CACHE_MODE` | enum: `off`, `replay`, `record`, `auto` | NO | `off` | @marketing-auto/adapter-anthropic | Prompt caching mode (dev fixture caching) |
| `REPLICATE_API_TOKEN` | string, startsWith `r8_` | NO | undefined | @marketing-auto/adapter-replicate | Replicate API token |
| `DATAFORSEO_LOGIN` | email string | NO | undefined | @marketing-auto/adapter-dataforseo | DataForSEO username |
| `DATAFORSEO_PASSWORD` | string, min 8 | NO | undefined | @marketing-auto/adapter-dataforseo | DataForSEO password |
| `SMTP_USER` | email string | NO | undefined | @marketing-auto/adapter-smtp | SMTP username (Gmail app password recommended) |
| `SMTP_APP_PASSWORD` | string, min 8 | NO | undefined | @marketing-auto/adapter-smtp | SMTP password (Gmail app password) |
| `SMTP_FROM_NAME` | string | NO | `Marketing Automation` | @marketing-auto/adapter-smtp | From: header name |
| `SMTP_HOST` | string | NO | `smtp.gmail.com` | @marketing-auto/adapter-smtp | SMTP server |
| `SMTP_PORT` | number 1–65535 | NO | `465` | @marketing-auto/adapter-smtp | SMTP port |
| `VAPID_PUBLIC_KEY` | string | NO | undefined | @marketing-auto/api | Web Push public key (Spec 40) |
| `VAPID_PRIVATE_KEY` | string | NO | undefined | @marketing-auto/api | Web Push private key |
| `VAPID_SUBJECT` | string, matches regex | NO | undefined | @marketing-auto/api | Web Push subject (mailto: or https://) |
| `ARTICLE_SCHEDULER_ENABLED` | boolean | NO | `false` | @marketing-auto/api | Enable article pipeline scheduler |
| `GITHUB_APP_ID` | numeric string | NO | undefined | @marketing-auto/adapter-astro-sync | GitHub App ID (Spec 21) |
| `GITHUB_APP_PRIVATE_KEY_PATH` | file path | NO | undefined | @marketing-auto/adapter-astro-sync | Path to GitHub App private key PEM |
| `PAGESPEED_WORK_DIR` | file path | NO | `/tmp/marketing-auto/pagespeed` | @marketing-auto/pipelines | Working directory for PageSpeed local builds |
| `PAGESPEED_BUILD_TIMEOUT_MS` | number, min 60000 | NO | `300000` (5 min) | @marketing-auto/pipelines | Timeout for Astro build |
| `PAGESPEED_LIGHTHOUSE_TIMEOUT_MS` | number, min 30000 | NO | `120000` (2 min) | @marketing-auto/pipelines | Timeout for Lighthouse run |
| `PAGESPEED_INSIGHTS_API_KEY` | string | NO | undefined | @marketing-auto/pipelines | Google PageSpeed Insights API key (optional; 25k/day with key, 400/day without) |
| `SIGNAL_COLLECTOR_CRON` | cron expression | NO | undefined | @marketing-auto/api | Cron for signal collection (default: daily 00:30 UTC) |
| `TREND_SYNTHESIZER_CRON` | cron expression | NO | undefined | @marketing-auto/api | Cron for trend synthesis (default: daily 01:30 UTC) |
| `VOYAGE_API_KEY` | string | NO | undefined | @marketing-auto/adapter-voyage | Voyage AI API key (text embeddings, Spec 54.5) |
| `R2_ACCOUNT_ID` | string | NO | undefined | @marketing-auto/core | Cloudflare R2 account ID (Spec 12) |
| `R2_ACCESS_KEY_ID` | string | NO | undefined | @marketing-auto/core | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | string | NO | undefined | @marketing-auto/core | Cloudflare R2 secret key |
| `R2_BUCKET` | string | NO | undefined | @marketing-auto/core | R2 bucket name |
| `R2_PUBLIC_BASE_URL` | URL | NO | undefined | @marketing-auto/core | R2 public endpoint for hero images |

**Pattern for adding new env vars:**

When adding a new optional string-typed variable with format constraints (email, URL, startsWith):

```typescript
const optionalStr = (schema: z.ZodString) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

// Use in schema:
MY_EMAIL: optionalStr(z.string().email()),
MY_API_KEY: optionalStr(z.string().startsWith("sk-")),
```

This handles the case where `MY_EMAIL=""` in shell → becomes `undefined` (not empty string) → passes validation.

When adding to `.env.example`, use empty or commented value:

```
MY_EMAIL=
# MY_API_KEY=sk-...
```

---

## SECTION 9: COST_OPS Registry

**File:** `packages/core/src/cost/operations.ts` (lines 14–91)

All cost operation constants and their usage:

| Constant Name | String Value | Service | Estimated Cost (EUR) | Used By |
|---|---|---|---|---|
| `ARTICLE_OUTLINE` | `article-outline` | anthropic | 0.50 | Article pipeline OutlineStep |
| `ARTICLE_DRAFT` | `article-draft` | anthropic | 1.50 | Article pipeline DraftStep |
| `ARTICLE_SELF_REVIEW` | `article-self-review` | anthropic | 0.40 | Article pipeline SelfReviewStep |
| `ARTICLE_RESEARCH_SERP` | `article-research-serp` | dataforseo | 0.02 | Article pipeline ResearchStep (SERP analysis) |
| `ARTICLE_RESEARCH_SYNTHESIS` | `research-competitor-synthesis` | anthropic | 0.30 | Article pipeline ResearchStep (LLM synthesis) |
| `COLD_START_VOICE_QUESTIONS` | `voice-questions-generation` | anthropic | 0.25 | Cold-Start Phase 1 (voice discovery) |
| `COLD_START_VOICE_SYNTHESIS` | `voice-synthesis` | anthropic | 0.50 | Cold-Start Phase 1 (voice synthesis) |
| `COLD_START_COMPETITOR_IDENTIFICATION` | `competitor-identification` | anthropic | 0.60 | Cold-Start Phase 2a (identify competitors) |
| `COLD_START_COMPETITOR_ANALYSIS` | `competitor-report-synthesis` | anthropic | 1.50 | Cold-Start Phase 2b (analyze competitors) |
| `COLD_START_CLUSTER_CANDIDATES` | `cluster-candidates-generation` | anthropic | 0.80 | Cold-Start Phase 3 (generate candidate clusters) |
| `COLD_START_CLUSTER_KEYWORD_OVERVIEW` | `cluster-keyword-overview` | dataforseo | 0.05 | Cold-Start Phase 3 (keyword research per cluster) |
| `COLD_START_CLUSTER_SYNTHESIS` | `cluster-plan-synthesis` | anthropic | 1.00 | Cold-Start Phase 3 (synthesize cluster plan) |
| `COLD_START_CORNERSTONE_SPECS` | `cornerstone-specs-generation` | anthropic | 0.70 | Cold-Start Phase 4 (generate cornerstone specs) |
| `COLD_START_GO_LIVE_CHECKLIST` | `cold-start-go-live-checklist` | anthropic | 0.25 | Cold-Start Phase 5 (go-live validation) |
| `SCHEMA_RICH_DETECTION` | `schema-rich-detection` | anthropic | 0.15 | SchemaExtensionStep (detect FAQ/HowTo) |
| `SCHEMA_FAQ_BUILD` | `schema-faq-build` | anthropic | 0.20 | SchemaExtensionStep (build FAQ schema) |
| `SCHEMA_HOWTO_BUILD` | `schema-howto-build` | anthropic | 0.20 | SchemaExtensionStep (build HowTo schema) |
| `INTERNAL_LINK_ANALYSIS` | `internal-link-analysis` | anthropic | 0.30 | LinkAnalysisStep (analyze link targets) |
| `INTERNAL_LINK_REBUILD` | `internal-link-rebuild` | anthropic | 0.40 | LinkRebuildStep (rebuild links for cluster) |
| `HERO_IMAGE` | `hero-image-generation` | replicate | 0.03 | HeroImageStep (Replicate SDXL) |
| `DATAFORSEO_SERP_ANALYSIS` | `serp-analysis` | dataforseo | 0.02 | ResearchStep SERP snapshot |
| `DATAFORSEO_KEYWORD_RESEARCH` | `keyword-research` | dataforseo | 0.03 | ClusterCandidatesStep keyword enrichment |
| `DATAFORSEO_BACKLINK_CHECK` | `backlink-check` | dataforseo | 0.05 | (not yet used) |
| `BRIEFING_GENERATION` | `briefing-generation` | anthropic | 0.40 | Briefing worker (daily summary) |
| `SMTP_MAGIC_LINK` | `magic-link-email` | smtp | 0.01 | Auth magic-link send |
| `SMTP_BRIEFING` | `briefing-email` | smtp | 0.01 | Briefing email send |
| `PAGESPEED_PSI_API` | `pagespeed-psi-api` | anthropic | 0.00 | PageSpeed validation (API call, not counted) |
| `GAP_TITLE_SUGGEST` | `gap-title-suggest` | anthropic | 0.05 | Gap title suggestion (Haiku) |
| `GAP_KEYWORD_OVERVIEW` | `gap-keyword-overview` | dataforseo | 0.03 | Gap keyword enrichment (if cluster has Cold-Start data) |
| `GAP_RELATED_KEYWORDS` | `gap-related-keywords` | dataforseo | 0.05 | Gap keyword fallback (Astro-imported clusters) |
| `FRONTMATTER_SUGGEST` | `frontmatter-suggest` | anthropic | 0.08 | Spec 50: Haiku frontmatter suggestion |
| `SOCIAL_IMAGE_EXTRACT` | `social-image-extract` | anthropic | 0.05 | Spec 51: Haiku extract tools from article |
| `SOCIAL_IMAGE_CAPTION` | `social-image-caption` | anthropic | 0.15 | Spec 51: Sonnet write Instagram caption |
| `SOCIAL_IMAGE_HASHTAGS` | `social-image-hashtags` | anthropic | 0.05 | Spec 51: Haiku generate hashtag list |
| `TREND_SYNTHESIS` | `trend-synthesis` | anthropic | 2.00 | Spec 54.5: Opus daily trend synthesis |
| `TREND_COVERAGE_TIEBREAKER` | `trend-coverage-tiebreaker` | anthropic | 0.08 | Spec 54.5: Haiku coverage tiebreaker (borderline topics) |
| `DATAFORSEO_TRENDS_EXPLORE` | `dataforseo-trends-explore` | dataforseo | 0.01 | Spec 54.5: per-candidate DataForSEO Trends lookup |
| `VOYAGE_EMBED_TEXT` | `voyage-embed-text` | voyage | 0.01 | Spec 54.5: Voyage AI embeddings (cluster + article coverage) |

**Cost estimates lookup:**

**File:** `packages/core/src/cost/estimates.ts`

Estimates are registered via `COST_ESTIMATES_EUR` object. Always use `COST_OPS.X` constant, never hardcoded string. Unknown operations return 0 and log a warning (caught by `VALID_COST_OPS` set).

---

## SECTION 10: Recurring Patterns

### 1. TypeScript strict-mode Drizzle insert (exactOptionalPropertyTypes)

When inserting a Zod-inferred value into a Drizzle table with nullable optional fields:

```typescript
// ❌ Wrong — Zod optional = T | undefined, Drizzle = T | null
const zodData = MySchema.parse(input);
await db.insert(articles).values(zodData);

// ✅ Right — filter undefined, cast to Drizzle insert type
const cleaned = Object.fromEntries(
  Object.entries(zodData).filter(([, v]) => v !== undefined)
) as typeof articles.$inferInsert;
await db.insert(articles).values(cleaned);
```

**File:** `packages/db/CLAUDE.md` (lines 133–136)

---

### 2. exactOptionalPropertyTypes optional spread

When building objects with optional fields under strict types:

```typescript
// ❌ Wrong — spreads undefined value
const obj = { ...base, ...(condition ? { field: value } : {}) };

// ✅ Right — conditional spread  
const obj = { ...base, ...(condition && { field: value }) };
```

**File:** `packages/pipelines/src/routing/execute-decision.ts` (lines 185–195)

---

### 3. Zod stored config evolution (.default() pattern)

When a new field is added to a Zod schema after old data is already in the DB:

```typescript
const TopicScopeSchema = z.object({
  languages: z.array(z.enum(["de", "en"])).min(1),
  // New field in 54.5b:
  min_trend_score: z.number().int().min(0).max(100).default(25),
});
```

Old rows in `project_configurations.topic_scope` don't have `min_trend_score`. When `loadActiveConfig()` calls `.parse()` on the JSONB, Zod applies `.default(25)` and backward-compatibility is preserved.

**File:** `packages/db/src/schema/project-config.ts` (lines 41–58)

---

### 4. Zod post-parse mutation (spread)

When the LLM output needs field name remapping or type coercion before persisting:

```typescript
// LLM returns camelCase; DB wants snake_case (rare in this codebase)
const raw = { communityBuzz: 15, searchVolumeGrowth: 20 };
const corrected = { community_buzz: raw.communityBuzz, search_volume_growth: raw.searchVolumeGrowth };
```

More commonly, the reverse: Zod infers camelCase, code uses it as-is:

```typescript
const schema = z.object({ communityBuzz: z.number() });
type Data = z.infer<typeof schema>; // { communityBuzz: number }
// Directly usable in DB insert — no remapping needed
```

**File:** `packages/pipelines/src/topic-sources/trend-discovery/emit-brief.ts` (remaps scoreBreakdown snake→camel)

---

### 5. Drizzle targetWhere for partial indexes

When a unique constraint has a WHERE clause, `onConflictDoUpdate.targetWhere` MUST match it exactly:

```typescript
// Index: (project_id, source, external_id) WHERE processed_at IS NULL
await db
  .insert(externalSignals)
  .values(row)
  .onConflictDoUpdate({
    target: [externalSignals.projectId, externalSignals.source, externalSignals.externalId],
    // Must match the index predicate byte-exactly
    targetWhere: isNull(externalSignals.processedAt),
    set: { /* ... */ }
  });
```

**File:** Not explicitly in the codebase; mentioned in Spec 54 Backlog learnings

---

### 6. No external API calls inside db.transaction()

Transactions should not call external services. Do I/O outside the transaction:

```typescript
// ❌ Wrong — API call inside transaction
await db.transaction(async (tx) => {
  const response = await claudeAPI.call(...); // ← bad
  await tx.insert(articles).values(...);
});

// ✅ Right — API call before transaction
const response = await claudeAPI.call(...);
await db.transaction(async (tx) => {
  await tx.insert(articles).values(...);
});
```

**File:** `packages/pipelines/src/routing/execute-decision.ts` (pure function, no external calls)

---

### 7. Custom Error class — no `cause` or `kind` property

ES2022+ reserves `Error.cause`, so custom errors must avoid this name:

```typescript
// ❌ Wrong
class MyError extends Error {
  constructor(public cause: string) { super(); }
}

// ✅ Right
class MyError extends Error {
  constructor(public myErrorKind: string) { super(); }
}

// For routing errors specifically:
class RoutingNotImplementedError extends Error {
  constructor(
    public readonly routingKind: RoutingDecision["kind"], // ← not "kind"
    reason: string
  ) { super(`...${routingKind}...`); }
}
```

**File:** `packages/pipelines/src/routing/types.ts` (lines 47–55)

---

### 8. LLM output validation (.max + .transform)

When an LLM step has a hard token ceiling, validate and fail explicitly if truncated:

```typescript
const schema = z.object({
  title: z.string().max(200, "LLM output too long"),
  body: z.string().max(8192, "Exceeds token limit — need multi-call split"),
}).transform((data) => {
  if (!data.body || data.body.length === 0) {
    throw new Error("LLM produced empty body — likely hit max_tokens");
  }
  return data;
});
```

**File:** `packages/pipelines/src/article/localize/pipeline.ts` (handles max_tokens via two-call split)

---

### 9. i18n — never hardcoded

All user-facing strings must come from the i18n system, never hardcoded:

```typescript
// ❌ Wrong
return "Please approve this article";

// ✅ Right
return t("articles.approval_required_message");
```

**File:** `apps/web/src/pages/` (all Vue templates use `{{ $t(...) }}`)

---

### 10. vue-i18n v10: $tc() removed

Pluralization syntax changed between v9 and v10:

```typescript
// v9 (old)
$tc("items", count, { count })

// v10 (new) — use $t() with custom message format
$t("items", { count })
// In locale file, message string uses ICU syntax: "You have {count} item|items"
```

**File:** `apps/web/src/i18n/index.ts` (createI18n v10 setup)

---

### 11. TopicSource pattern

All topic sources implement `TopicSource<Input>`:

```typescript
interface TopicSource<Input = unknown> {
  readonly source: TopicBriefInsert["source"];
  readonly inputSchema: z.ZodType<Input>;
  emit(input: Input, ctx: TopicSourceContext): Promise<TopicBriefInsert[]>;
}
```

**Key invariants:**
- MUST NOT persist briefs (caller owns the transaction)
- MUST be idempotent
- CAN return empty array

**File:** `packages/pipelines/src/topic-sources/types.ts` (lines 14–26)

**Implementations:**
- `packages/pipelines/src/topic-sources/gap-analysis/source.ts`
- `packages/pipelines/src/topic-sources/trend-discovery/source.ts`

---

### 12. Adapter package structure

Every adapter lives in `packages/adapters/<name>/`:

```
packages/adapters/anthropic/
├── src/
│   ├── index.ts            (main export: client factory)
│   ├── client.ts           (API wrapper)
│   ├── verify.ts           (verification flow — REQUIRED)
│   └── types.ts            (TypeScript types)
├── package.json            ("./verify" subpath export)
└── README.md
```

**Subpath export requirement:**

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./verify": "./src/verify.ts"
  }
}
```

Callers import verification via: `import { verifyAnthropic } from "@marketing-auto/adapter-anthropic/verify"`

**File:** `packages/adapters/anthropic/package.json` (example pattern)

---

### 13. Project config evolution (JSONB + loadActiveConfig)

When a project config field changes, use `loadActiveConfig()` which:
1. Caches the active `project_configurations` row per-project
2. Parses all JSONB fields through their Zod schemas
3. Applies `.default()` values to old data automatically

```typescript
const config = await loadActiveConfig(projectId);
// config.topicScope has min_trend_score applied (even if old row lacked it)
```

**File:** `packages/pipelines/src/config/index.ts` (loadActiveConfig implementation)

---

### 14. Test fixtures — always mixed-source

When writing tests with topic briefs, use mixed source values to catch source-specific logic bugs:

```typescript
// ❌ Wrong — single source
const briefs = [
  { source: "gap_analysis", gapMetadata: {...} },
  { source: "gap_analysis", gapMetadata: {...} },
];

// ✅ Right — mixed sources
const briefs = [
  { source: "gap_analysis", gapMetadata: {...}, approvalStatus: "pending" },
  { source: "trend_discovery", trendMetadata: {...}, approvalStatus: "approved" },
  { source: "manual", approvalStatus: "rejected" },
];
```

**File:** Spec 54 Backlog (lines 95–97)

---

### 15. preRunId pattern for pipeline triggers

When a UI needs to poll a pipeline run immediately after enqueue (before the worker picks it up):

```typescript
// Trigger helper creates the row BEFORE enqueueing
const runId = await createQueuedRun(projectId, pipelineName, input);
const { jobId } = await enqueuePipeline({ ..., preRunId: runId });
return { runId, jobId }; // UI can poll immediately
```

**File:** `packages/pipelines/src/cold-start/triggers.ts` (cold-start triggers)
**File:** `packages/pipelines/src/article/trigger.ts` (article pipeline triggers)

---

## SECTION 11: Known Tech Debt

**File:** `specs/54-Backlog.md` (lines 1–100)

All open items (deferred or in backlog):

| Priority | Item | Description | Estimate |
|---|---|---|---|
| 1 | **54.4b — Reddit + GitHub Trending Adapters** | Deferred from 54.4; adds broader signal capture beyond PH/HN/RSS | 1.5 days |
| 2 | **Tech Debt #3 — Automation chains only for 2/4 gap types** | `/automate` supports missing_spoke_type + cluster_too_small; missing_hub and missing_translation lack chain orchestration | TBD |
| 3 | **Tech Debt #10 — Article Discovery is post-draft only** | Discovery pipeline runs after generation; future spec to bring earlier in pipeline | TBD |
| 4 | **clusters.satellite_keywords column cleanup** | Column became fossil after `/suggest` stopped writing in 54.3; audit readers, deprecate or migrate | TBD |
| 5 | **dual-write deprecation: content_gaps → topic_briefs only** | Once 54.9 UI moves to briefs, content_gaps can be deprecated | TBD |
| 6 | **Adjustable trend score weights via project config** | Currently hardcoded constants; expose as `topic_scope.score_weights` (or separate key) | 2 hours |
| 7 | **Bulk DataForSEO Trends as signal source** | Collect weekly top-growing queries as external_signals | 1 day |
| 8 | **`rejected_topic_candidates` 90-day storage cleanup** | 30-day `expires_at` gate; rows stay forever; add DELETE for rows >90d old | 30 min |
| — | **Per-source configuration in signal_sources** | Move `maxAgeDays`, `minPoints` from hardcoded to `project_configurations.signal_sources` | 1–2 hours |

**Score rebalancing (Spec 54.5b):**

Current weights (positive sum to 100):
- `communityBuzz`: 15
- `searchVolumeGrowth`: 15
- `officialAnnouncement`: 25
- `serpVolatility`: 20
- `sourceDiversity`: 25
- `existingCoveragePenalty`: -40

Rationale: RSS-only signals were scoring zero on buzz+growth; diversity rewards cross-source confirmation; official raised for vendor announcements.

`min_trend_score` default: 25 (lowered from 40 in 54.5b).

---

## Open Questions

⚠️ **NEEDS CLARIFICATION:**

1. **`content_gaps` vs `topic_briefs` dual-write durability:**  
   The Spec 54.3 gap routes update both tables. If `topic_briefs` write succeeds but `content_gaps` fails (or vice versa), state is inconsistent. The routes do NOT wrap both writes in a transaction. **Question:** Is this intentional (backward-compat for UI that may still read content_gaps directly), or should it be fixed?

2. **`clusters.satellite_keywords` usage after 54.3:**  
   The `/suggest` endpoint stopped writing to this column in 54.3. The column is still populated by Cold-Start phase 3 + some topic sources. **Question:** Which codepaths still READ this column? Should it be deprecated, or is it actively used by article generation?

3. **`articleSourceEnum` "imported" semantics:**  
   Articles with `source='imported'` come from Astro repo mirrors. Cold-Start generates articles with `source='generated'`. **Question:** Does the codebase treat imported articles differently in the article pipeline (outline/draft/etc.)? Or do they all follow the same pipeline?

4. **`topicBriefs.clusterAction='standalone'` handling:**  
   When `cluster_action='standalone'`, the brief has `clusterId=null`. Downstream article generation (outline/draft) typically reads cluster context. **Question:** How do article generation steps handle articles with no cluster assignment?

5. **Partial index on `rejected_topic_candidates.expires_at`:**  
   PostgreSQL does NOT allow `NOW()` in partial index WHERE clauses. The index `(project_id, expires_at)` has no WHERE — the `expires_at > NOW()` filter is applied at query time. **Question:** Is there a planned cleanup job for rows where `expires_at < NOW()`? The backlog mentions 90-day cleanup but no implementation exists yet.

6. **`articles.projectConfigVersionId` consistency:**  
   Articles can be generated from different `project_configurations` versions (during a config update). Downstream steps might need to know which config version was active. **Question:** Is `projectConfigVersionId` read anywhere, or only written? If not read, can it be removed?

7. **Transaction isolation in `executeDecision`:**  
   The function runs inside a transaction passed by the caller. If the caller also has other inserts (e.g., creating the pipeline_run row), are those atomic? **Question:** What's the transaction scope — just the brief update, or the entire caller's work?

8. **Cluster-match embedding backfill in trend synthesis:**  
   Embeddings are lazily backfilled when missing (opportunistic, warnings logged). If backfill fails (Voyage API down), the cluster match falls through to `create_new`. **Question:** Should failed backfills be retried on the next synthesis run, or are they one-shot?

9. **`external_signals.processedInto` cardinality:**  
   One signal can theoretically be processed into multiple briefs (e.g., same HN post inspires two different brief topics). The code only sets ONE `processedInto`. **Question:** Is single-brief-per-signal intentional, or should this be a join table?

10. **vec...tor embedding dimension consistency:**  
    Both `clusters.embedding` and `articles.embedding` use pgvector with 1024 dimensions (Voyage voyage-3). **Question:** If Voyage is upgraded to a new model with different dimensions, how is backfill handled? Is there a migration process?

---

**End of Codebase Reference Pack**

Generated: 2026-05-15
Verified against: `packages/db/src/schema/`, `packages/pipelines/src/`, `packages/core/src/cost/`, `apps/api/src/`, `apps/web/src/`

