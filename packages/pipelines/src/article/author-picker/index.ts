import { articles, and, db, eq, sql } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import type { TopicBrief } from "@marketing-auto/db";
import { historicAuthorScore } from "./historic.ts";
import { embeddingAuthorMatch } from "./embedding.ts";
import type { AuthorPickResult } from "./types.ts";

export type { AuthorPickResult } from "./types.ts";

const log = createLogger("pipelines:author-picker");

export class AuthorPickerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorPickerError";
  }
}

async function resolveAuthorName(
  projectId: string,
  slug: string,
  locale: "de" | "en",
): Promise<string> {
  const rows = await db
    .select({ title: articles.title, domainExtras: articles.domainExtras })
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

  const extras = (row.domainExtras ?? {}) as Record<string, unknown>;
  return row.title ?? String(extras.name ?? slug);
}

/**
 * Default fallback: picks the author with the most imported blog posts for this
 * project + locale, then verifies they exist in the authors collection.
 * Throws AuthorPickerError rather than returning a phantom slug.
 */
async function defaultFallbackAuthor(
  projectId: string,
  locale: "de" | "en",
): Promise<{ slug: string; name: string }> {
  // Find the author slug with the most imported blog posts (exclude org placeholders)
  const rows = await db.execute(sql`
    SELECT
      a.author AS slug,
      COUNT(*) AS post_count
    FROM articles a
    WHERE a.project_id = ${projectId}
      AND a.collection = 'blog'
      AND a.source = 'imported'
      AND a.author IS NOT NULL
      AND a.author NOT LIKE 'toolwiki%'
      AND a.locale = ${locale}
    GROUP BY a.author
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `);

  const topAuthor = (rows as unknown as Array<{ slug: string; post_count: string }>)[0];

  if (!topAuthor?.slug) {
    throw new AuthorPickerError(
      `default_fallback failed: no imported blog authors found for project ${projectId} locale ${locale}`,
    );
  }

  // Verify the slug actually exists in the authors collection
  const authorRows = await db
    .select({ title: articles.title, domainExtras: articles.domainExtras })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "authors"),
        eq(articles.slug, topAuthor.slug),
        eq(articles.locale, locale),
      ),
    )
    .limit(1);

  const authorRow = authorRows[0];

  if (!authorRow) {
    throw new AuthorPickerError(
      `default_fallback failed: author "${topAuthor.slug}" appears in blog posts but is missing from authors collection for project ${projectId} locale ${locale}`,
    );
  }

  const extras = (authorRow.domainExtras ?? {}) as Record<string, unknown>;
  const name = authorRow.title ?? String(extras.name ?? topAuthor.slug);

  log.warn(
    { projectId, locale, fallbackAuthor: topAuthor.slug, postCount: topAuthor.post_count },
    "[author-picker] fell to default_fallback — historic + embedding both returned no match",
  );

  return { slug: topAuthor.slug, name };
}

/**
 * Pick the best author for a blog article based on historical pattern matching
 * with embedding fallback and dynamic default.
 *
 * Strategy 1: Historic SQL score — authors who've written to the same cluster/intent.
 * Strategy 2: Voyage embedding match against author expertise profiles.
 * Strategy 3: Dynamic default — author with most imported blog posts, verified in authors collection.
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

  // ── Strategy 3: Dynamic default fallback ─────────────────────────────────────
  const fallback = await defaultFallbackAuthor(projectId, locale);

  return {
    authorSlug: fallback.slug,
    authorName: fallback.name,
    matchStrategy: "default_fallback",
    matchScore: 0,
    candidates: [],
  };
}
