import {
  buildPromiseBlock,
  programmaticFallbackHook,
  type HookArticleContext,
  type HookOutput,
  type HookPattern,
} from "./hookEngine.ts";
import { buildHookPrompt } from "./hookPrompt.ts";
import { validateHook } from "./hookValidator.ts";

/**
 * Minimal logger interface — caller provides; absent = silent.
 */
export interface HookLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Dependency-injected LLM caller — keeps core free of the Anthropic adapter.
 * Returns the raw LLM text response, or null on failure.
 */
export type HookLlmCaller = (systemPrompt: string, userPrompt: string) => Promise<string | null>;

/**
 * Generate a validated hook with retry logic and programmatic fallback.
 *
 * Mirrors the logic in packages/pipelines GenerateHookStep but is adapter-agnostic.
 * The caller provides a `llmCaller` closure that wraps whatever LLM client is available.
 * If `llmCaller` is not provided, falls through immediately to the programmatic fallback.
 */
export async function generateHookWithGate(
  article: HookArticleContext,
  pattern: HookPattern,
  llmCaller?: HookLlmCaller,
  options?: { maxRetries?: number; log?: HookLogger },
): Promise<HookOutput> {
  const maxRetries = options?.maxRetries ?? 2;
  const log = options?.log;

  if (llmCaller) {
    let lastViolations: string[] | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const { systemPrompt, userPrompt } = buildHookPrompt(
        pattern,
        {
          articleTitle: article.title,
          toolNames: article.toolNames,
          primaryKeyword: article.primaryKeyword ?? "KI-Tools",
        },
        lastViolations,
      );

      let hookPartial: { leadPhrase: string; highlightWord: string; trailPhrase: string } | null = null;
      try {
        const raw = await llmCaller(systemPrompt, userPrompt);
        if (raw) {
          const start = raw.indexOf("{");
          const end = raw.lastIndexOf("}");
          if (start >= 0 && end > start) {
            hookPartial = JSON.parse(raw.slice(start, end + 1)) as {
              leadPhrase: string;
              highlightWord: string;
              trailPhrase: string;
            };
          }
        }
      } catch {
        log?.warn({ attempt, pattern }, "Hook LLM call failed");
      }

      if (hookPartial) {
        const result = validateHook(hookPartial, pattern);
        if (result.valid) {
          const promiseBlock = buildPromiseBlock(pattern, {
            toolCount: article.toolCount,
            primaryKeyword: article.primaryKeyword ?? "KI-Tools",
          });
          return {
            ...hookPartial,
            pattern,
            fullText: `${hookPartial.leadPhrase} ${hookPartial.highlightWord} ${hookPartial.trailPhrase}`.trim(),
            promiseBlock,
          };
        }
        lastViolations = result.violations;
        log?.warn({ attempt, violations: result.violations }, "Hook validation failed, retrying");
      }
    }
  }

  log?.error({ articleId: article.id, pattern }, "Hook generation failed all retries, using programmatic fallback");
  return programmaticFallbackHook(article, pattern);
}
