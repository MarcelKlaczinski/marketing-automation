import { eq } from "drizzle-orm";
import { db } from "../client.ts";
import { articles } from "../schema/content.ts";

export async function markArticleRefreshed(articleId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(articles)
    .set({ lastRefreshedAt: now })
    .where(eq(articles.id, articleId));
}
