#!/usr/bin/env bun
import { articles, db } from "@marketing-auto/db";
import { continueArticleGeneration } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";

const log = createLogger("cli:article-continue");

const cornerstone = process.argv[2];
if (!cornerstone) {
  console.error("Usage: bun ... article:continue <cornerstone-keyword>");
  process.exit(1);
}

const [article] = await db
  .select({ id: articles.id, projectId: articles.projectId, status: articles.status })
  .from(articles)
  .where(and(eq(articles.cornerstoneKeyword, cornerstone), eq(articles.status, "outline_review")))
  .limit(1);

if (!article) {
  console.error(`No article in "outline_review" state for cornerstone "${cornerstone}".`);
  console.error(`Check that Job 1 (article:generate) completed successfully.`);
  process.exit(1);
}

try {
  const result = await continueArticleGeneration({
    articleId: article.id,
    projectId: article.projectId,
  });

  console.log(`Continuation enqueued. Job ID: ${result.draftJobId}
Job 2 (draft + image + assembly) running in background. Check Drizzle Studio in ~5-8 min.`);

  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  log.error({ err: e, cornerstone }, "article:continue failed");
  console.error(`Error: ${msg}`);
  process.exit(1);
}
