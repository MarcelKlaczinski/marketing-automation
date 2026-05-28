/**
 * Spec 65.16 — Image-style preset resolution + provider routing.
 *
 * Two orthogonal resolvers — preset (visual-language) and provider (image-
 * generation backend). The preset only applies when the provider is NB2;
 * the photographic pipeline has no preset (Sonnet vision-pick is its only
 * "style" lever).
 *
 * Pure functions — no DB. Callers load `definition + project` ahead of time
 * (same pattern as `resolve-auto-approve.ts` from Spec 65.V1.5b).
 *
 * ─── Preset resolution (3-tier priority, content-level wins) ────────────
 *
 *   1. content-level explicit choice (generate-time Marcel selection,
 *      stored in `topic_briefs.recurring_metadata.formatConfig.imageStylePreset`)
 *   2. definition.socialImageStylePresetOverride (per-definition override)
 *   3. project.socialImageStylePreset (project default)
 *
 * ─── Provider routing (2-tier, content-level wins) ──────────────────────
 *
 *   1. content-level explicit choice (when Marcel toggled provider per-content)
 *   2. content-type default routing:
 *        story_arc_clickbait     → nano-banana-2 (signature drama)
 *        opinion_recommendation  → nano-banana-2 (signature provocation)
 *        lifestyle_listicle      → photographic   (authentic-lifestyle fits real-photos)
 *        head-to-head-*          → nano-banana-2 (signature tech)
 *        (unknown)               → nano-banana-2 (V1 default per Marcel-decision Q1)
 *
 * Per Marcel-Decision §3.4: the photographic pipeline stays running for
 * lifestyle-listicle by default; Marcel can flip per-content if a specific
 * lifestyle topic wants NB2.
 */
import {
  DEFAULT_PRESET_KEY,
  isPresetKey,
  type PresetKey,
} from "@marketing-auto/social/presets/catalog";

// ─── Preset resolution ────────────────────────────────────────────────────

export interface ResolveImageStylePresetInput {
  /** Project-wide default (always non-null, DB has NOT NULL DEFAULT). */
  projectDefault: PresetKey;
  /** Per-definition override. `null` means "inherit project default". */
  definitionOverride: PresetKey | null;
  /**
   * Per-content explicit choice (generate-time Marcel selection). `null`/
   * `undefined` means "inherit definition / project". Stored at
   * `topic_briefs.recurring_metadata.formatConfig.imageStylePreset`.
   */
  contentLevelChoice?: PresetKey | null;
}

/**
 * Pick the preset for an upcoming render. Content-level > definition > project.
 *
 * The result is ALWAYS a valid `PresetKey` because `projectDefault` is
 * `NOT NULL DEFAULT 'dark-neon-grid'` at the DB layer.
 */
export function resolveImageStylePreset(input: ResolveImageStylePresetInput): PresetKey {
  if (input.contentLevelChoice && isPresetKey(input.contentLevelChoice)) {
    return input.contentLevelChoice;
  }
  if (input.definitionOverride && isPresetKey(input.definitionOverride)) {
    return input.definitionOverride;
  }
  if (isPresetKey(input.projectDefault)) {
    return input.projectDefault;
  }
  // Defensive — should never trigger because the DB CHECK rejects invalid
  // values. Only reachable if a downstream caller bypasses the schema cast.
  return DEFAULT_PRESET_KEY;
}

// ─── Provider routing ─────────────────────────────────────────────────────

export type ImageProvider = "nano-banana-2" | "photographic";

const VALID_PROVIDERS: readonly ImageProvider[] = ["nano-banana-2", "photographic"];

export function isImageProvider(value: unknown): value is ImageProvider {
  return typeof value === "string" && (VALID_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Content-type → provider default. Lifestyle stays photographic per
 * Marcel-Decision §3.4 (authentic-lifestyle fits real-photos). Everything
 * else (story-arc / opinion / head-to-head and unknown format-types) routes
 * through NB2 for signature visual quality.
 */
const CONTENT_TYPE_PROVIDER_DEFAULT: Record<string, ImageProvider> = {
  "story-arc-clickbait": "nano-banana-2",
  "opinion-recommendation": "nano-banana-2",
  "lifestyle-listicle": "photographic",
  "head-to-head-vs": "nano-banana-2",
  "head-to-head-deep-dive": "nano-banana-2",
};

export interface ResolveImageProviderInput {
  /** Family-B template key (drives the content-type default). */
  templateKey: string;
  /**
   * Per-content explicit provider choice (generate-time Marcel selection).
   * `null` / `undefined` falls through to the content-type default.
   */
  contentLevelChoice?: ImageProvider | null;
}

/**
 * Pick the provider for an upcoming render. Content-level > content-type-default.
 *
 * Unknown template keys default to `nano-banana-2` (V1 default per
 * Marcel-decision Q1). This keeps the routing safe for future Family-A
 * templates that adopt NB2 without an explicit catalog entry.
 */
export function resolveImageProvider(input: ResolveImageProviderInput): ImageProvider {
  if (input.contentLevelChoice && isImageProvider(input.contentLevelChoice)) {
    return input.contentLevelChoice;
  }
  return CONTENT_TYPE_PROVIDER_DEFAULT[input.templateKey] ?? "nano-banana-2";
}
