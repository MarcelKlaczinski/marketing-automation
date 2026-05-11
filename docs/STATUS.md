# Marketing-Tool Feature Status
Stand: 2026-05-11

---

## 1. Repo Overview

### Apps
| Package | Role |
|---------|------|
| `apps/api` | Hono HTTP API server + BullMQ workers; all tenant and platform endpoints |
| `apps/web` | Quasar 2 + Vue 3 PWA frontend; mobile-first marketing dashboard |

### Packages
| Package | Role | Status |
|---------|------|--------|
| `packages/core` | Credential vault, cost enforcement, queue pause/resume logic | functional |
| `packages/cost-tracker` | `track()` wrapper, pricing constants, budget limit checks | functional |
| `packages/db` | Drizzle schema, migrations, typed DB client | functional |
| `packages/pipelines` | All pipeline classes + BullMQ engine | functional |
| `packages/shared` | `config.ts` (Zod env), `result.ts`, logger | functional |
| `packages/prompts` | System-prompt builder, project-context loader | functional |
| `packages/skills` | Git submodule: skill `.md` files loaded into LLM prompts | external submodule |

### Adapters
| Adapter | Role | Status |
|---------|------|--------|
| `adapters/anthropic` | Wraps Anthropic SDK; `messages()`, verify | functional |
| `adapters/replicate` | Image generation via Replicate API; verify | functional |
| `adapters/dataforseo` | SERP, keyword, backlink queries; verify | functional |
| `adapters/email` | Nodemailer/SMTP; `sendEmail()`, `sendMagicLinkEmail()` | functional |
| `adapters/storage` | Cloudflare R2 `put/get/delete/presign`; verify | functional |
| `adapters/astro-sync` | Git-based Astro MDX sync + repo import pipeline | functional |
| `adapters/pagespeed` | Lighthouse-CLI + PSI API dual-mode validation pipeline | functional |

---

## 2. Specs Status

| Spec | Title | Status | Notes |
|------|-------|--------|-------|
| 00 | Foundation Setup | ✅ Implementiert | Bun workspace, Hono, Drizzle, Redis config in place |
| 01 | Database Schema | ✅ Implementiert | 17 migrations applied, all tables present |
| 02 | Credential Vault | ✅ Implementiert | `globalCredentials` table, `loadCredential()` in core |
| 03 | Cost Tracker | ✅ Implementiert | `packages/cost-tracker` fully functional |
| 04 | Magic Link Auth | ✅ Implementiert | `/auth/magic-link/request` + `/auth/magic-link/verify` endpoints |
| 05 | Base Pipeline Engine | ✅ Implementiert | `Pipeline`, `BaseStep`, BullMQ queue in `packages/pipelines/src/engine` |
| 10 | Project Marketing Context Skill Integration | ✅ Implementiert | `packages/prompts` loads skill MDs + project context |
| 11 | Anthropic Adapter | ✅ Implementiert | `adapters/anthropic/src/client.ts` |
| 11.5 | Email Adapter | ✅ Implementiert | `adapters/email/src/client.ts` |
| 12 | Replicate Adapter | ✅ Implementiert | `adapters/replicate/src/client.ts` |
| 13 | DataForSEO Adapter | ✅ Implementiert | `adapters/dataforseo/src/client.ts` |
| 14 | Cold-Start Pipeline | ✅ Implementiert | 5 phases, 7 pipeline classes in `packages/pipelines/src/cold-start/` |
| 20 | Article Pipeline | ✅ Implementiert | `ArticleOutlinePipeline` + `ArticleDraftPipeline` in `packages/pipelines/src/article/` |
| 21 | Astro Markdown Sync Adapter | ✅ Implementiert | `adapters/astro-sync` with 6-step sync pipeline |
| 22 | PageSpeed Validation | ✅ Implementiert | Lighthouse-CLI mode in `adapters/pagespeed` |
| 22.5 | PageSpeed Dual-Mode | ✅ Implementiert | PSI API mode added, `mode` column in DB (migration 0016) |
| 23 | Schema.org Extensions | ✅ Implementiert | `packages/pipelines/src/schema-extension/` |
| 24 | Internal Linking Pipeline | ✅ Implementiert | `packages/pipelines/src/internal-linking/` + `cluster:link-rebuild` pipeline |
| 30 | Web App Shell | ✅ Implementiert | Quasar layout, router, i18n, PWA shell in `apps/web` |
| 31 | Auth + Session UI | ✅ Implementiert | LoginPage, AuthVerifyPage, session guards |
| 31.5 | Dev-Mode Magic Link Console Output | ✅ Implementiert | ❓ Unklar (no dedicated file found; likely implemented inline in email adapter) |
| 32 | Installer / First-Run Wizard | ✅ Implementiert | `InstallerPage.vue`, `apps/web/src/components/installer/` |
| 33 | Settings + Credential Management | ✅ Implementiert | `SettingsPage.vue` present, `apps/web/src/components/settings/` |
| 34 | Project Management | ✅ Implementiert | `ProjectDetailPage.vue`, `ProjectsPage.vue` present |
| 34.5 | MarkdownEditor Improvements | ✅ Implementiert | ❓ Unklar (no dedicated file; likely merged into 34 or 36 implementation) |
| 35 | Cold-Start Wizard UI | ✅ Implementiert | `ColdStartPage.vue` + Phase1–5 components in `apps/web/src/components/cold-start/` |
| 36 | Article Pipeline UI | ✅ Implementiert | `ArticlesPage.vue`, `ArticleDetailPage.vue`, Kanban + detail components in `apps/web/src/components/articles/` |
| 37 | Clusters & Pillars Management UI | ✅ Implementiert | `ClustersManagementPage.vue` + `apps/web/src/components/clusters/` |
| 38 | Cost Dashboard | ✅ Implementiert | `CostDashboardPage.vue` + 6 cost chart/table components |
| 39 | Activity Feed | ✅ Implementiert | `ActivityPage.vue` + `apps/web/src/components/activity/` |
| 40 | Notifications System | ✅ Implementiert | `notifications` table, SSE stream endpoint, `pushSubscriptions`, `InboxPage.vue` |
| 41 | Cost Enforcement & Pipeline Hardening | ✅ Implementiert | `trigger-helpers.ts`, `checkTriggerAllowed`, cost pre-flight in all trigger routes |
| 42 | Stabilization Pass | ✅ Implementiert | Status explicitly ✅ Complete (Sessions 1+2, 2026-05-07) |
| 43 | Inbox Dashboard | ✅ Implementiert | `InboxPage.vue` + 4 inbox components (most recent commit) |
| 44 | Astro-Repo-Import | ✅ Implementiert | `RepoImportPipeline` (`astro:repo-import`), `astroImportRuns` table, CLAUDE.md confirms done |
| 45/46 | Multi-Language Article Generation | ✅ Implementiert | `cornerstoneSpecs` table, `CornerstoneApprovalPage.vue`, locale-aware article generation |

