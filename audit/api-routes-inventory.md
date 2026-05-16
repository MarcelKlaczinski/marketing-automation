# API Routes Inventory

[Generated 2026-05-16]

## Section 1: Complete Route Inventory

Routes are listed with their full paths (prefix from `server.ts` + handler path). Auth levels: `none` = no middleware, `session` = `requireAuth` middleware applied (checked session cookie), `admin` = same as session (no separate admin role in current codebase — `requireAuth` is the only auth gate).

| Path | Method | Auth | Category | UI Surface | UI Presence | Input | Output | Project-Scoped | File |
|---|---|---|---|---|---|---|---|---|---|
| `/health` | GET | none | other | internal-only | no-ui | — | `{ ok, version, uptimeSec, timestamp }` | No | `routes/health.ts:7` |
| `/api/auth/login` | POST | none | auth | nav | current-ui | `{ email }` | `{ ok }` 202 | No | `routes/auth.ts:67` |
| `/api/auth/magic-link/request` | POST | none | auth | nav | current-ui | `{ email }` | `{ ok }` 202 | No | `routes/auth.ts:78` |
| `/api/auth/magic-link/verify` | POST | none | auth | nav | current-ui | `{ token }` | `{ ok, data: { user: { id, email } } }` | No | `routes/auth.ts:90` |
| `/api/auth/verify` | GET | none | auth | nav | current-ui | `?token=` (redirect flow) | 302 redirect | No | `routes/auth.ts:171` |
| `/api/auth/logout` | POST | none | auth | nav | current-ui | — | `{ ok }` | No | `routes/auth.ts:252` |
| `/api/auth/me` | GET | none | auth | nav | current-ui | — | `{ ok, data: { id, email } }` | No | `routes/auth.ts:267` |
| `/api/system/info` | GET | none | other | settings | partial-ui | — | `{ deploymentMode, apiVersion, nodeVersion }` | No | `routes/system.ts:36` |
| `/api/system/status` | GET | none | other | settings | current-ui | — | `{ initialized, postgres, redis, adapters }` | No | `routes/system.ts:52` |
| `/api/system/credentials` | POST | session | other | settings | current-ui | `{ service, key, value, metadata? }` | `{ ok }` | No | `routes/system.ts:82` |
| `/api/system/credentials/:service/:key` | DELETE | session | other | settings | partial-ui | — | `{ ok }` | No | `routes/system.ts:109` |
| `/api/system/credentials/:service` | DELETE | session | other | settings | partial-ui | — | `{ ok, data: { service } }` | No | `routes/system.ts:123` |
| `/api/system/verify/:adapter` | POST | session | other | settings | current-ui | — | `{ ok, data: { ok, message } }` | No | `routes/system.ts:140` |
| `/api/system/initialize` | POST | none | other | settings | current-ui | — | `{ ok }` | No | `routes/system.ts:172` |
| `/api/projects` | GET | session | project | project-selector | current-ui | — | `{ ok, data: [project+stats] }` | No | `routes/projects.ts:54` |
| `/api/projects/:slug` | GET | session | project | project-selector | current-ui | — | `{ ok, data: project+stats }` | Yes | `routes/projects.ts:80` |
| `/api/projects` | POST | session | project | settings | current-ui | `{ slug, name, industry, pipelineTemplate, marketingContextMd? }` | `{ ok, data: project }` 201 | No | `routes/projects.ts:131` |
| `/api/projects/:slug` | PATCH | session | project | settings | current-ui | `{ name?, domain?, industry?, pipelineTemplate?, marketingContextMd?, costLimits?, astroRepo?, pagespeedThresholds?, linkRebuildBudgetMonthly? }` | `{ ok, data: project }` | Yes | `routes/projects.ts:226` |
| `/api/projects/:slug/pause-state` | GET | session | project | dashboard | current-ui | — | `{ ok, data: pauseInfo }` | Yes | `routes/projects.ts:266` |
| `/api/projects/:slug/resume-queues` | POST | session | project | dashboard | current-ui | — | `{ ok, data: { resumed } }` | Yes | `routes/projects.ts:279` |
| `/api/projects/:slug/astro-import` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ forceAll? }` | `{ ok, data: { importRunId, jobId } }` 202 | Yes | `routes/projects.ts:299` |
| `/api/projects/:slug/astro-import-runs` | GET | session | pipeline-state | article-detail | current-ui | `?limit&offset` | `{ ok, data: { items, total, limit, offset } }` | Yes | `routes/projects.ts:359` |
| `/api/projects/:slug/astro-import/:importRunId/trigger-discovery` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ mode? }` | `{ ok, data: { enqueued, mode } }` 202 | Yes | `routes/projects.ts:398` |
| `/api/projects/:slug/detect-gaps` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: result }` | Yes | `routes/projects.ts:445` |
| `/api/projects/:slug/content-gaps` | GET | session | brief | briefs-list | current-ui | `?status&gapType&priority&limit&offset` | `{ ok, data: { items, total, limit, offset, gapsLastDetectedAt } }` | Yes | `routes/projects.ts:480` |
| `/api/projects/:slug/content-gaps/:id` | PATCH | session | brief | briefs-list | current-ui | `{ status }` | `{ ok, data: { id, status } }` | Yes | `routes/projects.ts:536` |
| `/api/projects/:slug/content-gaps/batch` | POST | session | brief | briefs-list | current-ui | `{ action, filters?, gapIds? }` | `{ ok, data: { affected } }` | Yes | `routes/projects.ts:609` |
| `/api/projects/:slug/content-gaps/:id/suggest` | POST | session | brief | brief-detail | current-ui | — | `{ ok, data: { suggestedTitle, suggestedSlug, suggestedMeta, primaryKeyword, secondaryKeywords, briefId, clusterUpdated, cached } }` | Yes | `routes/projects.ts:693` |
| `/api/projects/:slug/content-gaps/:id/generate` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { type, articleId/cornerstoneSpecId, runId?, jobId?, deduped?, gapStatus, briefId } }` | Yes | `routes/projects.ts:805` |
| `/api/projects/:slug/content-gaps/:id/automate` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { chainId, articleId, briefId, deduped } }` 202 | Yes | `routes/projects.ts:942` |
| `/api/projects/:slug/pipeline-chains` | GET | session | pipeline-state | pipeline-runs-list | current-ui | `?status&limit&offset` | `{ ok, data: { items, total, limit, offset } }` | Yes | `routes/projects.ts:1067` |
| `/api/projects/:slug/pipeline-chains/:chainId` | GET | session | pipeline-state | pipeline-run-detail | current-ui | — | `{ ok, data: chain }` | Yes | `routes/projects.ts:1101` |
| `/api/projects/:slug/pipeline-chains/:chainId/resume` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { chainId, resumedStep } }` 202 | Yes | `routes/projects.ts:1124` |
| `/api/projects/:slug/pipeline-chains/:chainId/cancel` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { chainId, status } }` | Yes | `routes/projects.ts:1156` |
| `/api/projects/:slug/cold-start/status` | GET | session | cold-start | cold-start-flow | current-ui | — | `{ ok, data: { voice, competitors, clusters, cornerstones, goLive } }` | Yes | `routes/cold-start.ts:36` |
| `/api/projects/:slug/cold-start/voice-refinement/questions` | POST | session | pipeline-trigger | cold-start-flow | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/cold-start.ts:207` |
| `/api/projects/:slug/cold-start/voice-refinement/synthesize` | POST | session | pipeline-trigger | cold-start-flow | current-ui | `{ answers: [{ questionIndex, answer }] }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/cold-start.ts:233` |
| `/api/projects/:slug/cold-start/competitor-analysis/questions` | POST | session | pipeline-trigger | cold-start-flow | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/cold-start.ts:257` |
| `/api/projects/:slug/cold-start/competitor-analysis/run` | POST | session | pipeline-trigger | cold-start-flow | current-ui | `{ competitors: [{ domain, why_relevant, expected_strengths }] }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/cold-start.ts:293` |
| `/api/projects/:slug/cold-start/cluster-plan` | POST | session | pipeline-trigger | cold-start-flow | current-ui | `{ contentGaps?, topicsToAvoid? }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/cold-start.ts:336` |
| `/api/projects/:slug/cold-start/cornerstones` | POST | session | pipeline-trigger | cold-start-flow | current-ui | `{ approvedClusters, locales }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/cold-start.ts:391` |
| `/api/projects/:slug/cold-start/cornerstones` | GET | session | cold-start | cold-start-flow | current-ui | — | `{ ok, data: [articles] }` (deprecated) | Yes | `routes/cold-start.ts:480` |
| `/api/projects/:slug/cold-start/cornerstones/:articleId/action` | POST | session | cold-start | cold-start-flow | current-ui | `{ action: "approve"\|"reject" }` (deprecated) | `{ ok, data: { articleId, newStatus } }` | Yes | `routes/cold-start.ts:428` |
| `/api/projects/:slug/cold-start/cornerstones/:articleId` | PATCH | session | cold-start | cold-start-flow | current-ui | `{ title?, cornerstoneKeyword?, metaDescription? }` (deprecated) | `{ ok, data: article }` | Yes | `routes/cold-start.ts:452` |
| `/api/projects/:slug/cold-start/go-live-checklist` | POST | session | pipeline-trigger | cold-start-flow | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/cold-start.ts:503` |
| `/api/projects/:slug/cornerstone-specs` | GET | session | cold-start | cold-start-flow | current-ui | `?clusterId&status` | `{ ok, data: { pairs, totalSpecs } }` | Yes | `routes/cornerstone-specs.ts:40` |
| `/api/projects/:slug/cornerstone-specs/:specId/approve` | POST | session | cold-start | cold-start-flow | current-ui | — | `{ ok, data: { id, status } }` | Yes | `routes/cornerstone-specs.ts:86` |
| `/api/projects/:slug/cornerstone-specs/pair/:translationKey/approve` | POST | session | cold-start | cold-start-flow | current-ui | — | `{ ok, data: { approvedCount, specs } }` | Yes | `routes/cornerstone-specs.ts:120` |
| `/api/projects/:slug/cornerstone-specs/:specId/reject` | POST | session | cold-start | cold-start-flow | current-ui | `{ reason? }` | `{ ok, data: { id, status } }` | Yes | `routes/cornerstone-specs.ts:152` |
| `/api/projects/:slug/clusters/:clusterId/generate-articles` | POST | session | pipeline-trigger | cluster-detail | current-ui | `{ approvalMode?, modelOverride? }` | `{ ok, data: { results } }` 202 | Yes | `routes/cornerstone-specs.ts:187` |
| `/api/clusters` | GET | session | cluster | clusters-list | current-ui | `?projectSlug&pillarId&limit&offset` | `{ ok, data: { items, total, limit, offset } }` | Yes (via query) | `routes/clusters.ts:19` |
| `/api/clusters` | POST | session | cluster | clusters-list | current-ui | `{ projectSlug, pillarId, name, primaryKeyword? }` | `{ ok, data: cluster }` 201 | Yes (via body) | `routes/clusters.ts:95` |
| `/api/clusters/:id` | PATCH | session | cluster | cluster-detail | current-ui | `{ name?, primaryKeyword?, pillarId? }` | `{ ok, data: cluster }` | Yes | `routes/clusters.ts:140` |
| `/api/clusters/:id` | DELETE | session | cluster | cluster-detail | current-ui | — | `{ ok, data: { id, articlesUncategorized } }` | Yes | `routes/clusters.ts:185` |
| `/api/clusters/:id/move` | POST | session | cluster | clusters-list | current-ui | `{ direction: "up"\|"down" }` | `{ ok, data: { changed } }` | Yes | `routes/clusters.ts:211` |
| `/api/clusters/:id/move-articles` | POST | session | cluster | cluster-detail | current-ui | `{ articleIds, toClusterId }` | `{ ok, data: { movedCount } }` | Yes | `routes/clusters.ts:269` |
| `/api/pillars` | GET | session | project | clusters-list | current-ui | `?projectSlug` | `{ ok, data: [pillar+clusterCount] }` | Yes (via query) | `routes/pillars.ts:12` |
| `/api/pillars` | POST | session | project | clusters-list | current-ui | `{ projectSlug, name, description? }` | `{ ok, data: pillar }` 201 | Yes (via body) | `routes/pillars.ts:48` |
| `/api/pillars/:id` | PATCH | session | project | clusters-list | current-ui | `{ name?, description? }` | `{ ok, data: pillar }` | Yes | `routes/pillars.ts:81` |
| `/api/pillars/:id` | DELETE | session | project | clusters-list | current-ui | — | `{ ok, data: { id } }` or 409 if has clusters | Yes | `routes/pillars.ts:109` |
| `/api/pillars/:id/move` | POST | session | project | clusters-list | current-ui | `{ direction: "up"\|"down" }` | `{ ok, data: { changed } }` | Yes | `routes/pillars.ts:138` |
| `/api/articles` | GET | session | article | articles-list | current-ui | `?projectSlug&lane&limit&offset` | `{ ok, data: { items, total, limit, offset } }` | Yes (via query) | `routes/articles.ts:356` |
| `/api/articles/across-projects` | GET | session | article | articles-list | current-ui | `?statuses&limit&offset` | `{ ok, data: { items, total, limit, offset } }` | No | `routes/articles.ts:414` |
| `/api/articles/imported/collections` | GET | session | article | articles-list | current-ui | `?projectSlug` | `{ ok, data: { [collection]: { de, en, total } } }` | Yes (via query) | `routes/articles.ts:464` |
| `/api/articles/imported` | GET | session | article | articles-list | current-ui | `?projectSlug&collection&limit&offset` | `{ ok, data: { items(pairs), total, limit, offset } }` | Yes (via query) | `routes/articles.ts:503` |
| `/api/articles/imported/:id` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { article, pendant } }` | Yes | `routes/articles.ts:590` |
| `/api/articles/pipeline-runs/fix-stuck` | POST | session | pipeline-state | internal-only | no-ui | — | `{ ok, data: { fixed } }` | No | `routes/articles.ts:623` |
| `/api/articles/:id/frontmatter` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { yaml, slug, extras, schema } }` | Yes | `routes/articles.ts:636` |
| `/api/articles/:id/frontmatter-extras` | PATCH | session | article | article-detail | current-ui | `{ extras: Record<string,unknown> }` | `{ ok, data: { saved } }` | Yes | `routes/articles.ts:709` |
| `/api/articles/:id/frontmatter-suggest` | POST | session | pipeline-trigger | article-detail | current-ui | — | `{ ok, data: suggestions }` | Yes | `routes/articles.ts:733` |
| `/api/articles/:id/local-preview` | POST | session | article | article-detail | current-ui | — | `{ ok, data: { url, slug, repoPath } }` | Yes | `routes/articles.ts:776` |
| `/api/articles/:id` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { article, cluster, pillar, recentRuns } }` | Yes | `routes/articles.ts:881` |
| `/api/articles/:id` | PATCH | session | article | article-detail | current-ui | `{ title?, metaDescription?, cornerstoneKeyword?, slug?, status? }` | `{ ok, data: article }` | Yes | `routes/articles.ts:1035` |
| `/api/articles/:id/body` | POST | session | article | article-detail | current-ui | `{ bodyMd, changeReason? }` | `{ ok, data: { version } }` | Yes | `routes/articles.ts:1072` |
| `/api/articles/:id/versions` | GET | session | article | article-detail | current-ui | — | `{ ok, data: [{ id, version, changeReason, createdAt }] }` | Yes | `routes/articles.ts:1108` |
| `/api/articles/:id/versions/:version` | GET | session | article | article-detail | current-ui | — | `{ ok, data: versionRow }` | Yes | `routes/articles.ts:1134` |
| `/api/articles/:id/refresh` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ reason? }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1159` |
| `/api/articles/:id/generate-outline` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1249` |
| `/api/articles/:id/generate-draft` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1270` |
| `/api/articles/:id/generate-hero-image` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ promptOverride? }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1295` |
| `/api/articles/:id/localize` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ targetLocale, mode? }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1331` |
| `/api/articles/:id/sync` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1454` |
| `/api/articles/:id/validate-pagespeed` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ mode?, urlOverride? }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1474` |
| `/api/articles/:id/extend-schema` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/articles.ts:1571` |
| `/api/articles/:articleId/continue` | POST | session | pipeline-trigger | triggered-action | no-ui | `{ modelOverride? }` | `{ ok, data: { draftJobId } }` 202 | Yes | `routes/articles.ts:1604` |
| `/api/projects/:projectSlug/articles/generate` | POST | session | pipeline-trigger | triggered-action | no-ui | `{ cornerstoneSlug, approvalMode?, modelOverride? }` | `{ ok, data: { articleId } }` 202 | Yes | `routes/articles.ts:1648` |
| `/api/pipeline-runs/active` | GET | session | pipeline-state | pipeline-runs-list | current-ui | `?projectId&since` | `{ ok, data: { entries, since, activeCount } }` | No (cross-project) | `routes/pipeline-runs.ts:115` |
| `/api/pipeline-runs/project/:projectId` | GET | session | pipeline-state | pipeline-runs-list | current-ui | `?pipelineNamePrefix&limit&offset` | `{ ok, data: { items, total, limit, offset } }` | Yes | `routes/pipeline-runs.ts:441` |
| `/api/pipeline-runs/:id/cancel` | PATCH | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok }` | Yes | `routes/pipeline-runs.ts:473` |
| `/api/pipeline-runs/:runId` | GET | session | pipeline-state | pipeline-run-detail | current-ui | — | `{ ok, data: { id, pipelineName, projectId, status, stepName, input, output, error, startedAt, completedAt, createdAt } }` | Yes | `routes/pipeline-runs.ts:496` |
| `/api/cost/aggregations` | GET | session | cost | cost-dashboard | current-ui | `?projectId` | `{ ok, data: { thisMonth, lastMonth, thisYear } }` | No | `routes/cost.ts:46` |
| `/api/cost/logs` | GET | session | cost | cost-dashboard | current-ui | `?projectId&service&operation&from&to&limit&offset` | `{ ok, data: { logs, total, limit, offset } }` | No | `routes/cost.ts:180` |
| `/api/cost/alerts` | GET | session | cost | cost-dashboard | current-ui | `?projectId&includeAcked` | `{ ok, data: [alerts] }` | No | `routes/cost.ts:235` |
| `/api/cost/alerts/:id/acknowledge` | POST | session | cost | cost-dashboard | current-ui | — | `{ ok, data: { id } }` | Yes | `routes/cost.ts:264` |
| `/api/notifications` | GET | session | other | nav | current-ui | `?unreadOnly&since&limit&offset` | `{ ok, data: { notifications, unreadCount, total, limit, offset } }` | No | `routes/notifications.ts:23` |
| `/api/notifications/unread-count` | GET | session | other | nav | current-ui | — | `{ ok, data: { count } }` | No | `routes/notifications.ts:45` |
| `/api/notifications/mark-read` | POST | session | other | nav | current-ui | `{ ids: [uuid] }` | `{ ok, data: { updated } }` | No | `routes/notifications.ts:55` |
| `/api/notifications/mark-all-read` | POST | session | other | nav | current-ui | — | `{ ok, data: { updated } }` | No | `routes/notifications.ts:62` |
| `/api/notifications/stream` | GET | session | other | nav | current-ui | — | SSE stream (`connected`, `notification`, `heartbeat` events) | No | `routes/notifications.ts:68` |
| `/api/push/vapid-public-key` | GET | session | other | settings | current-ui | — | `{ ok, data: { publicKey } }` | No | `routes/push-subscriptions.ts:13` |
| `/api/push/subscriptions` | GET | session | other | settings | current-ui | — | `{ ok, data: [{ id, endpoint, userAgent, createdAt, lastUsedAt }] }` | No | `routes/push-subscriptions.ts:19` |
| `/api/push/subscriptions` | POST | session | other | settings | current-ui | `{ endpoint, keys: { p256dh, auth }, userAgent? }` | `{ ok, data: { id, updated } }` 201 | No | `routes/push-subscriptions.ts:44` |
| `/api/push/subscriptions/:id` | DELETE | session | other | settings | partial-ui | — | `{ ok, data: { id } }` | No | `routes/push-subscriptions.ts:87` |
| `/api/push/test` | POST | session | other | settings | partial-ui | — | `{ ok, data: { sent } }` | No | `routes/push-subscriptions.ts:102` |
| `/api/admin/prune-notifications` | POST | session | admin | internal-only | no-ui | — | `{ ok, data: result }` | No | `routes/admin.ts:155` |
| `/api/admin/notification-counts` | GET | session | admin | nav | current-ui | `?projectId` | `{ ok, data: { pendingSuggestions } }` | No | `routes/admin.ts:165` |
| `/api/admin/templates` | GET | session | admin | internal-only | current-ui | — | `{ ok, data: { templates } }` | No | `routes/admin.ts:201` |
| `/api/admin/templates/:key/preview` | POST | session | admin | internal-only | current-ui | `{ source, fixtureKey?, sampleArticleId?, theme, locale, force?, projectId? }` | `{ ok, data: { slides, caption, hashtags, metadata, cacheKey, fromCache } }` | No | `routes/admin.ts:237` |
| `/api/admin/templates/:key/eligible-articles` | GET | session | admin | internal-only | current-ui | `?locale&limit&projectId` | `{ ok, data: { articles } }` | No | `routes/admin.ts:462` |
| `/api/articles/:articleId/social-posts/generate` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ format?, theme?, variant? }` | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/social-posts.ts:30` |
| `/api/articles/:articleId/social-posts` | GET | session | article | article-detail | current-ui | — | `{ ok, data: [socialPost] }` | Yes | `routes/social-posts.ts:72` |
| `/api/articles/:articleId/template-suggestions` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { suggestions, renders } }` | Yes | `routes/social-posts.ts:421` |
| `/api/articles/:articleId/all-templates` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { templates } }` | Yes | `routes/social-posts.ts:448` |
| `/api/articles/:articleId/generate-templates` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ templateKeys, locale?, theme? }` | `{ ok, data: { jobs } }` 202 | Yes | `routes/social-posts.ts:528` |
| `/api/articles/:articleId/template-renders` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { renders } }` | Yes | `routes/social-posts.ts:671` |
| `/api/social-posts/:id` | GET | session | article | article-detail | current-ui | — | `{ ok, data: socialPost }` | Yes | `routes/social-posts.ts:89` |
| `/api/social-posts/:id/download-bundle` | GET | session | article | triggered-action | current-ui | — | ZIP binary response | Yes | `routes/social-posts.ts:105` |
| `/api/social-posts/:id/re-render` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { runId, jobId } }` 202 | Yes | `routes/social-posts.ts:180` |
| `/api/template-renders/:id/download` | GET | session | article | triggered-action | current-ui | — | ZIP binary response | Yes | `routes/social-posts.ts:721` |
| `/api/projects/:slug/social-posts` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { items } }` (admin list) | Yes | `routes/social-posts.ts:238` |
| `/api/projects/:slug/social-posts/re-render-batch` | POST | session | pipeline-trigger | triggered-action | partial-ui | `{ socialPostIds?, filter? }` | `{ ok, data: { triggered, estimatedCostEur } }` | Yes | `routes/social-posts.ts:266` |
| `/api/projects/:slug/social-suggestions` | GET | session | article | article-detail | current-ui | — | `{ ok, data: { items } }` | Yes | `routes/social-posts.ts:350` |
| `/api/projects/:slug/brand-assets` | GET | session | project | settings | current-ui | `?assetType&source` | `{ ok, data: { assets, summary } }` | Yes | `routes/brand-assets.ts:42` |
| `/api/projects/:slug/brand-assets/upload` | POST | session | project | settings | current-ui | multipart: `file, assetType, assetKey, displayName?` | `{ ok, data: { asset, previewUrl } }` | Yes | `routes/brand-assets.ts:84` |
| `/api/projects/:slug/brand-assets/:assetId` | DELETE | session | project | settings | current-ui | — | `{ ok, data: { deleted, willResolve } }` | Yes | `routes/brand-assets.ts:160` |
| `/api/projects/:slug/brand-assets/:assetId/reset` | POST | session | project | settings | current-ui | — | `{ ok, data: { newAsset } }` | Yes | `routes/brand-assets.ts:195` |
| `/api/projects/:slug/brand-tokens` | GET | session | project | settings | current-ui | — | `{ ok, data: { tokens, defaults } }` | Yes | `routes/brand-tokens.ts:26` |
| `/api/projects/:slug/brand-tokens` | PATCH | session | project | settings | current-ui | `{ tokens: { colors?, typography?, voice?, social? } }` | `{ ok, data: { tokens } }` | Yes | `routes/brand-tokens.ts:47` |
| `/api/projects/:slug/brand-tokens/reset` | POST | session | project | settings | current-ui | `{ sections? }` | `{ ok, data: { tokens } }` | Yes | `routes/brand-tokens.ts:96` |
| `/api/projects/:slug/trends/pending-briefs` | GET | session | brief | briefs-list | current-ui | — | `{ ok, data: { briefs } }` | Yes | `routes/trends.ts:57` |
| `/api/projects/:slug/trends/rejected-topics` | GET | session | brief | briefs-list | current-ui | `?reason` | `{ ok, data: { rejected } }` | Yes | `routes/trends.ts:91` |
| `/api/projects/:slug/trends/signal-pool` | GET | session | brief | briefs-list | current-ui | `?source&from&to&processed&limit&offset` | `{ ok, data: { items, total, limit, offset } }` | Yes | `routes/trends.ts:130` |
| `/api/projects/:slug/trends/briefs/:briefId/approve` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ mode? }` | `{ ok, data: { articleId, runId, jobId, deduped, briefId } }` 202 | Yes | `routes/trends.ts:187` |
| `/api/projects/:slug/trends/briefs/:briefId/dismiss` | POST | session | brief | triggered-action | current-ui | — | `{ ok, data: { briefId } }` | Yes | `routes/trends.ts:285` |
| `/api/projects/:slug/trends/briefs/:briefId/edit` | POST | session | brief | brief-detail | current-ui | `{ suggestedTitle?, suggestedMeta?, suggestedSlug? }` | `{ ok, data: { briefId } }` | Yes | `routes/trends.ts:354` |
| `/api/projects/:slug/trends/synthesize` | POST | session | pipeline-trigger | triggered-action | current-ui | — | `{ ok, data: { jobId, deduped } }` 202 | Yes | `routes/trends.ts:406` |
| `/api/projects/:slug/trends/synthesis-status` | GET | session | pipeline-state | dashboard | current-ui | — | `{ ok, data: { status, jobId } }` | Yes | `routes/trends.ts:435` |
| `/api/projects/:slug/clusters/propose` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ fromBriefId }` | `{ ok, data: { proposal, projectDefaultIntents } }` | Yes | `routes/projects/clusters.ts:53` |
| `/api/projects/:slug/clusters/create-from-brief` | POST | session | pipeline-trigger | triggered-action | current-ui | `{ fromBriefId, proposal, generateMode? }` | `{ ok, data: { clusterId, pillarId, cornerstoneSpecId, articleId, briefStatus, runId?, jobId?, deduped? } }` 202 | Yes | `routes/projects/clusters.ts:104` |

