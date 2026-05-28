/**
 * Spec 65.16 — Visual-Style Preset Catalog.
 *
 * 3 signature visual-languages that drive Family-B Cover + emotion-heavy
 * slide rendering when the project routes through Nano Banana 2 (NB2).
 * Each preset = NB2-prompt-template + DS-token overrides + font set.
 *
 * Storage convention (Spec 65.16 §3.2):
 *   - Preset DEFINITIONS live here in code (not DB) — they contain prompts,
 *     font names, color tokens that aren't user-data.
 *   - The KEY persists in DB: `projects.social_image_style_preset` (default)
 *     and optional `recurring_content_definitions.social_image_style_preset_override`.
 *   - Content-level override is stored in `topic_briefs.recurring_metadata.formatConfig.imageStylePreset`.
 *
 * The Marcel niche-analysis identified 3 color-languages "die siegen, nie gemixt":
 *
 *   1. `dark-neon-grid` — cinematic dark, electric energy, tech-magic (story-arc / opinion)
 *   2. `light-editorial` — refined magazine, premium, calm-confident (lifestyle / educational)
 *   3. `blue-tech-gradient` — modern SaaS-energy, optimistic-tech, accessible (head-to-head)
 *
 * Each preset is INTENTIONALLY radically different: dominant colors, distinct
 * typography, distinct texture-language. Per design-skill principles: vary
 * aesthetics, never converge on common choices.
 *
 * Adding a new preset (e.g. BK Solar's "warm-solar-gold"):
 *   1. Add the key to `PRESET_KEYS` const tuple here.
 *   2. Add a `PresetCatalogEntry` to `PRESET_CATALOG`.
 *   3. Widen the CHECK constraint on `projects.social_image_style_preset` +
 *      `recurring_content_definitions.social_image_style_preset_override` in a
 *      new migration.
 *   4. Loading the new fonts: add to `packages/social/src/presets/fonts.ts`.
 */

/** Ordered tuple — drives both the CHECK constraint values and the UI dropdown. */
export const PRESET_KEYS = [
  "dark-neon-grid",
  "light-editorial",
  "blue-tech-gradient",
] as const;

export type PresetKey = (typeof PRESET_KEYS)[number];

export function isPresetKey(value: unknown): value is PresetKey {
  return typeof value === "string" && (PRESET_KEYS as readonly string[]).includes(value);
}

/**
 * The slide-role drives the composition prompt-fragment. Family-B templates
 * map their per-template narrative beats onto these abstract roles:
 *
 *   story-arc-clickbait: cover / conflict / resolution / payoff
 *   lifestyle-listicle:  cover / item / item / item
 *   opinion-recommendation: cover / hot-take / top-pick
 *
 * Family-A presets may add `head-to-head` / `verdict` in V1.7+.
 */
export const SLIDE_ROLES = [
  "cover",
  "conflict",
  "resolution",
  "payoff",
  "item",
  "hot-take",
  "top-pick",
] as const;

export type SlideRole = (typeof SLIDE_ROLES)[number];

/**
 * Per-preset DS-token overrides. Applied on top of `deriveEmotionalDsTokens`
 * via `derivePresetEmotionalDsTokens()` in `preset-ds-tokens.ts`. Only the
 * fields a preset wants to override are present — the rest cascade from
 * `deriveEmotionalDsTokens(brandTokens, theme)`.
 *
 * Color values use the oklch space matching DsTokens (Pattern 119) when
 * possible; hex is acceptable for explicit brand-anchored colors.
 */
export interface PresetColorOverrides {
  /** Primary text color (displays + cover headlines). */
  textPrimary: string;
  /** Accent text color (highlight words, eyebrows, dot-separators). */
  textAccent: string;
  /** Solid surface color when no image is rendered (gradient-fallback slides). */
  emotionSurface: string;
  /** Linear gradient overlay (transparent → bottom) layered above NB2 image. */
  imageOverlayGradient: string;
  /** Semi-transparent overlay for product-context slides. */
  emotionImageOverlay: string;
}