---

## 3. DB Schema

### Enums (`_enums.ts`)
| Enum | Values |
|------|--------|
| `lifecycle_stage` | cold_start, pre_launch, launch, growth, mature |
| `pipeline_template` | educational, affiliate_review, local_business, programmatic_seo |
| `industry` | ai_education, automotive_dealer, renewable_affiliate, music_school, other |
| `article_status` | proposed, approved, generating, outline_review, drafting, final_review, schema_extending, ready_to_publish, validating, published, blocked_by_pagespeed, failed, rejected |
| `social_platform` | instagram, tiktok, linkedin, twitter |
| `social_format` | carousel, reel, single_image, story |
| `social_status` | draft, in_review, approved, scheduled, published, failed |
| `credential_service` | google_analytics, google_search_console, google_adsense, instagram_graph, github_deploy, astro_deploy_webhook |
| `cost_service` | anthropic, replicate, dataforseo, smtp |
| `pipeline_run_status` | queued, running, completed, failed, cancelled |
| `approval_action` | requested, approved, rejected, changes_requested |
| `user_role` | owner, editor |
| `article_source` | generated, imported |
| `cornerstone_spec_status` | proposed, approved, in_generation, article_done, rejected |

### Tables by Schema File

**auth.ts**
| Table | Purpose |
|-------|---------|
| `users` | Platform users (email, role) |
| `magic_link_tokens` | One-time auth tokens |
| `sessions` | Active session tokens with expiry |

**projects.ts**
| Table | Purpose |
|-------|---------|
| `projects` | Tenant projects (slug, domain, lifecycle, cost limits, astro config) |
| `projectCredentials` | Encrypted per-project API credentials |

**identity.ts**
| Table | Purpose |
|-------|---------|
| `brandVoices` | LLM-generated brand voice per project |
| `contentPillars` | Thematic pillars (ordered) |
| `clusters` | Keyword clusters with satellite keywords |

**content.ts**
| Table | Purpose |
|-------|---------|
| `articles` | Core content: status, body, outline, SEO fields, JSON-LD, embedding, source (generated/imported) |
| `cornerstoneSpecs` | DE+EN cornerstone pairs with approval workflow |
| `articleVersions` | Version history for article body edits |
| `socialPosts` | Social media post drafts (currently schema only) |

