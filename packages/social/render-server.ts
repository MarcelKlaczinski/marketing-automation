/**
 * Programmatic Remotion render entry.
 * Used by the article:social-image pipeline to render PNG slides from ListCarousel compositions.
 */

import { bundle } from "@remotion/bundler";
import { renderStill } from "@remotion/renderer";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { readFile, rm, mkdir } from "node:fs/promises";
import type { ListCarouselInput } from "./src/compositions/list-carousel/types.ts";

const ENTRY_POINT = resolve(fileURLToPath(import.meta.url), "src/index.tsx");

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

export async function renderListCarousel(input: ListCarouselInput): Promise<RenderResult> {
  const serveUrl = await getBundle();
  const totalSlides = 1 + input.tools.length + 1;
  const slides: Buffer[] = [];

  const outDir = resolve(tmpdir(), `social-render-${Date.now()}`);
  await mkdir(outDir, { recursive: true });

  try {
    for (let slideIndex = 0; slideIndex < totalSlides; slideIndex++) {
      const outPath = resolve(outDir, `slide-${slideIndex}.png`);

      await renderStill({
        composition: {
          id: "ListCarousel",
          width: 1080,
          height: 1080,
          fps: 30,
          durationInFrames: 1,
          defaultProps: {},
          props: {},
          defaultCodec: null,
          defaultOutName: null,
          defaultVideoImageFormat: null,
          defaultPixelFormat: null,
          defaultProResProfile: null,
          defaultSampleRate: null,
        },
        serveUrl,
        output: outPath,
        frame: 0,
        imageFormat: "png",
        inputProps: { ...input, slideIndex },
      });

      const buf = await readFile(outPath);
      slides.push(buf);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }

  return { slides, sequenceCount: totalSlides };
}
