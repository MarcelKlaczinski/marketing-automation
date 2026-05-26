/**
 * Spec 65.7 — Shared helpers used by all Family A comparison templates.
 *
 * Pure functions; no side effects, no DB calls. Locale-aware where needed.
 */
import type { FamilyATool } from "./types.ts";

// ─── Price formatting (DE/EN parity, shared across grid + head-to-head) ───────

export interface PriceComponents {
  pricePrefix: string;
  priceAmount: string;
}

export interface PriceInput {
  pricingTier?: "free" | "freemium" | "paid" | "enterprise" | undefined;
  priceFrom?: number | undefined;
}

export function buildPriceComponents(
  input: PriceInput,
  locale: "de" | "en",
): PriceComponents {
  if (input.pricingTier === "free" || input.priceFrom === 0) {
    return { pricePrefix: "", priceAmount: locale === "de" ? "Kostenlos" : "Free" };
  }
  if (input.priceFrom != null) {
    return {
      pricePrefix: locale === "de" ? "Ab" : "From",
      priceAmount: `${input.priceFrom} $/Mo`,
    };
  }
  if (input.pricingTier === "enterprise") {
    return { pricePrefix: "", priceAmount: "Enterprise" };
  }
  return { pricePrefix: "", priceAmount: locale === "de" ? "Auf Anfrage" : "Contact" };
}

// ─── Fallback bullets when LLM data is absent ─────────────────────────────────

export function buildFallbackPros(meta: string, locale: "de" | "en"): [string, string] {
  const cat = meta.split("·")[0]?.trim() ?? meta;
  const trimmed = cat.slice(0, 28);
  return locale === "de"
    ? [`Stark bei: ${trimmed}`, "Aktiv weiterentwickelt"]
    : [`Strong at: ${trimmed}`, "Actively developed"];
}

export function buildFallbackCons(locale: "de" | "en"): [string, string] {
  return locale === "de"
    ? ["Lernkurve für Einsteiger", "Weniger Integrationen"]
    : ["Learning curve for beginners", "Fewer integrations"];
}

// ─── Brand-color resolution with DS-token fallback ────────────────────────────

/**
 * Returns the tool's primary brand color, falling back to a neutral DS token
 * when the asset is unset. Slide components call this once per tool render and
 * reuse the result.
 */
export function resolveToolBrandColor(
  tool: Pick<FamilyATool, "primaryColor">,
  dsBrandFallback: string,
): string {
  return tool.primaryColor ?? dsBrandFallback;
}

/**
 * Tertiary fallback uses a perceptual hue-shift on the primary when only one
 * brand color is set. Pure (no `Math.random`) — same input always yields same output.
 */
export function deriveTertiaryColor(primary: string, theme: "dark" | "light"): string {
  // Conservative fallback — return an oklch alpha-mix of primary so verdict
  // slide text always contrasts against the brand-gradient background.
  return `color-mix(in oklch, ${primary} 35%, ${theme === "dark" ? "#ffffff" : "#0a0a0a"})`;
}

// ─── Brand-aware URL resolution (multi-tenant safety) ────────────────────────

/**
 * Resolves the article URL from project brand tokens — multi-tenant safe.
 * Mirrors the `single-tool-spotlight` template convention (Spec 60.1):
 *   - Reads `brandTokens.social.websiteUrl` (e.g. "https://toolwiki.ai/", "bellemann.de").
 *   - Strips http(s):// scheme + trailing slash.
 *   - Falls back to "toolwiki.ai" only when the project has no `websiteUrl` set
 *     (acceptable for V1 since the single deployed tenant is toolwiki).
 *
 * `brandTokens` is loosely typed because the composition schema treats it as
 * `z.record(z.unknown())` at the boundary — narrow it once here so callers
 * don't need to repeat the optional-chain dance.
 */
export function resolveArticleUrl(brandTokens: unknown, articleSlug: string): string {
  const tokens = brandTokens as { social?: { websiteUrl?: unknown } } | undefined;
  const raw = typeof tokens?.social?.websiteUrl === "string" ? tokens.social.websiteUrl : "toolwiki.ai";
  const websiteBase = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `${websiteBase}/${articleSlug}`;
}

// ─── Locale-aware copy snippets ───────────────────────────────────────────────

export function localeCopy(locale: "de" | "en") {
  return {
    swipe: locale === "de" ? "Swipe für Details" : "Swipe for details",
    swipeShort: locale === "de" ? "Swipe →" : "Swipe →",
    winner: locale === "de" ? "Sieger" : "Winner",
    topPick: locale === "de" ? "Top-Empfehlung" : "Top Pick",
    versus: locale === "de" ? "vs." : "vs.",
    pricingLabel: locale === "de" ? "Preis" : "Pricing",
    useCasesLabel: locale === "de" ? "Anwendungsfälle" : "Use cases",
    featuresLabel: locale === "de" ? "Features" : "Features",
    prosLabel: locale === "de" ? "Pro" : "Pros",
    consLabel: locale === "de" ? "Contra" : "Cons",
    verdictEyebrow: locale === "de" ? "Fazit · Sieger" : "Verdict · Winner",
    andTheWinnerIs: locale === "de" ? "Sieger:" : "Winner:",
    bestFor: locale === "de" ? "Beste Wahl für" : "Best choice for",
    compareHeaderTitleFallback: locale === "de" ? "Was wir vergleichen" : "What we compare",
    fullReview: locale === "de" ? "Vollständiger Vergleich →" : "Full comparison →",
    moreReviews: locale === "de" ? "Mehr Vergleiche" : "More comparisons",
    honestlyTested: locale === "de" ? "ehrlich getestet." : "honestly tested.",
  };
}