**operations.ts**
| Table | Purpose |
|-------|---------|
| `systemSettings` | Key-value system config |
| `globalCredentials` | Encrypted global API credentials |
| `costLogs` | Per-call cost entries with token counts |
| `briefings` | Generated article briefings |
| `pipelineRuns` | Pipeline execution tracking (all pipelines) |
| `astroSyncRuns` | Per-article Astro sync results |
| `pagespeedRuns` | PageSpeed validation results (scores, mode) |
| `schemaExtensionRuns` | Schema.org extension pipeline results |
| `linkRebuildRuns` | Internal linking rebuild results |
| `projectPauseStates` | Queue pause state per project+service |
| `costAlerts` | Budget limit alerts with acknowledge workflow |
| `astroImportRuns` | Astro repo import run tracking |
| `approvals` | Generic approval workflow table (schema only — unused per Backlog B-002) |

**notifications.ts**
| Table | Purpose |
|-------|---------|
| `notifications` | In-app notification messages with read state |

**push.ts**
| Table | Purpose |
|-------|---------|
| `pushSubscriptions` | VAPID Web Push endpoint subscriptions per user |

### Migrations (chronological)
| # | Name | Purpose |
|---|------|---------|
| 0000 | pale_roland_deschain | Foundation tables |
| 0001 | peaceful_marvel_apes | Auth + projects |
| 0002 | simple_boomerang | Identity tables |
| 0003 | article_pipeline_schema | Articles, pipeline runs |
| 0004 | astro_sync_schema | Astro sync runs |
| 0005 | pagespeed_schema | PageSpeed runs |
| 0006 | schema_extension | Schema extension runs |
| 0007 | internal_linking | Link rebuild runs, article embeddings |
| 0008 | remove_linking_status | Cleanup |
| 0009 | remove_elevenlabs_service | Remove unused service enum value |
| 0010 | system_settings_global_credentials | Global credentials table |
| 0011 | clusters_position | Position ordering on clusters/pillars |
| 0012 | cost_enforcement | projectPauseStates, costAlerts, cost limit columns |
| 0013 | notifications | Notifications + pushSubscriptions |
| 0014 | astro_import | astroImportRuns, article source/import metadata |
| 0015 | multilang_cornerstone_specs | cornerstoneSpecs table, article locale/translationKey |
| 0016 | pagespeed_mode | `mode` column on pagespeed_runs |

---

## 4. API-Endpoints

### auth.ts
| Method | Path | Handler |
|--------|------|---------|
| POST | `/auth/login` | Dev-only direct login |
| POST | `/auth/magic-link/request` | Send magic link email |
| POST | `/auth/magic-link/verify` | Verify token, create session |
| GET | `/auth/magic-link/verify` | Token verify (GET variant) |
| POST | `/auth/logout` | Invalidate session |
| GET | `/auth/me` | Current user info |

### projects.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/projects/` | List all projects |
| GET | `/projects/:slug` | Project detail + adapters status |
| POST | `/projects/` | Create project |
| PATCH | `/projects/:slug` | Update project |
| GET | `/projects/:slug/pause-state` | Queue pause status |
| POST | `/projects/:slug/resume-queues` | Resume paused queues |
| POST | `/projects/:slug/astro-import` | Trigger Astro repo import |
| GET | `/projects/:slug/astro-import-runs` | List import runs |

### cold-start.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/:slug/cold-start/status` | Phase completion status |
| POST | `/:slug/cold-start/voice-refinement/questions` | Trigger voice questions |
| POST | `/:slug/cold-start/voice-refinement/synthesize` | Trigger voice synthesis |
| POST | `/:slug/cold-start/competitor-analysis/questions` | Trigger competitor identification |
| POST | `/:slug/cold-start/competitor-analysis/analyze` | Trigger competitor analysis |
| POST | `/:slug/cold-start/cluster-plan` | Trigger cluster propose |
| POST | `/:slug/cold-start/cluster-plan/expand` | Trigger cluster expand |
| POST | `/:slug/cold-start/cluster-plan/:clusterId` | Trigger single cluster expand |
| PATCH | `/:slug/cold-start/cluster-plan/:clusterId` | Update cluster |
| GET | `/:slug/cold-start/cornerstones` | List cornerstone specs |
| POST | `/:slug/cold-start/go-live-checklist` | Trigger go-live checklist |

