/**
 * Spec 65.16 V1.7 #3 — Sample-Render helper.
 *
 * Fires ONE NB2 image generation with the resolved preset + a fixed test
 * prompt so Marcel can preview a preset's signature visual language WITHOUT
 * having to wait for the next real cron-fire. Reuses the `dry_run` monthly
 * budget bucket (similar cost shape ~€0.25/click) — adding a dedicated
 * `sample_render` budget type would force a migration + UI; reusing keeps
 * V1.7 #3 contained.
 *
 * Inputs:
 *   - projectId + projectSlug — for R2 storage prefix + tenant scope
 *   - definitionId — used as the R2 key suffix (one sample per definition)
 *   - preset — fully-resolved PresetKey from the cascade (caller resolves)
 *
 * Returns:
 *   - publicUrl (R2 CDN URL for the WebP) + r2Key + preset used + cost
 *
 * Not in scope: this helper does NOT render a full Family-B carousel — only
 * ONE NB2 image with a fixed editorial scene (`"editorial test image: dark
 * cinematic scene with negative space for a headline overlay"`). If Marcel
 * wants the actual carousel output for a real brief, the recurring-content
 * cron-fire is the canonical path (and Spec 58.2 re-render after that).
 */
import { generateImage } from "@marketing-auto/adapter-nano-banana";
import { COST_OPS } from "@marketing-auto/core/cost";
import { buildNB2Prompt, type PresetKey } from "@marketing-auto/social/presets/catalog";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("recurring-content:sample-image");

export interface SampleImageInput {
  projectId: string;
  projectSlug: string;
  definitionId: string;
  preset: PresetKey;
}

export interface SampleImageResult {
  publicUrl: string;
  r2Key: string;
  preset: PresetKey;
  costEur: number;
  seed: number | null;
}

/**
 * R2 prefix shape: `<projectSlug>/sample-renders/<definitionId>`. One
 * sample slot per definition — newer calls overwrite the older R2 object
 * (the adapter generates a fresh UUID each time so technically NOT
 * overwriting, but the prefix is scoped per-definition for browsability).
 */
function buildStoragePrefix(projectSlug: string, definitionId: string): string {
  return `${projectSlug}/sample-renders/${definitionId}`;
}

/**
 * Sample scene context — fixed test prompt that lets Marcel evaluate each
 * preset's signature on the SAME scene. Mirrors the cover-role composition
 * fragment from `buildNB2Prompt` ROLE_COMPOSITION so the result actually
 * resembles a real Cover slide.
 *
 * The hookContext is synthetic — Marcel doesn't pass a hook into the
 * sample-render path. The empty rendered + variables make `buildNB2Prompt`
 * skip the subject-anchor + beat-context lines, producing a "pure preset
 * style" image without subject-specific framing.
 */
const SAMPLE_NARRATIVE_BEAT = "cover";
const SAMPLE_BEAT_TEXT =
  "Editorial test scene demonstrating the preset's signature visual language with negative space for a headline overlay";

export async function renderSampleImage(input: SampleImageInput): Promise<SampleImageResult> {
  const { prompt } = buildNB2Prompt({
    preset: input.preset,
    slideRole: "cover",
    narrativeBeat: SAMPLE_NARRATIVE_BEAT,
    beatText: SAMPLE_BEAT_TEXT,
    hookContext: {
      rendered: "",
      variables: {},
    },
  });

  log.info(
    { projectId: input.projectId, definitionId: input.definitionId, preset: input.preset },
    "sample-image: starting NB2 render",
  );

  const result = await generateImage({
    projectId: input.projectId,
    operation: COST_OPS.SOCIAL_NB2_IMAGE,
    estimatedCostEur: 0.25,
    model: "nano-banana-2",
    resolution: "1k",
    aspectRatio: "4:5",
    outputFormat: "webp",
    prompt,
    storagePrefix: buildStoragePrefix(input.projectSlug, input.definitionId),
  });

  log.info(
    {
      projectId: input.projectId,
      definitionId: input.definitionId,
      preset: input.preset,
      r2Key: result.r2Key,
      durationMs: result.durationMs,
    },
    "sample-image: NB2 render complete",
  );

  // Real cost lands in cost_logs via the adapter's track() wrapper. We
  // surface a representative figure (the standard 1k nano-banana-2 rate)
  // for UI display — the authoritative number is in cost_logs.
  return {
    publicUrl: result.publicUrl,
    r2Key: result.r2Key,
    preset: input.preset,
    costEur: 0.062, // standard 1k nano-banana-2 rate; cost_logs has the real per-call value
    seed: result.seed,
  };
}
