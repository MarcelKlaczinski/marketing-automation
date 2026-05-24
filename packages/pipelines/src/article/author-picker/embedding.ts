import { voyage } from "@marketing-auto/adapter-voyage";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db, eq, and } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import type { TopicBrief } from "@marketing-auto/db";
import type { AuthorProfile } from "./types.ts";

const log = createLogger("pipelines:author-picker:embedding");

const SIMILARITY_THRESHOLD = 0.55;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildQueryText(brief: TopicBrief): string {
  const parts = [brief.topicTitle];
  if (brief.primaryKeyword) parts.push(brief.primaryKeyword);
  const secondary = (brief.secondaryKeywords ?? []).slice(0, 3);
  parts.push(...secondary);
  return parts.join(" ");
}

/**
 * Fetch all author profiles for a project+locale, resolving expertise embeddings.
 * Embeddings are cached in domainExtras.expertiseEmbedding — computed once,
 * written back to DB, reused on subsequent calls.
 */
async function loadAuthorProfiles(
  projectId: string,
  locale: "de" | "en",
  embedCtx: { projectId: string; pipelineRunId?: string },
): Promise<AuthorProfile[]> {
  const rows = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "authors"),
        eq(articles.locale, locale),
      ),
    );

  const profiles: AuthorProfile[] = [];

  for (const row of rows) {
    const extras = (row.domainExtras ?? {}) as Record<string, unknown>;
    const expertiseRaw = Array.isArray(extras.expertise)
      ? (extras.expertise as unknown[]).filter((h): h is string => typeof h === "string")
      : [];

    if (expertiseRaw.length === 0) continue;

    const cachedEmbedding = Array.isArray(extras.expertiseEmbedding)
      ? (extras.expertiseEmbedding as number[])
      : undefined;

    let expertiseEmbedding = cachedEmbedding;

    if (!expertiseEmbedding) {
      try {
        const expertiseText = expertiseRaw.join(", ");
        expertiseEmbedding = await voyage.embed(expertiseText, {
          projectId: embedCtx.projectId,
          operation: COST_OPS.VOYAGE_EMBED_TEXT,
          ...(embedCtx.pipelineRunId !== undefined && {
            pipelineRunId: embedCtx.pipelineRunId,
          }),
        });

        // Write embedding back to DB for caching
        const updatedExtras = { ...extras, expertiseEmbedding };
        await db
          .update(articles)
          .set({ domainExtras: updatedExtras, updatedAt: new Date() })
          .where(eq(articles.id, row.id));

        log.info({ authorSlug: row.slug }, "cached expertise embedding for author");
      } catch (err) {
        log.warn({ err, authorSlug: row.slug }, "failed to embed author expertise; skipping");
        continue;
      }
    }

    profiles.push({
      slug: row.slug,
      name: row.title ?? String(extras.name ?? row.slug),
      expertise: expertiseRaw,
      expertiseEmbedding,
    });
  }

  return profiles;
}

/**
 * Voyage embedding fallback for author matching.
 * Embeds the brief's topic+keywords, compares against cached author expertise embeddings.
 * Returns the best match if similarity exceeds SIMILARITY_THRESHOLD, else null.
 */
export async function embeddingAuthorMatch(
  projectId: string,
  brief: TopicBrief,
  locale: "de" | "en",
  pipelineRunId?: string,
): Promise<{ slug: string; name: string; score: number } | null> {
  const embedCtx = {
    projectId,
    ...(pipelineRunId !== undefined && { pipelineRunId }),
  };

  const queryText = buildQueryText(brief);
  if (!queryText.trim()) {
    log.warn({ briefId: brief.id }, "empty query text for author embedding; skipping");
    return null;
  }
  let queryEmbedding: number[];

  try {
    queryEmbedding = await voyage.embed(queryText, {
      projectId,
      operation: COST_OPS.VOYAGE_EMBED_TEXT,
      ...(pipelineRunId !== undefined && { pipelineRunId }),
    });
  } catch (err) {
    log.warn({ err }, "failed to embed brief query; skipping embedding fallback");
    return null;
  }

  const profiles = await loadAuthorProfiles(projectId, locale, embedCtx);
  if (profiles.length === 0) return null;

  let bestSlug = "";
  let bestName = "";
  let bestScore = -1;

  for (const profile of profiles) {
    if (!profile.expertiseEmbedding) continue;
    const sim = cosineSimilarity(queryEmbedding, profile.expertiseEmbedding);
    if (sim > bestScore) {
      bestScore = sim;
      bestSlug = profile.slug;
      bestName = profile.name;
    }
  }

  if (bestScore < SIMILARITY_THRESHOLD) {
    log.debug({ bestScore, threshold: SIMILARITY_THRESHOLD }, "no embedding match above threshold");
    return null;
  }

  return { slug: bestSlug, name: bestName, score: bestScore };
}
