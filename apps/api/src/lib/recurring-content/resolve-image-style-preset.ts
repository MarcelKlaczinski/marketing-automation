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
 *   2. content-type default routing (V1.6.1 — all Family-B → NB2):
 *        story_arc_clickbait     → nano-banana-2 (signature drama)
 *        opinion_recommendation  → nano-banana-2 (signature provocation)
 *        lifestyle_listicle      → nano-banana-2 (signature lifestyle — V1.6.1 pivot)
 *        head-to-head-*          → nano-banana-2 (signature tech)
 *        (unknown)               → nano-banana-2 (V1 default per Marcel-decision Q1)
 *
 * V1.6.1 (Marcel-Decision §A1, post-mortem 2026-05-28): pivot from
 * `photographic` to `nano-banana-2` for lifestyle-listicle. Live-test
 * 2026-05-27 showed systemic off-topic stock-photo selection from the
 * photographic pipeline (random pexels-BTS, generic laptops). Photographic
 * remains as opt-in fallback via the content-level `imageProvider` override
 * on `domain_extras.recurring.formatConfig.imageProvider`. undraw integration
 * is a V1.7 follow-up.
 *
 * Mirrors `CONTENT_TYPE_PROVIDER_DEFAULT` in
 * `packages/pipelines/src/article/social-image/stage-family-b-images.step.ts` —
 * keep these in sync when changing a default or adding a Family-B template.
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
 * Content-type → provider default. ALL Family-B types route through NB2
 * since V1.6.1 (Marcel-Decision §A1 post-mortem 2026-05-28). See file-
 * header JSDoc for the pivot rationale.
 *
 * Photographic stays available as an opt-in fallback via the content-level
 * `imageProvider` override on
 * `domain_extras.recurring.formatConfig.imageProvider`.
 */
const CONTENT_TYPE_PROVIDER_DEFAULT: Record<string, ImageProvider> = {
  "story-arc-clickbait": "nano-banana-2",
  "opinion-recommendation": "nano-banana-2",
  "lifestyle-listicle": "nano-banana-2",
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