**Total routes: 127**

---

## Section 2: Route → UI Surface Mapping

### Narrative

**nav**: Auth, session management (`/api/auth/*`), notifications (`/api/notifications/*`) feed the top navbar.

**project-selector**: `GET /api/projects` and `GET /api/projects/:slug` power the project picker dropdown and project header.

**dashboard**: `GET /api/projects/:slug/pause-state`, `GET /api/projects/:slug/trends/synthesis-status`, and `GET /api/pipeline-runs/active` are all polled by the dashboard/inbox view.

**cold-start-flow**: All `/api/projects/:slug/cold-start/*` and cornerstone-spec routes exclusively drive the 5-phase Cold-Start wizard (`ColdStartPage`).

**clusters-list / cluster-detail**: Pillar and cluster CRUD routes plus `POST /api/clusters/:id/move-articles`.

**articles-list / article-detail**: Article list, detail, pipeline trigger actions (generate-outline, generate-draft, localize, sync, validate-pagespeed, extend-schema, refresh) and all article body/frontmatter/version endpoints.

**briefs-list / brief-detail**: Content gaps, topic briefs, and trend discovery endpoints under `/:slug/content-gaps/*` and `/:slug/trends/*`.

**pipeline-runs-list / pipeline-run-detail**: `GET /api/pipeline-runs/active`, `GET /api/pipeline-runs/project/:projectId`, `GET /api/pipeline-runs/:runId`, chain list/detail endpoints.

