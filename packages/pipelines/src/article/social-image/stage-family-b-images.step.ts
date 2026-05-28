/**
 * Spec 65.8 Day 5 — StageFamilyBImagesStep.
 *
 * Pipeline step that runs between `GenerateCaptionStep` and `RenderSlidesStep`
 * in the `article:social-image` pipeline. When the resolved templateKey is
 * one of the 3 Family-B templates, calls the photographic orchestrator
 * (`getImagesForSlides` from Day 2) to populate
 * `articles.domain_extras.familyBImages[]` with R2-staged WebP URLs +
 * license metadata. For non-Family-B templates, the step is a no-op
 * pass-through (zero cost, no I/O).
 *
 * Idempotent: reads the existing cache from `domain_extras.familyBImages`
 * first; cache-hit slides skip the LLM + provider + R2 work. The re-render
 * endpoint's `refreshImages` flag clears the cache (separate flow in the
 * articles route) so re-renders can re-stage when Marcel explicitly asks.
 *
 * Soft-fail per slide: the orchestrator returns `failedSlideIndices` for
 * slides that couldn't be staged. Those slides render gradient-only at
 * Remotion-render time (Family-B `SlideComposition` `image={null}` branch).
 * A complete photographic-pipeline failure (Marcel hasn't entered provider
 * keys yet, all 3 providers rate-limited, etc.) leaves `familyBImages = []`
 * — the carousel still renders, just gradient-only across the board.
 *
 * Cost-tracking: the orchestrator's internal LLM calls
 * (`IMAGE_QUERY_KEYWORDS` Haiku + `IMAGE_VISION_PICK` Sonnet vision) are
 * already tracked at the adapter boundary via `anthropic.messages()`. This
 * step has `estimatedCostEur = 0.25` as the per-call upper-bound budget
 * gate (covers ~4 image slides × €0.05-0.06). Real cost lands in cost_logs
 * per LLM call.
 */
import {
  type PexelsCredentials,
} from "@marketing-auto/adapter-pexels";
import type { PixabayCredentials } from "@marketing-auto/adapter-pixabay";
import type { UnsplashCredentials } from "@marketing-auto/adapter-unsplash";
import {
  type FamilyBImageEntry,
  familyBImagesArraySchema,
} from "@marketing-auto/social/photographic";
import { type SlideRole } from "@marketing-auto/social/presets/catalog";
import { articles, db, eq, sql } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import {
  generateNB2ImagesForSlides,
  type NB2ImageSlideRequest,
  type OrchestrateNB2ImagesResult,
} from "./nb2/orchestrator.ts";
import { resolvePresetForArticle } from "./nb2/resolve-preset.ts";
import {
  type ImageSlideRequest,
  getImagesForSlides,
  type OrchestrateImagesResult,
} from "./photographic/orchestrator.ts";
import { readAdapterCredsForProject } from "./photographic/read-creds.ts";

// ─── Per-template image-slide map (Spec 65.8 §3.7 Option γ) ───────────────────

/**
 * Which slides need photographic backgrounds per Family-B template. Slides
 * not listed render gradient-only. Indexed by slideIndex; the orchestrator
 * passes through one request per index.
 */
// Spec 65.16 — `beat` is typed as `SlideRole` (not bare `string`) so the
// NB2 path's `slideRole: s.narrativeBeat` flow stays type-safe end-to-end.
// Adding a new beat string without extending `SlideRole` is a compile-time
// error in this map.
const FAMILY_B_IMAGE_SLIDES: Readonly<
  Record<string, ReadonlyArray<{ slideIndex: number; beat: SlideRole }>>
