/**
 * Spec 65.7 — Shared schemas for Family A comparison templates.
 *
 * Four templates share most of these slot definitions:
 *   - comparison-grid-3 (8 slides: cover + header + 3 tools + verdict + end)
 *   - comparison-grid-5 (10 slides: cover + header + 5 tools + verdict + end)
 *   - head-to-head-vs (6 slides: cover + tool A + tool B + side-by-side + verdict + end)
 *   - head-to-head-deep-dive (9 slides: cover + tool A overview/features + tool B overview/features + pricing + use-case + verdict + end)
 *
 * Theme + locale + brandTokens flow as top-level props on every composition's
 * dispatcher; downstream slide components consume `deriveDsTokens(tokens, theme)`
 * for bi-theme handling. Brand colors per tool come from `tool_brand_assets`
 * via the brief-generator (Spec 65.2 → 65.5 pipeline) and propagate through
 * `FamilyATool.primaryColor` / `secondaryColor` / `tertiaryColor`.
 */
import { z } from "zod";

// ─── Score tier (for color coding) ────────────────────────────────────────────

export type ScoreTier = "hi" | "mid" | "lo";

export function scoreTier(score: number): ScoreTier {
  if (score >= 80) return "hi";
  if (score >= 65) return "mid";
  return "lo";
}

// ─── Per-tool render payload (used by all 4 Family A templates) ───────────────

/**
 * Single tool's render-ready data. Comes from `articles.domainExtras.tools[]`
 * resolved via `buildToolLookup()` for icons + `tool_brand_assets` for brand
 * colors at `buildInput()` time.
 */
export const familyAToolSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(28),
  /** 0–100 numeric score; templates color-code via `scoreTier()`. */
  score: z.number().int().min(0).max(100),
  scoreTier: z.enum(["hi", "mid", "lo"]),
  /** Sub-category / one-line descriptor — e.g. "Premium-Ästhetik · web + Discord". */
  meta: z.string().min(1).max(48),
  /** Pre-formatted price prefix ("Ab"/"From" or empty) split for ligature-friendly layout. */
  pricePrefix: z.string().max(8),
  /** Pre-formatted price amount ("10 $/Mo" / "Kostenlos" / "Contact"). */
  priceAmount: z.string().min(1).max(20),
  /** Exactly 2 pros for grid layouts; head-to-head templates may use more from optional `extendedPros`. */
  pros: z.tuple([z.string().min(1).max(60), z.string().min(1).max(60)]),
  cons: z.tuple([z.string().min(1).max(60), z.string().min(1).max(60)]),
  /** Optional extended lists used by `head-to-head-deep-dive` features slide. */
  extendedPros: z.array(z.string().max(60)).max(4).optional(),
  extendedCons: z.array(z.string().max(60)).max(4).optional(),
  isWinner: z.boolean().default(false),
  winnerFlagText: z.string().max(20).optional(),
  /** Original price-tier — preserved so fallback-render + planner can re-derive price components. */
  pricingTier: z.enum(["free", "freemium", "paid", "enterprise"]).optional(),
  /** Original price floor (USD/mo) — preserved alongside pre-formatted pricePrefix/priceAmount. */
  priceFrom: z.number().nonnegative().optional(),
  /** Resolved icon — inline SVG string or null when only initials available. */
  iconSvg: z.string().optional(),
  iconInitials: z.string().max(3).optional(),
  iconHue: z.number().min(0).max(360).optional(),
  /** Brand colors from `tool_brand_assets` (Spec 65.2). All optional — slide
   *  components fall back to DS-token brand stops when absent. */
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  tertiaryColor: z.string().optional(),
});

export type FamilyATool = z.infer<typeof familyAToolSchema>;

// ─── Cover slide content ──────────────────────────────────────────────────────

export const familyACoverSchema = z.object({
  /** Eyebrow label, e.g. "Vergleich · 3 KI-Bild-Generatoren" */
  eyebrow: z.string().min(8).max(36),
  /** Headline lead — first part of the cover hook, e.g. "Die 3 besten". */
  headlineLead: z.string().min(4).max(28),
  /** Highlighted (em) word/phrase, e.g. "KI-Bild-Generatoren". */
  headlineEm: z.string().min(4).max(32),
  /** Optional trailing punctuation / closer. */
  headlineTrail: z.string().max(20).optional(),
  /** 1–2 line subheadline. */
  subline: z.string().min(40).max(160),
  /** Header counter / date pin like "01 / 08 · 05 / 2026". */
  headerNum: z.string().min(8).max(48),
});

export type FamilyACoverContent = z.infer<typeof familyACoverSchema>;

// ─── Compare-header slide (between Cover and first ToolSlide) ─────────────────

export const familyACompareHeaderSchema = z.object({
  /** "What we're comparing" sentence. */
  title: z.string().min(10).max(72),
  /** 2–5 criteria the comparison evaluates against. */
  criteria: z.array(z.string().min(4).max(40)).min(2).max(5),
  /** Optional category badge text. */
  categoryBadge: z.string().max(28).optional(),
});

export type FamilyACompareHeaderContent = z.infer<typeof familyACompareHeaderSchema>;

// ─── Verdict slide ────────────────────────────────────────────────────────────

export const familyAVerdictSchema = z.object({
  /** Winner tool slug — must match one of the tools[].slug values. */
  winnerToolSlug: z.string().min(1),
  /** 1–2 sentence reasoning, e.g. "Beste Wahl für …". */
  reasoning: z.string().min(40).max(220),
  /** Eyebrow on the verdict slide. */
  eyebrow: z.string().min(6).max(32),
  /** Final CTA line shown on verdict slide footer. */
  ctaLine: z.string().min(6).max(28),
});

export type FamilyAVerdictContent = z.infer<typeof familyAVerdictSchema>;

// ─── End slide ────────────────────────────────────────────────────────────────

export const familyAEndSchema = z.object({
  /** Headline lead, e.g. "Mehr Tool-Vergleiche". */
  headlineLead: z.string().min(4).max(28),
  /** Highlighted (em) word/phrase, e.g. "ehrlich getestet.". */
  headlineEm: z.string().min(4).max(32),
  /** Article URL stripped of protocol — used on footer. */
  articleUrl: z.string().min(8).max(48),
  /** CTA line above the URL. */
  ctaLine: z.string().min(6).max(28),
});

export type FamilyAEndContent = z.infer<typeof familyAEndSchema>;

// ─── Shared theme + locale shape (composition input wrapper) ──────────────────

export const familyACommonInputSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  locale: z.enum(["de", "en"]).default("de"),
  /** Loosely-typed at the boundary; resolved via `resolveBrandTokens()` in each slide. */
  brandTokens: z.record(z.unknown()).optional(),
  /**
   * Spec 65.10 — Optional pluggable end-slide. When present, replaces the
   * inline `FamilyAEnd` slide with a `<HostSlide>` dispatch from Spec 65.9.
   * Recurring-content briefs (Spec 65.5) freeze this into
   * `recurringMetadata.formatConfig.selectedEndSlide`; the social-image
   * pipeline threads it into the composition's `renderInput` snapshot.
   *
   * Loosely-typed at the schema boundary because Zod's discriminated-union
   * validation lives in `end-slide-components/types.ts`. Each composition
   * narrows via `endSlideDataSchema.safeParse(...)` at render time.
   */
  endSlideData: z.record(z.unknown()).optional(),
});

export type FamilyACommonInput = z.infer<typeof familyACommonInputSchema>;
