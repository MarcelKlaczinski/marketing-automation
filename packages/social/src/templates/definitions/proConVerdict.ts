import type { TemplateDefinition, GeneratedContent, ContentBounds } from "../types.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { PRO_CON_VERDICT_FIXTURES } from "./fixtures/proConVerdict.fixtures.ts";
// @marketing-auto/core imported lazily inside generateContent() to avoid
// triggering getEnv() at module evaluation time (breaks unit tests without env vars).
import { validateAndReprompt } from "../validateGenerated.ts";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Section A — Constraint-Based Content (Spec 59.3.5)
// ---------------------------------------------------------------------------

/**
 * Hard bounds for all LLM-produced fields.
 * Numbers are referenced by the LLM prompt AND enforced by the Zod schema below.
 * Single source of truth: edit here, not in the prompt strings.
 */
export const proConVerdictBounds = {
  verdictSnippet: { min: 20, max: 80 },   // Cover snippet, cover-snippet bucket @ fontSize 44
  whenToUse:      { min: 30, max: 280 },  // Verdict slide, slot-body bucket @ fontSize 32
  whenToSkip:     { min: 30, max: 280 },  // Verdict slide, slot-body bucket @ fontSize 32
  captionBody:    { min: 20, max: 1800 }, // Instagram caption, not rendered in slide
  hashtags:       { max: 10, perItemMaxChars: 24 },
  prosVisible:    { max: 5,  perItemMaxChars: 80 }, // list-item bucket @ fontSize 28
  consVisible:    { max: 5,  perItemMaxChars: 80 },
} as const satisfies ContentBounds;

/**
 * Zod schema for the LLM-generated verdict-specific fields.
 * Used by validateAndReprompt() in generateContent() and by the
 * fixtures-respect-bounds test to validate fixture.generatedContent.
 */
export const proConVerdictGeneratedSchema = z.object({
  verdictSnippet: z.string()
    .min(proConVerdictBounds.verdictSnippet.min)
    .max(proConVerdictBounds.verdictSnippet.max),
  whenToUse: z.string()
    .min(proConVerdictBounds.whenToUse.min)
    .max(proConVerdictBounds.whenToUse.max),
  whenToSkip: z.string()
    .min(proConVerdictBounds.whenToSkip.min)
    .max(proConVerdictBounds.whenToSkip.max),
});

export type ProConVerdictGenerated = z.infer<typeof proConVerdictGeneratedSchema>;

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});

const SLIDE_W = 1080;
const SLIDE_H = 1350;

export type ProConVerdictContext = {
  toolName: string;
  pros: string[];
  cons: string[];
};

type VerdictData = {
  snippet: string;
  whenToUse: string;
  whenToSkip: string;
};

type GeneratedContentWithVerdict = GeneratedContent & {
  _verdict: VerdictData | null;
};

const hookSchema = z.object({
  pattern: z.enum(["superlative_question", "number_promise", "negative_frame", "identity_frame", "curiosity_gap"]),
  leadPhrase: z.string().min(1),
  highlightWord: z.string().min(1),
  trailPhrase: z.string().min(1),
  fullText: z.string().min(5),
  promiseBlock: z.object({
    line1: z.string().min(1),
    line2: z.string().min(1),
  }),
});

