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
import { singleToolSpotlightBounds } from "../src/templates/definitions/singleToolSpotlight";

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

  describe("comparison-grid-3 (Grid3Props)", () => {
    const grid3 = extractSection(remotionMd, "comparison-grid-3");

    it("eyebrow min/max (tighter than grid-4)", () => {
      const budget = parseFieldBudget(grid3, "eyebrow");
      expect(budget).not.toBeNull();
      expect(comparisonGrid3Bounds.eyebrow.min).toBe(budget!.min);
      expect(comparisonGrid3Bounds.eyebrow.max).toBe(budget!.max);
    });

    it("tools.meta min/max", () => {
      const match = grid3.match(
        /meta:\s*string;\s*\/\/\s*min\s*(\d+),\s*max\s*(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(comparisonGrid3Bounds.tools.meta.min).toBe(Number(match![1]));
      expect(comparisonGrid3Bounds.tools.meta.max).toBe(Number(match![2]));
    });

    it("tools.bullets.pros each min/max", () => {
      const match = grid3.match(
        /pros:\s*string\[\];\s*\/\/\s*EXACTLY\s*\d+\s*entries;\s*each\s*min\s*(\d+),\s*max\s*(\d+)/,
      );
      expect(match).toBeTruthy();
      expect(comparisonGrid3Bounds.tools.bullets.pros.each.min).toBe(Number(match![1]));
      expect(comparisonGrid3Bounds.tools.bullets.pros.each.max).toBe(Number(match![2]));
    });

    it("heroSub max for grid-3 is 160 (tighter than grid-4's 180)", () => {
      expect(comparisonGrid3Bounds.heroSub.max).toBe(160);
      expect(comparisonGrid4Bounds.heroSub.max).toBe(180);
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
});
