/**
 * Spec 60.0c Section F.2 — REMOTION.md drift detector.
 *
 * Parses field-length budgets from the authoritative REMOTION.md in the
 * toolwiki-design skill and verifies they match the *Bounds objects in code.
 *
 * If Claude Design re-exports an updated bundle and REMOTION.md changes, this
 * test fails, prompting the implementer to update the *Bounds constants.
 *
 * The regex-based parser is intentionally simple — REMOTION.md's format is
 * stable and machine-generated. If the format changes, update the helpers here.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { comparisonGrid4Bounds } from "../src/templates/definitions/comparisonGrid4";
import { comparisonGrid3Bounds } from "../src/templates/definitions/comparisonGrid3";
import { verdictPerUseCaseBounds } from "../src/templates/definitions/verdictPerUseCase";
import { singleToolSpotlightBounds, coverBounds } from "../src/templates/definitions/singleToolSpotlight";

const REMOTION_MD_PATH = join(
  import.meta.dir,
  "../../../.claude/skills/toolwiki-design/REMOTION.md",
);

/**
 * Extract the section of REMOTION.md between `### \`sectionName\`` and the
 * next `### ` heading (or end of file). Returns the section text.
 */
function extractSection(md: string, sectionName: string): string {
  const start = md.indexOf(`### \`${sectionName}\``);
  if (start === -1) return "";
  const afterStart = md.slice(start + sectionName.length + 5);
  const nextSection = afterStart.indexOf("\n### ");
  return nextSection === -1 ? afterStart : afterStart.slice(0, nextSection);
}

