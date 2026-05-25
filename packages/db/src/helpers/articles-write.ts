import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import { articles } from "../schema/content.ts";

export async function markArticleRefreshed(articleId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(articles)
    .set({ lastRefreshedAt: now })
    .where(eq(articles.id, articleId));
}

/**
 * Spec 65.0 Day 6 — stamp the article with the template metadata that was
 * used for its most-recent social render. Marcel-Decision §8: "current
 * version always wins" — no historical preservation, the snapshot is for
 * audit + diagnostics ("what template did we last use for this article").
 *
 * `templateVersion` is typically the rendering template's current
 * `file_hash` from the `templates` table. Callers compute it via
 * `getTemplate({ projectId, templateKey })` and pass `.fileHash` here.
 *
 * Best-effort write: no FK on `articleId` (caller should pass a real one)
 * and silently no-ops if the article row doesn't exist (no rows updated).
 * Safe to call from a fire-and-forget context — re-renders happily
 * overwrite the snapshot.
 */
export async function markArticleTemplateSnapshot(opts: {
  articleId: string;
  templateKey: string;
  templateVersion: string;
}): Promise<void> {
  await db
    .update(articles)
    .set({
      templateKey: opts.templateKey,
      templateVersion: opts.templateVersion,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, opts.articleId));
}
