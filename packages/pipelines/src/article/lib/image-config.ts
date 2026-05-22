import type { NanoBananaResolution } from "@marketing-auto/adapter-nano-banana";
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

/**
 * Per-project image-generation configuration resolved from the `projects` table.
 *
 * `provider` is the column `projects.image_generation_provider` (Spec 64.6).
 * `resolution` is the column `projects.image_generation_resolution` (Spec 64.6b),
 *   used by `nanoBananaImageCostEur` for accounting and by HeroImageStep to drive
 *   `buildPromptWithResolutionHint` (Spec 64.6d).
 *
 * Returned as a plain object so consumers can destructure: `{ provider, resolution }`.
 */
export type ImageProvider = "nano-banana-2" | "flux-1.1-pro";

export interface ProjectImageConfig {
  provider: ImageProvider;
  resolution: NanoBananaResolution;
}

/**
 * Reads the per-project image-generation config from `projects`. Used by both
 * `HeroImageStep` (live pipeline) and the `rebake-hero-samples` ad-hoc script
 * — the 2nd-consumer that triggered the extraction.
 *
 * Defensive defaults mirror the column defaults from migrations 0088 (`nano-banana-2`)
 * and 0089 (`1k`) so projects rows inserted before those migrations don't crash.
 */
export async function resolveImageConfig(projectId: string): Promise<ProjectImageConfig> {
  const [row] = await db
    .select({
      provider: projects.imageGenerationProvider,
      resolution: projects.imageGenerationResolution,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return {
    provider: (row?.provider ?? "nano-banana-2") as ImageProvider,
    resolution: (row?.resolution ?? "1k") as NanoBananaResolution,
  };
}
