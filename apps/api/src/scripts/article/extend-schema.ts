#!/usr/bin/env bun
import { articles, db } from "@marketing-auto/db";
import { enqueueSchemaExtension } from "@marketing-auto/pipelines";
import { eq } from "drizzle-orm";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: bun --filter @marketing-auto/api article:extend-schema <article-slug>");
  process.exit(1);
}

const all = await db
  .select({
    id: articles.id,
    projectId: articles.projectId,
    status: articles.status,
  })
  .from(articles)
  .where(eq(articles.slug, slug));

if (all.length === 0) {
  console.error(`No article found with slug "${slug}"`);
  process.exit(1);
}

const article = all[0]!;

const result = await enqueueSchemaExtension({
  articleId: article.id,
  projectId: article.projectId,
});

console.log(`Schema extension enqueued
   Article ID: ${article.id}
   Job ID:     ${result.jobId}

Pipeline will detect FAQ/HowTo content and add Schema.org rich types.
Cost: ~EUR 0.05 (Anthropic detection call).`);
process.exit(0);
