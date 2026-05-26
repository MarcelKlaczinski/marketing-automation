/**
 * Spec 65.8 — `opinion-recommendation` TemplateDefinition (Family B).
 *
 * 6-slide opinion piece (Cover / Hot-Take / Reasoning×2 / Top-Pick / End).
 * Single Sonnet call with tagged-block output (4 `## beatName` headers +
 * `<CAPTION>` + `<HASHTAGS>`).
 *
 * Validator: Hot-Take MUST be declarative (no `?`, no hedging phrases like
 * "vielleicht" / "I think"); Top-Pick MUST name the recommended tool
 * verbatim. Reasoning beats are free-form (any text that satisfies schema
 * bounds passes — the analytical content carries itself).
 */
import {
  buildOpinionRecommendationNarrativePrompt,
  buildOpinionRecommendationRetrySuffix,
  OPINION_RECOMMENDATION_SYSTEM_PROMPT,
  validateOpinionRecommendationNarrative,
} from "../../compositions/opinion-recommendation/narrative-prompt.ts";
import {
  opinionRecommendationGeneratedSchema,
  opinionRecommendationNarrativeSchema,
  type OpinionRecommendationInput,
  type OpinionRecommendationNarrative,
} from "../../compositions/opinion-recommendation/types.ts";
import { splitNarrativeByBeats } from "../../compositions/_shared/family-b/helpers.ts";
import type {
  FamilyBHook,
  FamilyBToolMention,
} from "../../compositions/_shared/family-b/types.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import type {
  ContentBounds,
  GeneratedContent,
  TemplateDefinition,
} from "../types.ts";
import { OPINION_RECOMMENDATION_FIXTURES } from "./fixtures/opinionRecommendation.fixtures.ts";

// ─── Context (buildInput → render contract) ──────────────────────────────────

export interface OpinionRecommendationContext {
  hook: FamilyBHook;
  recommendedTool: FamilyBToolMention;
  articleSlug: string;
  articleUrl: string;
}

// ─── Bounds ──────────────────────────────────────────────────────────────────

export const opinionRecommendationBounds: ContentBounds = {
  hook: { min: 8, max: 160 },
  beat: { min: 20, max: 400 },
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
};

export { opinionRecommendationGeneratedSchema };

// ─── Tagged-block parser ──────────────────────────────────────────────────────

function parseTaggedBlock(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = text.match(re);
  if (!m) return null;
  return m[1]?.trim() ?? null;
}

function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("#") && /^#[^\s\-#]+$/u.test(s));
}

// ─── Static fallback narrative ────────────────────────────────────────────────

function buildFallbackNarrative(
  toolName: string,
  locale: "de" | "en",
): OpinionRecommendationNarrative {
  if (locale === "de") {
    return {
      hotTake: {
        beatName: "hotTake",
        text: `Die meisten benutzen KI-Tools wie Suchmaschinen. Falsch.`,
      },
      reasoning1: {
        beatName: "reasoning1",
        text: `Erstens: Eine Suche bringt dir Fragmente. Ein guter Prompt bringt dir Antworten — wenn du das Tool wie einen Sparringspartner behandelst.`,
      },
      reasoning2: {
        beatName: "reasoning2",
        text: `Zweitens: Die meisten testen ein Tool eine Woche und geben auf. Drei Wochen sind das Minimum, um den Workflow zu kalibrieren.`,
      },
      topPick: {
        beatName: "topPick",
        text: `Meine Empfehlung: ${toolName} — weil es dich zwingt, strukturiert zu denken, statt nur zu fragen.`,
      },
    };
  }
  return {
    hotTake: {
      beatName: "hotTake",
      text: `Most people use AI tools like search engines. Wrong.`,
    },
    reasoning1: {
      beatName: "reasoning1",
      text: `First: a search gives you fragments. A good prompt gives you answers — but only when you treat the tool as a sparring partner.`,
    },
    reasoning2: {
      beatName: "reasoning2",
      text: `Second: most people test a tool for a week and quit. Three weeks is the minimum to calibrate the workflow.`,
    },
    topPick: {
      beatName: "topPick",
      text: `My pick: ${toolName} — because it forces you to think structured, not just to ask.`,
    },
  };
}

const DEFAULT_HASHTAGS_DE = [
  "#KIMeinung",
  "#AIOpinion",
  "#KIWorkflow",
  "#FutureOfWork",
  "#TechMeinung",
  "#KIFürBusiness",
  "#Productivity",
] as const;

const DEFAULT_HASHTAGS_EN = [
  "#AIOpinion",
  "#TechTake",
  "#AIWorkflow",
  "#FutureOfWork",
  "#AIForBusiness",
  "#Productivity",
  "#HotTake",
] as const;

// ─── TemplateDefinition ───────────────────────────────────────────────────────

