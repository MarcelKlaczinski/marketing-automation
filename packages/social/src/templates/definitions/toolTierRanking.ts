/**
 * Spec 65.17 B6 — `tool-tier-ranking` TemplateDefinition.
 *
 * Single-still data-driven Family-A template. Renders 3 tier-lanes
 * (Spitze · Stark · Solide) with 1–2 tool logos per lane. Tier assignment is
 * frozen at brief-emit time by the `top-n-comparison` brief-generator when
 * `formatConfig.tierMode === true` (Spec 65.17 B5) and lives at
 * `articles.domain_extras.recurring.formatConfig.tierData`.
 *
 * No LLM hook — tier-template is purely data-driven; caption + hashtags are
 * deterministically generated from the tier-assignment.
 */
import { articles, db, inArray } from "@marketing-auto/db";
import type { TemplateDefinition } from "../types.ts";
import { buildToolLookup } from "../adapters/toolLookup.ts";
import { writeSlides } from "../lib/writeSlides.ts";
import { brandTokensSchema, type HookOutput } from "../../compositions/list-carousel/types.ts";
import {
  toolTierRankingBounds,
  type Tier,
  type TierLane,
  type ToolTierRankingGenerated,
  type ToolTierRankingInput,
} from "../../compositions/tool-tier-ranking/types.ts";
import { tierLabel } from "../../compositions/tool-tier-ranking/tier-colors.ts";
import { TOOL_TIER_RANKING_FIXTURES } from "./fixtures/toolTierRanking.fixtures.ts";
import type { FamilyATool } from "../../compositions/_shared/family-a/types.ts";

// ─── BuildInput output shape ─────────────────────────────────────────────────

export interface TierRankingContext {
  tiers: TierLane[];
  /** Flat tool-name list for caption/hashtag derivation. */
  toolNames: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_BRAND_TOKENS = brandTokensSchema.parse({});
const SLIDE_W = 1080;
const SLIDE_H = 1350;

const TIER_ORDER: readonly Tier[] = ["spitze", "stark", "solide"];

interface ToolDomainShape {
  id?: string;
  slug?: string;
  name?: string;
  primaryColor?: string;
  secondaryColor?: string;
  tertiaryColor?: string;
}

interface RecurringDomainShape {
  formatConfig?: {
    tierData?: Array<{ toolId: string; tier: Tier }>;
    toolIds?: string[];
  };
}

/**
 * Map a `FamilyATool` from a raw tool-lookup entry. The tier-template only
 * reads `slug / name / iconSvg / iconInitials / iconHue / primaryColor` —
 * other `familyAToolSchema` fields are filled with safe defaults so the Zod
 * parse succeeds.
 */
function toFamilyATool(args: {
  slug: string;
  name: string;
  resolved: ReturnType<typeof buildToolLookup> extends Promise<Map<string, infer V>> ? V : never;
  domain?: ToolDomainShape;
}): FamilyATool {
  const { slug, name, resolved, domain } = args;
  const tool: FamilyATool = {
    slug,
    name: name.slice(0, 28),
    score: 0,
    scoreTier: "mid",
    meta: "—",
    pricePrefix: "",
    priceAmount: "—",
    pros: ["—", "—"],
    cons: ["—", "—"],
    isWinner: false,
  };
  if (resolved?.iconSvg !== undefined) tool.iconSvg = resolved.iconSvg;
  if (resolved?.iconInitials !== undefined) tool.iconInitials = resolved.iconInitials;
  if (resolved?.iconHue !== undefined) tool.iconHue = resolved.iconHue;
  if (domain?.primaryColor !== undefined) tool.primaryColor = domain.primaryColor;
  if (domain?.secondaryColor !== undefined) tool.secondaryColor = domain.secondaryColor;
  if (domain?.tertiaryColor !== undefined) tool.tertiaryColor = domain.tertiaryColor;
  return tool;
}

function buildGenerated(
  ctx: TierRankingContext,
  articleTitle: string | null,
  articleSlug: string,
  locale: "de" | "en",
): ToolTierRankingGenerated {
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const year = new Date().getFullYear();
  const titleParts = (articleTitle ?? articleSlug).split(/[–—:]/);
  const headlineLead = (titleParts[0]?.trim() ?? articleSlug).slice(0, 28);
  const headlineEm = (
    titleParts[1]?.trim() ??
    (locale === "de" ? "im Tier-Ranking" : "ranked")
  ).slice(0, 32);

  const eyebrow = locale === "de"
    ? `Tier-Ranking · ${ctx.toolNames.length} Tools`
    : `Tier ranking · ${ctx.toolNames.length} tools`;

  const subline = locale === "de"
    ? `Datengetrieben aus Persona-Scores — von Solide bis Spitze.`
    : `Data-driven from persona scores — Decent to Top.`;

  return {
    eyebrow,
    headlineLead,
    headlineEm,
    subline,
    headerNum: locale === "de" ? `${month}/${year}` : `${month}/${year}`,
    ctaLine: locale === "de" ? "Vollständiges Ranking →" : "Full ranking →",
    articleUrl: `toolwiki.ai/${articleSlug}`,
    tiers: ctx.tiers,
  };
}

function fallbackCaption(ctx: TierRankingContext, locale: "de" | "en", slug: string): string {
  const tools = ctx.toolNames.join(" · ");
  if (locale === "de") {
    return (
      `${ctx.toolNames.length} Tools im Tier-Ranking: ${tools}.\n\n` +
      `Solide. Stark. Spitze. Wer ist wo?\n\n` +
      `→ toolwiki.ai/${slug}`
    );
  }
  return (
    `${ctx.toolNames.length} tools tier-ranked: ${tools}.\n\n` +
    `Decent. Solid. Top. Who lands where?\n\n` +
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
      "#TierList",
      "#KIFürBusiness",
      "#AIForBusiness",
    ];
  }
  return [
    "#AITools",
    "#AIComparison",
    "#TierList",
    "#AIForBusiness",
    "#SoftwareReview",
    "#ToolStack",
    "#Productivity",
  ];
}

