import type { TemplateDefinition, GeneratedContent } from "../types.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { PRO_CON_VERDICT_FIXTURES } from "./fixtures/proConVerdict.fixtures.ts";
import { buildHashtagInstructions } from "@marketing-auto/core";
import { z } from "zod";

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

const llmResponseSchema = z.object({
  hook: hookSchema,
  caption_body: z.string().min(20),
  hashtags: z.array(z.string().regex(/^#[^\s\-#]+$/u)).min(5).max(10),
  verdict_snippet: z.string().min(20).max(120),
  when_to_use: z.string().min(30).max(280),
  when_to_skip: z.string().min(30).max(280),
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
  "verdict_snippet": "<15-20 word honest verdict on ${toolName}>",
  "when_to_use": "<2-3 sentences: when ${toolName} is the right choice>",
  "when_to_skip": "<2-3 sentences: when to avoid ${toolName} and what to use instead>"
}`;

    const raw = await llmCaller(systemPrompt, userPrompt);
    if (!raw) return buildFallbackContent(ctx, locale, article.slug);

    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return buildFallbackContent(ctx, locale, article.slug);
    }

    let parsed: z.infer<typeof llmResponseSchema>;
    try {
      parsed = llmResponseSchema.parse(JSON.parse(raw.slice(start, end + 1)));
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