### articles.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/articles/` | List articles for project |
| GET | `/articles/across-projects` | Articles across all projects |
| GET | `/articles/imported/collections` | Imported article collections |
| GET | `/articles/imported` | List imported articles |
| GET | `/articles/imported/:id` | Imported article detail |
| GET | `/articles/:id` | Article detail |
| PATCH | `/articles/:id` | Update article metadata |
| POST | `/articles/:id/body` | Update article body |
| GET | `/articles/:id/versions` | Article version history |
| GET | `/articles/:id/versions/:version` | Specific version |
| POST | `/articles/:id/generate-outline` | Trigger outline pipeline |
| POST | `/articles/:id/generate-draft` | Trigger draft pipeline |
| POST | `/articles/:id/sync` | Trigger Astro sync |
| POST | `/articles/:id/validate-pagespeed` | Trigger PageSpeed validation |
| POST | `/articles/:id/extend-schema` | Trigger schema extension |
| POST | `/articles/:articleId/continue` | Continue stalled pipeline |
| POST | (legacy) `/generate-article` | Legacy trigger endpoint |

### clusters.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/clusters/` | List clusters with articles |
| POST | `/clusters/` | Create cluster |
| PATCH | `/clusters/:id` | Update cluster |
| DELETE | `/clusters/:id` | Delete cluster |
| POST | `/clusters/:id/move` | Reorder cluster |
| POST | `/clusters/:id/move-articles` | Move articles between clusters |

### pillars.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/pillars/` | List pillars |
| POST | `/pillars/` | Create pillar |
| PATCH | `/pillars/:id` | Update pillar |
| DELETE | `/pillars/:id` | Delete pillar |
| POST | `/pillars/:id/move` | Reorder pillar |

### cost.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/cost/aggregations` | Cost aggregations (month/year/service) |
| GET | `/cost/logs` | Paginated cost log entries |
| GET | `/cost/alerts` | Cost alert list |
| POST | `/cost/alerts/:id/acknowledge` | Acknowledge alert |

### notifications.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/notifications/` | List notifications |
| GET | `/notifications/unread-count` | Unread count |
| POST | `/notifications/mark-read` | Mark selected read |
| POST | `/notifications/mark-all-read` | Mark all read |
| GET | `/notifications/stream` | SSE event stream |

### push-subscriptions.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/push/vapid-public-key` | VAPID public key |
| GET | `/push/subscriptions` | List user subscriptions |
| POST | `/push/subscriptions` | Register subscription |
| DELETE | `/push/subscriptions/:id` | Remove subscription |
| POST | `/push/test` | Send test push |

### cornerstone-specs.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/projects/:slug/cornerstone-specs` | List cornerstone pairs |
| POST | `/projects/:slug/cornerstone-specs/:specId/approve` | Approve spec |
| POST | `/projects/:slug/cornerstone-specs/:specId/generate-article` | Trigger article generation |
| POST | `/projects/:slug/cornerstone-specs/:specId/reject` | Reject spec |
| POST | `/projects/:slug/cornerstone-specs/:specId/regenerate` | Re-generate spec |

### pipeline-runs.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/pipeline-runs/active` | Active runs across projects |
| GET | `/pipeline-runs/project/:projectId` | Runs for project |
| GET | `/pipeline-runs/:runId` | Single run detail |

### system.ts
| Method | Path | Handler |
|--------|------|---------|
| GET | `/system/info` | System info (version, env) |
| GET | `/system/status` | Adapter health check |
| POST | `/system/credentials` | Save global credential |
| DELETE | `/system/credentials/:service/:key` | Delete credential key |
| DELETE | `/system/credentials/:service` | Delete all service credentials |
| POST | `/system/verify/:adapter` | Verify adapter credentials |
| POST | `/system/initialize` | First-run initialization |

### Other
| Method | Path | Handler |
|--------|------|---------|
| GET | `/health/` | Health check |
| POST | `/admin/prune-notifications` | Prune old notifications |

---

## 5. Frontend

### Pages (`apps/web/src/pages/`)
| Page | Purpose |
|------|---------|
| `IndexPage.vue` | Root redirect |
| `LoginPage.vue` | Magic link login form |
| `AuthVerifyPage.vue` | Magic link verification handler |
| `InstallerPage.vue` | First-run setup wizard |
| `ProjectsPage.vue` | Project list |
| `ProjectDetailPage.vue` | Project hub (tabs: context, cold-start, articles, clusters, settings) |
| `ColdStartPage.vue` | Cold-Start 5-phase wizard |
| `ArticlesPage.vue` | Kanban article board |
| `ArticleDetailPage.vue` | Article editor + pipeline actions |
| `ClustersManagementPage.vue` | Cluster/pillar CRUD |
| `CornerstoneApprovalPage.vue` | DE+EN cornerstone spec review |
| `CostDashboardPage.vue` | Cost charts + logs |
| `ActivityPage.vue` | Pipeline run activity feed |
| `InboxPage.vue` | Inbox: tasks, runs, notifications |
| `SettingsPage.vue` | Adapter credentials management |
| `ErrorNotFound.vue` | 404 page |

