import type { NanoBananaResolution } from "@marketing-auto/adapter-nano-banana";

/**
 * Spec 64.6d: qualitative resolution hints injected into the hero-image prompt.
 *
 * Discovery 64.8 §4 verified live: the Gemini Image API ignores `responseFormat.image.imageSize`
 * (returns HTTP 400) and instead derives output dimensions from the **prompt text alone**.
 *
 * Hints are intentionally soft (no pixel counts like "1024px") — explicit numeric tokens
 * risk being parsed by Gemini as crop/layout hints rather than resolution hints. Qualitative
 * phrasing lets the model's training data pick the right dimension. If qualitative hints
 * later prove insufficient we can escalate to explicit numerics, but start with soft.
 */
const RESOLUTION_HINTS: Record<NanoBananaResolution, string> = {
  "0.5k": "low-resolution preview quality",
  "1k": "standard editorial quality",
  "2k": "high-resolution editorial photography",
  "4k": "premium print quality, ultra-detailed",
};

/**
 * The hero-image step always renders 16:9 widescreen for blog/article use. Future
 * per-article-type overrides (e.g. portrait for author bios) would extend this into
 * an `AspectHint` map keyed by article type — but blog-only is the only path today.
 */
const ASPECT_HINT = "16:9 widescreen aspect ratio";

/**
 * Augments a hero-image prompt with explicit aspect-ratio + resolution hints.
 *
 * Gemini Image API derives output dimensions from prompt text. Without this
 * augmentation, every call returns Gemini's default 1:1 square crop regardless
 * of the `aspectRatio` value the adapter passes. This helper is the single
 * injection point — all callers (HeroImageStep sync + batch enqueue + rebake
 * script) must pass through it before invoking the adapter.
 *
 * The `Format:` prefix mirrors how Gemini's training data sees image-spec
 * instructions in editorial photography descriptions. Empirically more reliable
 * than a bare suffix like "16:9 widescreen".
 */
export function buildPromptWithResolutionHint(
  basePrompt: string,
  resolution: NanoBananaResolution,
): string {
  const resolutionHint = RESOLUTION_HINTS[resolution];
  return `${basePrompt.trim()}\n\nFormat: ${ASPECT_HINT}, ${resolutionHint}.`;
}
