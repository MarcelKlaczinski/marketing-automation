import Anthropic from "@anthropic-ai/sdk";
import { assertCostBudget, estimateCostEur } from "@marketing-auto/core/cost";
import { getGlobal } from "@marketing-auto/core/credentials";
import { anthropicCostEur, track } from "@marketing-auto/cost-tracker";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { computeCacheKey, getCacheMode, isCacheable, readFixture, writeFixture } from "./cache.ts";
import {
  ANTHROPIC_MODELS,
  AnthropicClientError,
  type CacheStats,
  JsonParseError,
  MAX_OUTPUT_TOKENS,
  type MessagesInput,
  type MessagesResult,
} from "./types.ts";

const log = createLogger("anthropic");

let _client: Anthropic | null = null;

async function getApiKey(): Promise<string> {
  const fromVault = await getGlobal("anthropic", "api_key");
  if (fromVault) return fromVault;
  const fromEnv = getEnv().ANTHROPIC_API_KEY;
  if (fromEnv) return fromEnv;
  throw new Error("Anthropic API key not configured (set via installer or ANTHROPIC_API_KEY env)");
}

async function getClient(): Promise<Anthropic> {
  if (_client) return _client;
  _client = new Anthropic({
    apiKey: await getApiKey(),
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

function buildSystemBlocks(input: MessagesInput): Anthropic.Messages.TextBlockParam[] {
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

  const suffix = input.jsonMode ? `${input.systemSuffix}\n${JSON_INSTRUCTION}` : input.systemSuffix;

  if (suffix.length > 0) {
    blocks.push({
      type: "text",
      text: suffix,
    });
  }

  return blocks;
}

function buildTools(input: MessagesInput): Anthropic.Messages.ToolUnion[] | undefined {
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

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  let cleaned = raw.trim();

  // Strip markdown code fences — handle both:
  //   (a) fence at start of string
  //   (b) prose before fence (Sonnet sometimes adds preamble)
  const fenceIdx = cleaned.search(/```(?:json)?[ \t]*\n/i);
  if (fenceIdx !== -1) {
    const afterFence = cleaned.slice(fenceIdx).replace(/^```(?:json)?[ \t]*\n/i, "");
    const closingFence = afterFence.indexOf("```");
    cleaned = (closingFence !== -1 ? afterFence.slice(0, closingFence) : afterFence).trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  }

  // Direct parse (fast path)
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (firstErr) {
    // Fallback 1: model prepended prose before the JSON object — find first '{'.
    const objStart = cleaned.indexOf("{");
    if (objStart > 0) {
      try {
        return { ok: true, value: JSON.parse(cleaned.slice(objStart)) };
      } catch {
        // ignore — fall through
      }
    }
    // Fallback 2: trailing prose after the JSON object (e.g. "{"key":"val"}\nNote: ...").
    // Extract the first complete JSON object by counting braces.
    // Handles Sonnet responses that add commentary after the closing brace.
    if (objStart !== -1) {
      let depth = 0;
      let end = -1;
      for (let i = objStart; i < cleaned.length; i++) {
        if (cleaned[i] === "{") depth++;
        else if (cleaned[i] === "}") {
          if (--depth === 0) { end = i; break; }
        }
      }
      if (end > objStart) {
        try {
          return { ok: true, value: JSON.parse(cleaned.slice(objStart, end + 1)) };
        } catch {
          // ignore — fall through to error
        }
      }
    }
    return { ok: false, error: firstErr };
  }
}

function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  return e.status === 429 || e.status === 408 || (e.status >= 500 && e.status < 600);
}

export async function messages(input: MessagesInput): Promise<MessagesResult> {
  // --- dev-mode fixture cache (Spec 22.6) ---
  const mode = getCacheMode();
  const canCache = isCacheable(input) && !input.forceRefresh;

  if (mode !== "off" && canCache) {
    const cacheKey = computeCacheKey(input);
    const fixture = readFixture(cacheKey);

    if (mode === "replay") {
      if (!fixture) {
        throw new AnthropicClientError(
          `Cache MISS for key ${cacheKey} (operation: ${input.operation}). ` +
            `Run with ANTHROPIC_CACHE_MODE=record or =auto to record fixtures first.`,
          0
        );
      }
      log.info(
        { cacheKey, operation: input.operation, recordedAt: fixture.recordedAt },
        "Anthropic cache HIT (replay)"
      );
      await track({
        projectId: input.projectId,
        ...(input.pipelineRunId !== undefined ? { pipelineRunId: input.pipelineRunId } : {}),
        ...(input.articleId !== undefined ? { articleId: input.articleId } : {}),
        service: "anthropic",
        operation: input.operation,
        estimatedCostEur: 0,
        fn: async () => null,
        computeCostEur: () => 0,
        metadata: () => ({ cached: true, cacheKey, source: "fixture" }),
      });
      return fixture.response;
    }

    if (mode === "auto" && fixture) {
      log.info(
        { cacheKey, operation: input.operation, recordedAt: fixture.recordedAt },
        "Anthropic cache HIT (auto)"
      );
      await track({
        projectId: input.projectId,
        ...(input.pipelineRunId !== undefined ? { pipelineRunId: input.pipelineRunId } : {}),
        ...(input.articleId !== undefined ? { articleId: input.articleId } : {}),
        service: "anthropic",
        operation: input.operation,
        estimatedCostEur: 0,
        fn: async () => null,
        computeCostEur: () => 0,
        metadata: () => ({ cached: true, cacheKey, source: "fixture" }),
      });
      return fixture.response;
    }
    // RECORD mode or AUTO miss: fall through to live call
  }
  // --- end cache layer ---

  await assertCostBudget(
    input.projectId,
    "anthropic",
    estimateCostEur("anthropic", input.operation)
  );

  const client = await getClient();
  const modelId = ANTHROPIC_MODELS[input.model];
  const maxTokens = Math.min(input.maxTokens ?? 4096, MAX_OUTPUT_TOKENS[input.model]);

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
    "Calling Anthropic"
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
          throw new AnthropicClientError(`Anthropic API error: ${e.message}`, e.status ?? 0);
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
        cacheTtl: input.cacheTtl ?? "1h",
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
    response = await track({
      ...trackBase,
      pipelineRunId: input.pipelineRunId,
      articleId: input.articleId,
    });
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
        "JSON parse failed"
      );
      throw new JsonParseError(
        `Anthropic returned non-JSON response for operation "${input.operation}"`,
        raw,
        r.error
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
    "Anthropic call complete"
  );

  const result: MessagesResult = {
    raw,
    json: parsedJson,
    outputTokens: response.usage.output_tokens,
    cacheStats,
    stopReason: response.stop_reason,
    messageId: response.id,
  };

  // Record fixture after a successful live call (record/auto modes)
  if (canCache && (mode === "record" || mode === "auto")) {
    const cacheKey = computeCacheKey(input);
    try {
      writeFixture(cacheKey, input, result);
      log.info({ cacheKey, operation: input.operation, mode }, "Recorded Anthropic fixture");
    } catch (e) {
      log.warn({ err: e, cacheKey }, "Failed to write fixture (continuing)");
    }
  }

  return result;
}