> = {
  // story-arc-clickbait — Cover/Conflict/Resolution/Payoff (Setup + Lesson stay gradient-only)
  "story-arc-clickbait": [
    { slideIndex: 0, beat: "cover" },
    { slideIndex: 2, beat: "conflict" },
    { slideIndex: 3, beat: "resolution" },
    { slideIndex: 4, beat: "payoff" },
  ],
  // lifestyle-listicle — Cover + 3 Item slides (Intro stays gradient-only)
  "lifestyle-listicle": [
    { slideIndex: 0, beat: "cover" },
    { slideIndex: 2, beat: "item" },
    { slideIndex: 3, beat: "item" },
    { slideIndex: 4, beat: "item" },
  ],
  // opinion-recommendation — Cover/Hot-Take/Top-Pick (Reasoning #1+#2 stay gradient-only)
  "opinion-recommendation": [
    { slideIndex: 0, beat: "cover" },
    { slideIndex: 1, beat: "hot-take" },
    { slideIndex: 4, beat: "top-pick" },
  ],
};

const FAMILY_B_TEMPLATE_KEYS = Object.keys(FAMILY_B_IMAGE_SLIDES);

export function isFamilyBTemplate(templateKey: string | null | undefined): boolean {
  return typeof templateKey === "string" && FAMILY_B_TEMPLATE_KEYS.includes(templateKey);
}

// ─── Step I/O ─────────────────────────────────────────────────────────────────
//
// Input is the GenerateCaption output (which already carries templateKeyOverride
// from the pipeline bridge); declared loosely so the step doesn't pin the entire
// upstream Zod inference. Output is the same input + the new `familyBImages`
// array (empty for non-Family-B paths).

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  templateKeyOverride: z.string().nullable().optional(),
}).passthrough();

const OutputSchema = InputSchema.extend({
  familyBImages: familyBImagesArraySchema.default([]),
  familyBImagesStats: z
    .object({
      templateKey: z.string().nullable(),
      cacheHits: z.number().int().min(0),
      freshStages: z.number().int().min(0),
      failures: z.number().int().min(0),
      totalProviderCandidates: z.number().int().min(0),
    })
    .optional(),
}).passthrough();

type StageInput = z.infer<typeof InputSchema>;
type StageOutput = z.infer<typeof OutputSchema>;

// ─── DI shape (lets tests inject mocked credentials + orchestrator) ───────────

/**
 * Dependencies the step needs from the outside. Production wiring uses
 * `readAdapterCredsForProject` (vault) + the real orchestrator import.
 * Tests inject stubs to stay offline.
 */
export interface StageFamilyBImagesDeps {
  loadCredentials: (projectId: string) => Promise<{
    pexels: PexelsCredentials | null;
    unsplash: UnsplashCredentials | null;
    pixabay: PixabayCredentials | null;
  }>;
  /** Default is `getImagesForSlides` from `./photographic/orchestrator.ts`. */
  runOrchestrator?: typeof getImagesForSlides;
  /**
   * Spec 65.16 — NB2 orchestrator dep, mirrors `runOrchestrator` shape so
   * tests can inject a stub when exercising the NB2 routing branch.
   * Default is `generateNB2ImagesForSlides` from `./nb2/orchestrator.ts`.
   */
  runNB2Orchestrator?: typeof generateNB2ImagesForSlides;
}

const DEFAULT_DEPS: StageFamilyBImagesDeps = {
  loadCredentials: readAdapterCredsForProject,
  runOrchestrator: getImagesForSlides,
  runNB2Orchestrator: generateNB2ImagesForSlides,
};

// ─── Image provider routing (Spec 65.16 §3.4) ────────────────────────────

type ImageProvider = "nano-banana-2" | "photographic";

/**
 * Content-type default routing. Lifestyle stays photographic per Marcel-
 * Decision §3.4 (authentic-lifestyle fits real-photos). Everything else
 * routes through NB2 for signature visual quality. Mirrors the table in
 * `apps/api/src/lib/recurring-content/resolve-image-style-preset.ts` —
 * keep these in sync when adding a Family-B template.
 */
const CONTENT_TYPE_PROVIDER_DEFAULT: Record<string, ImageProvider> = {
  "story-arc-clickbait": "nano-banana-2",
  "opinion-recommendation": "nano-banana-2",
  "lifestyle-listicle": "photographic",
};

