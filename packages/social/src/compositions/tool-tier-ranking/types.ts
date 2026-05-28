/**
 * Spec 65.17 B2 — `tool-tier-ranking` composition input schema.
 *
 * Single-still data-driven Family-A template. Renders 3 tier-lanes
 * (Spitze · Stark · Solide) with 1–2 tool logos per lane, derived from
 * `tool_persona_scores` via the `deriveTiers` helper in
 * `apps/api/src/lib/recurring-content/derive-tiers.ts`.
 *
 * Tier labels are positive-framing for affiliate-safety (Discovery §3.3 +
 * Marcel-decision Q2); the composition NEVER labels a tool "Bad" / "Schlecht".
 */
import { z } from "zod";
import { familyAToolSchema } from "../_shared/family-a/types";

export const TIER_VALUES = ["spitze", "stark", "solide"] as const;
export const tierSchema = z.enum(TIER_VALUES);
export type Tier = z.infer<typeof tierSchema>;

/**
 * One lane in the tier-ranking carousel. `label` is the locale-resolved badge
 * text ("Spitze" / "Stark" / "Solide" / EN equivalents). `tools` is 1–2
 * `FamilyATool` entries — the per-tier count follows the `deriveTiers` 1/2/1
 * (4 tools) and 2/2/1 (5 tools) distribution.
 */
export const tierLaneSchema = z.object({
  tier: tierSchema,
  label: z.string().min(1).max(24),
  tools: z.array(familyAToolSchema).min(1).max(2),
});
export type TierLane = z.infer<typeof tierLaneSchema>;

export const toolTierRankingGeneratedSchema = z.object({
  /** Eyebrow above the title (e.g. "AI-Tools · Vergleich"). */
  eyebrow: z.string().min(4).max(36),
  /** Headline lead, e.g. "Die besten". */
  headlineLead: z.string().min(2).max(28),
  /** Highlighted (em) word/phrase, e.g. "KI-Bild-Generatoren". */
  headlineEm: z.string().min(4).max(32),
  /** Optional 1-line subline beneath the headline. */
  subline: z.string().min(0).max(120).optional(),
  /** Header counter / date pin like "05 / 2026 · 5 Tools". */
  headerNum: z.string().min(4).max(48),
  /** Final CTA line shown on footer. */
  ctaLine: z.string().min(6).max(28),
  /** Article URL stripped of protocol — used on footer. */
  articleUrl: z.string().min(4).max(48),
  /** Exactly 3 tier-lanes in the order spitze → stark → solide. */
  tiers: z.array(tierLaneSchema).length(3),
});

export type ToolTierRankingGenerated = z.infer<typeof toolTierRankingGeneratedSchema>;

// ─── Zod input schema for Remotion composition registration ──────────────────

export const toolTierRankingInputSchema = z.object({
  slideIndex: z.number().int().default(0),
  locale: z.enum(["de", "en"]).default("de"),
  theme: z.enum(["dark", "light"]).default("dark"),
  generated: toolTierRankingGeneratedSchema,
  brandTokens: z.record(z.unknown()).optional(),
  overrides: z.record(z.unknown()).optional(),
  /** Spec 65.15 — Cover-stamp logo URL; null/undefined → no stamp. */
  logoUrl: z.string().nullable().optional(),
});

export type ToolTierRankingInput = z.infer<typeof toolTierRankingInputSchema>;

// ─── ContentBounds (mirrors REMOTION.md convention) ───────────────────────────

export const toolTierRankingBounds = {
  eyebrow:   { min: 4,  max: 36 },
  headerNum: { min: 4,  max: 48 },
  heroLead:  { min: 2,  max: 28 },
  heroEm:    { min: 4,  max: 32 },
  subline:   { min: 0,  max: 120 },
  laneLabel: { min: 1,  max: 24 },
  footer: {
    ctaLine: { min: 6,  max: 28 },
    url:     { min: 4,  max: 48 },
  },
  tierCount: { exact: 3 },
  toolsPerLane: { min: 1, max: 2 },
} as const;
