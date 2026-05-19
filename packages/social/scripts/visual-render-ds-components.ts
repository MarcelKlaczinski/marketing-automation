/**
 * Spec 60.0b v2 — Visual harness for DS shared components (DsGlow, DsTop, DsFoot).
 *
 * Renders a representative single-tool-spotlight slide that exercises the target
 * component and diffs against a baseline PNG. Each component gets its own baseline
 * directory so regressions are isolated.
 *
 * Usage (called by visual-ds-components.test.ts):
 *   bun packages/social/scripts/visual-render-ds-components.ts --component=DsGlow
 *   bun packages/social/scripts/visual-render-ds-components.ts --component=DsTop
 *   bun packages/social/scripts/visual-render-ds-components.ts --component=DsFoot
 *
 * Options:
 *   --update   Re-render and overwrite baselines
 *
 * Exits 0 when all renders are within the 0.1% diff threshold.
 * Exits 1 when no --component is given, when the component is unknown, or when
 * any render exceeds the diff threshold.
 *
 * Baseline directory: test/__baselines__/ds-components/<component>/
 */

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { brandTokensSchema } from "../src/compositions/list-carousel/types.ts";
import { singleToolSpotlightInputSchema } from "../src/compositions/single-tool-spotlight/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_ROOT = resolve(HERE, "../test/__baselines__/ds-components");
const DIFF_THRESHOLD = 0.001; // 0.1%

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const componentArg = process.argv.find(a => a.startsWith("--component="))?.split("=")[1];
const UPDATE = process.argv.includes("--update");

const VALID_COMPONENTS = ["DsGlow", "DsTop", "DsFoot"] as const;
type DsComponent = typeof VALID_COMPONENTS[number];

if (!componentArg || !VALID_COMPONENTS.includes(componentArg as DsComponent)) {
  console.error(`[ds-components] --component must be one of: ${VALID_COMPONENTS.join(", ")}`); // biome-ignore lint/suspicious/noConsoleLog: script output
  process.exit(1);
}
const component = componentArg as DsComponent;

// ---------------------------------------------------------------------------
// Render-server (dynamic import to keep Remotion out of cold boot)
// ---------------------------------------------------------------------------

type RS = {
  renderSingleToolSpotlight: (i: Record<string, unknown>) => Promise<{ slides: Buffer[] }>;
};

async function getRs(): Promise<RS> {
  return (await import("../render-server.ts")) as unknown as RS;
}

// ---------------------------------------------------------------------------
// Fixture: representative single-tool-spotlight slide per component
//
// DsGlow  — rendered on every slide; use the body slide (most prominent glow)
// DsTop   — the eyebrow + counter row; use the cover slide (header always visible)
// DsFoot  — the logo + CTA row; use the end slide (footer is the focal point)
//
// Each fixture produces 2 PNGs (dark + light).
// ---------------------------------------------------------------------------

const DEFAULT_BRAND = brandTokensSchema.parse({});
const THEMES = ["dark", "light"] as const;

const BODY_FIXTURE = singleToolSpotlightInputSchema.parse({
  slideIndex: 1,
  slideTotal: 3,
  cover: null,
  body: {
    eyebrow: "Deep Dive · Tool-Portrait",
    headerNum: "Test 04/2026 · Midjourney",
    slideIndex: 1,
    slideTotal: 3,
    tool: { logo: "", name: "Midjourney", version: "v7 · Premium-Ästhetik", isLive: true },
    verdictQuote: "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen.",
    score: 92,
    scoreLabel: "Top Aesthetic",
    facts: [
      { key: "Pricing",    value: "Ab 10 $/Mo" },
      { key: "Standard",   value: "30 $ · 15h GPU" },
      { key: "Für wen",    value: "Marketing" },
      { key: "Commercial", value: "Ab Basic" },
    ],
    strengths: [
      "Ästhetik out-of-the-box auf Stockfoto-Niveau.",
      "--sref für konsistenten Brand-Look.",
      "Subtile Hauttöne, anspruchsvolles Licht.",
      "API seit v6.1 für Studio-Pipelines.",
    ],
    weaknesses: [
      "Text im Bild bleibt schwach (→ Ideogram).",
      "Schwer aus dem MJ-Look auszubrechen.",
      "--cref max. 85 % Charakter-Ähnlichkeit.",
      "Komposition kippt aus Stil-Bias.",
    ],
    footer: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
  },
  end: null,
  theme: "dark",
  locale: "de",
  brandTokens: DEFAULT_BRAND as Record<string, unknown>,
});

