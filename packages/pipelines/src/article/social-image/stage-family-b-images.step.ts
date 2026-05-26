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
import { articles, db, eq, sql } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import {
  type ImageSlideRequest,
  getImagesForSlides,
} from "./photographic/orchestrator.ts";
import { readAdapterCredsForProject } from "./photographic/read-creds.ts";

// ─── Per-template image-slide map (Spec 65.8 §3.7 Option γ) ───────────────────

/**
 * Which slides need photographic backgrounds per Family-B template. Slides
 * not listed render gradient-only. Indexed by slideIndex; the orchestrator
 * passes through one request per index.
 */
const FAMILY_B_IMAGE_SLIDES: Readonly<Record<string, ReadonlyArray<{ slideIndex: number; beat: string }>>> = {
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
}

const DEFAULT_DEPS: StageFamilyBImagesDeps = {
  loadCredentials: readAdapterCredsForProject,
  runOrchestrator: getImagesForSlides,
};

// ─── Step ──────────────────────────────────────────────────────────────────────

export class StageFamilyBImagesStep extends BaseStep<StageInput, StageOutput> {
  readonly name = "stage-family-b-images";
  readonly inputSchema = InputSchema;
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

    // 3. Load provider credentials from vault.
    const credentials = await this.deps.loadCredentials(input.projectId);
    if (!credentials.pexels && !credentials.unsplash && !credentials.pixabay) {
      ctx.log.warn(
        { articleId: input.articleId, projectId: input.projectId },
        "StageFamilyBImagesStep: no photographic-provider credentials in vault — skipping (gradient-only render)",
      );
      return passThroughEmpty(input, templateKey);
    }

    // 4. Resolve brand primary color (used by vision-pick for harmony scoring).
    const brandPrimaryColor = resolveBrandPrimary(extras);

    // 5. Call the orchestrator. Soft-fail per slide (see orchestrator comment).
    const orchestrator = this.deps.runOrchestrator ?? getImagesForSlides;
    const result = await orchestrator({
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

    // 6. Persist back to articles.domain_extras.familyBImages via jsonb_set
    //    (preserves sibling keys; never overwrites the whole column).
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
  formatConfig?: {
    hookData?: { rendered?: string; variables?: Record<string, string> };
    narrative?: Record<string, { text?: string }>;
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