function parseFieldBudget(
  section: string,
  fieldName: string,
): { min: number; max: number } | null {
  // Matches: fieldName: string; // min N, max N — (rest)
  const pattern = new RegExp(
    `${fieldName}:\\s*string;\\s*\\/\\/\\s*min\\s*(\\d+),\\s*max\\s*(\\d+)`,
  );
  const match = section.match(pattern);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

describe("*Bounds match REMOTION.md field-length budgets", () => {
  const remotionMd = readFileSync(REMOTION_MD_PATH, "utf-8");

  it("REMOTION.md is readable and non-empty", () => {
    expect(remotionMd.length).toBeGreaterThan(100);
    expect(remotionMd).toContain("Grid4Props");
    expect(remotionMd).toContain("Grid3Props");
    expect(remotionMd).toContain("VerdictProps");
    expect(remotionMd).toContain("SpotlightProps");
    expect(remotionMd).toContain("CoverProps");
  });

  describe("comparison-grid-4 (Grid4Props)", () => {
    const grid4 = extractSection(remotionMd, "comparison-grid-4");

    it("eyebrow min/max", () => {
      const budget = parseFieldBudget(grid4, "eyebrow");
      expect(budget).not.toBeNull();
      expect(comparisonGrid4Bounds.eyebrow.min).toBe(budget!.min);
      expect(comparisonGrid4Bounds.eyebrow.max).toBe(budget!.max);
    });

    it("heroTitle min/max", () => {
      const budget = parseFieldBudget(grid4, "heroTitle");
      expect(budget).not.toBeNull();
      expect(comparisonGrid4Bounds.heroTitle.min).toBe(budget!.min);
      expect(comparisonGrid4Bounds.heroTitle.max).toBe(budget!.max);
    });

    it("heroSub min/max", () => {
      const budget = parseFieldBudget(grid4, "heroSub");
      expect(budget).not.toBeNull();
      expect(comparisonGrid4Bounds.heroSub.min).toBe(budget!.min);
      expect(comparisonGrid4Bounds.heroSub.max).toBe(budget!.max);
    });

    it("tools.verdict min/max", () => {
      const match = grid4.match(
        /verdict:\s*string;\s*\/\/\s*min\s*(\d+),\s*max\s*(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(comparisonGrid4Bounds.tools.verdict.min).toBe(Number(match![1]));
      expect(comparisonGrid4Bounds.tools.verdict.max).toBe(Number(match![2]));
    });

    it("footer.ctaLine min/max", () => {
      const match = grid4.match(
        /ctaLine:\s*string;\s*\/\/\s*min\s*(\d+),\s*max\s*(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(comparisonGrid4Bounds.footer.ctaLine.min).toBe(Number(match![1]));
      expect(comparisonGrid4Bounds.footer.ctaLine.max).toBe(Number(match![2]));
    });
  });

  describe("comparison-grid-3 (Spec 65.7 multi-slide carousel)", () => {
    const grid3 = extractSection(remotionMd, "comparison-grid-3");
    const grid3Bounds = comparisonGrid3Bounds as {
      cover: { subline: { min: number; max: number } };
      compareHeader: { criteria: { each: { min: number; max: number } } };
      tools: { count: number; pros: { each: { min: number; max: number } } };
      verdict: { reasoning: { min: number; max: number } };
    };

    it("REMOTION.md section is multi-slide (7 slides)", () => {
      expect(grid3).toContain("MULTI-SLIDE");
      expect(grid3).toContain("slideTotal: number;");
      expect(grid3).toContain("Cover → Compare-Header → 3 Tools → Verdict → End");
    });

    it("cover.subline min/max", () => {
      // REMOTION.md inline shape with subline budget
      const match = grid3.match(/subline:\s+string;\s*\/\/\s*min\s+(\d+),\s+max\s+(\d+)/);
      expect(match).toBeTruthy();
      expect(grid3Bounds.cover.subline.min).toBe(Number(match![1]));
      expect(grid3Bounds.cover.subline.max).toBe(Number(match![2]));
    });

    it("tools.length is exactly 3", () => {
      expect(grid3Bounds.tools.count).toBe(3);
      expect(grid3).toContain("EXACTLY 3 entries");
    });

    it("verdict.reasoning min/max", () => {
      const match = grid3.match(/reasoning:\s+string;\s*\/\/\s*min\s+(\d+),\s+max\s+(\d+)/);
      expect(match).toBeTruthy();
      expect(grid3Bounds.verdict.reasoning.min).toBe(Number(match![1]));
      expect(grid3Bounds.verdict.reasoning.max).toBe(Number(match![2]));
    });

    it("compare-header criteria each min/max", () => {
      // "criteria: string[];        // 2-5 entries; each min 4, max 40"
      const match = grid3.match(
        /criteria:\s*string\[\];\s*\/\/\s*\d+[-–]\d+\s+entries;\s+each\s+min\s+(\d+),\s+max\s+(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(grid3Bounds.compareHeader.criteria.each.min).toBe(Number(match![1]));
      expect(grid3Bounds.compareHeader.criteria.each.max).toBe(Number(match![2]));
    });
  });

  describe("comparison-grid-5 (Spec 65.7 multi-slide carousel)", () => {
    const grid5 = extractSection(remotionMd, "comparison-grid-5");

    it("REMOTION.md section is multi-slide (9 slides)", () => {
      expect(grid5).toContain("MULTI-SLIDE");
      expect(grid5).toContain("slideTotal: 9");
      expect(grid5).toContain("EXACTLY 5 entries");
    });
  });

  describe("head-to-head-vs (Spec 65.7 head-to-head carousel)", () => {
    const h2h = extractSection(remotionMd, "head-to-head-vs");

    it("REMOTION.md section is 6 slides + side-by-side compare", () => {
      expect(h2h).toContain("6 slides");
      expect(h2h).toContain("EXACTLY 2 entries");
      expect(h2h).toContain("EXACTLY 3 entries");
      expect(h2h).toMatch(/winner:\s+'a' \| 'b' \| 'tie'/);
    });
  });

  describe("head-to-head-deep-dive (Spec 65.7 deep-dive carousel)", () => {
    const dd = extractSection(remotionMd, "head-to-head-deep-dive");

    it("REMOTION.md section is 9 slides + pricing + use-case compare", () => {
      expect(dd).toContain("9 slides");
      expect(dd).toContain("Pricing-compare");
      expect(dd).toContain("Use-case-compare");
      expect(dd).toContain("EXACTLY 2 entries");
      expect(dd).toContain("3-5 entries");
    });
  });

  describe("verdict-per-use-case (VerdictProps)", () => {
    const verdict = extractSection(remotionMd, "verdict-per-use-case");

    it("rows.countMax is 7 (HARD layout bound)", () => {
      expect(verdictPerUseCaseBounds.rows.countMax).toBe(7);
    });

    it("rows.label min/max", () => {
      const match = verdict.match(
        /label:\s*string;\s*\/\/\s*min\s*(\d+),\s*max\s*(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(verdictPerUseCaseBounds.rows.label.min).toBe(Number(match![1]));
      expect(verdictPerUseCaseBounds.rows.label.max).toBe(Number(match![2]));
    });

    it("heroSub min/max", () => {
      const budget = parseFieldBudget(verdict, "heroSub");
      expect(budget).not.toBeNull();
      expect(verdictPerUseCaseBounds.heroSub.min).toBe(budget!.min);
      expect(verdictPerUseCaseBounds.heroSub.max).toBe(budget!.max);
    });
  });

  describe("single-tool-spotlight (SpotlightProps)", () => {
    const spotlight = extractSection(remotionMd, "single-tool-spotlight");

    it("verdictQuote min/max", () => {
      const match = spotlight.match(
        /verdictQuote:\s*string;\s*\/\/\s*min\s*(\d+),\s*max\s*(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(singleToolSpotlightBounds.verdictQuote.min).toBe(Number(match![1]));
      expect(singleToolSpotlightBounds.verdictQuote.max).toBe(Number(match![2]));
    });

    it("strengths each min/max", () => {
      const match = spotlight.match(
        /strengths:\s*string\[\];\s*\/\/\s*(\d+)[–-](\d+)\s*entries;\s*each\s*min\s*(\d+),\s*max\s*(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(singleToolSpotlightBounds.strengths.each.min).toBe(Number(match![3]));
      expect(singleToolSpotlightBounds.strengths.each.max).toBe(Number(match![4]));
    });

    it("strengths countMin is 3 (eligibility gate)", () => {
      expect(singleToolSpotlightBounds.strengths.countMin).toBe(3);
    });

    it("facts.count is exactly 4", () => {
      expect(singleToolSpotlightBounds.facts.count).toBe(4);
    });

    it("tool.name min/max", () => {
      const match = spotlight.match(
        /name:\s*string;\s*\/\/\s*min\s*(\d+),\s*max\s*(\d+)\s*—\s*large display/,
      );
      expect(match).toBeTruthy();
      expect(singleToolSpotlightBounds.tool.name.min).toBe(Number(match![1]));
      expect(singleToolSpotlightBounds.tool.name.max).toBe(Number(match![2]));
    });
  });

  describe("cover (CoverProps — Spec 60.1)", () => {
    const cover = extractSection(remotionMd, "cover");

    it("eyebrow min/max", () => {
      const budget = parseFieldBudget(cover, "eyebrow");
      expect(budget).not.toBeNull();
      expect(coverBounds.eyebrow.min).toBe(budget!.min);
      expect(coverBounds.eyebrow.max).toBe(budget!.max);
    });

    it("heroTitle min/max", () => {
      const budget = parseFieldBudget(cover, "heroTitle");
      expect(budget).not.toBeNull();
      expect(coverBounds.heroTitle.min).toBe(budget!.min);
      expect(coverBounds.heroTitle.max).toBe(budget!.max);
    });

    it("kicker min/max", () => {
      const budget = parseFieldBudget(cover, "kicker");
      expect(budget).not.toBeNull();
      expect(coverBounds.kicker.min).toBe(budget!.min);
      expect(coverBounds.kicker.max).toBe(budget!.max);
    });

    it("swipeText min/max", () => {
      const budget = parseFieldBudget(cover, "swipeText");
      expect(budget).not.toBeNull();
      expect(coverBounds.swipeText.min).toBe(budget!.min);
      expect(coverBounds.swipeText.max).toBe(budget!.max);
    });

    it("stats.count is 3", () => {
      expect(coverBounds.stats.count).toBe(3);
    });

    it("footer.ctaLine min/max", () => {
      const match = cover.match(/ctaLine:\s*string;\s*\/\/\s*min\s*(\d+),\s*max\s*(\d+)/);
      expect(match).toBeTruthy();
      expect(coverBounds.footer.ctaLine.min).toBe(Number(match![1]));
      expect(coverBounds.footer.ctaLine.max).toBe(Number(match![2]));
    });
  });
});
