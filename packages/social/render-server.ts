/**
 * Programmatic Remotion render entry.
 * Used by the article:social-image pipeline to render PNG slides from ListCarousel compositions.
 */

import { bundle } from "@remotion/bundler";
import { getCompositions, renderStill } from "@remotion/renderer";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { readFile, rm, mkdir } from "node:fs/promises";
import type { ListCarouselInput } from "./src/compositions/list-carousel/types.ts";
import type { VerdictPerUseCaseInput } from "./src/compositions/verdict-per-use-case/types.ts";
import type { SingleToolSpotlightInput } from "./src/compositions/single-tool-spotlight/types.ts";
import type { ProConVerdictInput } from "./src/compositions/pro-con-verdict/types.ts";
import type { ComparisonGrid4Input } from "./src/compositions/comparison-grid-4/types.ts";
import type { ComparisonGrid3Input } from "./src/compositions/comparison-grid-3/types.ts";
import type { ComparisonGrid5Input } from "./src/compositions/comparison-grid-5/types.ts";
import type { HeadToHeadVsInput } from "./src/compositions/head-to-head-vs/types.ts";
import type { HeadToHeadDeepDiveInput } from "./src/compositions/head-to-head-deep-dive/types.ts";
import type { StoryArcClickbaitInput } from "./src/compositions/story-arc-clickbait/types.ts";

const ENTRY_POINT = resolve(fileURLToPath(import.meta.url), "..", "src/index.tsx");
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let bundleUrl: string | null = null;

async function getBundle(): Promise<string> {
  if (bundleUrl) return bundleUrl;
  bundleUrl = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias as Record<string, string> | undefined),
          // Bun workspace packages are not auto-resolved by webpack — add explicit paths.
          "@marketing-auto/shared": resolve(WORKSPACE_ROOT, "packages/shared/src"),
        },
      },
    }),
  });
  return bundleUrl;
}

export type RenderResult = {
  slides: Buffer[];
  sequenceCount: number;
};

