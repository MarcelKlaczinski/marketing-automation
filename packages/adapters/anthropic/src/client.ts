import Anthropic from "@anthropic-ai/sdk";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { track, anthropicCostEur } from "@marketing-auto/cost-tracker";
import {
  ANTHROPIC_MODELS,
  MAX_OUTPUT_TOKENS,
  type MessagesInput,
  type MessagesResult,
  type CacheStats,
  JsonParseError,
  AnthropicClientError,
} from "./types.ts";

const log = createLogger("anthropic");

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    maxRetries: 3,
  });
  return _client;
}

const JSON_INSTRUCTION = [
  "",
  "## Output Format",
  "",
  "Return ONLY valid JSON. No markdown fences, no preamble, no commentary.",
  "Your response must be a single JSON value parseable by JSON.parse.",
  'If you cannot produce valid JSON, return: {"error": "..."}',
].join("\n");

function buildSystemBlocks(
  input: MessagesInput,
): Anthropic.Messages.TextBlockParam[] {
  const blocks: Anthropic.Messages.TextBlockParam[] = [];

  if (input.systemPrefix.length > 0) {
    blocks.push({
      type: "text",
      text: input.systemPrefix,
      cache_control: {
        type: "ephemeral",
        ttl: input.cacheTtl ?? "1h",
      },
    });
  }

  const suffix = input.jsonMode
    ? `${input.systemSuffix}\n${JSON_INSTRUCTION}`
    : input.systemSuffix;

  if (suffix.length > 0) {
    blocks.push({
      type: "text",
      text: suffix,
    });
  }

  return blocks;
}

function buildTools(
  input: MessagesInput,
): Anthropic.Messages.ToolUnion[] | undefined {
  if (!input.webSearch?.enabled) return undefined;

  const ws = input.webSearch;
  const tool: Anthropic.Messages.WebSearchTool20250305 = {
    type: "web_search_20250305",
    name: "web_search",
  };

  if (ws.maxUses !== undefined) {
    tool.max_uses = ws.maxUses;
  }
  if (ws.allowedDomains !== undefined) {
    tool.allowed_domains = ws.allowedDomains;
  }
  if (ws.blockedDomains !== undefined) {
    tool.blocked_domains = ws.blockedDomains;
  }

  return [tool];
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function tryParseJson(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: unknown } {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/, "");
  }
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  return e.status === 429 || e.status === 408 || (e.status >= 500 && e.status < 600);
}

export async function messages(input: MessagesInput): Promise<MessagesResult> {
  const client = getClient();
  const modelId = ANTHROPIC_MODELS[input.model];
  const maxTokens = Math.min(
    input.maxTokens ?? 4096,
    MAX_OUTPUT_TOKENS[input.model],
  );

  const systemBlocks = buildSystemBlocks(input);
  const tools = buildTools(input);

  log.debug(
    {
      projectId: input.projectId,
      operation: input.operation,
      model: input.model,
      cachedPrefixLen: input.systemPrefix.length,
      suffixLen: input.systemSuffix.length,
      userMessageLen: input.userMessage.length,
      jsonMode: input.jsonMode ?? false,
      webSearch: input.webSearch?.enabled ?? false,
    },
    "Calling Anthropic",
  );

  const trackBase = {
    projectId: input.projectId,
    service: "anthropic" as const,
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    fn: async () => {
      try {
        const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
          model: modelId,
          max_tokens: maxTokens,
          system: systemBlocks,
          messages: [{ role: "user", content: input.userMessage }],
        };

        if (input.temperature !== undefined) {
          params.temperature = input.temperature;
        }
        if (input.topP !== undefined) {
          params.top_p = input.topP;
        }
        if (input.topK !== undefined) {
          params.top_k = input.topK;
        }
        if (tools !== undefined) {
          params.tools = tools;
        }

        return await client.messages.create(params);
      } catch (e) {
        if (e instanceof Anthropic.APIError && !isRetryableError(e)) {
          throw new AnthropicClientError(
            `Anthropic API error: ${e.message}`,
            e.status ?? 0,
          );
        }
        throw e;
      }
    },
    computeCostEur: (msg: Anthropic.Messages.Message) =>
      anthropicCostEur({
        model: input.model,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
      }),
    metadata: (msg: Anthropic.Messages.Message) => ({
      model: input.model,
      modelId,
      stopReason: msg.stop_reason,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
      cacheTtl: input.cacheTtl ?? "1h",
      jsonMode: input.jsonMode ?? false,
    }),
  };

  let response;
  if (input.pipelineRunId !== undefined && input.articleId !== undefined) {
    response = await track({ ...trackBase, pipelineRunId: input.pipelineRunId, articleId: input.articleId });
  } else if (input.pipelineRunId !== undefined) {
    response = await track({ ...trackBase, pipelineRunId: input.pipelineRunId });
  } else if (input.articleId !== undefined) {
    response = await track({ ...trackBase, articleId: input.articleId });
  } else {
    response = await track(trackBase);
  }

  const cacheRead = response.usage.cache_read_input_tokens ?? 0;
  const cacheCreate = response.usage.cache_creation_input_tokens ?? 0;
  const fresh = response.usage.input_tokens;
  const cacheStats: CacheStats = {
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreate,
    freshInputTokens: fresh,
    totalInputTokens: cacheRead + cacheCreate + fresh,
    hit: cacheRead > 0,
  };

  const raw = extractText(response.content);

  let parsedJson: unknown | null = null;
  if (input.jsonMode) {
    const r = tryParseJson(raw);
    if (!r.ok) {
      log.error(
        {
          projectId: input.projectId,
          operation: input.operation,
          rawLen: raw.length,
          rawPreview: raw.slice(0, 200),
        },
        "JSON parse failed",
      );
      throw new JsonParseError(
        `Anthropic returned non-JSON response for operation "${input.operation}"`,
        raw,
        r.error,
      );
    }
    parsedJson = r.value;
  }

  log.info(
    {
      projectId: input.projectId,
      operation: input.operation,
      model: input.model,
      outputTokens: response.usage.output_tokens,
      cacheHit: cacheStats.hit,
      cacheReadPct:
        cacheStats.totalInputTokens > 0
          ? Math.round((cacheRead / cacheStats.totalInputTokens) * 100)
          : 0,
    },
    "Anthropic call complete",
  );

  return {
    raw,
    json: parsedJson,
    outputTokens: response.usage.output_tokens,
    cacheStats,
    stopReason: response.stop_reason,
    messageId: response.id,
  };
}