function fallbackHookOutput(toolCount: number, locale: "de" | "en"): HookOutput {
  const lead = locale === "de" ? `${toolCount} Tools` : `${toolCount} tools`;
  const highlight = locale === "de" ? "3 Tiers" : "3 tiers";
  const trail = locale === "de" ? "1 klarer Sieger." : "1 clear winner.";
  return {
    pattern: "number_promise",
    leadPhrase: lead,
    highlightWord: highlight,
    trailPhrase: trail,
    fullText: `${lead}, ${highlight}, ${trail}`,
    promiseBlock: {
      line1: locale === "de" ? "Datengetrieben aus Persona-Scores." : "Data-driven from persona scores.",
      line2: locale === "de" ? "Solide. Stark. Spitze." : "Decent. Solid. Top.",
    },
  };
}

// ─── Template definition ─────────────────────────────────────────────────────

export const toolTierRankingTemplate: TemplateDefinition<TierRankingContext> = {
  key: "tool-tier-ranking",
  displayName: "Tool-Tier-Ranking",
  description:
    "Datengetriebenes Tier-Ranking: 3 Lanes (Solide / Stark / Spitze) mit 3-5 Tools, abgeleitet aus tool_persona_scores. Gold/Silber/Bronze Color-Coding, Logo-Grid.",
  defaultSlideCount: 1,
  estimatedCostUsd: 0.005,

  outputFormat: "carousel",
  compatibleChannels: ["instagram"],
  generationClass: "frontmatter-derived",
  plannerMeta: {
    contentType: "comparison",
    estimatedEngagementTier: "high",
    recycleableFromExistingArticle: true,
    requiresLiveData: false,
  },

  renderServerFn: "renderToolTierRanking",

  bounds: toolTierRankingBounds,
  slotMap: {},

  eligibility: (article, _discovery) => {
    const recurring = (article.domainExtras ?? {}) as { recurring?: RecurringDomainShape };
    const tierData = recurring.recurring?.formatConfig?.tierData;
    if (!tierData || tierData.length < 3 || tierData.length > 5) {
      return {
        eligible: false,
        reason:
          "tool-tier-ranking requires 3–5 tier-mapped tools in domain_extras.recurring.formatConfig.tierData",
        requirements: ["domain_extras.recurring.formatConfig.tierData.length 3..5"],
      };
    }
    return { eligible: true };
  },

  generateContent: async (article, input, locale, _llmCaller) => {
    // No LLM — caption + hashtags are deterministic for tier-template
    // (the visual already carries the editorial message via Spitze/Stark/Solide
    // tier labels). Saves €0.005 per render vs. delegating to
    // generateContentWithGate, and keeps the data-driven contract clean.
    const ctx = input;
    return {
      hookOutput: fallbackHookOutput(ctx.toolNames.length, locale),
      caption: fallbackCaption(ctx, locale, article.slug),
      hashtags: fallbackHashtags(locale),
    };
  },

  buildInput: async (article, _discovery) => {
    const extras = (article.domainExtras ?? {}) as {
      recurring?: RecurringDomainShape;
      tools?: ToolDomainShape[];
    };
    const tierData = extras.recurring?.formatConfig?.tierData ?? [];
    const domainTools = extras.tools ?? [];

    // The brief-generator persists `tierData` in TIER order (post-`deriveTiers`
    // score-DESC + toolId-ASC sort), while `domain_extras.tools[]` is whatever
    // shape upstream produced (pick-order for fresh briefs, possibly absent for
    // pre-render snapshots per Spec 65.7-followup-2 synthesis). Positional
    // matching is unsafe — go straight to `articles` by toolId UUID for the
    // authoritative slug, then enrich with the in-memory `domainTools` map for
    // brand colors when present (Spec 65.17 /review-task fix).
    const toolIdsForLookup = tierData.map((entry) => entry.toolId);
    const articleRows =
      toolIdsForLookup.length > 0
        ? await db
            .select({ id: articles.id, slug: articles.slug, title: articles.title })
            .from(articles)
            .where(inArray(articles.id, toolIdsForLookup))
        : [];
    const slugByToolId = new Map<string, { slug: string; name: string }>();
    for (const row of articleRows) {
      slugByToolId.set(row.id, {
        slug: row.slug,
        name: row.title ?? row.slug,
      });
    }
    const domainBySlug = new Map<string, ToolDomainShape>();
    for (const t of domainTools) {
      if (t.slug) domainBySlug.set(t.slug, t);
    }

    const locale = (article.locale ?? "de") as "de" | "en";
    const allSlugs = Array.from(slugByToolId.values()).map((v) => v.slug);
    const toolLookup = await buildToolLookup(allSlugs, locale, article.projectId);

    // Group tier-data by tier label using slug-keyed lookups (no positional
    // matching). Tools whose article-row wasn't resolved (deleted between brief
    // emit + render) are silently skipped — the template's render fallback
    // gracefully handles missing tiers.
    const buckets = new Map<Tier, FamilyATool[]>();
    for (const tier of TIER_ORDER) buckets.set(tier, []);
    for (const entry of tierData) {
      const articleMeta = slugByToolId.get(entry.toolId);
      if (!articleMeta) continue;
      const slug = articleMeta.slug;
      const resolved = toolLookup.get(slug);
      const fallbackDomain = domainBySlug.get(slug);
      const tool = toFamilyATool({
        slug,
        name: fallbackDomain?.name ?? articleMeta.name,
        // biome-ignore lint/style/noNonNullAssertion: defensive ?? fallbacks inside toFamilyATool
        resolved: resolved!,
        ...(fallbackDomain && { domain: fallbackDomain }),
      });
      buckets.get(entry.tier)?.push(tool);
    }

    const tiers: TierLane[] = TIER_ORDER.map((tier) => ({
      tier,
      label: tierLabel(tier, locale),
      tools: (buckets.get(tier) ?? []).slice(0, 2) as TierLane["tools"],
    })).filter((lane) => lane.tools.length > 0) as TierLane[];

    const toolNames = tiers.flatMap((lane) => lane.tools.map((t) => t.name));

    return { tiers, toolNames };
  },

  render: async (context) => {
    const { article, input, locale, theme, overrides, logoUrl } = context as typeof context & {
      logoUrl?: string | null;
    };
    const brandTokens = context.brandTokens ?? DEFAULT_BRAND_TOKENS;

    const generated = buildGenerated(input, article.title, article.slug, locale);

    const compositionInput: ToolTierRankingInput = {
      slideIndex: 0,
      locale,
      theme,
      generated,
      brandTokens,
      ...(overrides !== undefined && { overrides }),
      ...(logoUrl !== undefined && { logoUrl }),
    };

    const socialModule = (await import("../../../render-server.ts")) as unknown as {
      renderToolTierRanking: (
        input: ToolTierRankingInput,
      ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    };
    const { slides: buffers } = await socialModule.renderToolTierRanking(compositionInput);

    const slideOutputs = await writeSlides(
      buffers,
      article.id,
      "tool-tier-ranking",
      locale,
      theme,
      { width: SLIDE_W, height: SLIDE_H },
    );

    return {
      slides: slideOutputs,
      caption:
        context.generatedContent?.caption ?? fallbackCaption(input, locale, article.slug),
      hashtags: context.generatedContent?.hashtags ?? fallbackHashtags(locale),
      metadata: { estimatedCostUsd: 0.005, templateKey: "tool-tier-ranking" },
    };
  },

  mockFixtures: TOOL_TIER_RANKING_FIXTURES,
};