### Component Directories
`activity`, `articles`, `clusters`, `cold-start`, `common`, `cornerstones`, `cost`, `inbox`, `installer`, `notifications`, `projects`, `settings`

### Composables (`apps/web/src/composables/`)
| Composable | Purpose |
|-----------|---------|
| `useApi.ts` | Typed fetch wrapper with auth headers |
| `useActiveRunsPolling.ts` | Polls active pipeline runs |
| `usePipelineRunPolling.ts` | Polls single pipeline run status |
| `useNotificationStream.ts` | SSE stream for notifications |
| `useNotify.ts` | Quasar notify wrappers |
| `useProjectPauseState.ts` | Queue pause state + resume |
| `usePushSubscription.ts` | Web Push subscription management |
| `useTheme.ts` | Dark/light mode toggle |

### Stores (`apps/web/src/stores/`)
`articles.ts`, `auth.ts`, `clusters.ts`, `cold-start.ts`, `cost.ts`, `notifications.ts`, `pillars.ts`, `projects.ts`, `system-status.ts`, `ui.ts`

---

## 6. Pipelines Detail

### Cold-Start Pipelines (`packages/pipelines/src/cold-start/`)

| Pipeline Name | Steps | Trigger |
|--------------|-------|---------|
| `cold-start:voice-refinement-questions` | GenerateVoiceQuestionsStep | POST `/:slug/cold-start/voice-refinement/questions` |
| `cold-start:voice-synthesis` | SynthesizeVoiceContextStep | POST `/:slug/cold-start/voice-refinement/synthesize` |
| `cold-start:competitor-questions` | IdentifyCompetitorsStep | POST `/:slug/cold-start/competitor-analysis/questions` |
| `cold-start:competitor-analysis` | FetchCompetitorKeywordsStep → SynthesizeCompetitorReportStep | POST `/:slug/cold-start/competitor-analysis/analyze` |
| `cold-start:cluster-propose` | GenerateClusterCandidatesStep → ValidateKeywordsStep | POST `/:slug/cold-start/cluster-plan` |
| `cold-start:cluster-expand` | ExpandWithSatellitesStep → SynthesizeClusterPlanStep | POST `/:slug/cold-start/cluster-plan/expand` |
| `cold-start:cornerstone-list` | GenerateCornerstoneSpecsStep | Auto-triggered after cluster expand |
| `cold-start:go-live-checklist` | GenerateGoLiveChecklistStep | POST `/:slug/cold-start/go-live-checklist` |

### Article Pipelines (`packages/pipelines/src/article/`)

| Pipeline Name | Steps | Trigger |
|--------------|-------|---------|
| `article:outline` | TopicIntakeStep → ResearchStep → OutlineStep → PersistOutlineStep | POST `/articles/:id/generate-outline` |
| `article:draft` | TopicIntakeStep → DraftStep → SelfReviewStep → HeroImageStep → AssemblyStep → PersistArticleStep | POST `/articles/:id/generate-draft` |

### Other Pipelines

| Pipeline Name | Steps | Trigger |
|--------------|-------|---------|
| `article:astro-sync` | LoadArticleStep → DownloadHeroStep → RenderMdxStep → ResolveSchemaStep → CommitToGithubStep → UpdateDbStatusStep | POST `/articles/:id/sync` |
| `article:pagespeed-validation` | LoadArticleStep → CloneOrUpdateStep → AstroBuildStep → PreviewServerStep → LighthouseStep → EvaluateAndPersistStep | POST `/articles/:id/validate-pagespeed` (mode=local) |
| `article:pagespeed-validation-api` | LoadArticleStep → PsiApiStep → EvaluateAndPersistStep | POST `/articles/:id/validate-pagespeed` (mode=api) |
| `article:schema-extension` | LoadArticleStep → DetectRichTypesStep → BuildJsonLdStep → PersistSchemaStep | POST `/articles/:id/extend-schema` |
| `cluster:link-rebuild` | OrchestrateClusterRebuildStep | POST `/:id/move-articles` (implicit) / manual trigger |
| `astro:repo-import` | FilterChangedFilesStep → ParseFrontmatterBatchStep → LinkTranslationPairsStep → UpsertArticlesStep → UpdateImportRunStep | POST `/projects/:slug/astro-import` |

