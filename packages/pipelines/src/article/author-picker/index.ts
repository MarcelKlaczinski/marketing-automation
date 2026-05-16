import { articles, and, db, eq } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import type { TopicBrief } from "@marketing-auto/db";
import { historicAuthorScore } from "./historic.ts";
import { embeddingAuthorMatch } from "./embedding.ts";
import type { AuthorPickResult } from "./types.ts";

export type { AuthorPickResult } from "./types.ts";

const log = createLogger("pipelines:author-picker");

// Default fallback author when no historic or embedding signal is available.
// Based on highest blog post count in Spec 54.9 audit of toolwiki imported articles.
const DEFAULT_AUTHOR_SLUG = "anna-weidner";

async function resolveAuthorName(
  projectId: string,
  slug: string,
  locale: "de" | "en",
): Promise<string> {
  const rows = await db
    .select({ title: articles.title, frontmatterExtras: articles.frontmatterExtras })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "authors"),
        eq(articles.slug, slug),
        eq(articles.locale, locale),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return slug;

  const extras = (row.frontmatterExtras ?? {}) as Record<string, unknown>;
  return row.title ?? String(extras.name ?? slug);
}

/**
 * Pick the best author for a blog article based on historical pattern matching
 * with embedding fallback and hardcoded default.
 *
 * Strategy 1: Historic SQL score — authors who've written to the same cluster/intent.
 * Strategy 2: Voyage embedding match against author expertise profiles.
 * Strategy 3: Default fallback (anna-weidner) with warning logged.
 *
 * No LLM call is made — pure SQL + optional embedding.
 */
export async function pickAuthor(
  projectId: string,
  brief: TopicBrief,
  pipelineRunId?: string,
): Promise<AuthorPickResult> {
  const localeRaw = brief.locale;
  const locale: "de" | "en" =
    localeRaw === "de" || localeRaw === "en" ? localeRaw : "de";

  // ── Strategy 1: Historic SQL score ────────────────────────────────────────────
  const historicRows = await historicAuthorScore(
    projectId,
    brief.clusterId ?? null,
    brief.intentType ?? null,
    locale,
  );

  const topHistoric = historicRows[0];
  if (topHistoric && topHistoric.matchedOnCluster + topHistoric.matchedOnIntent >= 1) {
    const authorName = await resolveAuthorName(projectId, topHistoric.slug, locale);
    log.info(
      { authorSlug: topHistoric.slug, score: topHistoric.score, projectId },
      "[author-picker] historic match"
    );
    return {
      authorSlug: topHistoric.slug,
      authorName,
      matchStrategy: "historic_score",
      matchScore: topHistoric.score,
      candidates: historicRows.map((r) => ({
        slug: r.slug,
        name: r.slug,
        score: r.score,
        reasoning: `cluster_hits=${r.matchedOnCluster} intent_hits=${r.matchedOnIntent} total=${r.totalPosts}`,
      })),
    };
  }

  // ── Strategy 2: Voyage embedding fallback ─────────────────────────────────────
  const embeddingMatch = await embeddingAuthorMatch(
    projectId,
    brief,
    locale,
    pipelineRunId,
  );

  if (embeddingMatch) {
    log.info(
      { authorSlug: embeddingMatch.slug, score: embeddingMatch.score, projectId },
      "[author-picker] embedding fallback match"
    );
    return {
      authorSlug: embeddingMatch.slug,
      authorName: embeddingMatch.name,
      matchStrategy: "embedding_fallback",
      matchScore: embeddingMatch.score,
      candidates: [
        {
          slug: embeddingMatch.slug,
          name: embeddingMatch.name,
          score: embeddingMatch.score,
          reasoning: "cosine similarity against expertise embedding",
        },
      ],
    };
  }

  // ── Strategy 3: Default fallback ──────────────────────────────────────────────
  log.warn(
    { projectId, briefId: brief.id, locale },
    "[author-picker] falling back to default author; no historic or embedding signal"
  );

  const defaultName = await resolveAuthorName(projectId, DEFAULT_AUTHOR_SLUG, locale);

  return {
    authorSlug: DEFAULT_AUTHOR_SLUG,
    authorName: defaultName,
    matchStrategy: "default_fallback",
    matchScore: 0,
    candidates: [],
  };
}
