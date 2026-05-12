#!/usr/bin/env bun
import { enqueueArticleSync } from "@marketing-auto/adapter-astro-sync";
import { articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: bun ... article:sync <article-slug>");
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
if (all.length > 1) {
  console.error(`Multiple articles share slug "${slug}". Specify a project.`);
  process.exit(1);
}

const article = all[0]!;

if (article.status !== "final_review" && article.status !== "ready_to_publish") {
  console.error(
    `Article status is "${article.status}". Sync requires "final_review" or "ready_to_publish".`
  );
  process.exit(1);
}

const result = await enqueueArticleSync({
  articleId: article.id,
  projectId: article.projectId,
});

console.log(`✅ Astro sync enqueued
   Article ID:   ${article.id}
   Sync run ID:  ${result.syncRunId}
   Job ID:       ${result.jobId}

Pipeline will commit to the Astro repo's main branch in ~10-30 seconds.
Check astroSyncRuns table or articles.astro_commit_sha for completion.`);

process.exit(0);
