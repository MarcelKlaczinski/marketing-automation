#!/usr/bin/env bun
import { enqueueArticleValidation } from "@marketing-auto/adapter-pagespeed";
import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: bun ... article:validate-pagespeed <article-slug>");
  process.exit(1);
}

const all = await db
  .select({ id: articles.id, projectId: articles.projectId, status: articles.status })
  .from(articles)
  .where(eq(articles.slug, slug));

if (all.length === 0) {
  console.error(`No article found with slug "${slug}"`);
  process.exit(1);
}

const article = all[0]!;

if (article.status !== "ready_to_publish" && article.status !== "blocked_by_pagespeed") {
  console.error(
    `Article status "${article.status}" — needs "ready_to_publish" or "blocked_by_pagespeed"`
  );
  process.exit(1);
}

const result = await enqueueArticleValidation({
  articleId: article.id,
  projectId: article.projectId,
});

console.log(`✅ PageSpeed validation enqueued
   Article ID: ${article.id}
   Run ID:     ${result.pagespeedRunId}
   Job ID:     ${result.jobId}

Pipeline runs ~2-5 min (clone + npm install + build + preview + lighthouse).
Check articles.pagespeed_scores and articles.status when complete.

Outcomes:
  - status = "published"            → all thresholds passed
  - status = "blocked_by_pagespeed" → see articles.pagespeed_failed_thresholds`);
process.exit(0);
