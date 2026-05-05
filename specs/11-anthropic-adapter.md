# Spec 11: Anthropic Adapter

**Phase:** 2 (Cold-Start for KI-Wissensraum)
**Estimated Effort:** 1 day
**Dependencies:** Spec 00 (foundation), Spec 01 (db schema), Spec 03 (cost tracker), Spec 10 (project marketing context)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6 (mostly translation work — patterns are well-established)

---

## Goal

Build the **typed Anthropic API client** that all generative pipeline steps use to call Claude. This is the first concrete adapter and the **pattern that Replicate and DataForSEO adapters will copy**. Therefore we get the contract right *here* — every later adapter follows the same shape.

The adapter handles:
1. **Typed message creation** with `claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-7` (the three models we route between)
2. **Prompt caching** correctly applied to system-prompt prefix (skill + project context) with 1-hour TTL
3. **Cost tracking** via `@marketing-auto/cost-tracker` — every call goes through `track()`, no exceptions
4. **Model routing** policy: per-step `defaultModel`, per-call override allowed
5. **Web search tool** support (used by fact-check steps later)
6. **Structured output via JSON-mode-style prompting** (we don't use Anthropic's tool-use for output schemas in this spec; clean JSON-via-prompt pattern instead — simpler, sufficient for our use)
7. **Retry handling** for transient errors (rate limits, 5xx) — distinct from BullMQ-level retries

This adapter is **stateless and project-scoped**: every call carries `projectId` so cost tracking and limits are correctly attributed.

## Non-Goals

- No streaming — we receive complete responses (pipeline steps are async via BullMQ, not user-facing realtime)
- No tool-use beyond Anthropic's built-in `web_search` — custom tool-use comes later if needed
- No vision/image input — pipeline steps that need it can be added per-step
- No prompt management UI — prompts live in pipeline step classes
- No batch API — we don't have batchable workloads yet (article generation is one-at-a-time per approval flow). Add later when we need it.
- No usage of `prompts/cache` analytics endpoints — we measure cache effectiveness via `cost_logs` metadata
- No multi-turn conversations within one adapter call — each call is one user message, one assistant response. Multi-turn happens by the pipeline step calling `messages()` multiple times with growing history.

## User-Facing Behavior (for developers writing pipeline steps)

After this spec, a step like this works:

```typescript
import { anthropic, type AnthropicModel } from "@marketing-auto/adapters/anthropic";
import { buildSystemPrompt } from "@marketing-auto/pipelines";

class GenerateOutlineStep extends BaseStep<{...}, {...}> {
  readonly defaultModel: AnthropicModel = "claude-sonnet-4-6";

  async execute(input, ctx) {
    const prompt = await buildSystemPrompt({
      skills: ["copywriting", "ai-seo"],
      projectIdOrSlug: ctx.projectId,
      stepInstructions: "Produce an outline of 5-7 H2 sections for the topic. JSON: { sections: string[] }",
    });

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "outline-generation",
      model: this.defaultModel,
      systemPrefix: prompt.cacheablePrefix,    // cached, 1h TTL
      systemSuffix: prompt.variableSuffix,     // not cached
      userMessage: `Topic: ${input.topic}`,
      maxTokens: 2000,
      jsonMode: true,                          // adds JSON-formatting instruction, parses output
    });

    // response.json is the parsed structured output (typed via outputSchema later)
    return { outline: response.json.sections };
  }
}
```

Key shape:
- `anthropic.messages()` is the single call surface
- `systemPrefix` / `systemSuffix` separation enables caching (prefix gets `cache_control`)
- `projectId` and `pipelineRunId` enable cost-log correlation
- `jsonMode: true` adds a strict JSON instruction and parses the response (see implementation)
- Returns `{ raw, json, usage, cacheStats }` so callers can both read structured output and inspect cost details

## Detailed Implementation

### Package Setup

`packages/adapters/anthropic/package.json`:

```json
{
  "name": "@marketing-auto/adapter-anthropic",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "cd ../../.. && bun test packages/adapters/anthropic/test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "@marketing-auto/cost-tracker": "workspace:*",
    "@anthropic-ai/sdk": "^0.42.0"
  }
}
```