// Full LLM response schema — used by validateAndReprompt inside generateContent().
// Bounds for verdict fields are sourced from proConVerdictBounds (single source of truth).
const llmResponseSchema = z.object({
  hook: hookSchema,
  caption_body: z.string()
    .min(proConVerdictBounds.captionBody.min)
    .max(proConVerdictBounds.captionBody.max),
  hashtags: z.array(z.string().regex(/^#[^\s\-#]+$/u)).min(5).max(10),
  verdict_snippet: z.string()
    .min(proConVerdictBounds.verdictSnippet.min)
    .max(proConVerdictBounds.verdictSnippet.max),
  when_to_use: z.string()
    .min(proConVerdictBounds.whenToUse.min)
    .max(proConVerdictBounds.whenToUse.max),
  when_to_skip: z.string()
    .min(proConVerdictBounds.whenToSkip.min)
    .max(proConVerdictBounds.whenToSkip.max),
});

export const proConVerdictTemplate: TemplateDefinition<ProConVerdictContext> = {
  key: "pro-con-verdict",
  displayName: "Pro-Con-Verdict",
  description:
    "5-slide Karussell: Diagonal-Split Cover, Pros-Slide, Cons-Slide, Verdict und CTA. Für Tool-Review-Artikel.",
  defaultSlideCount: 5,
  estimatedCostUsd: 0.007,

  outputFormat: "carousel",
  compatibleChannels: ["instagram"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "tool-spotlight",
    estimatedEngagementTier: "medium",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  bounds: proConVerdictBounds,
  generatedSchema: proConVerdictGeneratedSchema,
  slotMap: {
    verdictSnippet: "cover-snippet",
    whenToUse: "slot-body",
    whenToSkip: "slot-body",
  },

  eligibility: (article, _discovery) => {
    if (article.collection !== "tools") {
      return { eligible: false, reason: "Nur für tools-Collection" };
    }

    const extras = (article.frontmatterExtras ?? {}) as {
      pros?: Array<{ text: string } | string>;
      cons?: Array<{ text: string } | string>;
    };

    const pros = extras.pros ?? [];
    const cons = extras.cons ?? [];

    if (pros.length < 3) {
      return {
        eligible: false,
        reason: "Benötigt mindestens 3 Pros",
        requirements: ["frontmatter.pros.length >= 3"],
      };
    }
    if (cons.length < 3) {
      return {
        eligible: false,
        reason: "Benötigt mindestens 3 Cons",
        requirements: ["frontmatter.cons.length >= 3"],
      };
    }

    return { eligible: true };
  },

  generateContent: async (article, input, locale, llmCaller) => {
    const { buildHashtagInstructions } = await import("@marketing-auto/core");
    const ctx = input as ProConVerdictContext;
    const { toolName, pros, cons } = ctx;

    const hashtagInstructions = buildHashtagInstructions({
      locale,
      contentType: "review",
      toolNames: [toolName],
    });

    const systemPrompt = `You are an Instagram carousel copywriter for an AI tool review blog.
Generate hook, caption, and verdict data for a pro-con-verdict carousel about ${toolName}.
Output ONLY a valid JSON object. No markdown. No explanation. No code fences.

${hashtagInstructions}`;

    const outputLang =
      locale === "de" ? "German output, du-form (informal)" : "English output";

    const prosText = pros.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const consText = cons.map((c, i) => `${i + 1}. ${c}`).join("\n");

    const userPrompt = `Tool: ${toolName}
Output language: ${outputLang}

PROS:
${prosText}

CONS:
${consText}

Return a JSON object with this exact shape (no other keys):
{
  "hook": {
    "pattern": "<one of: superlative_question | number_promise | negative_frame | identity_frame | curiosity_gap>",
    "leadPhrase": "<hook opening, 2-5 words>",
    "highlightWord": "<1-2 words to emphasize>",
    "trailPhrase": "<closing phrase>",
    "fullText": "<complete hook as single sentence or question>",
    "promiseBlock": {
      "line1": "<what this carousel delivers, line 1>",
      "line2": "<line 2>"
    }
  },
  "caption_body": "<Instagram caption, 3-5 sentences, end with CTA to save>",
  "hashtags": ["#Tag1", "#Tag2"],
  "verdict_snippet": "<honest verdict on ${toolName}, ${proConVerdictBounds.verdictSnippet.min}–${proConVerdictBounds.verdictSnippet.max} chars>",
  "when_to_use": "<when ${toolName} is the right choice, ${proConVerdictBounds.whenToUse.min}–${proConVerdictBounds.whenToUse.max} chars>",
  "when_to_skip": "<when to avoid ${toolName} and what to use instead, ${proConVerdictBounds.whenToSkip.min}–${proConVerdictBounds.whenToSkip.max} chars>"
}`;

    const raw = await llmCaller(systemPrompt, userPrompt);
    if (!raw) return buildFallbackContent(ctx, locale, article.slug);

    const extractJson = (text: string): unknown | null => {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return null;
      try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
    };

    const initialJson = extractJson(raw);
    if (!initialJson) return buildFallbackContent(ctx, locale, article.slug);

    let parsed: z.infer<typeof llmResponseSchema>;
    try {
      parsed = await validateAndReprompt(
        initialJson,
        async (hints) => {
          const hintBlock = hints.map((h) => `- ${h}`).join("\n");
          const retryPrompt = `${userPrompt}\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${hintBlock}\n\nFix the issues above and return only the corrected JSON.`;
          const retryRaw = await llmCaller(systemPrompt, retryPrompt);
          return retryRaw ? (extractJson(retryRaw) ?? {}) : {};
        },
        { schema: llmResponseSchema, maxReprompts: 1, locale },
      );
    } catch {
      return buildFallbackContent(ctx, locale, article.slug);
    }

    const result: GeneratedContentWithVerdict = {
      hookOutput: parsed.hook,
      caption: parsed.caption_body,
      hashtags: parsed.hashtags,
      _verdict: {
        snippet: parsed.verdict_snippet,
        whenToUse: parsed.when_to_use,
        whenToSkip: parsed.when_to_skip,
      },
    };

    return result as unknown as GeneratedContent;
  },

  buildInput: async (article, _discovery) => {
    const extras = (article.frontmatterExtras ?? {}) as {
      pros?: Array<{ text: string } | string>;
      cons?: Array<{ text: string } | string>;
    };

    const rawName = article.title ?? article.slug;
    const toolName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    const normalize = (items: Array<{ text: string } | string>): string[] =>
      items.map((item) => (typeof item === "string" ? item : item.text));

    const pros = normalize(extras.pros ?? []).slice(0, 5);
    const cons = normalize(extras.cons ?? []).slice(0, 5);

    return { toolName, pros, cons };
  },

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const generatedWithVerdict = context.generatedContent as
      | (GeneratedContent & { _verdict?: VerdictData | null })
      | undefined;

    const verdict = generatedWithVerdict?._verdict ?? null;

    const compositionInput = {
      theme,
      locale,
      slideIndex: 0,
      totalSlides: 5,
      brandTokens,
      overrides: context.overrides ?? {},
      tool: { name: input.toolName },
      pros: input.pros,
      cons: input.cons,
      verdict,
    };

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderProConVerdict: (
        input: Record<string, unknown>,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };

    const { slides: buffers } = await socialModule.renderProConVerdict(
      compositionInput as unknown as Record<string, unknown>,
    );

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "pro-con-verdict",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(input, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.007, templateKey: "pro-con-verdict" },
    };
  },

  mockFixtures: PRO_CON_VERDICT_FIXTURES,
};

function buildFallbackContent(
  ctx: ProConVerdictContext,
  locale: "de" | "en",
  slug: string,
): GeneratedContent {
  const result: GeneratedContentWithVerdict = {
    hookOutput: {
      pattern: "negative_frame",
      leadPhrase: locale === "de" ? `${ctx.toolName}: Lohnt es sich` : `${ctx.toolName}: Worth it`,
      highlightWord: locale === "de" ? "wirklich?" : "really?",
      trailPhrase: locale === "de" ? "Ehrliche Antwort." : "Honest answer.",
      fullText:
        locale === "de"
          ? `${ctx.toolName}: Lohnt es sich wirklich? Ehrliche Antwort.`
          : `${ctx.toolName}: Worth it really? Honest answer.`,
      promiseBlock: {
        line1: locale === "de" ? `${ctx.pros.length} Vorteile, ${ctx.cons.length} Nachteile` : `${ctx.pros.length} pros, ${ctx.cons.length} cons`,
        line2: locale === "de" ? "unser ehrliches Fazit" : "our honest verdict",
      },
    },
    caption: fallbackCaption(ctx, locale, slug),
    hashtags: fallbackHashtags(locale),
    _verdict: null,
  };

  return result as unknown as GeneratedContent;
}

function fallbackCaption(ctx: ProConVerdictContext, locale: "de" | "en", slug: string): string {
  if (locale === "de") {
    return (
      `${ctx.toolName} im ehrlichen Check — ${ctx.pros.length} Vorteile, ${ctx.cons.length} Nachteile.\n\n` +
      `Unser Fazit: Für manche Use-Cases top, für andere gibt es bessere Alternativen.\n\n` +
      `Speicher diesen Post für deine nächste Tool-Entscheidung.\n\n` +
      `→ toolwiki.ai/${slug}`
    );
  }
  return (
    `${ctx.toolName} honestly reviewed — ${ctx.pros.length} pros, ${ctx.cons.length} cons.\n\n` +
    `Our verdict: great for some use cases, better alternatives exist for others.\n\n` +
    `Save this post for your next tool decision.\n\n` +
    `→ toolwiki.ai/${slug}`
  );
}

function fallbackHashtags(locale: "de" | "en"): string[] {
  if (locale === "de") {
    return [
      "#KITools",
      "#AITools",
      "#KIFürBusiness",
      "#AIForBusiness",
      "#SoftwareTest",
      "#Produktivität",
      "#ToolReview",
    ];
  }
  return [
    "#AITools",
    "#AIForBusiness",
    "#DigitalTools",
    "#SoftwareReview",
    "#Productivity",
    "#TechTools",
    "#ToolReview",
  ];
}
