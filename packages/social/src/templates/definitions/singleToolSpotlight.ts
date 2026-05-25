import { z } from "zod";
import type { TemplateDefinition, ContentBounds, GeneratedContent } from "../types.ts";
import { validateAndReprompt } from "../validateGenerated.ts";
import { buildConstraintBlock } from "../lib/buildConstraintBlock.ts";
import { getToolContext, type ToolContext } from "../adapters/tool.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { singleToolSpotlightOverridesSchema } from "../overrides/singleToolSpotlight.overrides.ts";
import { SINGLE_TOOL_SPOTLIGHT_FIXTURES } from "./fixtures/singleToolSpotlight.fixtures.ts";
import type { SingleToolSpotlightInput } from "../../compositions/single-tool-spotlight/types.ts";
// @marketing-auto/core imported lazily inside generateContent() to avoid
// triggering getEnv() at module evaluation time (breaks unit tests without env vars).

// ---------------------------------------------------------------------------
// Bounds — authoritative source: .claude/skills/toolwiki-design/REMOTION.md
// ---------------------------------------------------------------------------

// SpotlightProps section
export const singleToolSpotlightBounds = {
  eyebrow:   { min: 12, max: 28 },
  headerNum: { min: 16, max: 44 },
  tool: {
    name:    { min: 4, max: 14 },
    version: { min: 6, max: 34 },
  },
  verdictQuote: { min: 40, max: 120 },
  scoreLabel:   { min: 6,  max: 18 },
  facts: {
    count: 4,
    key:   { min: 4, max: 14 },
    value: { min: 4, max: 20 },
  },
  strengths:  { countMin: 3, countMax: 4, each: { min: 30, max: 70 } },
  weaknesses: { countMin: 3, countMax: 4, each: { min: 30, max: 70 } },
  footer: {
    ctaLine: { min: 8,  max: 24 },
    url:     { min: 12, max: 32 },
  },
  // Internal render fields retained for render-code compatibility
  pros:     { max: 5, perItemMaxChars: 80 },
  cons:     { max: 4, perItemMaxChars: 80 },
  features: { max: 6, perItemMaxChars: 80 },
  useCases: { max: 4, perItemMaxChars: 80 },
  // Caption/hashtag fields (not rendered on slide)
  captionBody: { min: 20, max: 1800 },
  hashtags: { max: 10, perItemMaxChars: 24 },
} as const satisfies ContentBounds;

// CoverProps section — new in Spec 60.1
export const coverBounds = {
  eyebrow:        { min: 8,  max: 28 },
  headerNum:      { min: 12, max: 56 },
  updateBadge:    { min: 8,  max: 28 },
  heroTitle:      { min: 6,  max: 22 },
  kicker:         { min: 40, max: 130 },
  toolLogosCount: { countMin: 1, countMax: 6 },  // ListBound: item count, not char count
  toolsMoreText:  { min: 4,  max: 14 },
  stats: {
    count: 3,
    value: { min: 1, max: 4 },
    label: { min: 8, max: 24 },
  },
  byline: {
    name:     { min: 4,  max: 22 },
    role:     { min: 10, max: 32 },
    readTime: { min: 5,  max: 14 },
  },
  swipeText: { min: 12, max: 28 },
  footer: {
    ctaLine: { min: 6,  max: 22 },
    url:     { min: 12, max: 32 },
  },
} as const satisfies ContentBounds;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * LLM response schema (snake_case — what the model returns).
 * Used in validateAndReprompt. Slightly generous bounds to tolerate LLM variance.
 */