**cost-dashboard**: All `/api/cost/*` routes.

**settings**: System installer, credential management, brand assets, brand tokens, push subscription configuration, project PATCH.

**triggered-action**: All pipeline-trigger POSTs that a user initiates by clicking a button — returns a job/run ID and is polled via the activity feed or Web Push. Download endpoints (ZIP bundles) also treated as triggered-actions.

**internal-only**: Health check, admin prune-notifications, fix-stuck-runs. Template gallery admin routes are technically current-ui but scoped to admin users.

### Additional Notes

- The `GET /api/notifications/stream` route is the only **SSE** (Server-Sent Events) real-time channel. It provides per-user notification updates (not pipeline events directly).
- The activity feed (`GET /api/pipeline-runs/active`) is a polling endpoint that aggregates from 5 different run tables (`pipeline_runs`, `astro_sync_runs`, `pagespeed_runs`, `schema_extension_runs`, `link_rebuild_runs`), normalized into `ActivityEntry` objects.
- Three deprecated cold-start routes remain in `routes/cold-start.ts` (marked `@deprecated Spec 48`) and still work but should be removed.

---

## Section 3: Missing Routes for Spec 54.11

### 3.1 Live Activity Feed — `GET /api/pipeline-runs?status=...&projectId=...&since=...&limit=...`

