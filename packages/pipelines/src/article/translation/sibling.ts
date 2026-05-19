import { articles, db, type Article } from "@marketing-auto/db";
import { and, eq } from "@marketing-auto/db";

/**
 * Find the translation sibling of an article via translationKey.
 * Returns the opposite-locale sibling (DE→EN or EN→DE).
 * Returns null if the article has no translationKey or no sibling exists.
 *
 * Always scoped to projectId to prevent cross-tenant matches
 * (translationKey is not enforced unique at the DB level — CLAUDE.md convention).
 */
export async function findSibling(article: {
  id: string;
  projectId: string;
  locale: string | null;
  translationKey: string | null;
}): Promise<Article | null> {
  if (!article.translationKey) return null;

  const targetLocale = article.locale === "de" ? "en" : "de";

  const [sibling] = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, article.projectId),
        eq(articles.translationKey, article.translationKey),
        eq(articles.locale, targetLocale),
      ),
    )
    .limit(1);

  return sibling ?? null;
}

/** Backward-compatible alias for 54.10 callsites. */
export const findEnSibling = findSibling;
