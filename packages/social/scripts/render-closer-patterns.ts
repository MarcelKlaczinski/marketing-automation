/**
 * Spec 51a-stunning-v2.1 §1.2 acceptance helper.
 *
 * Renders three end-slide PNGs — one per closer pattern (verdict_recap,
 * action_frame, identity_mirror) — to verify the deterministic closer engine
 * produces clean, concat-free layouts.
 *
 * Usage:
 *   bun packages/social/scripts/render-closer-patterns.ts [outDir]
 *
 * outDir defaults to /tmp/spec-51a-v2.1.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderComparisonGrid } from "../render-server.ts";
import { listCarouselInputSchema } from "../src/compositions/list-carousel/types.ts";
import { iconifyAdapter } from "../../pipelines/src/_lib/icon-sources/iconify.ts";
import { lobeIconsAdapter } from "../../pipelines/src/_lib/icon-sources/lobe-icons.ts";
import { simpleIconsAdapter } from "../../pipelines/src/_lib/icon-sources/simple-icons.ts";

/**
 * Mirror the production resolveToolIcon() chain (simple-icons → iconify →
 * lobe-icons) without touching the DB so the local script renders show the
 * exact SVGs production would inject. Falls through to initials/hue if no
 * adapter matches.
 */
async function resolveIcon(
  slug: string,
  initials: string,
  hue: number,
): Promise<{ iconSvg?: string; iconInitials: string; iconHue: number }> {
  for (const adapter of [simpleIconsAdapter, iconifyAdapter, lobeIconsAdapter]) {
    try {
      const res = await adapter.tryResolve(slug);
      if (res) return { iconSvg: res.svgContent, iconInitials: initials, iconHue: hue };
    } catch {}
  }
  return { iconInitials: initials, iconHue: hue };
}

const outDir = resolve(process.argv[2] ?? "/tmp/spec-51a-v2.1");

const baseTools = [
  {
    slug: "recraft",
    rank: 1,
    name: "Recraft",
    domain: "recraft.ai",
    eyebrow: "01 · RECRAFT",
    tagline: "KI-Vektor-Generator mit produktionsreifem SVG-Export.",
    strengths: ["SVG-Export", "Figma-Plugin", "Konsistente Styles"],
    pricing: { tier: "freemium" as const, label: "Pro ab 12 $/Mo" },
    bestFor: "Logo & Brand-Designer",
    keyDifferentiator: "produktionsreifem SVG-Export",
    starStrength: "SVG-Export",
    endSlideToken: "Logos",
    identityVerb: "designst Logos",
    iconInitials: "Rc",
    iconHue: 200,
  },
  {
    slug: "ideogram",
    rank: 2,
    name: "Ideogram",
    domain: "ideogram.ai",
    eyebrow: "02 · IDEOGRAM",
    tagline: "Stärkstes Typografie-Rendering aller Bild-KIs.",
    strengths: ["Text in Bildern", "Kostenlos nutzbar", "Schnell"],
    pricing: { tier: "freemium" as const, label: "Pro ab 8 $/Mo" },
    bestFor: "Poster & Text-in-Bild",
    keyDifferentiator: "Typografie-Rendering",
    starStrength: "Text in Bildern",
    endSlideToken: "Poster",
    identityVerb: "machst Poster",
    iconInitials: "Id",
    iconHue: 280,
  },
];

const thirdTool = {
  ...baseTools[0]!,
  slug: "midjourney",
  rank: 3,
  name: "Midjourney",
  domain: "midjourney.com",
  eyebrow: "03 · MIDJOURNEY",
  endSlideToken: "Bilder",
  identityVerb: "erzeugst Bilder",
};

const threeToolsRaw = [...baseTools, thirdTool];

const fiveToolsRaw = [
  ...threeToolsRaw,
  { ...thirdTool, slug: "flux", rank: 4, name: "Flux", domain: "flux.ai", eyebrow: "04 · FLUX" },
  { ...thirdTool, slug: "imagen", rank: 5, name: "Imagen", domain: "imagen.research.google", eyebrow: "05 · IMAGEN" },
];

async function withResolvedIcons<T extends { slug: string; name: string; iconInitials: string; iconHue: number }>(tools: T[]) {
  return Promise.all(tools.map(async (t) => {
    const fallbackInitials = t.iconInitials || t.name.slice(0, 2);
    const resolved = await resolveIcon(t.slug, fallbackInitials, t.iconHue);
    return { ...t, ...resolved };
  }));
}