function isImageProvider(value: unknown): value is ImageProvider {
  return value === "nano-banana-2" || value === "photographic";
}

function resolveProvider(templateKey: string, contentLevelChoice: unknown): ImageProvider {
  if (isImageProvider(contentLevelChoice)) return contentLevelChoice;
  return CONTENT_TYPE_PROVIDER_DEFAULT[templateKey] ?? "nano-banana-2";
}

// Preset resolution lives in `./nb2/resolve-preset.ts` since Spec 65.16 — it's
// shared with `RenderSlidesStep` so the image preset + text overlay preset
// always match. See `resolvePresetForArticle()`.

// ─── Step ──────────────────────────────────────────────────────────────────────

export class StageFamilyBImagesStep extends BaseStep<StageInput, StageOutput> {
  readonly name = "stage-family-b-images";
  readonly inputSchema = InputSchema;
  // Cast justification: `OutputSchema` uses `.passthrough()` + `.extend({...})`
  // on top of an `.passthrough()` base, so Zod's inferred type carries
  // `[k: string]: unknown` index signatures while `StageOutput` (via
  // `z.infer<typeof OutputSchema>`) is the same shape with stricter narrowing.
  // The cast resolves the structural variance mismatch under
  // `exactOptionalPropertyTypes` (same pattern as 4+ other pipeline steps).
  readonly outputSchema = OutputSchema as z.ZodType<StageOutput>;

  // Worst-case budget gate (per-call upper bound — ~4 image slides × €0.06).
  // Real cost-logs land per LLM call via the orchestrator → `anthropic.messages()`.
  override estimatedCostEur(): number {
    return 0.25;
  }

  /** Test seam — production calls without args; tests pass deps. */
  constructor(private readonly deps: StageFamilyBImagesDeps = DEFAULT_DEPS) {
    super();
  }

  async execute(input: StageInput, ctx: StepContext): Promise<StageOutput> {
    const templateKey = input.templateKeyOverride ?? null;

    // Fast path: non-Family-B templates produce no images.
    if (!isFamilyBTemplate(templateKey)) {
      return {
        ...input,
        familyBImages: [],
        familyBImagesStats: {
          templateKey,
          cacheHits: 0,
          freshStages: 0,
          failures: 0,
          totalProviderCandidates: 0,
        },
      } as StageOutput;
    }
    // templateKey is narrowed to string by isFamilyBTemplate; satisfy TS for the indexed read below.
    const tk = templateKey as string;

    // 1. Load article context: existing cache, hook, primaryTool, theme.
    const [row] = await db
      .select({ domainExtras: articles.domainExtras })
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!row) {
      ctx.log.warn({ articleId: input.articleId }, "StageFamilyBImagesStep: article not found — skipping image staging");
      return passThroughEmpty(input, templateKey);
    }

    const extras = parseDomainExtras(row.domainExtras);
    const existingCache = parseExistingCache(extras);
    const recurring = parseRecurring(extras);
    const hookData = recurring?.formatConfig?.hookData;
    if (!hookData) {
      ctx.log.warn(
        { articleId: input.articleId, templateKey },
        "StageFamilyBImagesStep: Family-B template requires recurring.formatConfig.hookData — skipping image staging (will render gradient-only)",
      );
      return passThroughEmpty(input, templateKey);
    }

    // 2. Build the per-slide ImageSlideRequest list. Beat-text comes from the
    //    article's recurring.formatConfig.narrative when present (Spec 65.5
    //    brief-generator surface) — falls back to the rendered hook if not
    //    populated (legacy / pre-generated articles).
    const narrative = recurring?.formatConfig?.narrative as Record<string, { text?: string }> | undefined;
    const slideMap = FAMILY_B_IMAGE_SLIDES[tk] ?? [];
    const slides: ImageSlideRequest[] = slideMap.map(({ slideIndex, beat }) => ({
      slideIndex,
      hookContext: {
        rendered: hookData.rendered ?? "",
        variables: hookData.variables ?? {},
      },
      narrativeBeat: beat,
      beatText: narrative?.[beat]?.text ?? hookData.rendered ?? "",
    }));