const COVER_FIXTURE = singleToolSpotlightInputSchema.parse({
  slideIndex: 0,
  slideTotal: 3,
  cover: {
    eyebrow: "Deep Dive · Tool-Portrait",
    headerNum: "Mai 2026 · Midjourney",
    heroTitle: "Midjourney",
    kicker:
      "Für Hero-Visuals und Mood-Boards 2026 immer noch ungeschlagen — umfassend getestet.",
    toolLogos: [{ src: "", alt: "Midjourney" }],
    toolsMoreText: "KI-Tool",
    stats: [
      { value: "10$",  label: "Monatlicher Plan" },
      { value: "4.6",  label: "Bewertung · 5.0" },
      { value: "Paid", label: "Preismodell" },
    ],
    byline: {
      initials: "MK",
      name: "Marcel Klaczinski",
      role: "Editor · KI-Tools & Reviews",
      readTime: "8 Min Lesen",
    },
    swipeText: "Swipe für Details",
    footer: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
  },
  body: null,
  end: null,
  theme: "dark",
  locale: "de",
  brandTokens: DEFAULT_BRAND as Record<string, unknown>,
});

const END_FIXTURE = singleToolSpotlightInputSchema.parse({
  slideIndex: 2,
  slideTotal: 3,
  cover: null,
  body: null,
  end: { ctaLine: "Vollständiger Test →", url: "toolwiki.ai/midjourney" },
  theme: "dark",
  locale: "de",
  brandTokens: DEFAULT_BRAND as Record<string, unknown>,
});

/** Map each DS component to the fixture that best showcases it */
const COMPONENT_FIXTURES: Record<DsComponent, typeof BODY_FIXTURE> = {
  DsGlow: BODY_FIXTURE,  // glow most prominent on body slide
  DsTop:  COVER_FIXTURE, // top row (eyebrow + counter) dominant on cover
  DsFoot: END_FIXTURE,   // foot (logo + CTA) is the sole focal element on end slide
};

// ---------------------------------------------------------------------------
// Render + diff helpers (identical pattern to visual-render-all.ts)
// ---------------------------------------------------------------------------

async function renderSlides(
  fixture: typeof BODY_FIXTURE,
  theme: "dark" | "light",
): Promise<Buffer[]> {
  const rs = await getRs();
  const input = { ...(fixture as Record<string, unknown>), theme };
  const { slides } = await rs.renderSingleToolSpotlight(input);
  return slides;
}

function pixelDiffRatio(a: Buffer, b: Buffer): number {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) return 1;
  const total = imgA.width * imgA.height;
  const diff = pixelmatch(imgA.data, imgB.data, null, imgA.width, imgA.height, { threshold: 0.1 });
  return diff / total;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const baselineDir = resolve(BASELINE_ROOT, component);
  await mkdir(baselineDir, { recursive: true });

  const fixture = COMPONENT_FIXTURES[component];
  let hasFail = false;

  for (const theme of THEMES) {
    const slides = await renderSlides(fixture, theme);
    if (slides.length === 0) {
      console.error(`[ds-components/${component}] ${theme}: no slides rendered`); // biome-ignore lint/suspicious/noConsoleLog: script output
      hasFail = true;
      continue;
    }

    // Only diff/save slide[0] — we care about component presence, not slide count
    const rendered = slides[0]!;
    const baselinePath = resolve(baselineDir, `${theme}.png`);

    let baselineExists = false;
    try {
      await access(baselinePath);
      baselineExists = true;
    } catch {
      // no baseline yet
    }

    if (!baselineExists || UPDATE) {
      await writeFile(baselinePath, rendered);
      const action = !baselineExists ? "written" : "updated";
      console.log(`[ds-components/${component}] ${theme}: baseline ${action}`); // biome-ignore lint/suspicious/noConsoleLog: script output
      continue;
    }

    const baseline = await readFile(baselinePath);
    const ratio = pixelDiffRatio(rendered, baseline);
    const pct = (ratio * 100).toFixed(3);

    if (ratio > DIFF_THRESHOLD) {
      console.error(`[ds-components/${component}] ${theme}: DIFF ${pct}% > ${DIFF_THRESHOLD * 100}% threshold`); // biome-ignore lint/suspicious/noConsoleLog: script output
      hasFail = true;
    } else {
      console.log(`[ds-components/${component}] ${theme}: OK (${pct}% diff)`); // biome-ignore lint/suspicious/noConsoleLog: script output
    }
  }

  process.exit(hasFail ? 1 : 0);
}

await main();
