import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { type FrontmatterFieldDescriptor, articles, db, projects } from "@marketing-auto/db";
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

    // Load project config to get available authors list
    const [proj] = await db
      .select({ astroRepo: projects.astroRepo })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);

    type AuthorEntry = { slug: string; name: string; expertise: string[] };
    const availableAuthors = (
      (proj?.astroRepo as { authors?: AuthorEntry[] } | null)?.authors ?? []
    ) as AuthorEntry[];

    const authorInstruction = availableAuthors.length > 0
      ? `\nAuthor assignment (include "author" field in FRONTMATTER_EXTRAS):\n${
          availableAuthors
            .map((a) => `- "${a.slug}": ${a.name} — ${a.expertise.join(", ")}`)
            .join("\n")
        }\nPick the author whose expertise best matches the article topic. If truly ambiguous, pick the first one.`
      : "";

    const draftInstructions = `
You are writing the FULL DRAFT of an article based on the approved outline.

Hard rules:
1. Write in the project's voice (loaded from marketing-context.md). NEVER drift.
2. Match the outline EXACTLY — same H2s, same key points per section, same order.
   EXCEPTION: always insert a "## Kurzantwort" section immediately after the intro
   (rule 5b below). This section is required regardless of what the outline says.
3. Hit estimated word counts within ±20%. Do not pad.
4. Weave satellite keywords naturally (1-3 mentions per article, total). NO stuffing.
5. Required article structure — follow this order every time:
   a. Intro paragraph(s): the angle from the outline, 2-4 paragraphs. NO H1 header.
      The title comes from frontmatter — do NOT repeat it as a # heading in the body.
   b. ## Kurzantwort: 2-4 sentences as a direct, concrete answer to the article's main
      search query. No Markdown formatting inside. Use specific numbers, names, prices
      where relevant. Write it as if answering someone with 10 seconds to read.
   c. All content H2 sections from the outline (in order, with their key points)
   d. ## Fazit: conclusion with one clear takeaway — not a summary
6. Write in Markdown:
   - NO H1 (#) anywhere in the body
   - H2 for sections (## Section Name)
   - H3 sparingly within sections
   - Use lists when the content is genuinely list-shaped, not as decoration
   - Code blocks with language tag for any code
   - Bold/italic for genuine emphasis only
7. Use concrete examples, specific numbers, real product names where applicable
8. NO em-dashes used as filler. NO "delve", "navigate", "leverage", "robust" unless context demands them.
9. NO internal links — do not invent anchor tags or placeholder links. Spec 24 handles linking.
10. NO custom JSX/MDX component tags (e.g. <AuthorBox />, <ToolCard />, <FaqBlock />, <PricingTable />,
    <TldrAside />, <CallToAction />, <WikiStamp />, or any other PascalCase component).
    The ONLY custom component allowed is <HubCarousel> — it is auto-injected by the system after generation.
    Do NOT write any import statements for custom components. Do NOT write any <ComponentName /> tags.
11. Do NOT write "Stand: <Datum> · Getestet von <Name>" or any similar metadata header.
    Do NOT write "[Author-Name]", "[Datum]", "[Name]" or any placeholder text anywhere.
    Author attribution and publish date are handled by the system — never in the article body.
12. After the conclusion, output a FRONTMATTER_EXTRAS block. This block is stripped before
    publishing — it is metadata only. Fill ALL applicable fields based on the article's topic and intent.${authorInstruction}

FRONTMATTER_EXTRAS fields — output every field that applies:

  IMPORTANT: Use ONLY values listed in the "# Frontmatter Requirements" section of the system
  prompt for any enum field (category, intentType, bottomLinksVariant, winner, listicleType).
  Using a value not in that list will cause Astro schema validation to fail.

  ALWAYS include:
  - "author": slug from the author list above (or omit if list is empty)
  - "category": pick the best matching value from the allowed enum in Frontmatter Requirements
  - "intentType": pick the best matching value from the allowed enum in Frontmatter Requirements
  - "tags": 5-8 specific tags matching the article topic (strings array)
  - "faq": 5-8 Q&A pairs the article answers — write in the article's locale, concrete answers (each answer 2-4 sentences)

  ALWAYS include:
  - "bottomLinksVariant": pick from the allowed enum in Frontmatter Requirements.
    Guidance: tool-review/comparison → "tool", tutorial/guide → "learning",
    pricing/business → "business", comparison → "comparison", general → "default"

  INCLUDE WHEN RELEVANT:
  - "primaryTool": slug of the main tool this article is about (e.g. "chatgpt", "midjourney") — include for tool-focused articles
  - "seoTitle": a shorter/punchier title for <title> tag if the article title is too long (max 60 chars) — omit if title already fits
  - "seoDescription": compelling meta description (max 160 chars, includes primary keyword) — omit if metaDescription already suffices
  - "toolSlugs": array of 2-8 tool slugs being compared — ONLY for comparison/review articles (intentType "comparison" or "review")
  - "winner": pick from allowed enum — ONLY when toolSlugs is set and there is a clear winner
  - "verdict": 1-2 sentence summary of the comparison outcome — ONLY when toolSlugs is set
  - "testMethodology": 1-3 sentences how you tested — ONLY for review/comparison with hands-on testing
  - "useCaseVerdicts": array of {useCase, winner, reason} — ONLY for "depends" winner comparisons
  - "listicleType": pick from allowed enum — ONLY for listicle-style articles (top-X, alternatives)

Output format:
[intro paragraphs — no # H1]

## Kurzantwort

[2-4 sentences, plain text, concrete answer to the main search query]

## [First content H2 from outline]

[...]

## Fazit

[conclusion with clear takeaway]

<!-- FRONTMATTER_EXTRAS: {"author":"<slug>","category":"...","intentType":"...","bottomLinksVariant":"...","tags":[...],"faq":[{"question":"...","answer":"..."}]} -->
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
    // Pattern: <!-- FRONTMATTER_EXTRAS: {...JSON...} -->
    // NOTE: the LLM sometimes omits the closing "-->", so we strip from the marker
    // to end-of-string unconditionally (it is always the last thing in the body).
    const extrasStartIdx = result.raw.indexOf("<!-- FRONTMATTER_EXTRAS:");
    let bodyMd = result.raw;
    let frontmatterExtras: Record<string, unknown> | null = null;

    if (extrasStartIdx !== -1) {
      // Try to parse the JSON between the opening tag and an optional closing -->
      const extrasRaw = result.raw.slice(extrasStartIdx);
      const jsonMatch = extrasRaw.match(/<!--\s*FRONTMATTER_EXTRAS:\s*(\{[\s\S]*)/);
      if (jsonMatch?.[1]) {
        // Remove optional trailing --> and whitespace before parsing
        const jsonStr = jsonMatch[1].replace(/\s*-->\s*$/, "").trimEnd();
        try {
          frontmatterExtras = JSON.parse(jsonStr) as Record<string, unknown>;
        } catch {
          // best-effort — invalid JSON means we just skip extras
        }
      }
      // Strip everything from the marker to end-of-string
      bodyMd = result.raw.slice(0, extrasStartIdx).trimEnd();
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

    // Strip "Stand: <date> · Getestet von <name>" placeholder lines the LLM sometimes adds
    // despite explicit instructions. Catches bolded, italicised, and plain variants.
    bodyMd = bodyMd
      .replace(/^[*_]*Stand:\s+\S[^\n]*·[^\n]*Getestet\s+von[^\n]*[*_]*\n?/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Validate author slug against the available list — null if unknown or list is empty
    const rawAuthorSlug = frontmatterExtras?.author;
    const chosenAuthor: string | null =
      typeof rawAuthorSlug === "string" && rawAuthorSlug.trim().length > 0
        ? availableAuthors.length === 0 ||
          availableAuthors.some((a) => a.slug === rawAuthorSlug.trim())
          ? rawAuthorSlug.trim()
          : null
        : null;

    // Persist extras and author in separate updates (avoids complex conditional typing)
    if (frontmatterExtras) {
      await db
        .update(articles)
        .set({ frontmatterExtras })
        .where(eq(articles.id, input.articleId));
    }
    if (chosenAuthor) {
      await db
        .update(articles)
        .set({ author: chosenAuthor })
        .where(eq(articles.id, input.articleId));
    }

    return { bodyMd, wordCount };
  }
}
