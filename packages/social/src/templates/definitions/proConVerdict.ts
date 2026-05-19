import type { TemplateDefinition, GeneratedContent, ContentBounds } from "../types.ts";
import { getToolContext, type ToolContext } from "../adapters/tool.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { validateAndReprompt } from "../validateGenerated.ts";
import { buildConstraintBlock } from "../lib/buildConstraintBlock.ts";
import { PRO_CON_VERDICT_FIXTURES } from "./fixtures/proConVerdict.fixtures.ts";
import {
  proConVerdictGeneratedSchema,
  proConVerdictLlmResponseSchema,
  type ProConVerdictGenerated,
  type ProConVerdictLlmResponse,
  type ProConVerdictInput,
} from "../../compositions/pro-con-verdict/types.ts";
// @marketing-auto/core imported lazily inside generateContent() to avoid
// triggering getEnv() at module evaluation time (breaks unit tests without env vars).

// ─── Bounds (proxy to composition bounds for ContentBounds shape) ─────────────

export const proConVerdictDefinitionBounds: ContentBounds = {
  tool_name:         { min: 1, max: 28 },
  tool_category:     { min: 1, max: 26 },
  subline:           { min: 30, max: 110 },
  eyebrow:           { min: 10, max: 36 },
  slide_num:         { min: 3, max: 10 },
  cta_line1:         { min: 8, max: 28 },
  cta_line2:         { min: 8, max: 30 },
  date_label:        { min: 8, max: 36 },
  pros_header:       { min: 4, max: 16 },
  cons_header:       { min: 4, max: 16 },
  pros:              { countMin: 3, countMax: 4, each: { min: 10, max: 48 } },
  cons:              { countMin: 3, countMax: 4, each: { min: 10, max: 48 } },
  verdict_text:      { min: 30, max: 120 },
  verdict_em:        { min: 3, max: 20 },
  recommendation_tag: { min: 10, max: 52 },
  captionBody:       { min: 20, max: 1800 },
  hashtags:          { max: 10, perItemMaxChars: 24 },
} as const satisfies ContentBounds;

// ─── Types ────────────────────────────────────────────────────────────────────

export { proConVerdictGeneratedSchema };
export type { ProConVerdictGenerated };

type GeneratedContentWithSlide = GeneratedContent & { _generatedSlide?: ProConVerdictGenerated };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});
const SLIDE_W = 1080;
const SLIDE_H = 1350;

function buildFallbackGenerated(ctx: ToolContext, locale: "de" | "en", articleSlug: string): ProConVerdictGenerated {
  const isDE = locale === "de";
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();

  const prosRaw = ctx.pros.slice(0, 4).map((p) => p.text.slice(0, 48));
  const consRaw = ctx.cons.slice(0, 4).map((c) => c.text.slice(0, 48));

  const base: ProConVerdictGenerated = {
    toolName: ctx.name.slice(0, 28),
    toolCategory: (ctx.primaryCategory ?? (isDE ? "KI-Tool" : "AI tool")).slice(0, 26),
    subline: isDE
      ? `Alle Vor- und Nachteile im Überblick — unser ehrliches Fazit.`
      : `All pros and cons at a glance — our honest verdict.`,
    eyebrow: isDE ? "Pro & Contra · Tool-Verdict" : "Pros & Cons · Tool Verdict",
    slideNum: "01 / 01",
    ctaLine1: isDE ? "Vollständiger Test →" : "Full review →",
    ctaLine2: `toolwiki.ai/${articleSlug}`,
    dateLabel: isDE
      ? `Stand ${month}/${year} · toolwiki.ai/${articleSlug}`
      : `As of ${month}/${year} · toolwiki.ai/${articleSlug}`,
    prosHeader: isDE ? "Stärken" : "Strengths",
    consHeader: isDE ? "Schwächen" : "Weaknesses",
    pros: prosRaw.length >= 3 ? prosRaw : [
      isDE ? "Einfache Bedienung" : "Easy to use",
      isDE ? "Gut integriert" : "Well integrated",
      isDE ? "Aktiv weiterentwickelt" : "Actively developed",
    ],
    cons: consRaw.length >= 3 ? consRaw : [
      isDE ? "Eingeschränkter Free-Tier" : "Limited free tier",
      isDE ? "Lernkurve vorhanden" : "Learning curve",
      isDE ? "Preis-Leistung prüfen" : "Check price/value",
    ],
    verdictText: isDE
      ? `${ctx.name} ist für bestimmte Use-Cases empfehlenswert.`
      : `${ctx.name} is recommended for specific use cases.`,
    verdictEm: isDE ? "empfehlenswert" : "recommended",
    recommendationTag: isDE ? "Empfohlen für: Fortgeschrittene" : "Recommended for: Power users",
  };

  if (ctx.iconSvg !== undefined) base.iconSvg = ctx.iconSvg;
  if (ctx.iconInitials !== undefined) base.iconInitials = ctx.iconInitials;
  if (ctx.iconHue !== undefined) base.iconHue = ctx.iconHue;

  return base;
}