const spotlightLlmResponseSchema = z.object({
  hook_text:     z.string().min(20).max(200),
  verdict_quote: z.string().min(30).max(160),
  score_label:   z.string().min(3).max(24),
  facts: z.array(z.object({
    key:   z.string().min(3).max(16),
    value: z.string().min(2).max(24),
  })).length(4),
  strengths:  z.array(z.string().min(20).max(80)).min(3).max(4),
  weaknesses: z.array(z.string().min(20).max(80)).min(3).max(4),
  caption:    z.string().min(20).max(2000),
  hashtags:   z.array(z.string().regex(/^#[^\s\-#]+$/u)).min(5).max(10),
});

type SpotlightLlmOutput = z.infer<typeof spotlightLlmResponseSchema>;

/** Data extracted from LLM for use in the body slide. */
interface SpotlightExtra {
  verdictQuote: string;
  scoreLabel:   string;
  facts:        Array<{ key: string; value: string }>;
  strengths:    string[];
  weaknesses:   string[];
}

/**
 * generatedSchema (camelCase) — validates fixture generatedContent fields.
 * Spec 59.3.5 dual-schema convention: spotlightLlmResponseSchema = LLM in,
 * singleToolSpotlightGeneratedSchema = fixture-test truth.
 */
export const singleToolSpotlightGeneratedSchema = z.object({
  verdictQuote: z.string().min(40).max(120),
  scoreLabel:   z.string().min(6).max(18),
  facts: z.array(z.object({
    key:   z.string().min(4).max(14),
    value: z.string().min(4).max(20),
  })).length(4),
  strengths:  z.array(z.string().min(30).max(70)).min(3).max(4),
  weaknesses: z.array(z.string().min(30).max(70)).min(3).max(4),
  caption:    z.string().min(singleToolSpotlightBounds.captionBody.min)
                        .max(singleToolSpotlightBounds.captionBody.max),
  hashtags:   z.array(z.string().max(singleToolSpotlightBounds.hashtags.perItemMaxChars))
                .max(singleToolSpotlightBounds.hashtags.max),
});
export type SingleToolSpotlightGenerated = z.infer<typeof singleToolSpotlightGeneratedSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});
const SLIDE_W = 1080;
const SLIDE_H = 1350;

const SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS = {
  minTools:  1,
  maxTools:  1,
  minSlides: 2,
  maxSlides: 3,
  defaultSlides: 3,
  eligibleCollections: ["tools"],
  fieldBounds: {
    pros: { minItems: 3, maxItems: 5 },
    cons: { minItems: 0, maxItems: 4 },
  },
};

// ---------------------------------------------------------------------------
// Template definition
// ---------------------------------------------------------------------------

