// Spec 61.4: Dual-mode LLM client (sync + batch) for Anthropic Batch API support.
// Pattern 118: returns batchPending signal instead of throwing on suspension.
// Pattern 119: anthropic_custom_id format is {pipelineRunId}:{stepKey}.
import { anthropic } from "@marketing-auto/adapter-anthropic";
import type { AnthropicModel } from "@marketing-auto/adapter-anthropic";
import { batchRequests, db } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

type TextBlockParam = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

const log = createLogger("pipelines:batch-llm-client");

// Injected once per epoch by the batch processor — not used in step code.
const JSON_INSTRUCTION = [
  "",
  "## Output Format",
  "",
  "Return ONLY valid JSON. No markdown fences, no preamble, no commentary.",
  "Your response must be a single JSON value parseable by JSON.parse.",
  'If you cannot produce valid JSON, return: {"error": "..."}',
].join("\n");

// ─── Public types ─────────────────────────────────────────────────────────────

export type LlmMode = "sync" | "batch";

export type LlmCallResult =
  | {
      mode: "sync";
      raw: string;
      json: unknown | null;
      outputTokens: number;
    }
  | {
      mode: "batch";
      raw: "";
      json: null;
      batchRequestId: string;
      outputTokens: 0;
    };

/** Parameters that map to a single LLM call in either mode. */
export type BatchLlmCallParams = {
  model: AnthropicModel;
  systemPrefix: string;
  systemSuffix: string;
  userMessage: string;
  maxTokens?: number;
  jsonMode?: boolean;
  estimatedCostEur: number;
  projectId: string;
  pipelineRunId: string;
  articleId?: string;
  operation: string;
  forceRefresh?: boolean;

  // Batch-specific metadata
  stepKey: string;
  mode: LlmMode;
};

// ─── Implementation ───────────────────────────────────────────────────────────

async function callSync(params: BatchLlmCallParams): Promise<LlmCallResult> {
  const result = await anthropic.messages({
    model: params.model,
    systemPrefix: params.systemPrefix,
    systemSuffix: params.systemSuffix,
    userMessage: params.userMessage,
    ...(params.maxTokens !== undefined ? { maxTokens: params.maxTokens } : {}),
    ...(params.jsonMode !== undefined ? { jsonMode: params.jsonMode } : {}),
    estimatedCostEur: params.estimatedCostEur,
    projectId: params.projectId,
    ...(params.pipelineRunId ? { pipelineRunId: params.pipelineRunId } : {}),
    ...(params.articleId !== undefined ? { articleId: params.articleId } : {}),
    operation: params.operation,
    ...(params.forceRefresh !== undefined ? { forceRefresh: params.forceRefresh } : {}),
  });
  return {
    mode: "sync",
    raw: result.raw,
    json: result.json,
    outputTokens: result.outputTokens,
  };
}

async function enqueueBatch(params: BatchLlmCallParams): Promise<LlmCallResult> {
  // Build raw Anthropic request format for storage + future batch submission
  const effectiveSuffix = params.jsonMode
    ? params.systemSuffix + JSON_INSTRUCTION
    : params.systemSuffix;

  const systemBlocks: TextBlockParam[] = [];
  if (params.systemPrefix.length > 0) {
    systemBlocks.push({
      type: "text",
      text: params.systemPrefix,
      cache_control: { type: "ephemeral" },
    });
  }
  if (effectiveSuffix.length > 0) {
    systemBlocks.push({ type: "text", text: effectiveSuffix });
  }

  const requestBody = {
    model: params.model,
    max_tokens: params.maxTokens ?? 8192,
    system: systemBlocks,
    messages: [{ role: "user" as const, content: params.userMessage }],
  };

  // Pattern 119: custom_id = {pipelineRunId}_{stepKey}
  // Note: separator is "_" (not ":") to satisfy Anthropic's pattern ^[a-zA-Z0-9_-]{1,64}$
  const anthropicCustomId = `${params.pipelineRunId}_${params.stepKey}`;

  const [row] = await db
    .insert(batchRequests)
    .values({
      projectId: params.projectId,
      ...(params.articleId !== undefined ? { articleId: params.articleId } : {}),
      pipelineRunId: params.pipelineRunId,
      anthropicCustomId,
      status: "pending",
      model: params.model,
      stepKey: params.stepKey,
      requestBody: requestBody as unknown as Record<string, unknown>,
    })
    .returning({ id: batchRequests.id });

  const batchRequestId = row!.id;
  log.info({ batchRequestId, anthropicCustomId, stepKey: params.stepKey }, "Batch request enqueued");

  return {
    mode: "batch",
    raw: "",
    json: null,
    batchRequestId,
    outputTokens: 0,
  };
}

/**
 * Call the LLM in either sync or batch mode.
 * Sync: returns immediately with content (uses adapter with cost tracking).
 * Batch: persists request to DB, returns batchRequestId — pipeline must suspend.
 */
export async function batchLlmCall(params: BatchLlmCallParams): Promise<LlmCallResult> {
  if (params.mode === "sync") {
    return callSync(params);
  }
  return enqueueBatch(params);
}
