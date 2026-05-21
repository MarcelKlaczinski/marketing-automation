import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { eq, type FrontmatterFieldDescriptor, articles, db, projects } from "@marketing-auto/db";
import { ARTICLE_COLLECTION_TYPES, type ArticleCollectionType } from "@marketing-auto/shared";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { resolveMasterPrompt } from "../../config/index.ts";
import { validateComparisonExtras } from "../frontmatter/comparison.ts";
import { validateKiWissenExtras } from "../frontmatter/ki-wissen.ts";
import { buildComparisonContextFragment, selectDraftPrompt } from "../prompts/index.ts";
import { ArticleOutlineSchema, ArticlePipelineError } from "../types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  modelOverride: z.string().optional(),
  locale: z.enum(["de", "en"]).optional(),
  // Spec 50: frontmatter schema — injected into prompt so LLM outputs FRONTMATTER_EXTRAS block
  frontmatterSchema: z.array(z.unknown()).nullable().optional(),
  // Spec 54.9: source-aware context injected into user message (not system prompt — preserves cache)
  sourceContext: z.string().optional(),
  // Spec 54.9: relevant tools context for the cluster (pre-generation phase)
  toolsContext: z.string().optional(),
  // Spec 61.2: collection type drives prompt selection; defaults to 'blog' when absent
  collectionType: z.enum(ARTICLE_COLLECTION_TYPES).optional(),
  // Spec 61.2: explicit tool slugs (2-4) for comparison articles; resolved from brief in standalone flow
  comparisonToolSlugs: z.array(z.string()).optional(),
  comparisonToolNames: z.array(z.string()).optional(),
});

const OutputSchema = z.object({
  bodyMd: z.string().min(500),
  wordCount: z.number().int().min(500),
});

