import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { type FrontmatterFieldDescriptor, articles, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  modelOverride: z.string().optional(),
  locale: z.enum(["de", "en"]).optional(),
  // Spec 50: frontmatter schema — injected into prompt so LLM outputs FRONTMATTER_EXTRAS block
  frontmatterSchema: z.array(z.unknown()).nullable().optional(),
});

const OutputSchema = z.object({
  bodyMd: z.string().min(500),
  wordCount: z.number().int().min(500),
});

export class DraftStep extends BaseStep<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  readonly name = "draft";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0.8;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article) throw new ArticlePipelineError(`Article ${input.articleId} not found`, "draft");
    if (!article.outline) throw new ArticlePipelineError("Article has no outline", "draft");

    const outline = ArticleOutlineSchema.parse(article.outline);
    const model =
      (input.modelOverride as "claude-opus-4-7" | "claude-sonnet-4-6" | undefined) ??
      "claude-sonnet-4-6";

    const draftInstructions = `
You are writing the FULL DRAFT of an article based on the approved outline.

Hard rules:
1. Write in the project's voice (loaded from marketing-context.md). NEVER drift.
2. Match the outline EXACTLY — same H2s, same key points per section, same order.
3. Hit estimated word counts within ±20%. Do not pad.
4. Weave satellite keywords naturally (1-3 mentions per article, total). NO stuffing.
5. Write in Markdown:
   - H2 for sections (## Section Name)
   - H3 sparingly within sections
   - Use lists when the content is genuinely list-shaped, not as decoration
   - Code blocks with language tag for any code
   - Bold/italic for genuine emphasis only
6. Open with the intro angle from the outline (not a generic "In this article we will..." intro)
7. End with a conclusion that has a clear takeaway, not a summary
8. Use concrete examples, specific numbers, real product names where applicable
9. NO em-dashes used as filler. NO "delve", "navigate", "leverage", "robust" unless context demands them.
10. NO internal links — do not invent anchor tags or placeholder links. Spec 24 handles linking.
11. After the conclusion, output a FRONTMATTER_EXTRAS block (see Frontmatter Requirements in system prompt).
    This block is stripped before publishing — it is metadata only.

Output format:
[article body in Markdown]

<!-- FRONTMATTER_EXTRAS: {"category":"...","intentType":"...","tags":[...],"faq":[{"question":"...","answer":"..."},...]} -->
    `.trim();
    const promptBase = {
      skills: ["copywriting", "copy-editing", "ai-seo", "product-marketing-context"],
      projectIdOrSlug: input.projectSlug,
      stepInstructions: draftInstructions,
      ...(input.frontmatterSchema?.length
        ? {
            // Spec 50: InputSchema accepts z.unknown() for bridge flexibility; runtime type guaranteed by caller
            frontmatterSchema: input.frontmatterSchema as FrontmatterFieldDescriptor[]
          }
        : {}),
    };
    const prompt = await buildSystemPrompt(
      input.locale ? { ...promptBase, locale: input.locale } : promptBase
    );

    const userMsg = [
      "# Outline to write",
      `**Title**: ${outline.title}`,
      `**Meta description**: ${outline.metaDescription}`,
      "",
      "## Intro angle",
      outline.introAngle,
      "",
      "## Sections",
      outline.sections
        .map((s, i) =>
          [
            `### ${i + 1}. ${s.h2}`,
            `*Intent*: ${s.intent}`,
            `*Estimated words*: ${s.estimatedWords}`,
            "*Key points*:",
            ...s.keyPoints.map((p) => `- ${p}`),
            s.targetKeywords.length > 0
              ? `*Naturally include*: ${s.targetKeywords.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n\n"),
      "",
      "Now write the full article in Markdown.",
    ].join("\n");

    const result = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.ARTICLE_DRAFT,
      model,
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix: prompt.variableSuffix,
      userMessage: userMsg,
      maxTokens: 8000,
      estimatedCostEur: this.estimatedCostEur(),
    });

    // Spec 50: Extract and strip the FRONTMATTER_EXTRAS block from the draft body.
    // Pattern: <!-- FRONTMATTER_EXTRAS: {...} -->
    const extrasMatch = result.raw.match(
      /<!--\s*FRONTMATTER_EXTRAS:\s*(\{[\s\S]*?\})\s*-->/
    );
    let bodyMd = result.raw;
    let frontmatterExtras: Record<string, unknown> | null = null;

    if (extrasMatch?.[1]) {
      try {
        frontmatterExtras = JSON.parse(extrasMatch[1]) as Record<string, unknown>;
      } catch {
        // best-effort — invalid JSON means we just skip extras
      }
      // Strip the block from the published body
      bodyMd = result.raw.replace(/\n*<!--\s*FRONTMATTER_EXTRAS:[\s\S]*?-->\s*$/, "").trimEnd();
    }

    // Inject HubCarousel: import at the top, component before the last ## section (Fazit).
    // The HubCarousel renders related cluster articles and must always be present in MDX.
    const hubImport = `import HubCarousel from '@/components/content/HubCarousel.astro';`;
    const excludeSlug = article.slug ?? input.articleId;

    // Prepend import (only if not already present — idempotent on re-generation)
    if (!bodyMd.includes("HubCarousel")) {
      // Find the last H2 heading to place <HubCarousel> just before it
      const lastH2Match = [...bodyMd.matchAll(/^## /gm)].at(-1);
      if (lastH2Match?.index !== undefined) {
        const idx = lastH2Match.index;
        bodyMd =
          hubImport +
          "\n\n" +
          bodyMd.slice(0, idx).trimEnd() +
          `\n\n<HubCarousel excludeSlug="${excludeSlug}" />\n\n` +
          bodyMd.slice(idx);
      } else {
        // No H2 found — append at end
        bodyMd = hubImport + "\n\n" + bodyMd + `\n\n<HubCarousel excludeSlug="${excludeSlug}" />`;
      }
    }

    const wordCount = bodyMd.trim().split(/\s+/).length;

    if (wordCount < 500) {
      throw new ArticlePipelineError(
        `Draft too short: ${wordCount} words. Outline estimated ${outline.estimatedTotalWords}.`,
        "draft"
      );
    }

    // Persist frontmatterExtras to DB alongside the body
    if (frontmatterExtras) {
      await db
        .update(articles)
        .set({ frontmatterExtras })
        .where(eq(articles.id, input.articleId));
    }

    return { bodyMd, wordCount };
  }
}