`packages/adapters/anthropic/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

### Decision: Why a sub-folder under `packages/adapters/`, not a flat package?

We keep all adapters under `packages/adapters/<service>/` instead of `packages/adapter-anthropic/`, `packages/adapter-replicate/`, etc. Three reasons:

1. **Browse-ability** — `packages/adapters/` lists every external service in one place
2. **Code-search efficiency** — search "adapter" finds them all
3. **Future shared utilities** — `packages/adapters/_shared/` for retry helpers, etc.

The `package.json` name `@marketing-auto/adapter-anthropic` keeps the import-path readable.

### Core Types

`packages/adapters/anthropic/src/types.ts`:

```typescript
/**
 * Models we use, mapped to canonical Anthropic IDs.
 * The string on the right is what the API accepts; the left is our short alias.
 */
export const ANTHROPIC_MODELS = {
    "claude-haiku-4-5":   "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6":  "claude-sonnet-4-6",
    "claude-opus-4-7":    "claude-opus-4-7",
  } as const;

export type AnthropicModel = keyof typeof ANTHROPIC_MODELS;

/** Per-model token caps we never want to exceed (sanity rails). */
export const MAX_OUTPUT_TOKENS: Record<AnthropicModel, number> = {
  "claude-haiku-4-5":  4096,
  "claude-sonnet-4-6": 8192,
  "claude-opus-4-7":   8192,
};

export type CacheTtl = "5m" | "1h";

export type AnthropicWebSearch = {
  /** When set, the model gets the web_search tool with these settings. */
  enabled: true;
  maxUses?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
} | { enabled: false };

export type MessagesInput = {
  projectId: string;
  /** For correlation with pipeline_runs (optional but strongly recommended) */
  pipelineRunId?: string;
  /** For correlation with articles (optional) */
  articleId?: string;
  /** Operation name for cost_logs (e.g., "outline-generation", "fact-check"). Required. */
  operation: string;

  model: AnthropicModel;

  /**
   * Cacheable system prompt prefix. Marked with cache_control: ephemeral 1h.
   * MUST be ≥ minCacheableTokens for the model (see hardCaching below) or caching is silently ignored.
   * Pass empty string if you have nothing to cache.
   */
  systemPrefix: string;
  /**
   * Variable suffix appended after the cached prefix. NOT cached.
   * Step-specific instructions go here.
   */
  systemSuffix: string;

  /** The user's message to the model. */
  userMessage: string;

  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;

  /**
   * If true, appends a strict JSON-formatting instruction to systemSuffix
   * and attempts to parse the response. Failure to parse is a thrown error.
   * The model is instructed to return ONLY valid JSON, no markdown fences.
   */
  jsonMode?: boolean;

  /** If set, overrides the default 1h cache TTL on the prefix. */
  cacheTtl?: CacheTtl;

  /** Web search tool config. Default: disabled. */
  webSearch?: AnthropicWebSearch;

  /** Pre-flight cost estimate. Required for cost-tracker limit check. */
  estimatedCostEur: number;
};

export type CacheStats = {
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  /** Sum of read+creation+freshInput. */
  totalInputTokens: number;
  /** Pure non-cached input tokens. */
  freshInputTokens: number;
  /** True if any tokens were read from cache (cache hit). */
  hit: boolean;
};

export type MessagesResult = {
  /** The raw text content (concatenated text blocks). */
  raw: string;
  /** Parsed JSON, only populated if jsonMode was true. */
  json: unknown | null;
  outputTokens: number;
  cacheStats: CacheStats;
  stopReason: string | null;
  /** Anthropic message ID for debugging. */
  messageId: string;
};

/** Thrown when the model returned invalid JSON despite jsonMode. */
export class JsonParseError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly parseError: unknown,
  ) {
    super(message);
    this.name = "JsonParseError";
  }
}

