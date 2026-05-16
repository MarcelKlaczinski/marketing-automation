import { articles, db } from "@marketing-auto/db";
import { and, desc, eq, isNotNull, ne, sql } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pipelines:voice-reference");

export interface VoiceReference {
  articleId: string;
  title: string;
  bodyMdExcerpt: string;  // first 1500 chars
  intentType: string | null;
  selfReviewScore: number | null;
}

/**
 * Load up to `limit` published articles from the same cluster + locale to use as
 * voice-style references in Refresh and Translation prompts.
 *
 * Strategy: same cluster + locale, ranked by selfReviewScore DESC, createdAt DESC.
 * Falls back to project-wide if the cluster yields fewer than `limit` results.
 */
export async function loadVoiceReferences(input: {
  projectId: string;
  clusterId: string | null;
  locale: "de" | "en";
  excludeArticleId: string | null;
  limit?: number;
}): Promise<VoiceReference[]> {
  const limit = input.limit ?? 3;

  const rows = await queryVoiceRefs(input, limit);

  // Fallback: if cluster-scoped query returned too few, try project-wide
  if (rows.length < limit && input.clusterId) {
    log.debug(
      { projectId: input.projectId, clusterId: input.clusterId, locale: input.locale, found: rows.length },
      "Voice reference cluster fallback to project-wide",
    );
    return queryVoiceRefs({ ...input, clusterId: null }, limit);
  }

  return rows;
}

async function queryVoiceRefs(
  input: { projectId: string; clusterId: string | null; locale: string; excludeArticleId: string | null },
  limit: number,
): Promise<VoiceReference[]> {
  const conditions = [
    eq(articles.projectId, input.projectId),
    eq(articles.collection, "blog"),
    eq(articles.locale, input.locale),
    isNotNull(articles.bodyMd),
    ne(articles.bodyMd, ""),
  ];

  if (input.clusterId) {
    conditions.push(eq(articles.clusterId, input.clusterId));
  }

  if (input.excludeArticleId) {
    conditions.push(ne(articles.id, input.excludeArticleId));
  }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      bodyMd: articles.bodyMd,
      intentType: articles.intentType,
      selfReviewScore: articles.selfReviewScore,
    })
    .from(articles)
    .where(and(...conditions))
    .orderBy(desc(sql`COALESCE(${articles.selfReviewScore}, 0)`), desc(articles.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    articleId: r.id,
    title: r.title ?? "",
    bodyMdExcerpt: r.bodyMd?.substring(0, 1500) ?? "",
    intentType: r.intentType,
    selfReviewScore: r.selfReviewScore,
  }));
}

/**
 * Format voice references for injection into an LLM prompt.
 * Returns an empty string if no references are available.
 */
export function formatVoiceReferences(refs: VoiceReference[]): string {
  if (refs.length === 0) return "";

  const formatted = refs
    .map(
      (r, i) =>
        `--- Voice Reference ${i + 1}: "${r.title}" ---\n${r.bodyMdExcerpt}${r.bodyMdExcerpt.length >= 1500 ? "\n[...excerpt truncated]" : ""}`,
    )
    .join("\n\n");

  return `# Voice Style References\nThe following excerpts from published articles in this cluster demonstrate the target voice and style:\n\n${formatted}`;
}