export interface PresetTypographyOverrides {
  /** Font family for hero/cover display type. */
  displayFontFamily: string;
  /** Font weight as a CSS value ("400" / "600" / "800"). */
  displayWeight: string;
  /** Letter-spacing for display type (uppercase tracking, etc.). */
  displayLetterSpacing: string;
  /** Display text-transform — "uppercase" boosts dark-neon distinctiveness. */
  displayTextTransform: "none" | "uppercase";
  /** Font family for body text (narrative beats, tool mentions). */
  bodyFontFamily: string;
  /** Body weight. */
  bodyWeight: string;
  /** Eyebrow / kicker text font (above-headline label). */
  eyebrowFontFamily: string;
  /** Eyebrow letter-spacing — typically wider than body. */
  eyebrowLetterSpacing: string;
}

/**
 * NB2 prompt-engineering directions per preset. The positive prompt is
 * assembled by `buildNB2Prompt(...)` from `nb2-prompts.ts` as:
 *
 *   [baseDirection] [textureDirection] [composition] [aspect-ratio hint] [anti-AI-slop]
 *
 * Per Spec 65.16 §3.5 + Phase-0 verify: Gemini Image API has NO negative-prompt
 * field (Memory D18), so anti-slop guidance is FOLDED INTO the positive prompt
 * via the `avoidPhrases` array (joined with "NOT" prefixes).
 */
export interface PresetNb2Direction {
  /** Base aesthetic direction — overall scene grammar. */
  baseDirection: string;
  /** Texture / lighting language layered on top of base. */
  textureDirection: string;
  /** Preset-specific phrases to bake into the "NOT" anti-slop list. */
  avoidPhrases: readonly string[];
}

export interface PresetCatalogEntry {
  /** Human-readable name shown in UI dropdowns. */
  displayName: string;
  /** One-line description for tooltip / picker hover. */
  description: string;
  /** Color + texture overrides. */
  colors: PresetColorOverrides;
  /** Typography overrides — font names must match `fonts.ts` loaded set. */
  typography: PresetTypographyOverrides;
  /** NB2 prompt-engineering direction. */
  nb2: PresetNb2Direction;
}

/**
 * Global anti-AI-slop phrases — added to EVERY preset's negative-list.
 * Per design-skill principles + Marcel's explicit rejection of generic-AI
 * imagery. These bake into the positive prompt as "NOT <phrase>" guidance.
 */
export const GLOBAL_AVOID_PHRASES = [
  "stock photo",
  "generic AI imagery",
  "purple-gradient-on-white",
  "flat lighting",
  "busy composition",
  "watermark or text overlay",
  "cliché tech imagery",
] as const;

/**
 * The 3 V1.6 presets. Adding a new tenant's preset = new entry + matching
 * `PRESET_KEYS` widening + migration to widen CHECK constraint.
 */