**EXISTS** (with a different path and shape).

`GET /api/pipeline-runs/active?projectId=&since=` at `apps/api/src/routes/pipeline-runs.ts:115`

The route returns a unified `{ entries, since, activeCount }` envelope aggregating all run types. It does NOT use offset/limit pagination (returns all matching entries). It does NOT accept a `status` filter — it uses a fixed rule: queued/running always included, terminal states included if `createdAt >= since` (default: last 24h).

Gap vs. requested: no `status` filter, no `limit` — if the volume of completed runs in a 24h window is large, the response can be large. A proper paginated endpoint with `status` filter is missing.

### 3.2 Pipeline Run Detail with Steps+Costs — `GET /api/pipeline-runs/:id`

**EXISTS** (partial).

`GET /api/pipeline-runs/:runId` at `apps/api/src/routes/pipeline-runs.ts:496`

Returns: `{ id, pipelineName, projectId, status, stepName, input, output, error, startedAt, completedAt, createdAt }`.

**Missing**: does not return child step rows (sub-runs with `parentRunId = id`) or `cost_logs` entries linked to this run. The `GET /api/articles/:id` endpoint returns some pipeline run data as `recentRuns.pipeline` (5 runs, no step breakdown or cost).

### 3.3 Retry Failed Run — `POST /api/pipeline-runs/:id/retry`