---

## 7. Cost-Ops

Defined in `packages/core/src/cost/operations.ts`. Pricing in `packages/cost-tracker/src/pricing.ts`.

| Key | Operation String | Category |
|-----|-----------------|----------|
| ARTICLE_OUTLINE | `article-outline` | Article |
| ARTICLE_DRAFT | `article-draft` | Article |
| ARTICLE_SELF_REVIEW | `article-self-review` | Article |
| ARTICLE_RESEARCH_SERP | `article-research-serp` | Article |
| ARTICLE_RESEARCH_SYNTHESIS | `research-competitor-synthesis` | Article |
| COLD_START_VOICE_QUESTIONS | `voice-questions-generation` | Cold-Start |
| COLD_START_VOICE_SYNTHESIS | `voice-synthesis` | Cold-Start |
| COLD_START_COMPETITOR_IDENTIFICATION | `competitor-identification` | Cold-Start |
| COLD_START_COMPETITOR_ANALYSIS | `competitor-report-synthesis` | Cold-Start |
| COLD_START_CLUSTER_CANDIDATES | `cluster-candidates-generation` | Cold-Start |
| COLD_START_CLUSTER_KEYWORD_OVERVIEW | `cluster-keyword-overview` | Cold-Start |
| COLD_START_CLUSTER_SYNTHESIS | `cluster-plan-synthesis` | Cold-Start |
| COLD_START_CORNERSTONE_SPECS | `cornerstone-specs-generation` | Cold-Start |
| COLD_START_GO_LIVE_CHECKLIST | `cold-start-go-live-checklist` | Cold-Start |
| SCHEMA_RICH_DETECTION | `schema-rich-detection` | Schema |
| SCHEMA_FAQ_BUILD | `schema-faq-build` | Schema |
| SCHEMA_HOWTO_BUILD | `schema-howto-build` | Schema |
| INTERNAL_LINK_ANALYSIS | `internal-link-analysis` | Linking |
| INTERNAL_LINK_REBUILD | `internal-link-rebuild` | Linking |
| HERO_IMAGE | `hero-image-generation` | Replicate |
| DATAFORSEO_SERP_ANALYSIS | `serp-analysis` | DataForSEO |
| DATAFORSEO_KEYWORD_RESEARCH | `keyword-research` | DataForSEO |
| DATAFORSEO_BACKLINK_CHECK | `backlink-check` | DataForSEO |
| BRIEFING_GENERATION | `briefing-generation` | Briefing |
| SMTP_MAGIC_LINK | `magic-link-email` | SMTP |
| SMTP_BRIEFING | `briefing-email` | SMTP |
| PAGESPEED_PSI_API | `pagespeed-psi-api` | PageSpeed |

**Pricing reference** (`packages/cost-tracker/src/pricing.ts`):
- Anthropic: claude-haiku-4-5 $1/$5, claude-sonnet-4-6 $3/$15, claude-opus-4-7 $5/$25 per MTok (input/output)
- Replicate: flux-1.1-pro $0.04/img, flux-schnell $0.003/img, ideogram-v3 $0.04/img
- DataForSEO: SERP standard $0.0006, live $0.002; keyword overview $0.0201/item
- SMTP: $0.0001/email
- EUR_PER_USD: 0.92 (fixed)

---

## 8. Credentials & ENV

### ENV Variables (`.env.example`)

| Category | Variable | Required |
|----------|----------|----------|
| **Runtime** | `NODE_ENV`, `LOG_LEVEL` | optional |
| **Database** | `DATABASE_URL` | required |
| **Redis** | `REDIS_URL` | required |
| **API** | `API_PORT`, `API_HOST`, `APP_BASE_URL`, `CORS_ORIGIN` | required |
| **Security** | `ENCRYPTION_KEY` (32-byte hex) | required |
| **Anthropic** | `ANTHROPIC_API_KEY` | required for LLM |
| **Replicate** | `REPLICATE_API_TOKEN` | required for images |
| **DataForSEO** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | required for SEO |
| **SMTP** | `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_FROM_NAME`, `SMTP_HOST`, `SMTP_PORT` | required for auth |
| **Web Push** | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | required for push |
| **Cloudflare R2** | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | required for storage |
| **PageSpeed** | `PAGESPEED_INSIGHTS_API_KEY` | optional (PSI mode) |

### Global Credential Services (stored encrypted in DB via `globalCredentials` table)
`anthropic`, `replicate`, `dataforseo`, `smtp`, `r2`, `github_app`