export const PRESET_CATALOG: Record<PresetKey, PresetCatalogEntry> = {
  "dark-neon-grid": {
    displayName: "Dark Neon Grid",
    description: "Cinematic dark with electric blue + purple neon — story-arc + opinion energy.",
    colors: {
      textPrimary: "#FFFFFF",
      textAccent: "#00D4FF",
      emotionSurface: "#0A0A0F",
      imageOverlayGradient:
        "linear-gradient(180deg, rgba(10,10,15,0) 0%, rgba(10,10,15,0.7) 60%, rgba(10,10,15,0.92) 100%)",
      emotionImageOverlay: "rgba(177, 78, 255, 0.18)",
    },
    typography: {
      // Spec 65.16 V1.7 #4 — Clash Display via Fontshare CDN (bold geometric
      // condensed display sans, the aditya-style anchor). Falls back to Inter
      // when Fontshare is unreachable via the CSS-stack inheritance.
      displayFontFamily: "Clash Display",
      displayWeight: "800",
      displayLetterSpacing: "0.02em",
      displayTextTransform: "uppercase",
      bodyFontFamily: "Inter Variable",
      bodyWeight: "500",
      eyebrowFontFamily: "JetBrains Mono",
      eyebrowLetterSpacing: "0.18em",
    },
    nb2: {
      baseDirection:
        "cinematic dark tech scene, electric blue and deep-purple neon lighting, volumetric glow, deep shadows, futuristic high-contrast atmosphere",
      textureDirection:
        "subtle perspective grid lines vanishing into the distance, bloom on accent elements, faint film grain overlay for depth, editorial-grade composition",
      avoidPhrases: [
        "pastel or soft colors",
        "daylight or sunny lighting",
        "warm cream or beige tones",
        "low contrast",
      ],
    },
  },
  "light-editorial": {
    displayName: "Light Editorial",
    description: "Warm cream + serif, refined magazine grade — lifestyle + educational calm.",
    colors: {
      textPrimary: "#1A1A1A",
      textAccent: "#C8553D",
      emotionSurface: "#F7F3ED",
      imageOverlayGradient:
        "linear-gradient(180deg, rgba(247,243,237,0) 0%, rgba(247,243,237,0.78) 60%, rgba(247,243,237,0.95) 100%)",
      emotionImageOverlay: "rgba(200, 85, 61, 0.12)",
    },
    typography: {
      displayFontFamily: "Fraunces",
      displayWeight: "600",
      displayLetterSpacing: "-0.01em",
      displayTextTransform: "none",
      bodyFontFamily: "Inter Variable",
      bodyWeight: "400",
      eyebrowFontFamily: "Inter Variable",
      eyebrowLetterSpacing: "0.14em",
    },
    nb2: {
      baseDirection:
        "refined editorial photography aesthetic, warm natural light from a single direction, minimalist premium composition, Kinfolk magazine mood, muted warm tones with a single subject",
      textureDirection:
        "abundant negative space for headline overlay in lower-third, soft paper-like grain, thin editorial rules, calm-confident energy",
      avoidPhrases: [
        "neon or harsh saturated colors",
        "dark background or low-key lighting",
        "tech-coded or futuristic imagery",
        "cluttered or busy scenes",
      ],
    },
  },
  "blue-tech-gradient": {
    displayName: "Blue Tech Gradient",
    description: "Modern SaaS gradient, optimistic-tech accessible — head-to-head + comparison.",
    colors: {
      textPrimary: "#FFFFFF",
      textAccent: "#FFB800",
      emotionSurface: "#0066FF",
      imageOverlayGradient:
        "linear-gradient(180deg, rgba(0,102,255,0) 0%, rgba(0,102,255,0.55) 55%, rgba(0,102,255,0.82) 100%)",
      emotionImageOverlay: "rgba(0, 240, 255, 0.14)",
    },
    typography: {
      // Spec 65.16 V1.7 #4 — Cabinet Grotesk via Fontshare CDN (modern
      // geometric sans, the "modern SaaS-energy" anchor per niche-analysis).
      displayFontFamily: "Cabinet Grotesk",
      displayWeight: "800",
      displayLetterSpacing: "-0.015em",
      displayTextTransform: "none",
      bodyFontFamily: "Inter Variable",
      bodyWeight: "500",
      // Satoshi for the eyebrow line — distinctive geometric tracking that
      // pairs with Cabinet Grotesk's wide-curve display.
      eyebrowFontFamily: "Satoshi",
      eyebrowLetterSpacing: "0.10em",
    },
    nb2: {
      baseDirection:
        "modern tech illustration with bold blue gradient background, clean energetic composition, optimistic SaaS aesthetic, bright accessible mood",
      textureDirection:
        "soft geometric shapes (circles, blobs) accenting the gradient, faint cyan-pop highlights, light glow on key elements, professional negative-space for headline overlay",
      avoidPhrases: [
        "dark scene or low-key lighting",
        "purple-dominant gradients",
        "stock corporate handshake imagery",
        "rainbow or pastel-only palettes",
      ],
    },
  },
};

/**
 * Default preset for new projects. Matches the aditya-reference Marcel
 * admires (Spec 65.16 §9 Q2).
 */
export const DEFAULT_PRESET_KEY: PresetKey = "dark-neon-grid";

/**
 * Suggested content-type → preset routing (informational, not enforced).
 * The actual default project-wide is `DEFAULT_PRESET_KEY`. Per-content
 * override at generate-time wins over any default.
 */
export const CONTENT_TYPE_PRESET_BIAS: Record<string, PresetKey> = {
  "story-arc-clickbait": "dark-neon-grid",
  "opinion-recommendation": "dark-neon-grid",
  "lifestyle-listicle": "light-editorial",
  "head-to-head-vs": "blue-tech-gradient",
  "head-to-head-deep-dive": "blue-tech-gradient",
};