async function renderComposition(
  compositionId: string,
  input: ListCarouselInput
): Promise<RenderResult> {
  const resolved = input;
  const serveUrl = await getBundle();
  const totalSlides = 1 + resolved.tools.length + 1;
  const slides: Buffer[] = [];

  // Resolve actual composition from bundle to get correct dimensions + metadata.
  // Then override props per-slide — in Remotion 4.x inputProps don't reliably
  // override when schema is registered; setting composition.props directly is the
  // supported programmatic path for server-side rendering.
  const compositions = await getCompositions(serveUrl);
  const baseComposition = compositions.find((c) => c.id === compositionId);
  if (!baseComposition) throw new Error(`${compositionId} composition not found in bundle`);

  const outDir = resolve(tmpdir(), `social-render-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  try {
    for (let slideIndex = 0; slideIndex < totalSlides; slideIndex++) {
      const outPath = resolve(outDir, `slide-${slideIndex}.png`);
      const slideProps = { ...resolved, slideIndex } as Record<string, unknown>;

      await renderStill({
        composition: { ...baseComposition, props: slideProps },
        serveUrl,
        output: outPath,
        frame: 0,
        imageFormat: "png",
      });

      const buf = await readFile(outPath);
      slides.push(buf);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  return { slides, sequenceCount: totalSlides };
}

export async function renderListCarousel(input: ListCarouselInput): Promise<RenderResult> {
  return renderComposition("ListCarousel", input);
}

export async function renderComparisonGrid(input: ListCarouselInput): Promise<RenderResult> {
  return renderComposition("ComparisonGrid", input);
}

/**
 * Spec 65.7 — shared multi-slide renderer for Family A carousel templates.
 * Renders `slideTotal` PNGs, looping the slideIndex prop without altering
 * the dispatcher composition's other input fields.
 */
async function renderMultiSlideComposition(
  compositionId: string,
  input: Record<string, unknown> & { slideTotal: number },
  totalSlides: number,
  slug: string,
): Promise<RenderResult> {
  const serveUrl = await getBundle();
  const compositions = await getCompositions(serveUrl);
  const baseComposition = compositions.find((c) => c.id === compositionId);
  if (!baseComposition) throw new Error(`${compositionId} composition not found in bundle`);

  const outDir = resolve(tmpdir(), `social-render-${slug}-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const slides: Buffer[] = [];
  try {
    for (let slideIndex = 0; slideIndex < totalSlides; slideIndex++) {
      const outPath = resolve(outDir, `slide-${slideIndex}.png`);
      const slideProps = { ...input, slideIndex } as Record<string, unknown>;
      await renderStill({
        composition: { ...baseComposition, props: slideProps },
        serveUrl,
        output: outPath,
        frame: 0,
        imageFormat: "png",
      });
      const buf = await readFile(outPath);
      slides.push(buf);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  return { slides, sequenceCount: totalSlides };
}

export async function renderSingleToolSpotlight(input: SingleToolSpotlightInput): Promise<RenderResult> {
  const totalSlides = input.slideTotal;
  const serveUrl = await getBundle();
  const compositions = await getCompositions(serveUrl);
  const baseComposition = compositions.find((c) => c.id === "SingleToolSpotlight");
  if (!baseComposition) throw new Error("SingleToolSpotlight composition not found in bundle");

  const outDir = resolve(tmpdir(), `social-render-sts-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const slides: Buffer[] = [];
  try {
    for (let slideIndex = 0; slideIndex < totalSlides; slideIndex++) {
      const outPath = resolve(outDir, `slide-${slideIndex}.png`);
      const slideProps = { ...input, slideIndex } as Record<string, unknown>;

      await renderStill({
        composition: { ...baseComposition, props: slideProps },
        serveUrl,
        output: outPath,
        frame: 0,
        imageFormat: "png",
      });

      const buf = await readFile(outPath);
      slides.push(buf);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  return { slides, sequenceCount: totalSlides };
}

export async function renderProConVerdict(input: ProConVerdictInput): Promise<RenderResult> {
  const serveUrl = await getBundle();
  const compositions = await getCompositions(serveUrl);
  const baseComposition = compositions.find((c) => c.id === "ProConVerdict");
  if (!baseComposition) throw new Error("ProConVerdict composition not found in bundle");

  const outDir = resolve(tmpdir(), `social-render-pcv-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const slides: Buffer[] = [];
  try {
    const outPath = resolve(outDir, "slide-0.png");
    const slideProps = { ...input, slideIndex: 0 } as Record<string, unknown>;

    await renderStill({
      composition: { ...baseComposition, props: slideProps },
      serveUrl,
      output: outPath,
      frame: 0,
      imageFormat: "png",
    });

    const buf = await readFile(outPath);
    slides.push(buf);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  return { slides, sequenceCount: 1 };
}

export async function renderComparisonGrid4(input: ComparisonGrid4Input): Promise<RenderResult> {
  const serveUrl = await getBundle();
  const compositions = await getCompositions(serveUrl);
  const baseComposition = compositions.find((c) => c.id === "comparison-grid-4");
  if (!baseComposition) throw new Error("comparison-grid-4 composition not found in bundle");

  const outDir = resolve(tmpdir(), `social-render-cg4-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const slides: Buffer[] = [];
  try {
    const outPath = resolve(outDir, "slide-0.png");
    const slideProps = { ...input, slideIndex: 0 } as Record<string, unknown>;

    await renderStill({
      composition: { ...baseComposition, props: slideProps },
      serveUrl,
      output: outPath,
      frame: 0,
      imageFormat: "png",
    });

    const buf = await readFile(outPath);
    slides.push(buf);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  return { slides, sequenceCount: 1 };
}

export async function renderComparisonGrid3(input: ComparisonGrid3Input): Promise<RenderResult> {
  // Spec 65.7 — multi-slide carousel (7 slides). Replaces the pre-65.7 single-still.
  return renderMultiSlideComposition("comparison-grid-3", input, input.slideTotal, "cg3");
}

export async function renderComparisonGrid5(input: ComparisonGrid5Input): Promise<RenderResult> {
  // Spec 65.7 — multi-slide carousel (9 slides).
  return renderMultiSlideComposition("comparison-grid-5", input, input.slideTotal, "cg5");
}

export async function renderHeadToHeadVs(input: HeadToHeadVsInput): Promise<RenderResult> {
  // Spec 65.7 — 2-tool head-to-head carousel (6 slides).
  return renderMultiSlideComposition("head-to-head-vs", input, input.slideTotal, "h2hvs");
}

export async function renderHeadToHeadDeepDive(input: HeadToHeadDeepDiveInput): Promise<RenderResult> {
  // Spec 65.7 — 2-tool deep-dive carousel (9 slides).
  return renderMultiSlideComposition("head-to-head-deep-dive", input, input.slideTotal, "h2hdd");
}

export async function renderStoryArcClickbait(input: StoryArcClickbaitInput): Promise<RenderResult> {
  // Spec 65.8 — Family B 7-slide narrative carousel.
  return renderMultiSlideComposition("story-arc-clickbait", input, input.slideTotal, "sac");
}

export async function renderVerdictPerUseCase(input: VerdictPerUseCaseInput): Promise<RenderResult> {
  const serveUrl = await getBundle();
  const compositions = await getCompositions(serveUrl);
  const baseComposition = compositions.find((c) => c.id === "verdict-per-use-case");
  if (!baseComposition) throw new Error("verdict-per-use-case composition not found in bundle");

  const outDir = resolve(tmpdir(), `social-render-vpc-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  const slides: Buffer[] = [];
  try {
    const outPath = resolve(outDir, "slide-0.png");
    const slideProps = { ...input, slideIndex: 0 } as Record<string, unknown>;

    await renderStill({
      composition: { ...baseComposition, props: slideProps },
      serveUrl,
      output: outPath,
      frame: 0,
      imageFormat: "png",
    });

    const buf = await readFile(outPath);
    slides.push(buf);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  return { slides, sequenceCount: 1 };
}
