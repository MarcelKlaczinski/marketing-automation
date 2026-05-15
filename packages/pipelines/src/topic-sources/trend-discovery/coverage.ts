import { createLogger } from "@marketing-auto/shared";
import { db, sql } from "@marketing-auto/db";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { voyage } from "@marketing-auto/adapter-voyage";
import type { CoverageResult, SynthesisTopic } from "./types.ts";

const log = createLogger("trend-discovery:coverage");

// ─── Types ───────────────────────────────────────────────────────────────────

type ArticleRow = {
  id: string;
  title: string | null;
  meta_description: string | null;
  similarity: number;
};

// ─── Article lazy backfill ────────────────────────────────────────────────────

/**
 * Backfill embeddings for any articles in the project that have null embedding.
 * Runs before coverage check so the similarity query has maximum coverage.
 * Skips gracefully on Voyage API errors to keep synthesis running.
 */
async function backfillArticleEmbeddings(
  projectId: string,
  pipelineRunId: string | undefined,
): Promise<void> {
  const rows = await db.execute<{ id: string; title: string | null; meta_description: string | null }>(
    sql`SELECT id, title, meta_description FROM articles
        WHERE project_id = ${projectId} AND embedding IS NULL
        LIMIT 50`,
  );

  if (rows.length === 0) return;

  log.info({ projectId, count: rows.length }, "backfilling article embeddings");

  for (const row of rows) {
    const text = [row.title, row.meta_description].filter(Boolean).join(" — ");
    if (!text) continue;

    try {
      const embedding = await voyage.embed(text, {
        projectId,
        operation: "coverage-backfill-article",
        ...(pipelineRunId !== undefined && { pipelineRunId }),
      });

      await db.execute(sql`
        UPDATE articles
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${row.id}
      `);
    } catch (e) {
      log.warn({ err: e, articleId: row.id }, "failed to backfill article embedding — skipping");
    }
  }
}

// ─── LLM tiebreaker ──────────────────────────────────────────────────────────

type TiebreakerVerdict = "covered" | "distinct" | "partial_overlap";

