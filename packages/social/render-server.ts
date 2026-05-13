/**
 * Programmatic Remotion render entry.
 * Used by the article:social-image pipeline to render PNG slides from ListCarousel compositions.
 */

import { bundle } from "@remotion/bundler";
import { getCompositions, renderStill } from "@remotion/renderer";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { readFile, rm, mkdir } from "node:fs/promises";
import type { ListCarouselInput } from "./src/compositions/list-carousel/types.ts";

const ENTRY_POINT = resolve(fileURLToPath(import.meta.url), "..", "src/index.tsx");

let bundleUrl: string | null = null;

async function getBundle(): Promise<string> {
  if (bundleUrl) return bundleUrl;
  bundleUrl = await bundle({
    entryPoint: ENTRY_POINT,
    webpackOverride: (config) => config,
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

export async function renderListCarouselStunning(input: ListCarouselInput): Promise<RenderResult> {
  return renderComposition("ListCarouselStunning", input);
}