export class DraftStep extends BaseStep<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  readonly name = "draft";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  override readonly llmBound = true;

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

    const DRAFT_STEP_DEFAULT_PROMPT = `
You are writing the FULL DRAFT of an article for toolwiki.ai — an AI tool wiki.

SCOPE CHECK: Every article must be primarily about AI/ML tools, AI features, AI concepts,
or AI use cases. If the outline topic has no meaningful AI connection, stop immediately
and output ONLY: {"draftRefused": true, "reason": "topic is not AI-related"}

Hard rules:
1. Write in the project's voice (loaded from marketing-context.md). NEVER drift.
   Anchor every section to the AI angle — never let non-AI context become the focus.
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

  IMPORTANT: Use ONLY the exact string values listed below for enum fields.
  Never invent variants (no underscores, no capitalization, no abbreviations).
  Using any value not in these lists causes a hard schema error that breaks the article.

  ALWAYS include:
  - "author": slug from the author list above (or omit if list is empty)
  - "category": pick from the allowed enum in "# Frontmatter Requirements" (exact value, no modifications)
  - "intentType": pick EXACTLY ONE of these values — copy it character-for-character:
      "overview" | "pricing" | "features" | "use-cases" | "comparison" | "tutorial" | "review" | "ethics" | "general"
      Note: "use-cases" has a hyphen, NOT an underscore. "general" is the fallback when nothing else fits.
  - "tags": 5-8 specific tags matching the article topic (strings array)
  - "excerpt": 1-2 sentences (max 160 chars) summarising the article's core answer — used as Astro collection excerpt.
      Write in the article's locale. Should include the primary keyword. No fluff, no clickbait.
  - "faq": 5-8 Q&A pairs the article answers — write in the article's locale, concrete answers (each answer 2-4 sentences)

  ALWAYS include:
  - "bottomLinksVariant": pick from the allowed enum in "# Frontmatter Requirements".
    Guidance: tool-review/comparison → "tool", tutorial/guide → "learning",
    pricing/business → "business", comparison → "comparison", general → "default"

  INCLUDE WHEN RELEVANT:
  - "primaryTool": slug of the main tool this article is about (e.g. "chatgpt", "midjourney") — include for tool-focused articles
  - "seoTitle": a shorter/punchier title for <title> tag if the article title is too long (max 60 chars) — omit if title already fits
  - "seoDescription": compelling meta description (max 160 chars, includes primary keyword) — omit if metaDescription already suffices

  COMPARISON/REVIEW FIELDS — include ONLY when ALL three conditions are true:
    (a) intentType is "comparison" or "review"
    (b) the article directly compares or reviews 2 or more named tools
    (c) you can list at least 2 real tool slugs
  If any condition is false, OMIT these fields entirely — do not write empty arrays or placeholder values:
  - "toolSlugs": array of exactly 2-8 tool slugs that are compared (e.g. ["chatgpt", "claude", "gemini"])
  - "winner": pick from the allowed winner enum — ONLY when there is a clear single winner
  - "verdict": 1-2 sentence summary of the comparison outcome
  - "testMethodology": 1-3 sentences how you tested — ONLY for hands-on testing articles
  - "useCaseVerdicts": array of {useCase, winner, reason} — ONLY for "depends" winner comparisons

  TOOL SPOTLIGHT FIELDS — include ONLY when ALL three conditions are true:
    (a) intentType is "overview", "features", "review", "pricing", or "use-cases"
    (b) the article focuses on a single named AI tool (primaryTool is set)
    (c) you have enough information from the outline to fill the fields meaningfully
  If any condition is false, OMIT these fields entirely — do not write empty arrays or null values:
  - "pros": array of 2-5 objects, each {"text": "one concrete advantage of this tool"}
      Write factual pros backed by the article content. No marketing fluff.
  - "cons": array of 0-4 objects, each {"text": "one concrete limitation or drawback"}
      Include ONLY real limitations. Omit the field entirely if there are none worth mentioning.
  - "features": array of 0-6 strings, each a key feature name (e.g. "GPT-4o integration", "API access")
      Write feature names, not sentences.
  - "useCases": array of 0-4 strings, each a concrete use case (e.g. "Code review", "Email drafting")
      These feed the social media template — keep them short (2-4 words each).
  - "pricingTier": EXACTLY ONE of these values (copy character-for-character): "free" | "freemium" | "paid" | "enterprise"
      "free" = completely free, no paid tier
      "freemium" = free tier exists + paid upgrades
      "paid" = paid only, no meaningful free tier
      "enterprise" = enterprise/custom pricing only
  - "priceFrom": the starting price in USD/EUR per month as a number (e.g. 20 for "$20/month")
      Use 0 when pricingTier is "free". Omit if price is unknown or enterprise-only.
  - "rating": a number from 0.0 to 5.0 reflecting the overall tool quality based on article content
      Use one decimal place (e.g. 4.2). Omit if the article does not reach a clear verdict.

  LISTICLE FIELDS — include ONLY for top-X or "alternatives to X" articles:
  - "listicleType": pick from allowed enum in "# Frontmatter Requirements"

Output format:
[intro paragraphs — no # H1]

## Kurzantwort

[2-4 sentences, plain text, concrete answer to the main search query]

## [First content H2 from outline]

[...]

## Fazit

[conclusion with clear takeaway]

<!-- FRONTMATTER_EXTRAS: {"author":"<slug>","category":"...","intentType":"...","excerpt":"...","bottomLinksVariant":"...","tags":[...],"faq":[{"question":"...","answer":"..."}]} -->
    `.trim();

    // Spec 61.2: collection-specific prompt selector — null = use blog default
    const collectionType: ArticleCollectionType = input.collectionType ?? "blog";
    // ISO 8601 always contains "T", so split[0] is always defined; fallback only
    // exists to satisfy `noUncheckedIndexedAccess`.
    const today = new Date().toISOString().split("T")[0] ?? "";
    const collectionPromptFn = selectDraftPrompt(collectionType);
    const baseInstructions = collectionPromptFn
      ? collectionPromptFn({ authorInstruction, today, locale: input.locale ?? "de" })
      : DRAFT_STEP_DEFAULT_PROMPT;

    const draftInstructions = await resolveMasterPrompt({
      projectId: input.projectId,
      promptKey: "article.draft",
      fallback: baseInstructions,
    });

    const promptBase = {
      skills: ["copywriting", "copy-editing", "ai-seo", "product-marketing"],
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

    // Spec 62.0a Section 4.4: edit-prompt resume override replaces variableSuffix.
    const systemSuffix = await resolvePrompt(ctx, this.name, () => prompt.variableSuffix);

    // Spec 61.2: comparison-specific tool listing (positional mapping for the LLM)
    const comparisonContext =
      collectionType === "comparison" && input.comparisonToolSlugs?.length
        ? buildComparisonContextFragment({
            toolSlugs: input.comparisonToolSlugs,
            ...(input.comparisonToolNames ? { toolNames: input.comparisonToolNames } : {}),
          })
        : null;

    const userMsg = [
      // Spec 54.9: source context (non-empty for gap_analysis / trend_discovery)
      ...(input.sourceContext ? [input.sourceContext, ""] : []),
      // Spec 54.9: tools context (non-empty when cluster has tool articles)
      ...(input.toolsContext ? [input.toolsContext, ""] : []),
      // Spec 61.2: comparison tool list (only for comparison collection)
      ...(comparisonContext ? [comparisonContext, ""] : []),
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
      articleId: input.articleId,
      operation: COST_OPS.ARTICLE_DRAFT,
      model,
      systemPrefix: prompt.cacheablePrefix,
      systemSuffix,
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

    // Spec 61.2 Pattern 111: validate comparison-specific frontmatter before persist.
    // Throws ArticlePipelineError(stage="draft") so the pipeline run is marked failed
    // and Marcel sees the validation issue in the UI (not a silent malformed article).
    if (collectionType === "comparison") {
      if (!frontmatterExtras) {
        throw new ArticlePipelineError(
          "comparison: draft did not emit a FRONTMATTER_EXTRAS block — cannot validate toolSlugs/winner/verdict",
          "draft",
        );
      }
      const validation = validateComparisonExtras(frontmatterExtras);
      if (!validation.ok) {
        throw new ArticlePipelineError(validation.error, "draft");
      }
    }

    // Spec 61.3 Pattern 111: validate ki-wissen FRONTMATTER_EXTRAS (category enum,
    // level enum, icon, facts[3..5], next[2..4]) + Pattern 116 (no monetization fields).
    if (collectionType === "ki-wissen") {
      if (!frontmatterExtras) {
        throw new ArticlePipelineError(
          "ki-wissen: draft did not emit a FRONTMATTER_EXTRAS block — cannot validate category/level/icon/facts/next",
          "draft",
        );
      }
      const validation = validateKiWissenExtras(frontmatterExtras);
      if (!validation.ok) {
        throw new ArticlePipelineError(validation.error, "draft");
      }
      // Pattern 116: minimum FAQ count for ki-wissen is 7 (vs. 5 for blog/comparison).
      // FAQ is a top-level field on frontmatterExtras (not in KiWissenExtrasSchema —
      // that schema only covers ki-wissen-specific fields). Validate count here.
      const faqRaw = frontmatterExtras.faq;
      const faqCount = Array.isArray(faqRaw) ? faqRaw.length : 0;
      if (faqCount < 7) {
        throw new ArticlePipelineError(
          `ki-wissen: faq must contain at least 7 entries, got ${faqCount}`,
          "draft",
        );
      }
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

    // Spec 61.2: comparisons should hit ~2000 words. Warn (don't fail) when below.
    if (collectionType === "comparison" && wordCount < 2000) {
      ctx.log.warn(
        { articleId: input.articleId, wordCount },
        "[draft] comparison article below 2000 word target",
      );
    }

    // Spec 61.3: ki-wissen pillar pages should hit ~2500 words. Warn (don't fail) when below.
    if (collectionType === "ki-wissen" && wordCount < 2500) {
      ctx.log.warn(
        { articleId: input.articleId, wordCount },
        "[draft] ki-wissen article below 2500 word target",
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

    // Merge LLM extras with existing DB value — preserves authorPickStrategy set by AuthorPickStep
    const mergedExtras = frontmatterExtras
      ? { ...(article.frontmatterExtras as Record<string, unknown> ?? {}), ...frontmatterExtras }
      : null;

    if (mergedExtras) {
      const extCategory = typeof mergedExtras.category === "string" ? mergedExtras.category : undefined;
      const extSubcategory = typeof mergedExtras.subcategory === "string" ? mergedExtras.subcategory : undefined;
      const rawTags = mergedExtras.tags;
      const extTags = Array.isArray(rawTags)
        ? rawTags.filter((t): t is string => typeof t === "string")
        : undefined;
      await db
        .update(articles)
        .set({
          frontmatterExtras: mergedExtras,
          ...(extCategory !== undefined ? { category: extCategory } : {}),
          ...(extSubcategory !== undefined ? { subcategory: extSubcategory } : {}),
          ...(extTags !== undefined ? { tags: extTags } : {}),
        })
        .where(eq(articles.id, input.articleId));
    }
    // Only write author if AuthorPickStep hasn't already set one
    if (chosenAuthor && !article.author) {
      await db
        .update(articles)
        .set({ author: chosenAuthor })
        .where(eq(articles.id, input.articleId));
    }

    return { bodyMd, wordCount };
  }
}