**MISSING**

No retry endpoint exists. Current workaround: re-trigger the pipeline via the article's action endpoints (e.g. `POST /api/articles/:id/generate-outline`).

Proposed signature: `POST /api/pipeline-runs/:id/retry` → `{ ok, data: { newRunId, jobId } }` 202

### 3.4 Cancel Running Pipeline — `POST /api/pipeline-runs/:id/cancel`

**EXISTS** (with different method).

`PATCH /api/pipeline-runs/:id/cancel` at `apps/api/src/routes/pipeline-runs.ts:473`

Uses PATCH not POST. Sets `status = 'cancelled'` in DB; does NOT signal BullMQ to abort the worker job mid-execution (the worker will complete its current step then find the run cancelled).

### 3.5 Cluster Generation Status — `GET /api/projects/:slug/clusters/:id/generation-status`

**MISSING**

No per-cluster generation status endpoint exists. The closest is `GET /api/clusters?projectSlug=` which includes `articleCount` and `cornerstoneCount` per cluster, but no active pipeline run state.

Proposed signature: `GET /api/projects/:slug/clusters/:id/generation-status` → `{ ok, data: { clusterId, totalSpecs, generating, done, failed, runs: [{ id, status, specId }] } }`

### 3.6 Search Across Articles+Briefs+Clusters — `GET /api/projects/:slug/search?q=...`