/** Thrown for non-retryable client errors (400-class except 429). */
export class AnthropicClientError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AnthropicClientError";
  }
}
```

### The Adapter

`packages/adapters/anthropic/src/client.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { track, anthropicCostEur } from "@marketing-auto/cost-tracker";
import {
  ANTHROPIC_MODELS,
  MAX_OUTPUT_TOKENS,
  type AnthropicModel,
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
    // SDK has its own retry logic for 5xx and 429; we expand on it below for our own logging.
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
  "If you cannot produce valid JSON, return: {\"error\": \"...\"}",
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

  // Suffix (uncached). Always present, possibly with JSON instruction appended.
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

function buildTools(input: MessagesInput): Anthropic.Messages.ToolUnion[] | undefined {
  if (!input.webSearch?.enabled) return undefined;

  const ws = input.webSearch;
  return [
    {
      type: "web_search_20250305",
      name: "web_search",
      ...(ws.maxUses !== undefined && { max_uses: ws.maxUses }),
      ...(ws.allowedDomains && { allowed_domains: ws.allowedDomains }),
      ...(ws.blockedDomains && { blocked_domains: ws.blockedDomains }),
    },
  ];
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  // Be lenient: strip leading/trailing whitespace; if model accidentally added
  // markdown fences despite instruction, strip them.
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  }
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function isRetryableError(e: unknown): boolean {
  if (!(e instanceof Anthropic.APIError)) return false;
  // 429 (rate limit), 408 (timeout), 5xx all retryable.
  // SDK already retries; this is our manual classification for surfacing.
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

  log.debug({
    projectId: input.projectId,
    operation: input.operation,
    model: input.model,
    cachedPrefixLen: input.systemPrefix.length,
    suffixLen: input.systemSuffix.length,
    userMessageLen: input.userMessage.length,
    jsonMode: input.jsonMode ?? false,
    webSearch: input.webSearch?.enabled ?? false,
  }, "Calling Anthropic");

  const response = await track({
    projectId: input.projectId,
    service: "anthropic",
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    fn: async () => {
      try {
        return await client.messages.create({
          model: modelId,
          max_tokens: maxTokens,
          system: systemBlocks,
          messages: [{ role: "user", content: input.userMessage }],
          ...(input.temperature !== undefined && { temperature: input.temperature }),
          ...(input.topP !== undefined && { top_p: input.topP }),
          ...(input.topK !== undefined && { top_k: input.topK }),
          ...(tools && { tools }),
        });
      } catch (e) {
        if (e instanceof Anthropic.APIError && !isRetryableError(e)) {
          // Non-retryable: throw a typed client error. BullMQ won't retry these.
          throw new AnthropicClientError(
            `Anthropic API error: ${e.message}`,
            e.status ?? 0,
          );
        }
        throw e; // retryable bubbles up; SDK already retried internally
      }
    },
    computeCostEur: (msg) => anthropicCostEur({
      model: input.model,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
    }),
    metadata: (msg) => ({
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
  });

  // Build CacheStats
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
      log.error({
        projectId: input.projectId,
        operation: input.operation,
        rawLen: raw.length,
        rawPreview: raw.slice(0, 200),
      }, "JSON parse failed");
      throw new JsonParseError(
        `Anthropic returned non-JSON response for operation "${input.operation}"`,
        raw,
        r.error,
      );
    }
    parsedJson = r.value;
  }

  log.info({
    projectId: input.projectId,
    operation: input.operation,
    model: input.model,
    outputTokens: response.usage.output_tokens,
    cacheHit: cacheStats.hit,
    cacheReadPct: cacheStats.totalInputTokens > 0
      ? Math.round((cacheRead / cacheStats.totalInputTokens) * 100)
      : 0,
  }, "Anthropic call complete");

  return {
    raw,
    json: parsedJson,
    outputTokens: response.usage.output_tokens,
    cacheStats,
    stopReason: response.stop_reason,
    messageId: response.id,
  };
}
```

### Public API & Index

`packages/adapters/anthropic/src/index.ts`:

```typescript
export { messages } from "./client.ts";
export {
  ANTHROPIC_MODELS,
  MAX_OUTPUT_TOKENS,
  type AnthropicModel,
  type CacheTtl,
  type AnthropicWebSearch,
  type MessagesInput,
  type MessagesResult,
  type CacheStats,
  JsonParseError,
  AnthropicClientError,
} from "./types.ts";

// Convenience namespace (matches the doc-style import in pipeline steps)
import { messages as _messages } from "./client.ts";
export const anthropic = {
  messages: _messages,
};
```

### CLAUDE.md for the package

`packages/adapters/anthropic/CLAUDE.md`:

```markdown
# Anthropic Adapter

The single, typed entry point for all Claude API calls in the platform.

## Hard Rules

- ALL pipeline steps that need an LLM call use this adapter — never `@anthropic-ai/sdk` directly
- EVERY call must include `projectId`, `operation`, and `estimatedCostEur`
- The `systemPrefix` is what gets cached (1h TTL by default). Put stable content there:
  skill content, project marketing context, format examples
- The `systemSuffix` is NOT cached. Put per-call instructions there
- `jsonMode: true` is the standard way to request structured output. Don't ask for JSON
  in the user message and parse manually — use the flag

## Model Routing Guidance

- Haiku 4.5: classification, summarization of short text, prompt compression, briefing assembly from raw data
- Sonnet 4.6: research synthesis, outlines, brand-voice-light tasks, fact-check, social repurposing
- Opus 4.7: final article draft, opinion pieces, brand-voice-critical content

If unsure, default to Sonnet. Only escalate to Opus when an A/B test shows it.

## Cache Effectiveness

Inspect `cost_logs.metadata` for `cacheReadTokens` vs `cacheCreationTokens` to verify
caching is working. Expected pattern after warmup:
- First call: high `cacheCreationTokens`, low `cacheReadTokens` (writes the cache)
- Subsequent calls within 1h: high `cacheReadTokens`, low/zero `cacheCreationTokens` (hits)
- Hit rate < 60% after warmup = something is wrong (prefix changes between calls)

Common cache breakers:
- Different `systemPrefix` per call (slightly varying skill order, different project context, etc.)
- Marketing context updated mid-run (briefly invalidates cache)
- Cross-organization or cross-workspace requests (caches isolated)

## Common Mistakes

- DO NOT pass system as a string — must be the array of TextBlockParam (the adapter handles this; if you ever shortcut around the adapter, remember this)
- DO NOT skip cost-tracker — even "small" calls add up
- DO NOT exceed model `max_tokens` (adapter clamps automatically; don't fight it)
- DO NOT request `temperature: 1.5` or wild values — Anthropic has a 0-1 range
- DO NOT instruct the user message "respond with JSON" — use `jsonMode: true`
```

### Smoke Test

Real Anthropic API calls cost real money, so the test is intentionally minimal but covers the critical path. Set `RUN_LIVE_ANTHROPIC=1` env var to enable; default-skipped in CI.

`packages/adapters/anthropic/test/anthropic.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, costLogs } from "@marketing-auto/db";
import { messages } from "../src/client.ts";

const live = process.env.RUN_LIVE_ANTHROPIC === "1";
const describeLive = live ? describe : describe.skip;

describeLive("Anthropic adapter (LIVE)", () => {
  let projectId: string;
  const slug = `anthropic-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug,
      name: "Anthropic Adapter Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      // very generous limits to avoid spurious failures during smoke tests
      costLimits: { daily: { anthropic: 5 }, monthly: { anthropic: 50 } },
    }).returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns text from haiku and writes a cost log", async () => {
    const result = await messages({
      projectId,
      operation: "test-haiku",
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "Reply in exactly three words.",
      userMessage: "Greet me.",
      maxTokens: 50,
      estimatedCostEur: 0.01,
    });

    expect(result.raw.length).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);

    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(1);
    expect(Number(logs[0]!.costEur)).toBeGreaterThan(0);
  });

  it("returns parsed JSON in jsonMode", async () => {
    const result = await messages({
      projectId,
      operation: "test-json",
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "Return a JSON object: {\"greeting\": <string>, \"length\": <number>}",
      userMessage: "Make a one-word greeting.",
      maxTokens: 100,
      jsonMode: true,
      estimatedCostEur: 0.01,
    });

    expect(result.json).not.toBeNull();
    expect(typeof result.json).toBe("object");
    expect((result.json as any).greeting).toBeDefined();
  });

  it(
    "shows cache hit on second call with same prefix",
    async () => {
      // Long enough to exceed Haiku's 4096-token min-cache. Use a chunk of repeated text.
      const longPrefix = ("This is a stable cached system prompt. ".repeat(500)).slice(0, 18000);

      const first = await messages({
        projectId,
        operation: "cache-warmup",
        model: "claude-haiku-4-5",
        systemPrefix: longPrefix,
        systemSuffix: "Reply briefly.",
        userMessage: "First call.",
        maxTokens: 30,
        estimatedCostEur: 0.05,
      });
      // First call writes cache (or hits if a prior test warmed it). Either is acceptable.
      // Just assert no crash.
      expect(first.raw.length).toBeGreaterThan(0);

      const second = await messages({
        projectId,
        operation: "cache-hit",
        model: "claude-haiku-4-5",
        systemPrefix: longPrefix,
        systemSuffix: "Reply briefly.",
        userMessage: "Second call.",
        maxTokens: 30,
        estimatedCostEur: 0.05,
      });
      // After warmup, cache_read_input_tokens should be > 0 on the second call
      expect(second.cacheStats.cacheReadInputTokens).toBeGreaterThan(0);
      expect(second.cacheStats.hit).toBe(true);
    },
    30_000,
  );
});

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.messages).toBe("function");
    expect(typeof mod.anthropic.messages).toBe("function");
    expect(mod.ANTHROPIC_MODELS["claude-sonnet-4-6"]).toBe("claude-sonnet-4-6");
  });
});
```

For local manual testing, set `RUN_LIVE_ANTHROPIC=1` and a real `ANTHROPIC_API_KEY`. Expected total cost of full live test run: < $0.05.

## Acceptance Criteria

- [ ] `bun --filter @marketing-auto/adapter-anthropic typecheck` passes
- [ ] `messages()` calls succeed against live Anthropic API (manual run with `RUN_LIVE_ANTHROPIC=1`)
- [ ] Each call writes exactly one row to `cost_logs` with the right `service`, `operation`, `cost_eur` > 0, and metadata containing `model`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`
- [ ] `jsonMode: true` returns parsed `result.json`, throws `JsonParseError` on malformed output
- [ ] `jsonMode: true` strips accidental markdown fences (test by instructing the model "respond in a code block")
- [ ] Cache hit visible: second call with identical `systemPrefix` shows `cacheStats.cacheReadInputTokens > 0` and `hit: true`
- [ ] Cost limit enforcement works: project with `daily.anthropic = 0.001` (tiny) rejects calls with `CostLimitExceeded`
- [ ] Empty `systemPrefix` works (single suffix block sent)
- [ ] Web search tool works when `webSearch.enabled = true` (manual test against live API; verify response references search)
- [ ] `maxTokens` override above the model's hard cap is silently clamped to the cap (no error)
- [ ] Non-retryable client error (e.g., invalid model id) throws `AnthropicClientError`, not bubbles up as raw SDK error
- [ ] Logs at info level: project id, operation, model, output tokens, cache hit pct
- [ ] No raw API keys in any log output

## Open Questions / Decisions Made

**Decision 1: We use the Anthropic SDK, not raw fetch.**
The SDK handles streaming, retries, and type generation correctly. Spec 04's note about "no raw fetch" violation in `email.ts` is exactly what we're avoiding here. The Resend adapter (a future small spec) will bring `email.ts` in line.

**Decision 2: Single `messages()` function, no `chat()` / `complete()` etc.**
Anthropic only has `messages.create`. We don't need to abstract over multiple endpoints. The function is fat (many options) but cohesive.

**Decision 3: `jsonMode` does prompt injection, not tool-use.**
Anthropic's tool-use is the official structured-output path, but it's heavyweight (must define a tool, model decides whether to call it). For our case — pipeline steps where we KNOW we want JSON — instructing the model and parsing is simpler, equivalently reliable on Sonnet/Opus, and faster.

**Decision 4: 1-hour TTL by default.**
Pipelines run with steps that can be minutes apart (LLM call + DataForSEO + image gen + LLM call again). 5-minute TTL would miss too many. 1h costs 2× the write multiplier — break-even after ~10 cache hits, which we'll easily exceed.

**Decision 5: Type aliases for short-form model names.**
`claude-sonnet-4-6` (our alias) maps to Anthropic's actual ID. If Anthropic ever versions Sonnet 4.6 mid-life, we change the right side; callers don't change. Cheap insurance.

**Decision 6: Per-call `estimatedCostEur` is required.**
Hard requirement for cost-tracker pre-flight check. Estimating is the caller's job — they know roughly how big their prompt + expected output is. Wildly wrong estimates cause limit checks to misfire, but the actual cost still gets logged correctly.

**Decision 7: We don't expose streaming.**
Pipeline steps run async via BullMQ; no user is waiting for a typewriter effect. Streaming adds error-handling complexity (mid-stream failures, partial parsing for jsonMode) we don't need yet. If a future use case demands it (e.g., live "thinking out loud" review UI), add a separate `streamMessages()`.

**Decision 8: SDK retries left in place; we wrap only for typed errors.**
Anthropic SDK handles 5xx + 429 with backoff via `maxRetries: 3`. We wrap for `AnthropicClientError` (non-retryable 4xx) so callers can catch them distinctly from network noise, but we don't reimplement the retry loop.

**Decision 9: `web_search_20250305` tool ID hardcoded.**
This is the documented tool name. If Anthropic releases a v2, we update one constant. Adding a config knob now is YAGNI.

**Decision 10: Adapter is stateless and the underlying client is a singleton.**
One Anthropic client object per process, lazily initialized. No connection pooling, no multi-key rotation. If we hit rate-limit constraints later, per-project keys could be added — but that's a Phase-3 problem.

## Implementation Order

1. Create `packages/adapters/` dir if not present, then `packages/adapters/anthropic/`
2. `package.json`, `tsconfig.json`, `CLAUDE.md`
3. `src/types.ts` (no logic — pure types and constants)
4. `src/client.ts` (the work)
5. `src/index.ts` (public surface)
6. `bun install` (pulls @anthropic-ai/sdk)
7. `bun --filter @marketing-auto/adapter-anthropic typecheck`
8. Write the test file (skipped by default unless `RUN_LIVE_ANTHROPIC=1`)
9. Run unit-level tests (the type-export check) — should pass without API key
10. Set `ANTHROPIC_API_KEY` in `.env`, run live test:
    ```
    RUN_LIVE_ANTHROPIC=1 bun --filter @marketing-auto/adapter-anthropic test
    ```
11. Verify `cost_logs` rows in Drizzle Studio after live test
12. Commit: `feat(adapters): anthropic client with prompt caching and cost tracking (spec 11)`

## Splitting Plan

Single session, ~1 day. No splitting needed. If pressure shows up, the natural split is:
- Session A: types + client + index (steps 1-7), commit after typecheck passes
- Session B: tests + live verification (steps 8-12), commit after live tests pass

`/clear` between if splitting.

## Discovered During Implementation

- `@anthropic-ai/sdk` latest is `0.94.0` (spec said `^0.42.0` which didn't exist). Updated to `^0.94.0`.
- `CacheControlEphemeral.ttl` (`"5m" | "1h"`) IS supported in SDK 0.94 — no workaround needed.
- `packages/adapters/*` needed to be added to root `workspaces` since Bun only resolved `packages/*` (direct children), not nested adapter packages.
- `exactOptionalPropertyTypes` required building the `track()` call conditionally for `pipelineRunId`/`articleId` — same pattern already in `tracker.ts`. Used a `trackBase` object spread with four conditional branches.
- `computeCostEur` and `metadata` callbacks needed explicit `Anthropic.Messages.Message` type annotation because TypeScript couldn't infer the generic `T` from the detached `trackBase` object literal.
- Added `drizzle-orm: ^0.36.0` as a `devDependency` (test file imports `eq` from it directly).

## Deviations

- `@anthropic-ai/sdk` version bumped from `^0.42.0` → `^0.94.0` (latest stable).
- Root `package.json` workspaces extended with `"packages/adapters/*"` to resolve the nested package.