async function runLlmTiebreaker(
  candidate: SynthesisTopic,
  existing: ArticleRow,
  projectId: string,
  pipelineRunId: string | undefined,
): Promise<TiebreakerVerdict> {
  const systemMsg = [
    "You are a content duplication analyst.",
    "Determine whether a new topic candidate is substantially the same as an existing article.",
    "Answer with exactly one word: 'covered', 'distinct', or 'partial_overlap'.",
    "- covered: the existing article would satisfy the same search intent as the new topic",
    "- distinct: the new topic is meaningfully different (different angle, scope, or audience)",
    "- partial_overlap: related but the new topic adds enough distinct value to justify a separate article",
  ].join("\n");

  const userMsg = [
    `Existing article: "${existing.title ?? "(no title)"}"`,
    existing.meta_description ? `Summary: ${existing.meta_description}` : "",
    "",
    `New topic candidate: "${candidate.topic_title}"`,
    `Primary keyword: ${candidate.primary_keyword}`,
    candidate.secondary_keywords.length > 0
      ? `Secondary keywords: ${candidate.secondary_keywords.join(", ")}`
      : "",
    "",
    "Is the new topic substantially the same as the existing article?",
    "Answer with one word only: covered / distinct / partial_overlap",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  try {
    const result = await anthropic.messages({
      projectId,
      operation: "trend-coverage-tiebreaker",
      model: "claude-haiku-4-5",
      systemPrefix: systemMsg,
      systemSuffix: "",
      userMessage: userMsg,
      maxTokens: 10,
      estimatedCostEur: 0.005,
      ...(pipelineRunId !== undefined && { pipelineRunId }),
    });

    const raw = (result.raw ?? "").trim().toLowerCase();
    if (raw === "covered" || raw === "distinct" || raw === "partial_overlap") {
      return raw as TiebreakerVerdict;
    }
    log.warn({ raw, candidateTitle: candidate.topic_title }, "unexpected tiebreaker verdict — treating as distinct");
    return "distinct";
  } catch (e) {
    log.warn({ err: e, candidateTitle: candidate.topic_title }, "tiebreaker LLM failed — treating as distinct");
    return "distinct";
  }
}

// ─── Main: checkExistingCoverage ──────────────────────────────────────────────

export type CheckCoverageInput = {
  projectId: string;
  candidate: SynthesisTopic;
  pipelineRunId?: string;
};

/**
 * Check whether an existing article already covers the topic candidate.
 *
 * Algorithm:
 *  1. Embed the candidate title + primary keyword
 *  2. Backfill any article embeddings that are null
 *  3. Vector similarity search: top 5 articles by cosine similarity
 *  4. max_sim > 0.85 → covered (hard threshold, no LLM)
 *     max_sim < 0.60 → distinct (hard threshold, no LLM)
 *     0.60 ≤ max_sim ≤ 0.85 → LLM tiebreaker (Haiku)
 */
export async function checkExistingCoverage(
  input: CheckCoverageInput,
): Promise<CoverageResult> {
  const { projectId, candidate, pipelineRunId } = input;

  const candidateText = `${candidate.topic_title} ${candidate.primary_keyword}`.trim();

  let candidateEmbedding: number[];
  try {
    candidateEmbedding = await voyage.embed(candidateText, {
      projectId,
      operation: "trend-coverage-candidate",
      ...(pipelineRunId !== undefined && { pipelineRunId }),
    });
  } catch (e) {
    log.warn({ err: e, candidateTitle: candidate.topic_title }, "failed to embed candidate — treating as distinct");
    return { covered: false, similarity: 0, matchedArticleId: null };
  }

  // Backfill missing article embeddings before querying
  await backfillArticleEmbeddings(projectId, pipelineRunId);

  // Count how many articles have embeddings (for coverage-ratio warning)
  const countRows = await db.execute<{ total: string; with_emb: string }>(sql`
    SELECT
      COUNT(*)::text AS total,
      COUNT(embedding)::text AS with_emb
    FROM articles
    WHERE project_id = ${projectId}
  `);
  const total = Number(countRows[0]?.total ?? 0);
  const withEmb = Number(countRows[0]?.with_emb ?? 0);
  if (total > 0 && withEmb / total < 0.5) {
    log.warn({ projectId, total, withEmb }, "< 50% of articles have embeddings — coverage check may miss duplicates");
  }

  // Vector similarity search: find top 5 most similar articles
  const embeddingLiteral = JSON.stringify(candidateEmbedding);
  const similarRows = await db.execute<{
    id: string;
    title: string | null;
    meta_description: string | null;
    similarity: string;
  }>(sql`
    SELECT
      id,
      title,
      meta_description,
      (1 - (embedding <=> ${embeddingLiteral}::vector))::text AS similarity
    FROM articles
    WHERE project_id = ${projectId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingLiteral}::vector
    LIMIT 5
  `);

  if (similarRows.length === 0) {
    log.debug({ projectId, candidateTitle: candidate.topic_title }, "no articles with embeddings — coverage check skipped");
    return { covered: false, similarity: 0, matchedArticleId: null };
  }

  const topRow = similarRows[0]!;
  const rawSim = parseFloat(topRow.similarity);
  // pgvector returns NaN for zero-norm vectors (e.g. all-zero embedding) — treat as 0
  const maxSim = isNaN(rawSim) ? 0 : rawSim;
  const typedRow: ArticleRow = {
    id: topRow.id,
    title: topRow.title,
    meta_description: topRow.meta_description,
    similarity: maxSim,
  };

  const HIGH = 0.85;
  const LOW = 0.60;

  if (maxSim >= HIGH) {
    log.debug(
      { candidateTitle: candidate.topic_title, maxSim, matchedArticleId: typedRow.id },
      "coverage: definitely covered (sim >= 0.85)"
    );
    return { covered: true, similarity: maxSim, matchedArticleId: typedRow.id };
  }

  if (maxSim < LOW) {
    log.debug(
      { candidateTitle: candidate.topic_title, maxSim },
      "coverage: definitely new (sim < 0.60)"
    );
    return { covered: false, similarity: maxSim, matchedArticleId: null };
  }

  // Tiebreaker band: 0.60 ≤ sim ≤ 0.85
  log.debug(
    { candidateTitle: candidate.topic_title, maxSim, matchedArticleId: typedRow.id },
    "coverage: tiebreaker band — calling LLM"
  );

  const verdict = await runLlmTiebreaker(candidate, typedRow, projectId, pipelineRunId);

  if (verdict === "covered") {
    return { covered: true, similarity: maxSim, matchedArticleId: typedRow.id };
  }

  return { covered: false, similarity: maxSim, matchedArticleId: null };
}