**MISSING**

No cross-entity search endpoint. Individual list endpoints (`/api/articles`, `/api/clusters`) accept filter params but not a free-text `q` query against titles/keywords.

Proposed signature: `GET /api/projects/:slug/search?q=&types=articles,clusters,briefs&limit=20` → `{ ok, data: { articles: [], clusters: [], briefs: [] } }`

### 3.7 Bulk Actions — `POST /api/projects/:slug/briefs/bulk-approve`, `POST /api/pipeline-runs/bulk-retry`

**PARTIALLY EXISTS**

- `POST /api/projects/:slug/content-gaps/batch` at `routes/projects.ts:609` — supports `action: "dismiss"` and `action: "suggest-all"` for content gaps. Does NOT support `approve`.
- `POST /api/projects/:slug/social-posts/re-render-batch` exists for social posts.
- **Missing**: no bulk-approve for topic briefs, no bulk-retry for pipeline runs.

Proposed: `POST /api/projects/:slug/briefs/bulk-approve` + `POST /api/pipeline-runs/bulk-retry`

### 3.8 Real-Time Updates — WebSocket or SSE Endpoint

**PARTIALLY EXISTS**

`GET /api/notifications/stream` at `routes/notifications.ts:68` — SSE endpoint delivering per-user app notifications (not raw pipeline events). Pipeline state updates arrive via Web Push (BullMQ job completion → `createNotification()` → push subscriber).

