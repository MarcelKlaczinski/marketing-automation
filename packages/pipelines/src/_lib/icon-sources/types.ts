export type IconSource = "simple-icons" | "iconify" | "lobe-icons";

export interface ResolvedIconAsset {
  source: IconSource;
  sourceRef: string;
  svgContent: string;
  /** Primary brand-color hex (first solid-fill or first gradient-stop). */
  brandColor?: string;
  /**
   * Additional distinct brand-colors found in the SVG, in order of
   * first-appearance. Used to seed `tool_brand_assets.secondary_color` +
   * `tertiary_color` when a logo carries a multi-color palette inline (e.g.
   * Gemini's blue/green/red/yellow). Excludes near-white / near-black tones
   * that are typically structural rather than brand-relevant.
   */
  additionalBrandColors?: string[];
  /**
   * Optional wordmark variant SVG content (logo + brand text). lobe-icons
   * publishes a `<slug>-text.svg` for ~ every brand; this carries the
   * vector source so the service can upload it separately to R2 and store
   * the URL on `tool_brand_assets.logo_wordmark_url`. Marcel-driven 65.2
   * follow-up — Templates choose icon vs wordmark per layout space.
   */
  wordmarkSvgContent?: string;
  format: "svg";
}

export interface IconSourceAdapter {
  name: IconSource;
  tryResolve(toolSlug: string): Promise<ResolvedIconAsset | null>;
}
