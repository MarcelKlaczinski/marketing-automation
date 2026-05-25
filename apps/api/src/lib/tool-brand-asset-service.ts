/**
 * Spec 65.2 — Tool Brand-Asset Resolver Service
 *
 * Wraps the existing pipelines logo-resolver chain (simple-icons → iconify →
 * lobe-icons → deterministic avatar from
 * `packages/pipelines/src/_lib/resolve-tool-icon.ts`) and adapts the result
 * to the `tool_brand_assets` table shape:
 *
 *   - chain hit → uploads inline SVG to R2 + returns `{ logoUrl, source,
 *     brandColorHint, sourceRef }`
 *   - chain miss (avatar fallback) → returns `{ logoUrl: null,
 *     source: "deterministic-avatar" }` so the row surfaces in the
 *     needs-review queue for Marcel to upload a custom SVG.
 *
 * Calling the pipelines resolver also populates `project_brand_assets` as a
 * side-effect, which keeps the Engine's existing render path warm during
 * V1. Phase 3 (Engine reads `tool_brand_assets` directly) is deferred per
 * the start-task confirm — populate first, switch consumers later.
 */
import { r2 } from "@marketing-auto/adapter-storage";
import { resolveToolIcon } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import type { BrandAssetSource } from "@marketing-auto/db";

const log = createLogger("tool-brand-asset-service");

export type ResolvedToolBrandAsset = {
  /** R2 public URL of the main mark/symbol logo; null when avatar-fallback. */
  logoUrl: string | null;
  /** R2 object key when uploaded; null when avatar-fallback. */
  logoR2Key: string | null;
  /**
   * R2 public URL of the wordmark variant (logo + brand text). Null when the
   * source has no `-text` variant or for avatar fallbacks. Templates choose
   * mark vs wordmark per layout.
   */
  logoWordmarkUrl: string | null;
  /** Source provider that produced the logo (or avatar marker). */
  source: BrandAssetSource;
  /** simple-icons/iconify/lobe-icons identifier; null for avatar. */
  sourceRef: string | null;
  /** Primary brand-color hint (first distinct hex). */
  brandColorHint: string | null;
  /**
   * Additional distinct brand-colors found in the SVG (multi-color logos
   * like Gemini). Used to seed `secondary_color` + `tertiary_color` when the
   * chain returns >1 color. Up to 2 entries.
   */
  additionalBrandColors: string[];
};

const SVG_CONTENT_TYPE = "image/svg+xml";
/** R2 keys are kebab-case under the project-slug prefix per storage convention. */
function buildR2Key(projectSlug: string, toolId: string, variant?: "wordmark"): string {
  const suffix = variant ? `-${variant}` : "";
  return `${projectSlug}/tool-brand-assets/${toolId}${suffix}.svg`;
}

export type ResolveToolBrandAssetInput = {
  toolId: string;
  toolSlug: string;
  projectId: string;
  projectSlug: string;
};

export async function resolveToolBrandAsset(
  input: ResolveToolBrandAssetInput,
): Promise<ResolvedToolBrandAsset> {
  const resolved = await resolveToolIcon(input.projectId, input.toolSlug);

  if (resolved.type === "avatar") {
    log.info(
      { toolId: input.toolId, slug: input.toolSlug },
      "no icon found — needs Marcel-upload",
    );
    return {
      logoUrl: null,
      logoR2Key: null,
      logoWordmarkUrl: null,
      source: "deterministic-avatar",
      sourceRef: null,
      brandColorHint: null,
      additionalBrandColors: [],
    };
  }

  // resolved.type === "svg" — upload the main mark to R2.
  const r2Key = buildR2Key(input.projectSlug, input.toolId);
  const upload = await r2.put({
    key: r2Key,
    body: resolved.svg,
    contentType: SVG_CONTENT_TYPE,
  });

  // If the source provides a wordmark variant (lobe-icons `<slug>-text.svg`),
  // upload that to a separate R2 key with the `-wordmark` suffix so templates
  // can choose between icon and wordmark per layout space.
  let logoWordmarkUrl: string | null = null;
  if (resolved.wordmarkSvg) {
    const wordmarkKey = buildR2Key(input.projectSlug, input.toolId, "wordmark");
    const wordmarkUpload = await r2.put({
      key: wordmarkKey,
      body: resolved.wordmarkSvg,
      contentType: SVG_CONTENT_TYPE,
    });
    logoWordmarkUrl = wordmarkUpload.publicUrl;
  }

  log.info(
    {
      toolId: input.toolId,
      source: resolved.source,
      r2Key,
      bytes: upload.bytesStored,
      hasWordmark: !!resolved.wordmarkSvg,
      additionalColors: resolved.additionalBrandColors?.length ?? 0,
    },
    "resolved + uploaded brand-asset logo",
  );

  return {
    logoUrl: upload.publicUrl,
    logoR2Key: r2Key,
    logoWordmarkUrl,
    source: resolved.source as BrandAssetSource,
    sourceRef: resolved.sourceRef,
    brandColorHint: resolved.brandColor ?? null,
    additionalBrandColors: resolved.additionalBrandColors ?? [],
  };
}

/**
 * Multipart-upload helper for Marcel's custom-logo override. Validates SVG
 * shape + size before pushing to R2. Throws on rejection so the route can
 * surface a 400 with the error message.
 */
export type UploadCustomLogoInput = {
  toolId: string;
  projectSlug: string;
  svgContent: string;
};

export const MAX_LOGO_BYTES = 100 * 1024; // 100KB per Spec 65.2 Q4 default

export async function uploadCustomLogo(
  input: UploadCustomLogoInput,
): Promise<{ logoUrl: string; logoR2Key: string }> {
  const bytes = Buffer.byteLength(input.svgContent, "utf8");
  if (bytes > MAX_LOGO_BYTES) {
    throw new Error(`SVG exceeds ${MAX_LOGO_BYTES} bytes (got ${bytes})`);
  }
  if (!input.svgContent.trimStart().startsWith("<svg") && !input.svgContent.trimStart().startsWith("<?xml")) {
    throw new Error("Body must be a valid SVG document");
  }

  const r2Key = buildR2Key(input.projectSlug, input.toolId);
  const upload = await r2.put({
    key: r2Key,
    body: input.svgContent,
    contentType: SVG_CONTENT_TYPE,
  });

  return { logoUrl: upload.publicUrl, logoR2Key: r2Key };
}
