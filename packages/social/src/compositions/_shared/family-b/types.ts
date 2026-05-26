/**
 * Spec 65.8 — Shared schemas for Family B narrative templates.
 *
 * Three templates share most of these slot definitions:
 *   - story-arc-clickbait (7 slides: Cover/Setup/Conflict/Resolution/Payoff/Lesson/End)
 *   - lifestyle-listicle (6 slides: Cover/Intro/Item#1/Item#2/Item#3/End)
 *   - opinion-recommendation (6 slides: Cover/Hot-Take/Reasoning#1/Reasoning#2/Top-Pick/End)
 *
 * Theme + locale + brandTokens flow as top-level props on every composition's
 * dispatcher; downstream slide components consume `deriveEmotionalDsTokens(brandTokens, theme)`
 * for the emotional bi-theme handling (extends the family-a base derivation
 * with image-overlay + emotion-specific surface tokens per spec §3.4).
 *
 * Photographic backgrounds come from `articles.domain_extras.familyBImages[]`
 * (Spec 65.8 §3.10) which is populated by the photographic-pipeline
 * orchestrator (`packages/pipelines/src/article/social-image/photographic/`)
 * before render time. Templates consume the staged R2 URLs; they do NOT
 * trigger LLM calls at render time.
 */
import { z } from "zod";

// ─── Hook context (LLM-rendered hook + variables for prop binding) ────────────

/**
 * The rendered hook + the variable map that produced it. Variables are
 * propagated to slide components so `{profession}`/`{lifeArea}`/{stance}`
 * can be referenced verbatim in narrative beats (Pattern §3.3 Option γ
 * Hybrid — variable-verbatim Zod refinement enforces consistency).
 */
export const familyBHookSchema = z.object({
  rendered: z.string().min(8).max(160),
  /** Variable map keyed by placeholder name (e.g. `{ profession: "Texter", lifeArea: "Job" }`). */
  variables: z.record(z.string()),
});

export type FamilyBHook = z.infer<typeof familyBHookSchema>;

// ─── Tool mention (inline product reference in narrative text) ────────────────

/**
 * One tool referenced in the narrative. Family-B uses product mentions
 * IN-FLOW rather than as a separate "Tool Slide" (different from Family A's
 * dedicated Tool slides). Marcel-Decision §0: "Product-mention im narrative
 * (logo + name in text-flow)".
 */
export const familyBToolMentionSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(28),
  iconSvg: z.string().optional(),
  iconInitials: z.string().max(3).optional(),
  iconHue: z.number().min(0).max(360).optional(),
  /** Brand colors from `tool_brand_assets` (Spec 65.2). */
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
});

export type FamilyBToolMention = z.infer<typeof familyBToolMentionSchema>;

// ─── Single narrative beat (rendered on one slide) ────────────────────────────

/**
 * One beat of the narrative arc. The beat-name is template-specific
 * ("setup" / "conflict" / "intro" / "item-1" / "hot-take" / "reasoning-1"
 * etc.); the structure here is shared.
 */
export const familyBNarrativeBeatSchema = z.object({
  /** Beat identifier — template-specific but shared shape. */
  beatName: z.string().min(2).max(32),
  /** Main copy for the slide (~30-100 words, LLM-generated). */
  text: z.string().min(20).max(400),
  /** Optional smaller eyebrow / overline label. */
  eyebrow: z.string().min(2).max(48).optional(),
  /** Optional inline tool mention rendered as a styled chip beside the body. */
  toolMention: familyBToolMentionSchema.optional(),
});

export type FamilyBNarrativeBeat = z.infer<typeof familyBNarrativeBeatSchema>;

// ─── End-slide content (legacy inline; HostSlide takes over per Spec 65.9) ────

export const familyBEndContentSchema = z.object({
  /** Headline lead, e.g. "Mehr ehrliche KI-Geschichten". */
  headlineLead: z.string().min(4).max(28),
  /** Highlighted (em) word/phrase. */
  headlineEm: z.string().min(4).max(32),
  /** Article URL stripped of protocol — used on footer. */
  articleUrl: z.string().min(8).max(48),
  /** CTA line above the URL. */
  ctaLine: z.string().min(6).max(28),
});

export type FamilyBEndContent = z.infer<typeof familyBEndContentSchema>;

// ─── Photographic background reference (one slide's staged R2 image) ──────────

/**
 * Render-time photographic-image payload. Comes from
 * `articles.domain_extras.familyBImages[]` (populated by the photographic
 * pipeline) and gets passed slide-by-slide to the dispatcher. Slides that
 * have no entry in the array render the gradient-only fallback per spec
 * §3.7 Option γ.
 */
export const familyBImageSchema = z.object({
  slideIndex: z.number().int().min(0),
  cdnUrl: z.string().url(),
  /**
   * Photographer credit string (e.g. "Jane Doe") — empty when the provider
   * doesn't return a name. Slides may render an unobtrusive credit overlay
   * when present; otherwise rely on the caption attribution per spec §3.12.
   */
  photographer: z.string().nullable().optional(),
});

export type FamilyBImage = z.infer<typeof familyBImageSchema>;

// ─── Shared composition input wrapper (locale + theme + brandTokens) ──────────

export const familyBCommonInputSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  locale: z.enum(["de", "en"]).default("de"),
  /** Loosely typed at the boundary; resolved via `resolveBrandTokens()` in each slide. */
  brandTokens: z.record(z.unknown()).optional(),
  /**
   * Spec 65.10 — Optional pluggable end-slide. When present, replaces the
   * inline Family-B end slide with a `<HostSlide>` dispatch from Spec 65.9.
   * Loose at the schema boundary; each composition narrows via
   * `endSlideDataSchema.safeParse(...)` at render time.
   */
  endSlideData: z.record(z.unknown()).optional(),
});

export type FamilyBCommonInput = z.infer<typeof familyBCommonInputSchema>;
