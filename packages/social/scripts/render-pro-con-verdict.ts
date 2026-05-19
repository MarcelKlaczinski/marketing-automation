/**
 * Spec 59.3 Section A acceptance helper.
 *
 * Renders all 5 slides × 3 fixtures × 2 themes (dark + light) = 30 PNGs.
 *
 * Usage:
 *   bun packages/social/scripts/render-pro-con-verdict.ts [outDir]
 *
 * outDir defaults to /tmp/spec-59.3-pro-con-verdict
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderProConVerdict } from "../render-server.ts";
import { proConVerdictInputSchema } from "../src/compositions/pro-con-verdict/types.ts";
import type { ProConVerdictInput } from "../src/compositions/pro-con-verdict/types.ts";

const outDir = resolve(process.argv[2] ?? "/tmp/spec-59.3-pro-con-verdict");
await mkdir(outDir, { recursive: true });

const SLIDE_NAMES = ["cover", "pros", "cons", "verdict", "end"];
const THEMES = ["dark", "light"] as const;

type FixtureDef = { name: string; input: Omit<ProConVerdictInput, "theme"> };

const fixtures: FixtureDef[] = [
  {
    name: "characteristic",
    input: {
      slideIndex: 0,
      locale: "de",
      brandTokens: {} as never,
      totalSlides: 5,
      tool: { name: "Loom" },
      pros: [
        "Async-Video direkt im Browser, kein Schnitt nötig",
        "Auto-Transkription in 50+ Sprachen",
        "Integriert sich in Slack, Notion, Linear",
        "Saubere Sharing-Links statt Datei-Anhänge",
      ],
      cons: [
        "Free-Tier auf 5 Min/Video begrenzt",
        "Editor schwach für längere Tutorials",
        "Keine echte Live-Recording-Option",
      ],
      verdict: {
        snippet: "Solide für schnelle Async-Updates, schwach für Tutorial-Macher",
        whenToUse:
          "Wenn du regelmäßig kurze Status-Videos für Teams brauchst und Slack-Integration zentral ist. Loom glänzt bei 1-5 Min Clips ohne Schnitt.",
        whenToSkip:
          "Wenn du längere strukturierte Tutorials produzierst oder Live-Streaming brauchst. ScreenStudio oder OBS sind hier deutlich besser.",
      },
    },
  },
  {
    name: "edge-min",
    input: {
      slideIndex: 0,
      locale: "en",
      brandTokens: {} as never,
      totalSlides: 5,
      tool: { name: "Tool X" },
      pros: ["Pro one here", "Pro two here", "Pro three here"],
      cons: ["Con one here", "Con two here", "Con three here"],
      verdict: {
        snippet: "Decent for X, weak for Y",
        whenToUse: "Use it for A. Skip if you need B.",
        whenToSkip: "Skip if you need C. Look at D instead for that case.",
      },
    },
  },
  {
    name: "edge-max",
    input: {
      slideIndex: 0,
      locale: "en",
      brandTokens: {} as never,
      totalSlides: 5,
      tool: { name: "Maximum Length Tool Name That Tests Layout" },
      pros: [
        "First pro at maximum allowed character count — testing wrapping at the upper bound",
        "Second pro at maximum allowed character count — testing wrapping at the upper bound",
        "Third pro at maximum allowed character count — testing wrapping at the upper bound",
        "Fourth pro at maximum allowed character count — testing wrapping at upper bound",
        "Fifth pro at maximum allowed character count — testing wrapping at the upper bound",
      ],
      cons: [
        "First con at maximum allowed character count — testing wrapping at the upper bound",
        "Second con at maximum allowed character count — testing wrapping at the upper bound",
        "Third con at maximum allowed character count — testing wrapping at the upper bound",
        "Fourth con at maximum allowed character count — testing wrapping at upper bound",
        "Fifth con at maximum allowed character count — testing wrapping at the upper bound",
      ],
      verdict: {
        snippet: "Solid for serious teams that have specific advanced workflow requirements",
        whenToUse:
          "When you need a deep workflow integration with specific advanced requirements. Best for established teams with clear processes and real budget.",
        whenToSkip:
          "If you're a solo founder or small team without complex workflow needs. The setup overhead and pricing make it overkill — try simpler alternatives.",
      },
    },
  },
];

let totalRendered = 0;

for (const theme of THEMES) {
  console.log(`\n══ Theme: ${theme.toUpperCase()} ══`);
  for (const fixture of fixtures) {
    console.log(`\n  ▶ ${fixture.name}`);
    const input = proConVerdictInputSchema.parse({ ...fixture.input, theme });
    const { slides } = await renderProConVerdict(input);
    console.log(`    → ${slides.length} slides`);

    for (let i = 0; i < slides.length; i++) {
      const slideName = SLIDE_NAMES[i] ?? `slide-${i}`;
      const filename = `${theme}--${fixture.name}--${String(i + 1).padStart(2, "0")}-${slideName}.png`;
      const outPath = resolve(outDir, filename);
      await writeFile(outPath, slides[i]!);
      console.log(`    ✓ ${filename}`);
      totalRendered++;
    }
  }
}

console.log(`\n✅ Done — ${totalRendered} PNGs written to ${outDir}`);
console.log(`   open "${outDir}"`);
