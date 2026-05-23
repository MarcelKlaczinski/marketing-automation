import {
  buildPromiseBlock,
  programmaticFallbackHook,
  type HookArticleContext,
  type HookOutput,
  type HookPattern,
} from "./hookEngine.ts";
import { buildHookPrompt, buildContentPrompt, type ContentPromptContext } from "./hookPrompt.ts";
import { validateHook } from "./hookValidator.ts";

export interface HookLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export type HookLlmCaller = (systemPrompt: string, userPrompt: string) => Promise<string | null>;

export interface GeneratedContent {
  hookOutput: HookOutput;
  caption: string;
  hashtags: string[];
}

/**
 * Generate a validated hook with retry logic and programmatic fallback.
 * Kept for backward compatibility — used by packages/pipelines GenerateHookStep.
 * For new template renders, prefer generateContentWithGate().
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
        undefined, // nicheLabel — uses default "AI tools niche" (this is back-compat path)
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

/**
 * Generate hook + caption + hashtags in a single LLM call.
 * If the hook part fails validation, retries the full call.
 * Falls back to programmatic hook + static caption on total failure.
 */
export async function generateContentWithGate(
  article: HookArticleContext,
  pattern: HookPattern,
  contentCtx: ContentPromptContext,
  llmCaller?: HookLlmCaller,
  options?: { maxRetries?: number; log?: HookLogger },
): Promise<GeneratedContent> {
  const maxRetries = options?.maxRetries ?? 2;
  const log = options?.log;

  if (llmCaller) {
    let lastViolations: string[] | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const { systemPrompt, userPrompt } = buildContentPrompt(pattern, contentCtx, lastViolations);

      type ContentRaw = {
        leadPhrase: string;
        highlightWord: string;
        trailPhrase: string;
        caption: string | null;
        hashtags: string[] | null;
      };
      let contentRaw: ContentRaw | null = null;

      try {
        const raw = await llmCaller(systemPrompt, userPrompt);
        if (raw) {
          const start = raw.indexOf("{");
          const end = raw.lastIndexOf("}");
          if (start >= 0 && end > start) {
            const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
            if (typeof obj["leadPhrase"] === "string" && typeof obj["highlightWord"] === "string" && typeof obj["trailPhrase"] === "string") {
              contentRaw = {
                leadPhrase: obj["leadPhrase"],
                highlightWord: obj["highlightWord"],
                trailPhrase: obj["trailPhrase"],
                caption: typeof obj["caption"] === "string" ? obj["caption"] : null,
                // safe: LLM output is controlled; filter to string elements only
                hashtags: Array.isArray(obj["hashtags"]) ? (obj["hashtags"] as unknown[]).filter((h): h is string => typeof h === "string") : null,
              };
            }
          }
        }
      } catch {
        log?.warn({ attempt, pattern }, "Content LLM call failed");
      }

      if (contentRaw) {
        const hookPartial = {
          leadPhrase: contentRaw.leadPhrase,
          highlightWord: contentRaw.highlightWord,
          trailPhrase: contentRaw.trailPhrase,
        };
        const result = validateHook(hookPartial, pattern);
        if (result.valid) {
          const promiseBlock = buildPromiseBlock(pattern, {
            toolCount: article.toolCount,
            primaryKeyword: article.primaryKeyword ?? "KI-Tools",
          });
          const hookOutput: HookOutput = {
            ...hookPartial,
            pattern,
            fullText: `${hookPartial.leadPhrase} ${hookPartial.highlightWord} ${hookPartial.trailPhrase}`.trim(),
            promiseBlock,
          };
          return {
            hookOutput,
            caption: contentRaw.caption ?? buildFallbackCaption(contentCtx),
            hashtags: (contentRaw.hashtags && contentRaw.hashtags.length > 0) ? contentRaw.hashtags : buildFallbackHashtags(contentCtx),
          };
        }
        lastViolations = result.violations;
        log?.warn({ attempt, violations: result.violations }, "Content hook validation failed, retrying");
      }
    }
  }

  log?.error({ articleId: article.id, pattern }, "Content generation failed all retries, using fallback");
  return {
    hookOutput: programmaticFallbackHook(article, pattern),
    caption: buildFallbackCaption(contentCtx),
    hashtags: buildFallbackHashtags(contentCtx),
  };
}

function buildFallbackCaption(ctx: ContentPromptContext): string {
  const toolNames = ctx.toolNames.join(" vs. ");
  const domain = ctx.domain ?? "toolwiki.ai";
  if (ctx.locale === "de") {
    if (ctx.contentType === "comparison" || ctx.contentType === "use-case") {
      return `${toolNames}: Ehrlicher Vergleich nach intensivem Test.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ ${domain}/${ctx.articleSlug}`;
    }
    return `${ctx.toolNames[0] ?? ctx.articleSlug} im Check — lohnt es sich wirklich?\n\nSpeicher diesen Post für wenn du das nächste Tool evaluierst.\n\n→ ${domain}/${ctx.articleSlug}`;
  }
  if (ctx.contentType === "comparison" || ctx.contentType === "use-case") {
    return `${toolNames}: An honest comparison after real-world testing.\n\nSave this post for your next tool decision.\n\n→ ${domain}/${ctx.articleSlug}`;
  }
  return `${ctx.toolNames[0] ?? ctx.articleSlug} reviewed — is it worth it?\n\nSave this post for your next tool evaluation.\n\n→ ${domain}/${ctx.articleSlug}`;
}

function buildFallbackHashtags(ctx: ContentPromptContext): string[] {
  const isComparison = ctx.contentType === "comparison" || ctx.contentType === "use-case";
  if (ctx.locale === "de") {
    return isComparison
      ? ["#KITools", "#AITools", "#KIVergleich", "#AIComparison", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest"]
      : ["#KITools", "#AITools", "#KIFürBusiness", "#AIForBusiness", "#Produktivität", "#Productivity", "#DigitalTools"];
  }
  return isComparison
    ? ["#AITools", "#AIComparison", "#AIForBusiness", "#SoftwareReview", "#Productivity", "#DigitalTools", "#TechTools"]
    : ["#AITools", "#AIForBusiness", "#Productivity", "#DigitalTools", "#SoftwareReview", "#TechTools", "#AIProductivity"];
}