function buildFallbackContent(ctx: ToolContext, locale: "de" | "en", articleSlug: string): GeneratedContent {
  const isDE = locale === "de";
  const generated = buildFallbackGenerated(ctx, locale, articleSlug);
  const result: GeneratedContentWithSlide = {
    hookOutput: {
      pattern: "negative_frame",
      leadPhrase: isDE ? `${ctx.name}: lohnt sich` : `${ctx.name}: worth it`,
      highlightWord: isDE ? "wirklich?" : "really?",
      trailPhrase: isDE ? "Ehrliche Antwort." : "Honest answer.",
      fullText: isDE
        ? `${ctx.name}: Lohnt es sich wirklich? Ehrliche Antwort.`
        : `${ctx.name}: Worth it really? Honest answer.`,
      promiseBlock: {
        line1: isDE ? `${ctx.pros.length} Stärken` : `${ctx.pros.length} strengths`,
        line2: isDE ? `${ctx.cons.length} Schwächen` : `${ctx.cons.length} weaknesses`,
      },
    },
    caption: isDE
      ? `${ctx.name} im ehrlichen Check — ${ctx.pros.length} Stärken, ${ctx.cons.length} Schwächen.\n\nUnser Fazit: Für manche Use-Cases top, für andere gibt es bessere Alternativen.\n\nSpeicher diesen Post für deine nächste Tool-Entscheidung.\n\n→ toolwiki.ai/${articleSlug}`
      : `${ctx.name} honestly reviewed — ${ctx.pros.length} pros, ${ctx.cons.length} cons.\n\nOur verdict: great for some use cases, better alternatives exist for others.\n\nSave this post for your next tool decision.\n\n→ toolwiki.ai/${articleSlug}`,
    hashtags: isDE
      ? ["#KITools", "#AITools", "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest", "#Produktivität", "#ToolReview"]
      : ["#AITools", "#AIForBusiness", "#DigitalTools", "#SoftwareReview", "#Productivity", "#TechTools", "#ToolReview"],
    _generatedSlide: generated,
  };
  return result as unknown as GeneratedContent;
}

// ─── Template definition ──────────────────────────────────────────────────────