export const opinionRecommendationTemplate: TemplateDefinition<OpinionRecommendationContext> = {
  key: "opinion-recommendation",
  displayName: "Opinion + Recommendation",
  description: "Hook-driven opinion piece: bold hot-take + 2 reasoning beats + concrete tool recommendation. Family B Spec 65.8.",
  defaultSlideCount: 6,
  estimatedCostUsd: 0.06,
  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "llm-live",
  plannerMeta: {
    contentType: "story",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: false,
    requiresLiveData: false,
  },
  renderServerFn: "renderOpinionRecommendation",
  bounds: opinionRecommendationBounds,
  generatedSchema: opinionRecommendationGeneratedSchema,

  // ── eligibility ──────────────────────────────────────────────────────────
  eligibility: (article) => {
    if (article.collection !== "recurring_content") {
      return {
        eligible: false,
        reason: "opinion-recommendation requires collection='recurring_content'",
        requirements: ["collection=recurring_content", "domainExtras.recurring.formatConfig.hookData set", "domainExtras.recurring.formatConfig.recommendedTool set"],
      };
    }
    const recurring = (article.domainExtras as { recurring?: { formatConfig?: { hookData?: unknown; recommendedTool?: unknown } } } | undefined)?.recurring;
    if (!recurring?.formatConfig?.hookData) {
      return {
        eligible: false,
        reason: "recurring article missing hookData",
        requirements: ["domainExtras.recurring.formatConfig.hookData set by Spec 65.5 brief-generator"],
      };
    }
    if (!recurring?.formatConfig?.recommendedTool) {
      return {
        eligible: false,
        reason: "recurring article missing recommendedTool",
        requirements: ["domainExtras.recurring.formatConfig.recommendedTool set by Spec 65.5 brief-generator"],
      };
    }
    return { eligible: true };
  },

  // ── buildInput ───────────────────────────────────────────────────────────
  buildInput: async (article) => {
    const recurring = (article.domainExtras as {
      recurring?: {
        formatConfig?: {
          hookData?: { rendered?: string; variables?: Record<string, string> };
          recommendedTool?: FamilyBToolMention;
        };
      };
    } | undefined)?.recurring;

    const hookData = recurring?.formatConfig?.hookData;
    const hook: FamilyBHook = {
      rendered: hookData?.rendered ?? article.title ?? article.slug,
      variables: hookData?.variables ?? {},
    };
    const recommendedTool: FamilyBToolMention = recurring?.formatConfig?.recommendedTool ?? {
      slug: "unknown",
      name: "the tool",
    };
    const articleUrl = `toolwiki.ai/${article.slug}`;
    return {
      hook,
      recommendedTool,
      articleSlug: article.slug,
      articleUrl,
    };
  },

  // ── generateContent ──────────────────────────────────────────────────────
  generateContent: async (article, input, locale, llmCaller) => {
    const ctx = input as OpinionRecommendationContext;

    const systemPrompt = `${OPINION_RECOMMENDATION_SYSTEM_PROMPT}\n\nAdditionally, after the 4 narrative beats, emit a CAPTION and HASHTAGS block in EXACTLY this format:\n\n<CAPTION>\n(your caption, 80-280 chars, no hashtags inside)\n</CAPTION>\n\n<HASHTAGS>\n#tag1 #tag2 ... (7 hashtags, no hyphens, mix DE+EN regardless of post locale)\n</HASHTAGS>`;

    const baseUserPrompt = buildOpinionRecommendationNarrativePrompt({
      hook: ctx.hook,
      recommendedToolName: ctx.recommendedTool.name,
      locale,
    });

    // First attempt
    let llmRaw = await llmCaller(systemPrompt, baseUserPrompt);
    let parsed = parseAndValidateNarrative(llmRaw, ctx.recommendedTool.name);

    // Single retry with refinement suffix
    if (!parsed.valid && llmRaw) {
      const retrySuffix = buildOpinionRecommendationRetrySuffix(parsed.validation);
      const retryRaw = await llmCaller(systemPrompt, `${baseUserPrompt}\n${retrySuffix}`);
      const retryParsed = parseAndValidateNarrative(retryRaw, ctx.recommendedTool.name);
      if (retryParsed.valid) {
        llmRaw = retryRaw;
        parsed = retryParsed;
      }
    }

    const finalNarrative =
      parsed.narrative ?? buildFallbackNarrative(ctx.recommendedTool.name, locale);
    const caption =
      (llmRaw && parseTaggedBlock(llmRaw, "CAPTION")) ??
      fallbackCaption(article, ctx, locale);
    const hashtagsRaw = (llmRaw && parseTaggedBlock(llmRaw, "HASHTAGS")) ?? "";
    const parsedHashtags = parseHashtags(hashtagsRaw);
    const hashtags =
      parsedHashtags.length >= 5
        ? parsedHashtags.slice(0, 10)
        : Array.from(locale === "de" ? DEFAULT_HASHTAGS_DE : DEFAULT_HASHTAGS_EN);

    const words = ctx.hook.rendered.split(" ");
    const result: GeneratedContent & { _opinionExtra: OpinionRecommendationNarrative } = {
      hookOutput: {
        pattern: "negative_frame",
        leadPhrase: words.slice(0, 3).join(" "),
        highlightWord: words.slice(3, 6).join(" ") || ctx.hook.rendered,
        trailPhrase: words.slice(6).join(" "),
        fullText: ctx.hook.rendered,
        promiseBlock: { line1: ctx.hook.rendered, line2: "" },
      },
      caption,
      hashtags,
      _opinionExtra: finalNarrative,
    };
    return result as unknown as GeneratedContent;
  },

  // ── render ───────────────────────────────────────────────────────────────
  render: async (context) => {
    const ctx = context.input;
    const narrative =
      (context.generatedContent as
        | (GeneratedContent & { _opinionExtra?: OpinionRecommendationNarrative })
        | undefined)?._opinionExtra ??
      buildFallbackNarrative(ctx.recommendedTool.name, context.locale);

    const brandTokens = brandTokensSchema.parse(context.brandTokens ?? {});
    const input: OpinionRecommendationInput = {
      slideIndex: 0,
      slideTotal: 6,
      theme: context.theme,
      locale: context.locale,
      brandTokens,
      hook: ctx.hook,
      narrative,
      recommendedTool: ctx.recommendedTool,
      end: {
        headlineLead: context.locale === "de" ? "Mehr Meinungen" : "More opinions",
        headlineEm: context.locale === "de" ? "ehrlich begründet." : "honestly argued.",
        articleUrl: ctx.articleUrl,
        ctaLine: context.locale === "de" ? "Vollständige Analyse →" : "Full analysis →",
      },
      images: [],
    };

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderOpinionRecommendation: (
        input: OpinionRecommendationInput,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderOpinionRecommendation(input);
    const slideOutputs = await writeSlides(
      buffers,
      context.article.id,
      "opinion-recommendation",
      context.locale,
      context.theme,
      { width: 1080, height: 1350 },
    );
    return {
      slides: slideOutputs,
      caption:
        context.generatedContent?.caption ??
        fallbackCaption(context.article, ctx, context.locale),
      hashtags:
        context.generatedContent?.hashtags ??
        Array.from(context.locale === "de" ? DEFAULT_HASHTAGS_DE : DEFAULT_HASHTAGS_EN),
      metadata: { estimatedCostUsd: 0.06, templateKey: "opinion-recommendation" },
    };
  },

  mockFixtures: OPINION_RECOMMENDATION_FIXTURES,
};

// ─── Pure helper: parse + validate ────────────────────────────────────────────

function parseAndValidateNarrative(
  raw: string | null,
  recommendedToolName: string,
): {
  valid: boolean;
  narrative: OpinionRecommendationNarrative | null;
  validation: ReturnType<typeof validateOpinionRecommendationNarrative>;
} {
  const emptyNarrative: OpinionRecommendationNarrative = {
    hotTake: { beatName: "hotTake", text: "" },
    reasoning1: { beatName: "reasoning1", text: "" },
    reasoning2: { beatName: "reasoning2", text: "" },
    topPick: { beatName: "topPick", text: "" },
  };
  const noNarrative = {
    valid: false,
    narrative: null,
    validation: validateOpinionRecommendationNarrative(emptyNarrative, recommendedToolName),
  };
  if (!raw) return noNarrative;
  // The LLM emits `## hotTake` / `## reasoning1` etc.; splitNarrativeByBeats matches case-insensitively.
  const split = splitNarrativeByBeats(raw, ["hotTake", "reasoning1", "reasoning2", "topPick"]);
  for (const beat of ["hotTake", "reasoning1", "reasoning2", "topPick"] as const) {
    if (!split[beat.toLowerCase()] && !split[beat]) return noNarrative;
  }
  const narrative: OpinionRecommendationNarrative = {
    hotTake: { beatName: "hotTake", text: split.hottake ?? split.hotTake ?? "" },
    reasoning1: { beatName: "reasoning1", text: split.reasoning1 ?? "" },
    reasoning2: { beatName: "reasoning2", text: split.reasoning2 ?? "" },
    topPick: { beatName: "topPick", text: split.toppick ?? split.topPick ?? "" },
  };
  const zodParsed = opinionRecommendationNarrativeSchema.safeParse(narrative);
  if (!zodParsed.success) return noNarrative;
  const validation = validateOpinionRecommendationNarrative(narrative, recommendedToolName);
  return { valid: validation.valid, narrative, validation };
}

function fallbackCaption(
  article: { title: string | null; slug: string },
  ctx: OpinionRecommendationContext,
  locale: "de" | "en",
): string {
  if (locale === "de") {
    return `Eine Meinung statt einer Vergleichsliste — und am Ende eine konkrete Empfehlung: ${ctx.recommendedTool.name}.\n\n${article.title ?? article.slug}`;
  }
  return `An opinion piece, not a feature comparison — with a concrete pick at the end: ${ctx.recommendedTool.name}.\n\n${article.title ?? article.slug}`;
}
