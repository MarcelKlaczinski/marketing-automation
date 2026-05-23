import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import type { FrontmatterFieldDescriptor } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { batchLlmCall } from "../../engine/batch-llm-client.ts";
import { loadTenantPromptVars } from "../../_lib/tenant-prompt-vars.ts";

const log = createLogger("pipelines:outline-step");
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { resolveMasterPrompt } from "../../config/index.ts";
import {
  type ArticleOutline,
  ArticleOutlineSchema,
  ArticleOutlineSchemaOutput,
  type ResearchResult,
} from "../types.ts";

const InputSchema = z.object({
  cornerstoneKeyword: z.string(),
  satelliteKeywords: z.array(z.string()),
  clusterName: z.string(),
  clusterPillar: z.string(),
  projectSlug: z.string(),
  research: z.unknown(),
  modelOverride: z.string().optional(),
  locale: z.enum(["de", "en"]).optional(),
  // Editor-chosen title hint — null means LLM should invent one freely
  suggestedTitle: z.string().nullable().optional(),
  // Spec 50: frontmatter schema for this collection — injected into system prompt
  frontmatterSchema: z.array(z.unknown()).nullable().optional(),
  // Spec 54.9: source-aware context injected into user message (not system prompt — preserves cache)
  sourceContext: z.string().optional(),
  // Spec 54.9: relevant tools context for the cluster (pre-generation phase)
  toolsContext: z.string().optional(),
  // Spec 54.9.1: linked article ID — passed through to cost_logs for per-article cost queries
  articleId: z.string().uuid().optional(),
});

export class OutlineStep extends BaseStep<z.infer<typeof InputSchema>, ArticleOutline> {
  readonly name = "outline";
  readonly inputSchema = InputSchema;
  readonly outputSchema = ArticleOutlineSchemaOutput;
  override readonly llmBound = true;