export const proConVerdictTemplate: TemplateDefinition<ToolContext> = {
  key: "pro-con-verdict",
  displayName: "Pro-Con-Verdict",
  description:
    "Einzelne Karte für ein Tool: Zwei-Spalten Pros/Cons + Verdict-Strip. Für Tool-Review-Artikel.",
  defaultSlideCount: 1,
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

  bounds: proConVerdictDefinitionBounds,
  generatedSchema: proConVerdictGeneratedSchema,
  slotMap: {},

  // ── Eligibility ────────────────────────────────────────────────────────────

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

  // ── generateContent ────────────────────────────────────────────────────────

  generateContent: async (article, input, locale, llmCaller) => {
    const { buildHashtagInstructions } = await import("@marketing-auto/core");
    const ctx = input as ToolContext;
    const isDE = locale === "de";

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const dateLabel = isDE
      ? `Stand ${month}/${year} · toolwiki.ai/${article.slug}`
      : `As of ${month}/${year} · toolwiki.ai/${article.slug}`;

    const constraintBlock = buildConstraintBlock(proConVerdictDefinitionBounds, locale, {
      fields: ["subline", "pros", "cons", "verdict_text", "verdict_em", "recommendation_tag"],
    });

    const hashtagInstructions = buildHashtagInstructions({
      locale,
      contentType: "review",
      toolNames: [ctx.name],
      ...(ctx.primaryCategory !== undefined && { toolCategory: ctx.primaryCategory }),
    });

    const localeDirective = isDE
      ? "Output language: German (du-Form, informell). Alle Texte auf Deutsch."
      : "Output language: English (concise, direct).";

    const prosText = ctx.pros.slice(0, 4).map((p) => `- ${p.text}`).join("\n");
    const consText = ctx.cons.slice(0, 4).map((c) => `- ${c.text}`).join("\n");
    const bodyExcerpt = (article.bodyMd ?? "").slice(0, 1500);

    const systemPrompt =
      "You write structured JSON for single-slide Instagram tool-verdict cards. " +
      "Return ONLY a valid JSON object. No markdown fences, no explanation.";

    const defaultEyebrow = isDE ? "Pro & Contra · Tool-Verdict" : "Pros & Cons · Tool Verdict";
    const defaultProsHeader = isDE ? "Stärken" : "Strengths";
    const defaultConsHeader = isDE ? "Schwächen" : "Weaknesses";
    const defaultCtaLine1 = isDE ? "Vollständiger Test →" : "Full review →";

    const userPrompt = `Generate content for a pro-con-verdict Instagram slide card about "${ctx.name}".

ARTICLE CONTEXT:
- Title: ${article.title ?? article.slug}
- Primary tool: ${ctx.name}
- Category: ${ctx.primaryCategory ?? "(not specified)"}
- Body excerpt: ${bodyExcerpt || "(not provided)"}

RAW PROS:
${prosText || "(not provided)"}

RAW CONS:
${consText || "(not provided)"}

Return exactly this JSON (no other keys):
{
  "tool_name": "<tool display name, max 28 chars>",
  "tool_category": "<specific tool category, max 26 chars, e.g. 'KI-Bildgenerator'>",
  "tool_logo_slug": "<kebab-case slug of the tool>",
  "subline": "<one sentence framing the pros/cons review, max 110 chars>",
  "eyebrow": "${defaultEyebrow}",
  "slide_num": "01 / 01",
  "cta_line1": "${defaultCtaLine1}",
  "cta_line2": "toolwiki.ai/${article.slug}",
  "date_label": "${dateLabel}",
  "pros_header": "${defaultProsHeader}",
  "cons_header": "${defaultConsHeader}",
  "pros": ["<concise pro, max 48 chars>", "...", "..."],
  "cons": ["<concise con, max 48 chars>", "...", "..."],
  "verdict_text": "<one verdict sentence in quote style, max 120 chars>",
  "verdict_em": "<2-4 word highlighted substring from verdict_text>",
  "recommendation_tag": "<'${isDE ? "Empfohlen für" : "Recommended for"}: ...' max 52 chars>",
  "caption": "<Instagram caption, 3-5 sentences, ends with CTA>",
  "hashtags": ${hashtagInstructions}
}

${constraintBlock}

${localeDirective}`;

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

    let parsed: ProConVerdictLlmResponse;
    try {
      parsed = await validateAndReprompt(
        initialJson,
        async (hints) => {
          const hintBlock = hints.map((h) => `- ${h}`).join("\n");
          const retryPrompt = `${userPrompt}\n\nPREVIOUS ATTEMPT FAILED:\n${hintBlock}\n\nFix and return only the corrected JSON.`;
          const retryRaw = await llmCaller(systemPrompt, retryPrompt);
          return retryRaw ? (extractJson(retryRaw) ?? {}) : {};
        },
        { schema: proConVerdictLlmResponseSchema, maxReprompts: 1, locale },
      );
    } catch {
      return buildFallbackContent(ctx, locale, article.slug);
    }

    const generatedSlide: ProConVerdictGenerated = {
      toolName: parsed.tool_name.slice(0, 28),
      toolCategory: parsed.tool_category.slice(0, 26),
      subline: parsed.subline.slice(0, 110),
      eyebrow: parsed.eyebrow.slice(0, 36),
      slideNum: parsed.slide_num.slice(0, 10),
      ctaLine1: parsed.cta_line1.slice(0, 28),
      ctaLine2: parsed.cta_line2.slice(0, 30),
      dateLabel: parsed.date_label.slice(0, 36),
      prosHeader: parsed.pros_header.slice(0, 16),
      consHeader: parsed.cons_header.slice(0, 16),
      pros: parsed.pros.slice(0, 4).map((p) => p.slice(0, 48)),
      cons: parsed.cons.slice(0, 4).map((c) => c.slice(0, 48)),
      verdictText: parsed.verdict_text.slice(0, 120),
      verdictEm: parsed.verdict_em.slice(0, 20),
      recommendationTag: parsed.recommendation_tag.slice(0, 52),
    };

    if (ctx.iconSvg !== undefined) generatedSlide.iconSvg = ctx.iconSvg;
    if (ctx.iconInitials !== undefined) generatedSlide.iconInitials = ctx.iconInitials;
    if (ctx.iconHue !== undefined) generatedSlide.iconHue = ctx.iconHue;

    const result: GeneratedContentWithSlide = {
      hookOutput: {
        pattern: "negative_frame",
        leadPhrase: generatedSlide.verdictEm || ctx.name,
        highlightWord: generatedSlide.toolCategory.split(/[\s-]/)[0] ?? ctx.name,
        trailPhrase: isDE ? "im Test." : "in review.",
        fullText: generatedSlide.verdictText.slice(0, 120),
        promiseBlock: {
          line1: `${generatedSlide.prosHeader}: ${generatedSlide.pros.length}`,
          line2: `${generatedSlide.consHeader}: ${generatedSlide.cons.length}`,
        },
      },
      caption: parsed.caption.slice(0, 1800),
      hashtags: parsed.hashtags,
      _generatedSlide: generatedSlide,
    };

    return result as unknown as GeneratedContent;
  },

  // ── buildInput ─────────────────────────────────────────────────────────────

  buildInput: async (article, _discovery) => {
    return getToolContext(article);
  },

  // ── render ─────────────────────────────────────────────────────────────────

  render: async (context) => {
    const { article, input, locale, theme } = context;
    const ctx = input as ToolContext;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const withSlide = context.generatedContent as GeneratedContentWithSlide | undefined;
    const generatedSlide = withSlide?._generatedSlide ?? buildFallbackGenerated(ctx, locale, article.slug);

    const compositionInput: ProConVerdictInput = {
      slideIndex: 0,
      locale,
      theme,
      brandTokens: brandTokens as Record<string, unknown>,
      overrides: context.overrides ?? {},
      generated: generatedSlide,
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
      caption: context.generatedContent?.caption ?? "",
      hashtags: context.generatedContent?.hashtags ?? [],
      metadata: { estimatedCostUsd: 0.007, templateKey: "pro-con-verdict" },
    };
  },

  mockFixtures: PRO_CON_VERDICT_FIXTURES,
};

