import type { TemplateDefinition } from "../types.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema } from "../../compositions/list-carousel/types.ts";
import { verdictPerUseCaseOverridesSchema } from "../overrides/verdict-per-use-case.overrides.ts";
import { USE_CASE_VERDICT_FIXTURES } from "./fixtures/verdictPerUseCase.fixtures.ts";
import {
  verdictPerUseCaseBounds,
  verdictPerUseCaseGeneratedSchema,
  type VerdictPerUseCaseInput,
  type VerdictPerUseCaseGenerated,
} from "../../compositions/verdict-per-use-case/types.ts";
// @marketing-auto/core imported lazily inside generateContent() to avoid
// triggering getEnv() at module evaluation time (breaks unit tests without env vars).

// ─── VerdictContext — buildInput output type ───────────────────────────────────

export interface VerdictUseCaseItem {
  label: string;       // use case label (from frontmatter useCaseVerdicts[].useCase)
  winnerSlug: string;  // tool slug for icon resolution
  winnerName: string;  // display name for the pill
  iconSvg?: string;
  iconInitials?: string;
  iconHue?: number;
}

export interface VerdictContext {
  useCases: VerdictUseCaseItem[];  // 5–7 items (capped in buildInput)
  toolNames: string[];             // for generateContent toolNames
}

// ─── Re-export bounds + generatedSchema for consumers ────────────────────────

export { verdictPerUseCaseBounds, verdictPerUseCaseGeneratedSchema };
export type { VerdictPerUseCaseGenerated };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});

const SLIDE_W = 1080;
const SLIDE_H = 1350;

function buildGenerated(
  ctx: VerdictContext,
  articleTitle: string | null,
  articleSlug: string,
  locale: "de" | "en",
  overridesValues: ReturnType<typeof verdictPerUseCaseOverridesSchema.parse>,
): VerdictPerUseCaseGenerated {
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const year = new Date().getFullYear();

  const titleParts = (articleTitle ?? articleSlug).split(/[–—:]/);
  // Budgets sized to match getFontSize "cover-headline" buckets (max 120 chars combined).
  // getFontSize auto-shrinks the rendered font; we only guard against truly absurd input.
  const headline = (titleParts[0]?.trim() ?? articleSlug).slice(0, 72);
  const headlineEm = (
    titleParts[1]?.trim() ??
    (locale === "de" ? "im Vergleich" : "compared")
  ).slice(0, 40);

  const eyebrow = locale === "de"
    ? overridesValues.copy.eyebrow.de
    : overridesValues.copy.eyebrow.en;
  const ctaLine1 = locale === "de"
    ? overridesValues.copy.ctaPrefix.de
    : overridesValues.copy.ctaPrefix.en;

  const subline = locale === "de"
    ? `${ctx.useCases.length} Use Cases. ${ctx.useCases.length} klare Empfehlungen — keine "kommt drauf an"-Antworten.`
    : `${ctx.useCases.length} use cases. ${ctx.useCases.length} clear recommendations — no "it depends" answers.`;

  return {
    headline,
    headlineEm,
    subline,
    eyebrow,
    slideNum: "01 / 01",
    ctaLine1,
    ctaLine2: `toolwiki.ai/${articleSlug}`,
    dateLabel: locale === "de"
      ? `${ctx.useCases.length} Use Cases · Stand ${month}/${year}`
      : `${ctx.useCases.length} use cases · as of ${month}/${year}`,
    useCases: ctx.useCases.map((uc) => {
      // Slide uses getFontSize("list-item") to auto-shrink long labels, with a 2-line clamp
      // as last-resort safety. Budgets here only block pathological input.
      const base: VerdictPerUseCaseGenerated["useCases"][number] = {
        label: uc.label.slice(0, 80),
        winnerName: uc.winnerName.slice(0, 24),
      };
      if (uc.iconSvg !== undefined) base.iconSvg = uc.iconSvg;
      if (uc.iconInitials !== undefined) base.iconInitials = uc.iconInitials;
      if (uc.iconHue !== undefined) base.iconHue = uc.iconHue;
      return base;
    }),
  };
}

function fallbackCaption(ctx: VerdictContext, locale: "de" | "en", slug: string): string {
  const toolNames = ctx.toolNames.join(" vs. ");
  if (locale === "de") {
    return (
      `${toolNames}: ${ctx.useCases.length} Use-Cases, ${ctx.useCases.length} ehrliche Empfehlungen.\n\n` +
      `Speicher diesen Post für deine nächste Tool-Entscheidung.\n\n` +
      `→ toolwiki.ai/${slug}`
    );
  }
  return (
    `${toolNames}: ${ctx.useCases.length} use cases, ${ctx.useCases.length} honest recommendations.\n\n` +
    `Save this post for your next tool decision.\n\n` +
    `→ toolwiki.ai/${slug}`
  );
}

function fallbackHashtags(locale: "de" | "en"): string[] {
  if (locale === "de") {
    return [
      "#KITools",
      "#AITools",
      "#KIVergleich",
      "#AIComparison",
      "#KIFürBusiness",
      "#AIForBusiness",
      "#UseCase",
    ];
  }
  return [
    "#AITools",
    "#AIComparison",
    "#AIForBusiness",
    "#UseCase",
    "#SoftwareReview",
    "#Productivity",
    "#DigitalTools",
  ];
}

// ─── Template definition ──────────────────────────────────────────────────────

