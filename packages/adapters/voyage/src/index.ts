import { track } from "@marketing-auto/cost-tracker";
import { EUR_PER_USD } from "@marketing-auto/cost-tracker";
import { createLogger } from "@marketing-auto/shared";
import {
  VOYAGE_COST_USD_PER_TOKEN,
  VoyageError,
  callVoyageEmbed,
  getApiKey,
} from "./client.ts";

export { VoyageError } from "./client.ts";

const log = createLogger("adapter:voyage");

export type EmbedContext = {
  projectId: string;
  operation: string;
  pipelineRunId?: string;
};

/**
 * Embed a single text string using Voyage AI voyage-3.
 * Returns a 1024-dimensional float array matching the `vector(1024)` DB column type.
 * Cost: ~€0.000_000_05 per token ($0.06 / 1M × EUR_PER_USD).
 */
export async function embed(text: string, ctx: EmbedContext): Promise<number[]> {
  const apiKey = getApiKey();

  const result = await track({
    projectId: ctx.projectId,
    service: "voyage",
    operation: ctx.operation,
    estimatedCostEur: 0.0001,
    ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    fn: async () => callVoyageEmbed([text], apiKey),
    computeCostEur: (res) => {
      const tokens = res.usage.total_tokens;
      return tokens * VOYAGE_COST_USD_PER_TOKEN * EUR_PER_USD;
    },
    metadata: (res) => ({
      model: res.model,
      totalTokens: res.usage.total_tokens,
      textLength: text.length,
    }),
  });

  const embedding = result.data[0]?.embedding;
  if (!embedding) {
    throw new VoyageError("Voyage API returned no embedding in response");
  }

  log.debug(
    { projectId: ctx.projectId, operation: ctx.operation, dims: embedding.length },
    "embedding computed"
  );

  return embedding;
}

/**
 * Embed multiple texts in a single API call.
 * Returns embeddings in the same order as the input texts.
 * Capped at 128 texts per call (Voyage AI limit).
 */
export async function embedBatch(
  texts: string[],
  ctx: EmbedContext,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 128) {
    throw new VoyageError(
      `embedBatch: too many texts (${texts.length}); max 128 per call`
    );
  }

  const apiKey = getApiKey();
  const estimatedTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
  const estimatedCostEur = estimatedTokens * VOYAGE_COST_USD_PER_TOKEN * EUR_PER_USD;

  const result = await track({
    projectId: ctx.projectId,
    service: "voyage",
    operation: ctx.operation,
    estimatedCostEur: Math.max(estimatedCostEur, 0.0001),
    ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    fn: async () => callVoyageEmbed(texts, apiKey),
    computeCostEur: (res) => {
      const tokens = res.usage.total_tokens;
      return tokens * VOYAGE_COST_USD_PER_TOKEN * EUR_PER_USD;
    },
    metadata: (res) => ({
      model: res.model,
      totalTokens: res.usage.total_tokens,
      textCount: texts.length,
    }),
  });

  return result.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Namespaced export — use `voyage.embed(...)` and `voyage.embedBatch(...)`.
 * Properties can be mutated in tests (ESM named bindings are readonly; object
 * properties are not).
 */
export const voyage = { embed, embedBatch };
