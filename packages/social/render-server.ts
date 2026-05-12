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

// Convert local file paths in iconUrl fields to base64 data URLs so Remotion's
// headless browser (served from localhost) can load them without file:// restrictions.
async function resolveIconUrls(input: ListCarouselInput): Promise<ListCarouselInput> {
  const tools = await Promise.all(
    input.tools.map(async (tool) => {
      if (!tool.iconUrl) return tool;
      if (tool.iconUrl.startsWith("data:") || tool.iconUrl.startsWith("http")) return tool;
      // Local file path → base64 data URL
      try {
        const buf = await readFile(tool.iconUrl);
        return { ...tool, iconUrl: `data:image/png;base64,${buf.toString("base64")}` };
      } catch {
        return { ...tool, iconUrl: undefined };
      }
    })
  );
  return { ...input, tools };
}

export async function renderListCarousel(input: ListCarouselInput): Promise<RenderResult> {
  const resolved = await resolveIconUrls(input);
  const serveUrl = await getBundle();
  const totalSlides = 1 + resolved.tools.length + 1;
  const slides: Buffer[] = [];

  // Resolve actual composition from bundle to get correct dimensions + metadata.
  // Then override props per-slide — in Remotion 4.x inputProps don't reliably
  // override when schema is registered; setting composition.props directly is the
  // supported programmatic path for server-side rendering.
  const compositions = await getCompositions(serveUrl);
  const baseComposition = compositions.find((c) => c.id === "ListCarousel");
  if (!baseComposition) throw new Error("ListCarousel composition not found in bundle");

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