const threeTools = await withResolvedIcons(threeToolsRaw);
const fiveTools = await withResolvedIcons(fiveToolsRaw);

function buildHookOutput(toolCount: number) {
  return {
    pattern: "superlative_question" as const,
    leadPhrase: "Welche KI generiert",
    highlightWord: "die besten Logos",
    trailPhrase: "wirklich?",
    fullText: "Welche KI generiert die besten Logos wirklich?",
    promiseBlock: {
      line1: toolCount <= 2
        ? "Wir haben beide getestet."
        : `Alle ${toolCount} in der Praxis getestet.`,
      line2: "Eine gewinnt klar.",
    },
  };
}

const sharedCoverBase = {
  eyebrow: "KI-BILDGENERATOREN",
  headlineLead: "Recraft oder Ideogram?",
  headlineHighlight: "Eines kann mehr.",
};

const sharedEnd = {
  headline: "Mehr Reviews,",
  headlineHighlight: "ehrlich getestet.",
  articleUrl: "https://toolwiki.ai/recraft-vs-ideogram",
};

const cases = [
  {
    name: "verdict_recap",
    input: {
      theme: "dark" as const,
      variant: "stunning" as const,
      slideIndex: 0,
      cover: { ...sharedCoverBase, hookOutput: buildHookOutput(threeTools.length) },
      tools: threeTools,
      end: {
        ...sharedEnd,
        closer: {
          pattern: "verdict_recap" as const,
          line1: { leadText: "Recraft für", highlightText: "Logos", trailText: "." },
          line2: { leadText: "Ideogram für", highlightText: "Poster", trailText: "." },
          fullText: "Recraft für Logos. Ideogram für Poster.",
        },
        toolRecap: ["recraft", "ideogram"],
      },
    },
  },
  {
    name: "action_frame",
    input: {
      theme: "dark" as const,
      variant: "stunning" as const,
      slideIndex: 0,
      cover: { ...sharedCoverBase, hookOutput: buildHookOutput(fiveTools.length) },
      tools: fiveTools,
      end: {
        ...sharedEnd,
        closer: {
          pattern: "action_frame" as const,
          line1: { leadText: "5 Tools", highlightText: "getestet", trailText: "." },
          line2: { leadText: "Speichere für", highlightText: "später", trailText: "." },
          fullText: "5 Tools getestet. Speichere für später.",
        },
        toolRecap: ["recraft", "ideogram", "midjourney", "flux", "imagen"],
      },
    },
  },
  {
    name: "identity_mirror",
    input: {
      theme: "dark" as const,
      variant: "stunning" as const,
      slideIndex: 0,
      cover: { ...sharedCoverBase, hookOutput: buildHookOutput(threeTools.length) },
      tools: threeTools,
      end: {
        ...sharedEnd,
        closer: {
          pattern: "identity_mirror" as const,
          line1: { leadText: "Du designst Logos?", highlightText: "Recraft", trailText: "." },
          line2: { leadText: "Du machst Poster?", highlightText: "Ideogram", trailText: "." },
          fullText: "Du designst Logos? Recraft. Du machst Poster? Ideogram.",
        },
        toolRecap: ["recraft", "ideogram"],
      },
    },
  },
];

// Also render a light-theme variant of the first case to verify the new
// components (ToolPreviewRow, "Perfekt für" panel, ToolRecapGrid) are
// theme-aware. Skip cover slide bg-cropping for clarity.
const lightVariant = {
  name: "light",
  input: { ...cases[0]!.input, theme: "light" as const },
};

await mkdir(outDir, { recursive: true });

for (const c of [...cases, lightVariant]) {
  console.log(`[render] ${c.name}…`);  // biome-ignore lint/suspicious/noConsoleLog: script output
  const parsed = listCarouselInputSchema.parse(c.input);
  const result = await renderComparisonGrid(parsed);

  const coverPath = resolve(outDir, `cover-${c.name}.png`);
  const toolPath = resolve(outDir, `tool-${c.name}.png`);
  const endPath = resolve(outDir, `end-${c.name}.png`);
  await writeFile(coverPath, result.slides[0]!);
  if (result.slides.length >= 3) {
    await writeFile(toolPath, result.slides[1]!);
  }
  await writeFile(endPath, result.slides[result.slides.length - 1]!);
  console.log(`  cover → ${coverPath}`);  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  tool  → ${toolPath}`);   // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  end   → ${endPath}`);    // biome-ignore lint/suspicious/noConsoleLog: script output
}

console.log("done");  // biome-ignore lint/suspicious/noConsoleLog: script output
