import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { HERO_VARIANTS, hasVariants, heroPublicPath, heroVariantPublicPath } from "@marketing-auto/shared/hero-variants";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { AstroSyncError } from "../types.ts";

const log = createLogger("astro-sync:hero");

const InputSchema = z.object({
  heroImagePublicUrl: z.string().url(),
  heroImageR2Key: z.string(),
  articleSlug: z.string(),
});

/** A single file to commit to GitHub. */
export interface HeroFile {
  /** Path inside the repo, e.g. "public/gen/<slug>/hero.webp" */
  repoPath: string;
  base64: string;
  bytes: number;
  contentType: string;
}

const OutputSchema = z.object({
  files: z.array(
    z.object({
      repoPath: z.string(),
      base64: z.string(),
      bytes: z.number(),
      contentType: z.string(),
    })
  ),
  /** The public Astro path for the base hero image, e.g. "/gen/<slug>/hero.webp" */
  heroPublicPath: z.string(),
});

export class DownloadHeroStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "download-hero";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    log.debug({ url: input.heroImagePublicUrl, slug: input.articleSlug }, "Downloading hero image(s)");

    const publicPath = heroPublicPath(input.articleSlug);
    const files: HeroFile[] = [];

    // Download the base image
    const baseFile = await downloadFile(input.heroImagePublicUrl);
    files.push({
      repoPath: `public/gen/${input.articleSlug}/hero.webp`,
      base64: baseFile.base64,
      bytes: baseFile.bytes,
      contentType: baseFile.contentType,
    });

    // Download variants if they exist (slug-based r2Key convention)
    if (hasVariants(input.heroImageR2Key)) {
      // Derive variant URLs from the base URL by replacing the basename
      // Base URL: http://localhost:3050/uploads/<project>/articles/hero/<slug>.webp
      // Variant:  http://localhost:3050/uploads/<project>/articles/hero/<slug>-16x9-640.webp
      const baseUrlWithoutFilename = input.heroImagePublicUrl.replace(/\/[^/]+\.[^.]+$/, "");
      let variantsDownloaded = 0;

      for (const variant of HERO_VARIANTS) {
        for (const fmt of ["webp", "avif"] as const) {
          const variantUrl = `${baseUrlWithoutFilename}/${input.articleSlug}${variant.suffix}.${fmt}`;
          const repoPath = `public/gen/${input.articleSlug}/hero${variant.suffix}.${fmt}`;
          const variantPublicP = heroVariantPublicPath(input.articleSlug, variant.suffix, fmt);
          try {
            const varFile = await downloadFile(variantUrl);
            files.push({ repoPath, base64: varFile.base64, bytes: varFile.bytes, contentType: varFile.contentType });
            variantsDownloaded++;
          } catch {
            // Variant may not exist yet (e.g. R2 mode without upload) — skip gracefully
            log.debug({ variantPublicP }, "Variant not available — skipping");
          }
        }
      }
      log.info({ slug: input.articleSlug, variantsDownloaded }, "Hero variants downloaded");
    }

    log.info({ fileCount: files.length, heroPublicPath: publicPath }, "Hero download complete");
    return { files, heroPublicPath: publicPath };
  }
}

async function downloadFile(url: string): Promise<{ base64: string; bytes: number; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new AstroSyncError(`Failed to download ${url}: HTTP ${res.status}`, "image");
  }
  const contentType = res.headers.get("content-type") ?? "image/webp";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { base64: buffer.toString("base64"), bytes: buffer.length, contentType };
}
