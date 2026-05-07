import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { AstroSyncError } from "../types.ts";

const log = createLogger("astro-sync:hero");

const InputSchema = z.object({
  heroImagePublicUrl: z.string().url(),
  articleSlug: z.string(),
});

const OutputSchema = z.object({
  base64: z.string(),
  astroAssetPath: z.string(),
  bytes: z.number(),
  contentType: z.string(),
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
    log.debug({ url: input.heroImagePublicUrl }, "Downloading hero image");

    const res = await fetch(input.heroImagePublicUrl);
    if (!res.ok) {
      throw new AstroSyncError(`Failed to download hero image: HTTP ${res.status}`, "image");
    }

    const contentType = res.headers.get("content-type") ?? "image/png";
    const ext = guessExtension(contentType);
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");

    const astroAssetPath = `src/assets/articles/${input.articleSlug}/hero.${ext}`;

    log.info({ bytes: buffer.length, astroAssetPath }, "Hero image downloaded");

    return {
      base64,
      astroAssetPath,
      bytes: buffer.length,
      contentType,
    };
  }
}

function guessExtension(contentType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
  };
  return map[contentType.toLowerCase()] ?? "png";
}
