/**
 * Smoke test for article:refresh pipeline (Spec 54.10 Section B).
 * Triggers a refresh on a generated DE article and logs the job/run IDs.
 *
 * Usage:
 *   bun --env-file ../../.env src/scripts/smoke-refresh.ts <articleId>
 *   bun --env-file ../../.env src/scripts/smoke-refresh.ts d799b7bc-0bc0-4419-8e3d-5867b29679a6
 */

import { articles, articleVersions, db, eq, topicBriefs } from "@marketing-auto/db";
import { enqueuePipeline } from "@marketing-auto/pipelines";

const articleId = process.argv[2];
if (!articleId) {
  console.error("Usage: bun --env-file ../../.env src/scripts/smoke-refresh.ts <articleId>");
  process.exit(1);
}

console.log(`[smoke-refresh] Looking up article ${articleId}…`);

const [article] = await db
  .select({ id: articles.id, slug: articles.slug, source: articles.source, projectId: articles.projectId,
            locale: articles.locale, status: articles.status, title: articles.title,
            intentType: articles.intentType, clusterId: articles.clusterId,
            cornerstoneKeyword: articles.cornerstoneKeyword, metaDescription: articles.metaDescription })
  .from(articles)
  .where(eq(articles.id, articleId))
  .limit(1);

if (!article) { console.error("Article not found"); process.exit(1); }
if (article.source !== "generated") { console.error(`Article source=${article.source} — only 'generated' articles can be refreshed`); process.exit(1); }

console.log(`[smoke-refresh] Article: "${article.title}" (${article.locale}, ${article.status})`);

// Count existing versions before
const versionsBefore = await db
  .select({ id: articleVersions.id })
  .from(articleVersions)
  .where(eq(articleVersions.articleId, articleId));

console.log(`[smoke-refresh] Existing versions: ${versionsBefore.length}`);

// Insert refresh brief (same logic as the HTTP route)
const [brief] = await db
  .insert(topicBriefs)
  .values({
    projectId:      article.projectId,
    source:         "refresh_detection",
    topicTitle:     article.title ?? "",
    primaryKeyword: article.cornerstoneKeyword ?? "",
    locale:         article.locale ?? "de",
    intentType:     article.intentType,
    clusterId:      article.clusterId,
    clusterAction:  "refresh",
    suggestedTitle: article.title,
    suggestedSlug:  article.slug,
    suggestedMeta:  article.metaDescription,
    approvalStatus: "approved",
    approvedBy:     "user",
    refreshMetadata: {
      targetArticleId: article.id,
      reason: "smoke test",
      staleness: { daysSinceLastUpdate: 0, rankingChange: null, competitorRefreshed: false },
    },
  })
  .returning();

if (!brief) { console.error("Failed to create refresh brief"); process.exit(1); }
console.log(`[smoke-refresh] Brief created: ${brief.id}`);

// Enqueue directly (script bypasses preRunId — no pipeline_runs row needed for smoke test)
const { jobId } = await enqueuePipeline({
  pipelineName: "article:refresh",
  projectId:    article.projectId,
  input:        { articleId: article.id, projectId: article.projectId, briefId: brief.id },
  jobOptions:   { jobId: `article-refresh-${article.id}` },
});

console.log(`[smoke-refresh] ✅ Enqueued — jobId: ${jobId}`);
console.log(`[smoke-refresh] Watch: bun --filter @marketing-auto/api worker:dev`);
console.log(`[smoke-refresh] After completion, check: SELECT version_number, created_at FROM article_versions WHERE article_id='${articleId}' ORDER BY version_number;`);

process.exit(0);