    // 3. Spec 65.16 — resolve image provider + preset.
    //    Provider: content-level choice > content-type default (lifestyle →
    //    photographic, story-arc/opinion → nano-banana-2). Preset: content-
    //    level choice > definition override > project default. Both come from
    //    `recurring.formatConfig.*` snapshot frozen at brief-generation time
    //    (the brief-generator stamped them per Marcel's wizard choices).
    const contentLevelPreset = recurring?.formatConfig?.imageStylePreset ?? null;
    const contentLevelProvider = recurring?.formatConfig?.imageProvider ?? null;
    const provider = resolveProvider(tk, contentLevelProvider);

    // Branch 1: Nano Banana 2 — preset-driven signature image generation.
    if (provider === "nano-banana-2") {
      // Resolve preset via the shared 3-tier helper (Spec 65.16 §3.3).
      // Single source of truth shared with `RenderSlidesStep` so the image
      // and the text overlay end up using the same preset.
      const preset = await resolvePresetForArticle({
        projectId: input.projectId,
        definitionId: recurring?.definitionId ?? null,
        contentLevelChoice: contentLevelPreset,
      });

      const nb2Slides: NB2ImageSlideRequest[] = slides.map((s) => ({
        slideIndex: s.slideIndex,
        // Safe cast — `ImageSlideRequest.narrativeBeat` is typed `string` upstream
        // (photographic interface) but the SOURCE values come from
        // `FAMILY_B_IMAGE_SLIDES.beat: SlideRole`, so this can only widen at the
        // photographic boundary then narrow back at the NB2 boundary. Drift
        // protection lives on the source map's type, not on this cast.
        slideRole: s.narrativeBeat as SlideRole,
        narrativeBeat: s.narrativeBeat,
        beatText: s.beatText,
        hookContext: s.hookContext,
      }));

      const nb2Orchestrator = this.deps.runNB2Orchestrator ?? generateNB2ImagesForSlides;
      const nb2Result: OrchestrateNB2ImagesResult = await nb2Orchestrator({
        projectId: input.projectId,
        projectSlug: input.projectSlug,
        articleId: input.articleId,
        formatType: tk,
        preset,
        slides: nb2Slides,
        existingCache,
        ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
      });

      // Persist back to articles.domain_extras.familyBImages via jsonb_set.
      if (nb2Result.entries.length > 0 || existingCache.length > 0) {
        await db
          .update(articles)
          .set({
            domainExtras: sql`jsonb_set(
              COALESCE(${articles.domainExtras}, '{}'::jsonb),
              '{familyBImages}',
              ${JSON.stringify(nb2Result.entries)}::jsonb
            )`,
          })
          .where(eq(articles.id, input.articleId));
      }

      ctx.log.info(
        {
          articleId: input.articleId,
          templateKey,
          provider: "nano-banana-2",
          preset,
          ...nb2Result.stats,
          failedSlides: nb2Result.failedSlideIndices,
        },
        "StageFamilyBImagesStep: nb2 pipeline complete",
      );

      // Map NB2 stats shape to the FamilyBImagesStats output schema. NB2
      // path has no provider candidates (it's generative); `freshGenerations`
      // maps to `freshStages` for shape compat with consumers reading either
      // path's output uniformly.
      return {
        ...input,
        familyBImages: nb2Result.entries,
        familyBImagesStats: {
          templateKey,
          cacheHits: nb2Result.stats.cacheHits,
          freshStages: nb2Result.stats.freshGenerations,
          failures: nb2Result.stats.failures,
          totalProviderCandidates: 0,
        },
      } as StageOutput;
    }

    // Branch 2: Photographic pipeline (pre-65.16 default path, retained for
    // lifestyle-listicle + any content-level photographic override).

