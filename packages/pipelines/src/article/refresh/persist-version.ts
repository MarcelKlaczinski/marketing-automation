import { articleVersions, db, type Article } from "@marketing-auto/db";
import { desc, eq } from "@marketing-auto/db";

/**
 * Persist the current article body to article_versions BEFORE regeneration.
 *
 * Defensive ordering: if the refresh pipeline fails mid-way, the original body
 * is already preserved. Worst case is a phantom version row — better than
 * mid-write corruption of the live article.
 *
 * Returns the version number that was created.
 */
export async function persistVersion(article: Pick<Article, "id" | "bodyMd">): Promise<number> {
  // Find the latest version number for this article
  const latest = await db
    .select({ version: articleVersions.version })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, article.id))
    .orderBy(desc(articleVersions.version))
    .limit(1);

  const nextVersion = (latest[0]?.version ?? 0) + 1;

  await db.insert(articleVersions).values({
    articleId: article.id,
    version: nextVersion,
    bodyMd: article.bodyMd ?? "",
    changeReason: "refresh",
  });

  return nextVersion;
}