### Per-Project Credential Services (stored in `projectCredentials`)
`google_analytics`, `google_search_console`, `google_adsense`, `instagram_graph`, `github_deploy`, `astro_deploy_webhook`

---

## 9. Tests

### Test files by package (27 total)

| Package | Test Files | Live-Gated? |
|---------|-----------|-------------|
| `packages/core` | 1 (credentials.test.ts) | no |
| `packages/cost-tracker` | 1 (cost-tracker.test.ts) | no |
| `packages/db` | 1 (schema.test.ts) | no |
| `packages/pipelines` | 13 files | yes (4 gated) |
| `packages/adapters/anthropic` | 1 | yes (RUN_LIVE_ANTHROPIC=1) |
| `packages/adapters/replicate` | 1 | yes (RUN_LIVE_REPLICATE=1) |
| `packages/adapters/dataforseo` | 1 | yes (RUN_LIVE_DATAFORSEO=1) |
| `packages/adapters/email` | 1 | yes (RUN_LIVE_SMTP=1) |
| `packages/adapters/storage` | 1 | yes (RUN_LIVE_R2=1) |
| `packages/adapters/astro-sync` | 3 | yes (RUN_LIVE_ASTRO_SYNC=1) |
| `apps/api` | 2 (auth, health) | no |

### Live-test flags
- `RUN_LIVE_ANTHROPIC=1` — real API call, ~$0.01
- `RUN_LIVE_REPLICATE=1` — real image generation
- `RUN_LIVE_DATAFORSEO=1` — real SERP queries
- `RUN_LIVE_SMTP=1` — real email send
- `RUN_LIVE_R2=1` — real R2 read/write
- `RUN_LIVE_ASTRO_SYNC=1` — real GitHub commit
- `RUN_LIVE_ARTICLE_PIPELINE=1` — full article pipeline, ~€1.30/run
- `RUN_LIVE_INTERNAL_LINKING=1` — internal linking pipeline
- `RUN_LIVE_SCHEMA_EXTENSION=1` — schema extension pipeline

---

## 10. Workers/Queues

### Worker files (`apps/api/src/workers/`)
| File | Purpose |
|------|---------|
| `index.ts` | Bootstraps the BullMQ worker process |
| `article-scheduler.ts` | Scheduled article generation trigger |

### BullMQ Queues
| Queue Name | Definition | Purpose |
|-----------|-----------|---------|
| `pipelines` | `packages/pipelines/src/engine/queue.ts` | Main pipeline job queue (all pipeline types) |
| `scheduled` | `packages/pipelines/src/engine/scheduler.ts` | Scheduled/delayed pipeline jobs |

Both queues connect via `getConnection()` from shared Redis config.

---

## 11. Git Status

### Branches
- `master` (current, default)
- `remotes/origin/feature/44-astro-repo-import` (merged)
- `remotes/origin/master`
- `claude/dazzling-lalande-d2fe63` (local Claude worktree branch)

### Recent Commits (last 20)
```
31adb44 feat(web/inbox): implement Inbox dashboard with 3-section layout
3da4c51 docs: update spec 22.5 discovered + deviations
f09a232 fix(pagespeed): null-check astroRepo+commitSha in local bridge
4655d04 feat(web): pagespeed validate button with mode switch (22-5.5)
d1c0530 feat(api): pagespeed endpoint supports mode (22-5.4)
1b316f7 feat(pagespeed): trigger supports mode dispatch (22-5.3)
383563b feat(pagespeed): PSI API step + API validation pipeline (22-5.2)
0aea786 feat(db): add mode column to pagespeed_runs (22-5.1)
9fb2059 docs: update spec-45 discovered sections + pipelines CLAUDE.md
a400a36 fix(api): review fixes for cornerstone-specs route
60abceb fix(spec-45): locale-aware hero alt-text + cornerstone link from clusters UI
1e6061a feat(web): cornerstone approval UI for DE+EN pairs (45-46.5)
52fae37 feat(api): cornerstone-spec approval + cluster article generation (45-46.4)
3ffac54 feat(pipelines): article generation locale-aware via cornerstoneSpecId (45-46.3)
ee7d4f0 feat(pipelines): cold-start cornerstone-list generates DE+EN pairs (45-46.2)
5b4a1f9 docs: note clusters.cornerstoneKeywords array discrepancy
6d2f4ba feat(db): add cornerstone_specs table for multi-language pairs (45-46.1)
69968d4 feat(web/inbox): implement Inbox dashboard with 3-section layout
6a16b56 docs: update CLAUDE.md and spec 44 with implementation learnings
ba7220e fix(astro-import): add pause-check + idempotency guard to import trigger
```