There is no WebSocket or SSE endpoint that streams pipeline run state changes in real-time. UI relies on polling `GET /api/pipeline-runs/active`.

**Missing**: A dedicated SSE or WebSocket endpoint for pipeline run events (`pipeline:started`, `pipeline:step-updated`, `pipeline:completed`, `pipeline:failed`).

### 3.9 Cost Summary with Time Windows — `GET /api/projects/:slug/cost-summary?window=today|week|month`

**PARTIALLY EXISTS**

`GET /api/cost/aggregations?projectId=` at `routes/cost.ts:46` — returns `thisMonth`, `lastMonth`, `thisYear` breakdowns globally or per project. No project-slug-based routing, no `today` or `week` windows, no per-pipeline breakdowns.

**Missing**: a project-scoped endpoint with flexible time window selection:
`GET /api/projects/:slug/cost-summary?window=today|week|month` → `{ ok, data: { window, totalEur, byService, byOperation, trend } }`

### 3.10 Project Picker with Activity — `GET /api/projects/picker`

**MISSING** (as a dedicated endpoint)

`GET /api/projects` at `routes/projects.ts:54` returns all projects with `stats` (clusterCount, articleCounts, totalArticles) but does NOT include `runningCount` (active pipeline runs) or `costThisMonth`.

Proposed signature: `GET /api/projects/picker` → `{ ok, data: [{ id, slug, name, industry, totalArticles, runningCount, costThisMonthEur }] }` — lightweight, no JOIN overhead from stats.

---

## Section 4: Summary

### Route Counts by Category