  override estimatedCostEur(): number {
    return 0.07; // Sonnet 4.6 @ up to 8k output tokens
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const research = input.research as ResearchResult;
    const model =
      (input.modelOverride as "claude-opus-4-7" | "claude-sonnet-4-6" | undefined) ??
      "claude-sonnet-4-6";

    // Spec multi-domain-evolution S4.4: tenant-resolved prompt variables.
    // Toolwiki resolves to "toolwiki.ai" + "an AI tool wiki" — byte-identical
    // to the legacy hardcoded substring. Deeper scope-bullet examples below
    // stay as Toolwiki defaults; non-Toolwiki tenants override via
    // `project_configurations.masterPrompts['article.outline']`.
    const tenantVars = await loadTenantPromptVars(ctx.projectId);

    const OUTLINE_STEP_DEFAULT_PROMPT = `
You are producing the OUTLINE for an article on ${tenantVars.domain} — ${tenantVars.nicheArticle}.

SCOPE GUARDRAIL (check FIRST before anything else):
${tenantVars.domain} publishes ONLY content that is primarily about ${tenantVars.nicheScopeShort}:
  ✓ AI tool reviews, comparisons, pricing (ChatGPT, Claude, Midjourney, Cursor, etc.)
  ✓ AI productivity workflows and use cases
  ✓ LLM/AI concepts and techniques (prompt engineering, RAG, fine-tuning, agents, etc.)
  ✓ AI-powered features of any software (e.g. Notion AI, Grammarly AI)
  ✗ General SaaS/software with no meaningful AI component
  ✗ Media streaming, music services, sports, cooking, travel, finance without AI angle
  ✗ Traditional SEO tools, web hosting, project management (unless AI-powered)

If the topic has NO meaningful AI angle, return ONLY this JSON and stop:
{"outOfScope": true, "reason": "one sentence why", "aiAngle": "optional: how to reframe with AI focus"}

If there IS an AI angle but the cluster topic is framed too broadly (e.g. "Streaming-Dienste Vergleich"),
REFRAME it around AI: "How AI Shapes Music Recommendations: Spotify, Apple Music and YouTube Music Compared".
The AI feature must be the primary focus, not a footnote.

Marcel will review this outline before any draft is written. The outline must be specific enough that:
- A different writer could pick it up and produce a draft that matches the intent
- Marcel can spot strategic mistakes (wrong angle, wrong sections) in 2 minutes of reading
- The draft step has all the structural decisions made

Rules:
1. **Title**: Specific, intent-matching, ~60 chars (fits in SERP). Include the cornerstone
   keyword naturally. NO clickbait, NO ALL-CAPS, NO "[YEAR]" placeholders.
2. **Slug**: kebab-case, lowercase, max 60 chars, German-friendly (umlauts → ae/oe/ue/ss).
3. **Meta description**: 150-160 chars, includes cornerstone keyword, action-oriented.
4. **Intro angle**: 100-200 words explaining HOW we open this article.
   What's the hook? What stake does the reader have?
5. **Sections** (4-12 H2s, ordered for narrative flow):
   - Each H2 is specific (not "Introduction", "Conclusion" — those are the surrounding intro/outro)
   - Each section lists 2-10 key points the draft must hit
   - Each section has an estimated word count summing to 800-3500 total
   - Sections naturally weave in satellite keywords where relevant
6. **Hero image**: A highly specific prompt for Nano Banana 2.
   Rules:
   - Describe a concrete scene with 1-3 physical objects. No abstract concepts.
   - Include composition (overhead flatlay / 3/4 angle / close-up), lighting (diffused window
     light / studio rim light), background (cream, dark slate, marble, etc.) and mood.
   - For articles about a specific product/tool (ChatGPT, Claude, Midjourney, etc.):
     reference its brand color and/or visual identity (icon shape, UI style) concretely.
     Example: "ChatGPT teal-green (#10A37F) card", "Claude orange gradient sphere".
   - **NO text labels of any kind.** No tier names, no brand-name lettering on cards,
     no checklist items, no annotations, no readable writing in the scene. Convey
     hierarchy / tiers / sequence via shape, color, position, or symbolic icons
     (squares, circles, arrows, checkmarks, stars) — never via rendered text.
     If a brand identity requires its name visible, the brand's official logo glyph
     (not text) is OK; otherwise leave the surface clean.
   - AVOID: people, faces, screens showing UI text, dense paragraphs of text,
     watermarks, typography, signage, captions, labels, readable writing of any kind.
   - Style enum picks the rendering mode — choose what best fits the scene.
   Target: 80-200 words. Longer is better than vague.
7. **Estimated total words**: Realistic; do not pad.

You have access to:
- The marketing-context.md (voice, audience, pillars)
- Competitor synthesis (what the SERP covers — you should DIFFER strategically)
- Cluster context (this article is part of "${input.clusterName}", pillar "${input.clusterPillar}")
- Satellite keywords (must appear naturally; do not stuff)

Output a single JSON object with EXACTLY this shape (no extra keys, no markdown):
{
  "title": "string — 20-120 chars, keyword-rich SERP title",
  "slug": "string — kebab-case a-z0-9- only, max 60 chars",
  "metaDescription": "string — 80-180 chars, action-oriented",
  "introAngle": "string — 100-2000 chars, explains the opening hook",
  "sections": [
    {
      "h2": "string — 5-150 chars, specific section heading",
      "intent": "string — 20-500 chars, what this section achieves",
      "keyPoints": ["string min 10 chars", "..."],
      "estimatedWords": 200,
      "targetKeywords": ["optional satellite keyword", "..."]
    }
  ],
  "heroImagePrompt": "string — 80-800 chars, specific Nano Banana 2 prompt (see rule 6 above)",
  "heroImageStyle": "photorealistic" | "illustrated" | "3d_render" | "minimalist",
  "estimatedTotalWords": 1500
}
Constraints: sections 4-12 items; keyPoints 2-10 per section; estimatedTotalWords 800-5000.
    `.trim();

    const outlineInstructions = await resolveMasterPrompt({
      projectId: ctx.projectId,
      promptKey: "article.outline",
      fallback: OUTLINE_STEP_DEFAULT_PROMPT,
    });

    const promptBase = {
      skills: ["copywriting", "content-strategy", "ai-seo", "schema"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: outlineInstructions,
      ...(input.frontmatterSchema?.length
        ? { frontmatterSchema: input.frontmatterSchema as FrontmatterFieldDescriptor[] }
        : {}),
    };
    const prompt = await buildSystemPrompt(
      input.locale ? { ...promptBase, locale: input.locale } : promptBase
    );

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    // cacheablePrefix (skill + project context) stays cached and unaffected.
    const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);

    const userMsg = [
      "# Article brief",
      `**Cornerstone keyword**: ${input.cornerstoneKeyword}`,
      `**Cluster**: ${input.clusterName} (pillar: ${input.clusterPillar})`,
      `**Satellite keywords to weave in**: ${input.satelliteKeywords.join(", ")}`,
      input.suggestedTitle
        ? `**Suggested title** (editorially chosen — use it verbatim if it is already SERP-strong; ` +
          `only change it if you have a clear SEO reason): "${input.suggestedTitle}"`
        : "",
      // Spec 54.9: source context (non-empty only for gap_analysis / trend_discovery briefs)
      ...(input.sourceContext ? ["", input.sourceContext] : []),
      // Spec 54.9: tools context (non-empty when cluster has tool articles)
      ...(input.toolsContext ? ["", input.toolsContext] : []),
      "",
      "# SERP analysis",
      research.competitorSynthesis,
      "",
      "# Top organic competitors (for reference)",
      research.serp.organicResults
        .slice(0, 5)
        .map((r) => `- ${r.title} (${r.domain})`)
        .join("\n"),
      "",
      "# People Also Ask (use these to inform reader intent)",
      research.serp.peopleAlsoAsk
        .slice(0, 8)
        .map((q) => `- ${q}`)
        .join("\n") || "(none)",
      "",
      "Now produce the outline.",
    ].join("\n");

    // Sonnet 4.6 / Opus 4.7 reject assistant-message prefill (HTTP 400).
    // Omit `jsonMode` and extract JSON manually from `result.raw`.
    // The trailing instruction is a belt-and-suspenders signal alongside the
    // schema example already in the step prompt.
    const callArgs = {
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      ...(input.articleId !== undefined ? { articleId: input.articleId } : {}),
      operation: COST_OPS.ARTICLE_OUTLINE,
      model,
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix:
        systemSuffix +
        "\n\nRespond with only a valid JSON object. No markdown fences, no prose preamble.",
      userMessage: userMsg,
      maxTokens: 8000,
      estimatedCostEur: this.estimatedCostEur(),
    };

    // Spec 61.4 resume path: batch result injected by the runner — parse cached content directly.
    if (ctx.batchResult?.stepKey === "outline") {
      log.info({ articleId: input.articleId }, "outline: using cached batch result (resume path)");
      // Batch responses may include ```json … ``` fences (no assistant prefill in batch mode).
      // Slice from the first '{' to the last '}' to be fence-tolerant.
      const raw = ctx.batchResult.content;
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
      const parsed = JSON.parse(json) as unknown;
      return ArticleOutlineSchema.parse(parsed);
    }

    // Spec 61.4: batch mode — enqueue for Anthropic Batch API, suspend pipeline (Pattern 118)
    if (ctx.llmMode === "batch") {
      const batchResult = await batchLlmCall({
        ...callArgs,
        stepKey: "outline",
        mode: "batch",
      });
      if (batchResult.mode === "batch") {
        // Return suspension signal — runner intercepts before outputSchema.parse() (Pattern 118)
        return { batchPending: true, batchRequestId: batchResult.batchRequestId } as unknown as ArticleOutline;
      }
    }

    // Sync mode (default): manual JSON extract (Sonnet/Opus reject prefill).
    // Retry once if first response doesn't contain a parseable JSON object.
    const sliceJson = (raw: string): string => {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) {
        throw new SyntaxError("no JSON object braces in response");
      }
      return raw.slice(start, end + 1);
    };

    let parsed: unknown;
    try {
      const result = await anthropic.messages(callArgs);
      parsed = JSON.parse(sliceJson(result.raw));
    } catch (err) {
      log.warn(
        { articleId: input.articleId, err: err instanceof Error ? err.message : String(err) },
        "outline: invalid JSON on first attempt — retrying once",
      );
      const result = await anthropic.messages({ ...callArgs, forceRefresh: true });
      parsed = JSON.parse(sliceJson(result.raw));
    }

    return ArticleOutlineSchema.parse(parsed);
  }
}