---

## 12. Offene TODOs

Only 1 TODO/FIXME/XXX found in non-test TypeScript sources:

| File | Count | Note |
|------|-------|------|
| `packages/adapters/pagespeed/src/steps/preview-server.ts:71` | 1 | Comment about parsing Astro log format: `// Astro logs "Local: http://localhost:XXXX/" — capture it` (informational, not a real TODO) |

**Assessment**: The codebase is exceptionally clean on TODO debt. The Backlog.md file handles deferred work explicitly.

### Tracked Backlog Items (`specs/Backlog.md`)
| ID | Topic | Status |
|----|-------|--------|
| B-001 | `pipelineTemplate` field unused; update validator bug | parked |
| B-002 | `approvals` table exists but unused | parked |
| B-003–7 | (implied by numbering gaps) | ❓ Unklar |
| B-008 | Pagination for articles/clusters (>100 articles trigger) | parked |
| B-009 | Production deploy infrastructure | parked |
| B-010 | pgvector quality for internal linking | under-review |

---

## 13. Nächste empfohlene Schritte

### Was fertig und testbar ist
- **Gesamte Backend-Pipeline** (Specs 00–24, 40–44, 45/46): Alle Pipeline-Klassen, Adapter, DB-Schema und API-Endpoints sind vollständig implementiert.
- **Vollständige Web-App** (Specs 30–43): Alle Pages, Stores und Composables vorhanden. Inbox, Cost Dashboard, Activity Feed, Clusters, Articles Kanban, Cold-Start Wizard — alles fertig.
- **Multi-Language / Cornerstone-Specs** (Spec 45/46): Gerade implementiert, letzte 20 Commits betreffen hauptsächlich diesen Feature.
- **Stabilization** (Spec 42): Explizit als ✅ Complete markiert (2026-05-07).

### Code ohne Spec / Spec ohne Code
- **`socialPosts` Tabelle**: Schema vorhanden (`content.ts`), aber keine Pipeline, kein API-Endpoint, keine UI. Social-Media-Workflows sind nicht angedacht (kein Spec existiert).
- **`approvals` Tabelle** (B-002): Schema vorhanden, nie befüllt. Kein Spec außer Backlog.
- **`pipelineTemplate` enum** (B-001): DB-Feld vorhanden, aber kein Code liest es. Update-Validator hat Bug.
- **`briefings` Tabelle**: Vorhanden in Schema + `SMTP_BRIEFING` COST_OP existiert, aber kein Briefing-Pipeline-Step oder Endpoint erkennbar.
- **`article-scheduler.ts` Worker**: Vorhanden, aber kein Spec für automatisches Scheduling.

### Technische Schulden
- **Keine Pagination**: `/api/articles`, `/api/clusters` laden alle Datensätze ohne Limit (Backlog B-008). Kritisch ab ~100 Artikeln.
- **`pgvector` Qualität** (B-010): Internal-Linking-Pipeline nutzt `articles.embedding`, aber ob die Embeddings sinnvolle Ergebnisse liefern, ist nicht validiert.
- **`pipelineTemplate` Validator-Bug**: Spec-34-Update-Route validiert gegen falsche enum-Werte (`commercial`, `editorial` statt `affiliate_review`, `local_business`).
- **Kein Production-Deploy** (B-009): System läuft nur lokal. Kein HTTPS, keine Backups, kein Process-Supervisor.
- **DataForSEO standard mode nicht implementiert**: SERP standard-mode (Queued, 5-Min-Polling) ist explizit als MVP-Lücke dokumentiert.

### Logischer nächster Spec
Basierend auf dem Stand (alles bis Spec 46 implementiert) gibt es drei natürliche Kandidaten:

1. **Spec 46+: Zweiter Tenant Onboarding** — Bellemann (automotive) oder Balkonkraftwerk (affiliate) onboarden würde den `pipelineTemplate`-Bug erzwingen und die SaaS-Reife validieren.
2. **Stabilization/QA-Pass für Spec 43–46** — Die letzten 4 Specs (Inbox, Astro-Import, Multi-Language, PageSpeed-Dual-Mode) wurden schnell hintereinander implementiert; ein Review-Pass für Edge Cases und fehlende Test-Abdeckung wäre sinnvoll.
3. **Spec 47: Pagination + Performance** (Backlog B-008 aktivieren) — Wenn KI-Wissensraum die 50-Artikel-Grenze überschreitet, wird Pagination dringend.