export const singleToolSpotlightTemplate: TemplateDefinition<ToolContext> = {
  key: "single-tool-spotlight",
  displayName: "Single-Tool-Spotlight",
  description:
    "3 Slides für einen einzelnen Tool-Artikel (Spec 60.1): Cover, Body (Verdict + Stärken/Schwächen), CTA.",
  defaultSlideCount: 3,
  estimatedCostUsd: 0.008,  // bumped from 0.006 to account for custom LLM call

  outputFormat: "carousel",
  compatibleChannels: ["instagram", "tiktok"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "tool-spotlight",
    estimatedEngagementTier: "medium",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  renderServerFn: "renderSingleToolSpotlight",

  bounds: singleToolSpotlightBounds,
  generatedSchema: singleToolSpotlightGeneratedSchema,
  slotMap: {
    verdictQuote: "slot-body",
    strengths:    "list-item",
    weaknesses:   "list-item",
    scoreLabel:   "eyebrow",
  },

  // ── Eligibility ────────────────────────────────────────────────────────────

  eligibility: (article, _discovery) => {
    if (article.collection !== "tools") {
      return { eligible: false, reason: "Nur für tools-Collection" };
    }

    const extras = (article.domainExtras ?? {}) as {
      pros?: Array<{ text: string } | string>;
      pricingTier?: string;
      pricing?: string;
    };

    const pros = extras.pros ?? [];
    if (pros.length < SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.minItems) {
      return {
        eligible: false,
        reason: `Benötigt mindestens ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.minItems} Pros`,
        requirements: [`frontmatter.pros.length >= ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.minItems}`],
      };
    }
    if (pros.length > SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems) {
      return {
        eligible: false,
        reason: `Zu viele Pros (max. ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems})`,
        requirements: [`frontmatter.pros.length <= ${SINGLE_TOOL_SPOTLIGHT_CONSTRAINTS.fieldBounds.pros.maxItems}`],
      };
    }

    if (!extras.pricingTier && !extras.pricing) {
      return {
        eligible: false,
        reason: "Pricing-Feld fehlt",
        requirements: ["frontmatter.pricingTier oder frontmatter.pricing"],
      };
    }

    return { eligible: true };
  },

  // ── generateContent ────────────────────────────────────────────────────────

  generateContent: async (article, input, locale, llmCaller) => {
    const { buildHashtagInstructions } = await import("@marketing-auto/core");
    const ctx = input as ToolContext;

    // Build the constraint block for LLM-generated fields only (structural fields come from article)
    const constraintBlock = buildConstraintBlock(
      singleToolSpotlightBounds,
      locale,
      { fields: ["verdictQuote", "scoreLabel", "facts", "strengths", "weaknesses"] },
    );

    const hashtagInstructions = buildHashtagInstructions({
      locale,
      contentType: "review",
      toolNames: [ctx.name],
      ...(ctx.primaryCategory !== undefined && { toolCategory: ctx.primaryCategory }),
    });
    const isDE = locale === "de";
    const localeDirective = isDE
      ? "Output language: German (du-Form, B2B-konversationell). Benutze Deutsch für alle Texte."
      : "Output language: English (concise, direct).";

    const prosText  = ctx.pros.slice(0, 5).map(p => p.text).join("; ") || "(not provided)";
    const consText  = ctx.cons.slice(0, 5).map(c => c.text).join("; ") || "(not provided)";
    const priceInfo = ctx.pricingTier === "free"
      ? "Free"
      : ctx.priceFrom != null
        ? `${ctx.pricingTier ?? "paid"} (from $${ctx.priceFrom}/mo)`
        : ctx.pricingTier ?? "paid";

    const systemPrompt =
      "You write structured JSON for Instagram carousel slides about AI tools. " +
      "Return ONLY valid JSON — no markdown fences, no explanation, no preamble.";

    const userPrompt = `Generate Instagram carousel content for a single-tool deep dive on "${ctx.name}".

TOOL DATA:
- Name: ${ctx.name}
- Category: ${ctx.primaryCategory ?? "(not specified)"}
- Pricing: ${priceInfo}
- Rating: ${ctx.rating != null ? `${ctx.rating.toFixed(1)}/5.0` : "(not rated)"}
- Pros: ${prosText}
- Cons: ${consText}
- Tagline: ${ctx.tagline ?? "(not provided)"}
- Article: "${article.title ?? article.slug}"

OUTPUT JSON — exactly these keys:
{
  "hook_text": "<one punchy Instagram hook sentence — lead with the tool's strongest unique value>",
  "verdict_quote": "<one definitive bottom-line judgment sentence>",
  "score_label": "<2-3 word category label for the score, e.g. 'Top Aesthetic' or 'Enterprise Pick'>",
  "facts": [
    { "key": "<short facet label>", "value": "<concrete value>" },
    { "key": "...", "value": "..." },
    { "key": "...", "value": "..." },
    { "key": "...", "value": "..." }
  ],
  "strengths": ["<specific strength>", "<specific strength>", "<specific strength>"],
  "weaknesses": ["<specific weakness>", "<specific weakness>", "<specific weakness>"],
  "caption": "<Instagram caption: hook line, 2-3 key points, CTA>",
  "hashtags": ${hashtagInstructions}
}

${constraintBlock}

${localeDirective}`;

    const raw = await llmCaller(systemPrompt, userPrompt);
    if (!raw) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    const start = raw.indexOf("{");
    const end   = raw.lastIndexOf("}");
    if (start === -1 || end === -1) return buildFallbackGeneratedContent(ctx, locale, article.slug);

    let parsed: SpotlightLlmOutput;
    try {
      const extracted = JSON.parse(raw.slice(start, end + 1)) as unknown;
      parsed = await validateAndReprompt(
        extracted,
        async (hints) => {
          const fixPrompt = `${userPrompt}\n\nFix these validation errors:\n${hints.map(h => `- ${h}`).join("\n")}`;
          const retryRaw = await llmCaller(systemPrompt, fixPrompt);
          if (!retryRaw) return {};
          const rs = retryRaw.indexOf("{");
          const re = retryRaw.lastIndexOf("}");
          if (rs === -1 || re === -1) return {};
          try { return JSON.parse(retryRaw.slice(rs, re + 1)) as unknown; }
          catch { return {}; }
        },
        { schema: spotlightLlmResponseSchema, maxReprompts: 1, locale },
      );
    } catch {
      return buildFallbackGeneratedContent(ctx, locale, article.slug);
    }

    const spotlight: SpotlightExtra = {
      verdictQuote: parsed.verdict_quote.slice(0, 120),
      scoreLabel:   parsed.score_label.slice(0, 18),
      facts:        parsed.facts.slice(0, 4).map(f => ({
        key:   f.key.slice(0, 14),
        value: f.value.slice(0, 20),
      })),
      strengths:  parsed.strengths.slice(0, 4).map(s => s.slice(0, 70)),
      weaknesses: parsed.weaknesses.slice(0, 4).map(w => w.slice(0, 70)),
    };

    return {
      hookOutput: {
        text:    parsed.hook_text.slice(0, 160),
        pattern: "negative_frame" as const,
      },
      caption:    parsed.caption.slice(0, 1800),
      hashtags:   parsed.hashtags,
      _spotlight: spotlight,
    } as unknown as GeneratedContent;
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
    const resolvedOverrides = singleToolSpotlightOverridesSchema.parse(context.overrides ?? {});

    // Extract _spotlight data via extension pattern (Spec 60.1 Session 6)
    const withSpotlight = context.generatedContent as
      (GeneratedContent & { _spotlight?: SpotlightExtra }) | undefined;
    const spotlight = withSpotlight?._spotlight ?? null;

    // Shared computed values
    const isDE = locale === "de";
    const now   = new Date();
    const month = new Intl.DateTimeFormat(isDE ? "de-DE" : "en-US", { month: "long" }).format(now);
    const year  = now.getFullYear();

    const websiteBase = String(brandTokens.social?.websiteUrl ?? "toolwiki.ai")
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
    const footerUrl  = `${websiteBase}/${ctx.slug}`.slice(0, 32);
    const footerCta  = isDE ? "Vollständiger Test →" : "Read full review →";
    const eyebrow    = isDE ? "Deep Dive · Tool-Portrait" : "Deep Dive · Tool Portrait";
    const score      = Math.min(99, Math.round((ctx.rating ?? 4.0) * 20));

    // Cover headerNum (min 12, max 56)
    const coverHeaderNum = `${month} ${year} · ${ctx.name}`.slice(0, 56);

    // Body headerNum (min 16, max 44)
    const bodyHeaderBase = `Test ${month.slice(0, 3)} ${year} · ${ctx.name}`;
    const bodyHeaderNum  = (
      bodyHeaderBase.length >= 16
        ? bodyHeaderBase
        : `${bodyHeaderBase} · ${ctx.primaryCategory ?? "Tool"}`
    ).slice(0, 44);

    // Pricing stat (value: 1-4 chars)
    const priceValue: string = ctx.pricingTier === "free"
      ? "Free"
      : ctx.priceFrom != null
        ? `${Math.min(ctx.priceFrom, 999)}$`.slice(0, 4)
        : "Paid";

    // Rating stat (value: 1-4 chars)
    const ratingValue = ctx.rating != null ? ctx.rating.toFixed(1) : "4.0";

    // Tier label (value: 1-4 chars)
    const tierValues: Record<string, string> = {
      free: "Free", freemium: "Mix", paid: "Paid", enterprise: "Ent.",
    };
    const tierValue = tierValues[ctx.pricingTier ?? "paid"] ?? "Paid";

    // Tool version string (min 6, max 34)
    const tierLabels: Record<string, string> = {
      free:       isDE ? "Kostenlose Version" : "Free version",
      freemium:   isDE ? "Freemium · Pro verfügbar" : "Freemium · Pro available",
      paid:       isDE ? "Bezahlte Version"   : "Paid version",
      enterprise: "Enterprise Edition",
    };
    const versionBase = tierLabels[ctx.pricingTier ?? "paid"] ?? (isDE ? "Vollversion" : "Full version");
    const toolVersion = (
      ctx.priceFrom != null && ctx.pricingTier !== "free"
        ? `${versionBase} · ab ${ctx.priceFrom} $/Mo`
        : versionBase
    ).slice(0, 34);

    // Cover kicker (min 40, max 130)
    let kicker = ctx.tagline ?? "";
    if (kicker.length < 40) {
      kicker = kicker
        ? `${kicker} — ${isDE ? "umfassend getestet." : "thoroughly tested."}`
        : isDE
          ? `${ctx.name}: ${ctx.primaryCategory ?? "KI-Tool"} im umfassenden Test — alle Features und Preise auf einen Blick.`
          : `${ctx.name}: Complete ${ctx.primaryCategory ?? "AI Tool"} review — all features and pricing at a glance.`;
    }
    kicker = kicker.slice(0, 130);

    // ── Cover slide ─────────────────────────────────────────────────────────
    const cover: SingleToolSpotlightInput["cover"] = {
      eyebrow,
      headerNum:  coverHeaderNum,
      heroTitle:  ctx.name.slice(0, 22),
      kicker,
      toolLogos:  [{ src: ctx.iconSvg ?? "", alt: ctx.name }],
      toolsMoreText: isDE ? "KI-Tool" : "AI Tool",
      stats: [
        {
          value: priceValue,
          label: isDE ? "Monatlicher Plan" : "Monthly plan",
        },
        {
          value: ratingValue,
          label: isDE ? "Bewertung · 5.0" : "Rating out of 5",
        },
        {
          value: tierValue,
          label: isDE ? "Preismodell" : "Price model",
        },
      ],
      byline: {
        initials: "MK",
        name:     "Marcel Klaczinski",
        role:     isDE ? "Editor · KI-Tools & Reviews" : "Editor · AI Tools & Reviews",
        readTime: isDE ? "8 Min Lesen" : "8 min read",
      },
      swipeText:  isDE ? "Swipe für Details" : "Swipe for details",
      footer: { ctaLine: footerCta, url: footerUrl },
    };

    // ── Body slide (requires _spotlight data) ───────────────────────────────
    const body: SingleToolSpotlightInput["body"] = spotlight
      ? {
          eyebrow,
          headerNum:    bodyHeaderNum,
          slideIndex:   1,   // placeholder — overridden by outer props.slideIndex in dispatcher
          slideTotal:   3,   // placeholder — overridden by outer props.slideTotal in dispatcher
          tool: {
            logo:    ctx.iconSvg ?? "",
            name:    ctx.name.slice(0, 14),
            version: toolVersion,
          },
          verdictQuote: spotlight.verdictQuote,
          score,
          scoreLabel:   spotlight.scoreLabel,
          facts:        spotlight.facts as [
            { key: string; value: string },
            { key: string; value: string },
            { key: string; value: string },
            { key: string; value: string },
          ],
          strengths:  spotlight.strengths,
          weaknesses: spotlight.weaknesses,
          footer: { ctaLine: footerCta, url: footerUrl },
        }
      : null;

    // ── End slide ────────────────────────────────────────────────────────────
    const includeEnd = resolvedOverrides.layout.includeEndSlide !== false;
    const end: SingleToolSpotlightInput["end"] = includeEnd
      ? { ctaLine: footerCta, url: footerUrl }
      : null;

    // slideTotal = cover + (body if available) + (end if enabled)
    const slideTotal =
      1 +                       // cover always present
      (body !== null ? 1 : 0) +
      (end  !== null ? 1 : 0);

    const compositionInput: SingleToolSpotlightInput = {
      slideIndex: 0,
      slideTotal: Math.max(1, slideTotal),
      cover,
      body,
      end,
      theme,
      locale,
      brandTokens: brandTokens as Record<string, unknown>,
      overrides:   resolvedOverrides as Record<string, unknown>,
    };

    // Dynamic import — avoids bundling Remotion into non-render contexts
    const socialModule = await import("../../../render-server.ts") as unknown as {
      renderSingleToolSpotlight: (
        input: Record<string, unknown>,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };

    const { slides: buffers } = await socialModule.renderSingleToolSpotlight(
      compositionInput as unknown as Record<string, unknown>,
    );

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "single-tool-spotlight",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption:  context.generatedContent?.caption  ?? fallbackCaption(ctx, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(ctx, locale),
      metadata: { estimatedCostUsd: 0.008, templateKey: "single-tool-spotlight" },
    };
  },

  mockFixtures: SINGLE_TOOL_SPOTLIGHT_FIXTURES,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFallbackGeneratedContent(
  ctx: ToolContext,
  locale: "de" | "en",
  slug: string,
): GeneratedContent {
  return {
    hookOutput: {
      text:    locale === "de"
        ? `${ctx.name} — lohnt es sich wirklich?`
        : `${ctx.name} — is it worth it?`,
      pattern: "negative_frame" as const,
    },
    caption:  fallbackCaption(ctx, locale, slug),
    hashtags: fallbackHashtags(ctx, locale),
    // _spotlight intentionally absent → render() falls back to cover+end only (2 slides)
  } as unknown as GeneratedContent;
}

function fallbackCaption(input: ToolContext, locale: "de" | "en", slug: string): string {
  const topPro = input.pros[0]?.text ?? "";
  if (locale === "de") {
    return (
      `${input.name} im Check — lohnt es sich wirklich?\n\n` +
      (topPro ? `Stärkstes Argument: ${topPro}\n\n` : "") +
      `Speicher diesen Post für deine nächste Tool-Evaluierung.\n\n` +
      `→ toolwiki.ai/${slug}`
    );
  }
  return (
    `${input.name} reviewed — is it worth it?\n\n` +
    (topPro ? `Strongest argument: ${topPro}\n\n` : "") +
    `Save this post for your next tool evaluation.\n\n` +
    `→ toolwiki.ai/${slug}`
  );
}

function fallbackHashtags(input: ToolContext, locale: "de" | "en"): string[] {
  const category = input.primaryCategory?.replace(/\s+/g, "") ?? "KITool";
  if (locale === "de") {
    return [
      "#KITools", "#AITools", `#${category}`,
      "#KIFürBusiness", "#AIForBusiness", "#SoftwareTest", "#Produktivität",
    ];
  }
  return [
    "#AITools", `#${category}`, "#AIForBusiness",
    "#DigitalTools", "#SoftwareReview", "#Productivity", "#TechTools",
  ];
}