| Category | Count |
|---|---|
| article | 30 |
| pipeline-trigger | 29 |
| project | 15 |
| pipeline-state | 7 |
| cold-start | 11 |
| brief | 9 |
| cluster | 8 |
| auth | 7 |
| cost | 4 |
| other | 7 |
| admin | 3 |
| **Total** | **130** |

*(Note: some routes counted in both article and pipeline-trigger categories — totals reflect primary category.)*

### Route Counts by UI Presence

| UI Presence | Count |
|---|---|
| current-ui | 107 |
| partial-ui | 7 |
| no-ui | 3 |
| **Total** | **117** |

### Missing Routes Summary

| # | Missing Route | Priority |
|---|---|---|
| 3.3 | `POST /api/pipeline-runs/:id/retry` | High |
| 3.5 | `GET /api/projects/:slug/clusters/:id/generation-status` | Medium |
| 3.6 | `GET /api/projects/:slug/search?q=` | Medium |
| 3.7a | `POST /api/projects/:slug/briefs/bulk-approve` | Low |
| 3.7b | `POST /api/pipeline-runs/bulk-retry` | Low |
| 3.8 | Pipeline SSE/WebSocket endpoint | High |
| 3.9 | `GET /api/projects/:slug/cost-summary?window=...` | Medium |
| 3.10 | `GET /api/projects/picker` (with runningCount+costThisMonth) | Medium |

---

## Section 5: Open Questions

### 1. Project-Scoping Consistency

Most data is project-scoped via slug in the URL path (`/api/projects/:slug/...`). However, several routes use `projectSlug` as a **query parameter** instead (`GET /api/articles?projectSlug=`, `GET /api/clusters?projectSlug=`, `GET /api/pillars?projectSlug=`), and cost/notification routes use `projectId` (UUID) not slug. This creates three different scoping patterns and complicates caching and authorization middleware:

- Path param (slug): `/api/projects/:slug/content-gaps`
- Query param (slug): `/api/articles?projectSlug=foo`
- Query param (UUID): `/api/cost/aggregations?projectId=uuid`

**Recommendation**: standardize resource endpoints under `/api/projects/:slug/articles`, `/api/projects/:slug/clusters`, etc. for path-param scoping.

### 2. Auth Level Inconsistency

`GET /api/auth/me`, `GET /api/system/info`, `GET /api/system/status`, and `POST /api/system/initialize` are publicly accessible (no `requireAuth`). This is intentional (installer flow requires pre-auth status checks). However, `POST /api/auth/logout` is also public (no auth required) — this is safe since it only deletes the session referenced by the cookie, but it means any token could be tried.

All other routes require `requireAuth`. There is no **admin-only** role gate in the codebase — `adminRoutes` uses the same `requireAuth` as all other routes. All users with a valid session can call `/api/admin/*`.

### 3. Pagination Patterns

Two offset-based pagination patterns are in use:

- `paginationQuerySchema` (from `lib/pagination.ts`): `limit` + `offset`, returning `{ items, total, limit, offset }`. Used consistently on most list endpoints.
- The activity feed (`GET /api/pipeline-runs/active`) returns a flat array with no pagination — potentially unbounded for projects with high throughput.
- `GET /api/projects/:slug/social-posts` has a hardcoded `LIMIT 200` (not paginated).

There is **no cursor-based pagination** anywhere in the API.

### 4. Error Response Shape Consistency

The `{ ok: false, error: string }` shape is consistently returned. Some endpoints add a `data` field alongside `error` (e.g. cost limit responses: `{ ok: false, error: "project_paused", data: pauseInfo }`). Some validation errors add `details` (Zod flatten output). Overall consistent.

HTTP status codes used:
- 200 deduped runs (idempotent pipeline triggers)
- 202 new async operations
- 201 resource creation
- 400 validation errors
- 402 cost limit exceeded
- 404 not found
- 409 conflict (duplicate slug, already-cancelled run, localization in progress)
- 422 unprocessable entity (invalid state transitions)
- 423 project paused
- 429 pagespeed cooldown
- 503 VAPID not configured

### 5. OpenAPI / Swagger Documentation

**None**. No OpenAPI spec, no Swagger UI, no JSDoc-based schema generation. Route validation is done purely via Zod with `@hono/zod-validator`. The only machine-readable API contract is the source code itself.

### 6. Deprecated Routes Still Active

Three deprecated endpoints remain in `routes/cold-start.ts` (Spec 48 replacements):

- `GET /api/projects/:slug/cold-start/cornerstones` (deprecated: use `/cornerstone-specs`)
- `POST /api/projects/:slug/cold-start/cornerstones/:articleId/action` (deprecated)
- `PATCH /api/projects/:slug/cold-start/cornerstones/:articleId` (deprecated)

These operate on the old `articles` table (pre-Spec-48 model) and should be removed once the frontend no longer references them.

### 7. The `GET /api/pipeline-runs/:runId` Response Gap

The run detail endpoint returns the top-level run row only. There is no way to fetch child step rows (`pipeline_runs WHERE parentRunId = :id`) or associated `cost_logs` via a single API call. The article detail endpoint (`GET /api/articles/:id`) returns up to 5 recent pipeline runs as a sidebar but no cost breakdown. A proper `GET /api/pipeline-runs/:id` enriched with steps and cost_logs is needed for a pipeline run detail page.