export const verdictPerUseCaseTemplate: TemplateDefinition<VerdictContext> = {
  key: "verdict-per-use-case",
  displayName: "Use-Case-Verdikt",
  description:
    "Einzelne Still-PNG: 5–7 Use-Case-Zeilen mit Index, Label und Winner-Pill (Tool-Icon + Name). Kein Score, keine Cards — saubere Rows getrennt durch border-top.",
  defaultSlideCount: 1,
  estimatedCostUsd: 0.005,

  outputFormat: "carousel",
  compatibleChannels: ["instagram"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "use-case",
    estimatedEngagementTier: "medium",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  bounds: verdictPerUseCaseBounds,
  generatedSchema: verdictPerUseCaseGeneratedSchema,
  slotMap: {},

  eligibility: (article, _discovery) => {
    if (article.collection !== "comparisons") {
      return { eligible: false, reason: "Nur für comparisons-Collection" };
    }

    const extras = (article.frontmatterExtras ?? {}) as {
      tools?: Array<{ slug?: string }>;
      toolSlugs?: string[];
      useCaseVerdicts?: Array<{ useCase?: string; winner?: string }>;
    };

    const toolCount = extras.tools?.length ?? extras.toolSlugs?.length ?? 0;
    if (toolCount < 3) {
      return {
        eligible: false,
        reason: "Benötigt mindestens 3 Tools für sinnvolle Use-Case-Verdicts",
        requirements: ["frontmatterExtras.tools.length >= 3"],
      };
    }

    const verdicts = extras.useCaseVerdicts ?? [];
    if (verdicts.length < 5) {
      return {
        eligible: false,
        reason: "Benötigt mindestens 5 Use-Case-Verdicts",
        requirements: ["frontmatterExtras.useCaseVerdicts.length >= 5"],
      };
    }

    return { eligible: true };
  },

  generateContent: async (article, input, locale, llmCaller) => {
    const { generateContentWithGate, inferArticleType, selectPattern } = await import("@marketing-auto/core");
    const ctx = input as VerdictContext;
    const toolNames = ctx.toolNames;
    const articleType = inferArticleType(article.title ?? article.slug, toolNames.length);
    const pattern = selectPattern(article.id, articleType);
    return generateContentWithGate(
      { id: article.id, title: article.title ?? article.slug, toolCount: toolNames.length, toolNames },
      pattern,
      {
        articleTitle: article.title ?? article.slug,
        toolNames,
        primaryKeyword: toolNames.join(" vs. "),
        locale,
        articleSlug: article.slug,
        contentType: "comparison",
      },
      llmCaller,
    );
  },

  buildInput: async (article, _discovery) => {
    type RawUseCaseVerdict = {
      useCase?: string;
      winner?: string;        // tool slug
      reason?: string;
    };
    type RawTool = {
      slug?: string;
      name?: string;
    };

    const extras = (article.frontmatterExtras ?? {}) as {
      tools?: RawTool[];
      toolSlugs?: string[];
      useCaseVerdicts?: RawUseCaseVerdict[];
    };

    const locale = (article.locale ?? "de") as "de" | "en";
    const rawVerdicts = (extras.useCaseVerdicts ?? []).slice(0, 7);

    // Collect all relevant slugs (verdict winners + article tools) for icon lookup
    const winnerSlugs = rawVerdicts
      .map((v) => v.winner)
      .filter((s): s is string => typeof s === "string");
    const toolSlugs = (extras.tools ?? [])
      .map((t) => t.slug)
      .filter((s): s is string => typeof s === "string");
    const allSlugs = Array.from(new Set([...winnerSlugs, ...toolSlugs]));

    const toolLookup = await buildToolLookup(allSlugs, locale, article.projectId);

    // Build tool names list for generateContent
    const toolNames = (extras.tools ?? [])
      .slice(0, 10)
      .map((t) => {
        const slug = t.slug ?? "";
        return t.name ?? toolLookup.get(slug)?.name ?? slug;
      })
      .filter(Boolean);

    const useCases: VerdictUseCaseItem[] = rawVerdicts
      .filter((v) => v.useCase && v.winner)
      .map((v): VerdictUseCaseItem => {
        const slug = v.winner!;
        const resolved = toolLookup.get(slug);
        const base: VerdictUseCaseItem = {
          label: (v.useCase ?? slug).slice(0, 80),
          winnerSlug: slug,
          winnerName: (resolved?.name ?? slug).slice(0, 24),
        };
        if (resolved?.iconSvg !== undefined) base.iconSvg = resolved.iconSvg;
        if (resolved?.iconInitials !== undefined) base.iconInitials = resolved.iconInitials;
        if (resolved?.iconHue !== undefined) base.iconHue = resolved.iconHue;
        return base;
      });

    return { useCases, toolNames };
  },

  render: async (context) => {
    const { article, input, locale, theme, overrides } = context;
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const overridesValues = verdictPerUseCaseOverridesSchema.parse(overrides ?? {});

    const generated = buildGenerated(
      input,
      article.title,
      article.slug,
      locale,
      overridesValues,
    );

    const compositionInput: VerdictPerUseCaseInput = {
      slideIndex: 0,
      locale,
      theme,
      generated,
      brandTokens,
      ...(overrides !== undefined && { overrides }),
    };

    const socialModule = await import("../../../render-server.ts") as unknown as {
      renderVerdictPerUseCase: (input: VerdictPerUseCaseInput) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderVerdictPerUseCase(compositionInput);

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "verdict-per-use-case",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption: context.generatedContent?.caption ?? fallbackCaption(input, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.005, templateKey: "verdict-per-use-case" },
    };
  },

  mockFixtures: USE_CASE_VERDICT_FIXTURES,
};
