import { articles, db, type Article } from "@marketing-auto/db";
import { and, eq } from "@marketing-auto/db";

/**
 * Find the EN sibling of a DE article via translationKey.
 * Returns null if the DE article has no translationKey or no EN sibling exists.
 *
 * Always scoped to projectId to prevent cross-tenant matches
 * (translationKey is not enforced unique at the DB level — CLAUDE.md convention).
 */
export async function findEnSibling(deArticle: {
  id: string;
  projectId: string;
  locale: string | null;
  translationKey: string | null;
}): Promise<Article | null> {
  if (deArticle.locale !== "de" || !deArticle.translationKey) {
    return null;
  }

  const [enArticle] = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, deArticle.projectId),
        eq(articles.translationKey, deArticle.translationKey),
        eq(articles.locale, "en"),
      ),
    )
    .limit(1);

  return enArticle ?? null;
}
