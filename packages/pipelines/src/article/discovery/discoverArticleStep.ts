import { articles, articleDiscovery, db, eq } from "@marketing-auto/db";
import { computeContentHash } from "./contentHash.ts";
import { runDeterministicEnrichment } from "./deterministicEnrichment.ts";
import { runLlmEnrichment } from "./llmEnrichment.ts";

export interface DiscoverArticleStepInput {
  articleId: string;
  projectId: string;
  mode: "deterministic_only" | "full";
  forceRefresh?: boolean;
}

export interface DiscoverArticleStepResult {
  articleId: string;
  status: "enriched" | "skipped_unchanged" | "failed";
  enrichmentMode: "deterministic" | "llm_enriched";
  durationMs: number;
  costUsd: number;
  error?: string;
}

export async function discoverArticleStep(
  input: DiscoverArticleStepInput,
): Promise<DiscoverArticleStepResult> {
  const startedAt = Date.now();

  try {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article) throw new Error(`Article ${input.articleId} not found`);

    const currentHash = computeContentHash(article.bodyMd, article.domainExtras);

    const [existing] = await db
      .select()
      .from(articleDiscovery)
      .where(eq(articleDiscovery.articleId, input.articleId))
      .limit(1);

    if (
      !input.forceRefresh &&
      existing?.contentHash === currentHash &&
      existing?.enrichmentMode === "llm_enriched"
    ) {
      return {
        articleId: input.articleId,
        status: "skipped_unchanged",
        enrichmentMode: "llm_enriched",
        durationMs: Date.now() - startedAt,
        costUsd: 0,
      };
    }

    const det = runDeterministicEnrichment(article);

    let llmFields = {};
    let llmCost = 0;
    if (input.mode === "full") {
      const llmResult = await runLlmEnrichment(article, det, input.projectId);
      llmFields = llmResult.fields;
      llmCost = llmResult.costUsd;
    }

    const enrichmentMode = input.mode === "full" ? "llm_enriched" : "deterministic";

    await db
      .insert(articleDiscovery)
      .values({
        articleId: input.articleId,
        ...det,
        ...llmFields,
        contentHash: currentHash,
        enrichmentRunAt: new Date(),
        enrichmentMode,
      })
      .onConflictDoUpdate({
        target: articleDiscovery.articleId,
        set: {
          ...det,
          ...llmFields,
          contentHash: currentHash,
          enrichmentRunAt: new Date(),
          enrichmentMode,
          updatedAt: new Date(),
        },
      });

    return {
      articleId: input.articleId,
      status: "enriched",
      enrichmentMode,
      durationMs: Date.now() - startedAt,
      costUsd: llmCost,
    };
  } catch (err) {
    return {
      articleId: input.articleId,
      status: "failed",
      enrichmentMode: "deterministic",
      durationMs: Date.now() - startedAt,
      costUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
