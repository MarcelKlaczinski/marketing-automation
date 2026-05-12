import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import type { FrontmatterFieldDescriptor } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
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
});

export class OutlineStep extends BaseStep<z.infer<typeof InputSchema>, ArticleOutline> {
  readonly name = "outline";
  readonly inputSchema = InputSchema;
  readonly outputSchema = ArticleOutlineSchemaOutput;

  override estimatedCostEur(): number {
    return 0.6; // Opus 4.7 @ up to 8k output tokens
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const research = input.research as ResearchResult;
    const model =
      (input.modelOverride as "claude-opus-4-7" | "claude-sonnet-4-6" | undefined) ??
      "claude-opus-4-7";

    const outlineInstructions = `
You are producing the OUTLINE for an article. Marcel will review this outline
before any draft is written. The outline must be specific enough that:
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
6. **Hero image**: A specific prompt for Flux 1.1 Pro. NOT generic ("a person at a desk").
   Specific composition + style + mood. Include style enum.
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
  "heroImagePrompt": "string — 30-500 chars, specific Flux 1.1 Pro prompt",
  "heroImageStyle": "photorealistic" | "illustrated" | "3d_render" | "minimalist",
  "estimatedTotalWords": 1500
}
Constraints: sections 4-12 items; keyPoints 2-10 per section; estimatedTotalWords 800-5000.
    `.trim();
    const promptBase = {
      skills: ["copywriting", "content-strategy", "ai-seo", "schema-markup"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: outlineInstructions,
      ...(input.frontmatterSchema?.length
        ? { frontmatterSchema: input.frontmatterSchema as FrontmatterFieldDescriptor[] }
        : {}),
    };
    const prompt = await buildSystemPrompt(
      input.locale ? { ...promptBase, locale: input.locale } : promptBase
    );

    const userMsg = [
      "# Article brief",
      `**Cornerstone keyword**: ${input.cornerstoneKeyword}`,
      `**Cluster**: ${input.clusterName} (pillar: ${input.clusterPillar})`,
      `**Satellite keywords to weave in**: ${input.satelliteKeywords.join(", ")}`,
      input.suggestedTitle
        ? `**Suggested title** (editorially chosen — use it verbatim if it is already SERP-strong; ` +
          `only change it if you have a clear SEO reason): "${input.suggestedTitle}"`
        : "",
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

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.ARTICLE_OUTLINE,
      model,
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 8000,
      jsonMode: true,
      estimatedCostEur: this.estimatedCostEur(),
    });

    return ArticleOutlineSchema.parse(result.json);
  }
}
