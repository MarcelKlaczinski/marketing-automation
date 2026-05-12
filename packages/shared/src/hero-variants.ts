/**
 * Hero image variant spec — shared between the generation pipeline,
 * the Astro-sync adapter, and the local-preview route.
 *
 * Lives in `packages/shared` (no external deps) to avoid a circular
 * dependency between `packages/pipelines` and `packages/adapters/astro-sync`.
 *
 * Convention: base image is `<prefix>/<slug>.webp`.
 * Variant: `<prefix>/<slug><suffix>.<format>`.
 * Public Astro path: `/gen/<slug>/hero<suffix>.<format>`.
 */

/** Pixel dimensions for each generated variant. */
export interface HeroVariantSpec {
  suffix: string;
  width: number;
  height: number;
}

/** All 11 dimension groups — 2 formats each = 22 files total. */
export const HERO_VARIANTS: HeroVariantSpec[] = [
  // 16:9 — hero / article header / Google Discover (≥ 1200 px required)
  { suffix: "-16x9-640",  width: 640,  height: 360  },
  { suffix: "-16x9-960",  width: 960,  height: 540  },
  { suffix: "-16x9-1280", width: 1280, height: 720  },
  { suffix: "-16x9-1600", width: 1600, height: 900  },
  { suffix: "-16x9-1920", width: 1920, height: 1080 },
  // 4:3 — cards, thumbnails
  { suffix: "-4x3-320",   width: 320,  height: 240  },
  { suffix: "-4x3-480",   width: 480,  height: 360  },
  { suffix: "-4x3-640",   width: 640,  height: 480  },
  // 1:1 — OG image (schema.org / social share)
  { suffix: "-1x1-400",   width: 400,  height: 400  },
  { suffix: "-1x1-800",   width: 800,  height: 800  },
  { suffix: "-1x1-1200",  width: 1200, height: 1200 },
];

/** Regex that matches a variant suffix inside a filename. */
export const VARIANT_SUFFIX_REGEX = /-(?:16x9|4x3|1x1)-\d+(?=\.)/;

/** UUID pattern — used to distinguish pre-variant (uuid) keys from slug-based keys. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Returns `true` if the given `r2Key` uses a slug-based filename,
 * which by convention means variants have been generated.
 * UUID-named keys = raw Replicate output (no variants yet).
 */
export function hasVariants(r2Key: string): boolean {
  const basename = r2Key.split("/").at(-1)?.replace(/\.[^.]+$/, "") ?? "";
  return !UUID_REGEX.test(basename);
}

/**
 * Derives the public Astro path for the base hero image.
 * e.g. slug="chatgpt-preise-2026" → "/gen/chatgpt-preise-2026/hero.webp"
 */
export function heroPublicPath(slug: string): string {
  return `/gen/${slug}/hero.webp`;
}

/**
 * Derives a variant's public Astro path.
 * e.g. slug="chatgpt-preise-2026", suffix="-16x9-1600", format="avif"
 *      → "/gen/chatgpt-preise-2026/hero-16x9-1600.avif"
 */
export function heroVariantPublicPath(slug: string, suffix: string, format: "webp" | "avif"): string {
  return `/gen/${slug}/hero${suffix}.${format}`;
}
