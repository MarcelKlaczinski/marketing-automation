/**
 * Spec 65.17 B6 — `tool-tier-ranking` mock fixtures.
 *
 * Three canonical fixtures (`characteristic` / `edge-min` / `edge-max`)
 * required by bootstrap's `assertFixtures` check. Tier counts mirror the
 * `deriveTiers` 1/1/1, 1/2/1, 2/2/1 distribution (Spec 65.17 B1).
 */
import type { MockFixtureMap } from "../../types.ts";
import type { TierRankingContext } from "../toolTierRanking.ts";
import type { FamilyATool } from "../../../compositions/_shared/family-a/types.ts";

/** Minimal FamilyATool helper — fills the fields the tier-template ignores. */
function fixtureTool(slug: string, name: string, opts: Partial<FamilyATool> = {}): FamilyATool {
  return {
    slug,
    name,
    score: 0,
    scoreTier: "mid",
    meta: "—",
    pricePrefix: "",
    priceAmount: "—",
    pros: ["—", "—"],
    cons: ["—", "—"],
    isWinner: false,
    ...opts,
  };
}

const characteristic: TierRankingContext = {
  toolNames: [
    "Midjourney",
    "DALL·E 4",
    "Flux 1.1 Pro",
    "Ideogram 2.0",
    "Stable Diffusion",
  ],
  tiers: [
    {
      tier: "spitze",
      label: "Spitze",
      tools: [
        fixtureTool("midjourney", "Midjourney", { iconInitials: "MJ", iconHue: 220, primaryColor: "#7c3aed" }),
        fixtureTool("dalle", "DALL·E 4", { iconInitials: "DE", iconHue: 160, primaryColor: "#10a37f" }),
      ],
    },
    {
      tier: "stark",
      label: "Stark",
      tools: [
        fixtureTool("flux", "Flux 1.1 Pro", { iconInitials: "FL", iconHue: 30, primaryColor: "#ff6b00" }),
        fixtureTool("ideogram", "Ideogram 2.0", { iconInitials: "ID", iconHue: 290, primaryColor: "#d946ef" }),
      ],
    },
    {
      tier: "solide",
      label: "Solide",
      tools: [fixtureTool("stable-diffusion", "Stable Diffusion", { iconInitials: "SD", iconHue: 270 })],
    },
  ],
};

const edgeMin: TierRankingContext = {
  toolNames: ["Tool A", "Tool B", "Tool C"],
  tiers: [
    { tier: "spitze", label: "Spitze", tools: [fixtureTool("tool-a", "Tool A", { iconInitials: "TA", iconHue: 0 })] },
    { tier: "stark", label: "Stark", tools: [fixtureTool("tool-b", "Tool B", { iconInitials: "TB", iconHue: 120 })] },
    { tier: "solide", label: "Solide", tools: [fixtureTool("tool-c", "Tool C", { iconInitials: "TC", iconHue: 240 })] },
  ],
};

const edgeMax: TierRankingContext = {
  toolNames: [
    "Longname-Tool-One",
    "Longname-Tool-Two",
    "Longname-Tool-Three",
    "Longname-Tool-Four",
    "Longname-Tool-Five",
  ],
  tiers: [
    {
      tier: "spitze",
      label: "Spitze",
      tools: [
        fixtureTool("ln-tool-one", "Longname-Tool-One", { iconInitials: "L1", iconHue: 40, primaryColor: "#0ea5e9" }),
        fixtureTool("ln-tool-two", "Longname-Tool-Two", { iconInitials: "L2", iconHue: 80, primaryColor: "#22c55e" }),
      ],
    },
    {
      tier: "stark",
      label: "Stark",
      tools: [
        fixtureTool("ln-tool-three", "Longname-Tool-Three", { iconInitials: "L3", iconHue: 200, primaryColor: "#a855f7" }),
        fixtureTool("ln-tool-four", "Longname-Tool-Four", { iconInitials: "L4", iconHue: 320, primaryColor: "#f59e0b" }),
      ],
    },
    {
      tier: "solide",
      label: "Solide",
      tools: [
        fixtureTool("ln-tool-five", "Longname-Tool-Five", { iconInitials: "L5", iconHue: 100, primaryColor: "#ec4899" }),
      ],
    },
  ],
};

export const TOOL_TIER_RANKING_FIXTURES: MockFixtureMap = {
  characteristic: {
    name: "Tier ranking — characteristic (5 AI image generators, 2/2/1)",
    description: "5-tool tier ranking, balanced terciles, typical brand colors.",
    input: characteristic,
  },
  "edge-min": {
    name: "Tier ranking — edge-min (3 tools, 1/1/1)",
    description: "Minimum 3 tools, one per tier, fallback initials only.",
    input: edgeMin,
  },
  "edge-max": {
    name: "Tier ranking — edge-max (5 tools, 2/2/1, long names)",
    description: "5 tools with long names + saturated brand colors — stresses lane wrapping.",
    input: edgeMax,
  },
};
