/// <reference path="./culori.d.ts" />
import { wcagContrast, parse } from "culori";
import type { BrandTokens } from "../compositions/list-carousel/types.ts";

export type ContrastViolation = {
  field: string;
  background: string;
  ratio: number;
  required: number;
  message: string;
};

type CheckPair = {
  // fg/bg can be undefined for deprecated optional fields — loop skips those pairs
  fg: string | undefined;
  bg: string | undefined;
  field: string;
  bgName: string;
  required: number;
};

export function validateBrandTokenContrast(tokens: BrandTokens): ContrastViolation[] {
  const violations: ContrastViolation[] = [];
  const c = tokens.colors;

  const pairs: CheckPair[] = [
    // eyebrowColor + surfaceSecondary are deprecated optional fields (Spec 60.0); skip when absent
    { fg: c.eyebrowColor,    bg: c.surfaceDark,      field: "eyebrowColor",    bgName: "surfaceDark",      required: 3.0 },
    { fg: c.ink,             bg: c.surfaceDark,      field: "ink",             bgName: "surfaceDark",      required: 4.5 },
    { fg: c.inkMuted,        bg: c.surfaceDark,      field: "inkMuted",        bgName: "surfaceDark",      required: 4.5 },
    { fg: c.primary,         bg: c.surfaceDark,      field: "primary",         bgName: "surfaceDark",      required: 3.0 },
    { fg: c.accent,          bg: c.surfaceDark,      field: "accent",          bgName: "surfaceDark",      required: 3.0 },
    { fg: c.ink,             bg: c.surfaceSecondary, field: "ink",             bgName: "surfaceSecondary", required: 4.5 },
    { fg: c.pricingFree,     bg: c.surfaceDark,      field: "pricingFree",     bgName: "surfaceDark",      required: 3.0 },
    { fg: c.pricingFreemium, bg: c.surfaceDark,      field: "pricingFreemium", bgName: "surfaceDark",      required: 3.0 },
    { fg: c.pricingPaid,     bg: c.surfaceDark,      field: "pricingPaid",     bgName: "surfaceDark",      required: 3.0 },
  ];

  for (const pair of pairs) {
    if (!pair.fg || !pair.bg) continue;
    const fgParsed = parse(pair.fg);
    const bgParsed = parse(pair.bg);
    // parse() returns undefined for unrecognized formats; culori v4 supports oklch natively
    if (!fgParsed || !bgParsed) continue;

    const ratio = wcagContrast(fgParsed, bgParsed);
    if (ratio < pair.required) {
      violations.push({
        field: `colors.${pair.field}`,
        background: pair.bgName,
        ratio: Math.round(ratio * 100) / 100,
        required: pair.required,
        message: `Contrast ${pair.field} vs ${pair.bgName} is ${ratio.toFixed(2)}, needs >= ${pair.required}`,
      });
    }
  }

  return violations;
}