    // Load provider credentials from vault.
    const credentials = await this.deps.loadCredentials(input.projectId);
    if (!credentials.pexels && !credentials.unsplash && !credentials.pixabay) {
      ctx.log.warn(
        { articleId: input.articleId, projectId: input.projectId },
        "StageFamilyBImagesStep: no photographic-provider credentials in vault — skipping (gradient-only render)",
      );
      return passThroughEmpty(input, templateKey);
    }

    // Resolve brand primary color (used by vision-pick for harmony scoring).
    const brandPrimaryColor = resolveBrandPrimary(extras);

    // Call the photographic orchestrator. Soft-fail per slide.
    const orchestrator = this.deps.runOrchestrator ?? getImagesForSlides;
    const result: OrchestrateImagesResult = await orchestrator({
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      articleId: input.articleId,
      formatType: tk,
      brandPrimaryColor,
      theme: extractTheme(input) ?? "dark",
      slides,
      existingCache,
      credentials,
      ...(ctx.pipelineRunId !== undefined && { pipelineRunId: ctx.pipelineRunId }),
    });

    // Persist back to articles.domain_extras.familyBImages via jsonb_set
    // (preserves sibling keys; never overwrites the whole column).
    if (result.entries.length > 0 || existingCache.length > 0) {
      await db
        .update(articles)
        .set({
          domainExtras: sql`jsonb_set(
            COALESCE(${articles.domainExtras}, '{}'::jsonb),
            '{familyBImages}',
            ${JSON.stringify(result.entries)}::jsonb
          )`,
        })
        .where(eq(articles.id, input.articleId));
    }

    ctx.log.info(
      {
        articleId: input.articleId,
        templateKey,
        provider: "photographic",
        ...result.stats,
        failedSlides: result.failedSlideIndices,
      },
      "StageFamilyBImagesStep: photographic-pipeline complete",
    );

    return {
      ...input,
      familyBImages: result.entries,
      familyBImagesStats: { templateKey, ...result.stats },
    } as StageOutput;
  }
}

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

export function passThroughEmpty(input: StageInput, templateKey: string | null): StageOutput {
  return {
    ...input,
    familyBImages: [],
    familyBImagesStats: {
      templateKey,
      cacheHits: 0,
      freshStages: 0,
      failures: 0,
      totalProviderCandidates: 0,
    },
  } as StageOutput;
}

export function parseDomainExtras(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null) return {};
  return raw as Record<string, unknown>;
}

export function parseExistingCache(extras: Record<string, unknown>): FamilyBImageEntry[] {
  const raw = extras.familyBImages;
  const parsed = familyBImagesArraySchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export function parseRecurring(extras: Record<string, unknown>): {
  definitionId?: string;
  formatConfig?: {
    hookData?: { rendered?: string; variables?: Record<string, string> };
    narrative?: Record<string, { text?: string }>;
    /** Spec 65.16 content-level preset choice (frozen at brief-generation time). */
    imageStylePreset?: string;
    /** Spec 65.16 content-level provider choice — overrides content-type-default routing. */
    imageProvider?: string;
  };
} | null {
  const recurring = extras.recurring;
  if (typeof recurring !== "object" || recurring === null) return null;
  return recurring as ReturnType<typeof parseRecurring>;
}

function resolveBrandPrimary(extras: Record<string, unknown>): string {
  // Best-effort lookup: brandTokens.colors.brandHue → derived primary. Falls
  // back to a neutral indigo if the lookup fails — vision-pick uses this for
  // harmony scoring, so the exact value matters less than having SOMETHING.
  const tokens = extras.brandTokens as { colors?: { brandHue?: number } } | undefined;
  const hue = tokens?.colors?.brandHue ?? 248;
  return `oklch(64% 0.16 ${hue})`;
}

function extractTheme(input: StageInput): "dark" | "light" | null {
  const theme = (input as Record<string, unknown>).theme;
  if (theme === "dark" || theme === "light") return theme;
  return null;
}
