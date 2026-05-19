/**
 * Unit tests for the 0042 brand_tokens data-migration transform (Spec 60.0).
 * These run without a DB connection — pure function tests.
 */

import { describe, it, expect } from "bun:test";
import {
  transformBrandTokens,
  extractHueFromOklch,
} from "../../migrations/scripts/0042-brand-tokens-schema-sync.ts";
import { brandTokensSchema } from "@marketing-auto/shared/brand-tokens";

describe("extractHueFromOklch", () => {
  it("extracts hue from oklch(L% C H)", () => {
    expect(extractHueFromOklch("oklch(64% 0.16 248)")).toBe(248);
    expect(extractHueFromOklch("oklch(72% 0.15 168)")).toBe(168);
    expect(extractHueFromOklch("oklch(64% 0.16 200)")).toBe(200);
  });

  it("returns null for non-oklch values", () => {
    expect(extractHueFromOklch("#ff0000")).toBeNull();
    expect(extractHueFromOklch("rgb(255,0,0)")).toBeNull();
    expect(extractHueFromOklch(undefined)).toBeNull();
    expect(extractHueFromOklch("")).toBeNull();
  });

  it("handles decimal hue values", () => {
    expect(extractHueFromOklch("oklch(64% 0.16 248.5)")).toBe(248.5);
  });
});

describe("transformBrandTokens", () => {
  it("renames primaryHue → brandHue when brandHue absent", () => {
    const input = { colors: { primaryHue: 248 } };
    const out = transformBrandTokens(input);
    expect((out.colors as Record<string, unknown>).brandHue).toBe(248);
  });

  it("does NOT overwrite existing brandHue when primaryHue also present", () => {
    const input = { colors: { primaryHue: 100, brandHue: 300 } };
    const out = transformBrandTokens(input);
    expect((out.colors as Record<string, unknown>).brandHue).toBe(300);
  });

  it("derives brandHue from primary oklch when neither hue field is set", () => {
    const input = { colors: { primary: "oklch(64% 0.16 200)" } };
    const out = transformBrandTokens(input);
    expect((out.colors as Record<string, unknown>).brandHue).toBe(200);
  });

  it("falls back to default brandHue (248) when primary is a hex value", () => {
    const input = { colors: { primary: "#4F6FE5" } };
    const out = transformBrandTokens(input);
    expect((out.colors as Record<string, unknown>).brandHue).toBe(248);
  });

  it("derives accentHue from accent oklch string", () => {
    const input = { colors: { accent: "oklch(72% 0.15 168)" } };
    const out = transformBrandTokens(input);
    expect((out.colors as Record<string, unknown>).accentHue).toBe(168);
  });

  it("falls back to default accentHue (168) when accent is absent", () => {
    const input = {};
    const out = transformBrandTokens(input);
    expect((out.colors as Record<string, unknown>).accentHue).toBe(168);
  });

  it("drops all deprecated DB-only typography fields", () => {
    const input = {
      typography: {
        fontFamily: "Inter Variable",
        fontFamilyOptions: ["Inter Variable", "Space Grotesk"],
        headingWeight: 800,
        bodyWeight: 400,
        eyebrowWeight: 700,
        captionWeight: 600,
        eyebrowLetterSpacing: "0.08em",
        headingLetterSpacing: "-0.02em",
        bodyLetterSpacing: "0em",
        headingSize: 64,
        subheadSize: 32,
        bodySize: 24,
        eyebrowSize: 18,
        headingLineHeight: 1.1,
        bodyLineHeight: 1.5,
      },
    };
    const out = transformBrandTokens(input);
    const typo = out.typography as Record<string, unknown>;
    // These canonical fields survive
    expect(typo.fontFamily).toBe("Inter Variable");
    expect(typo.headingWeight).toBe(800);
    // These DB-only fields are dropped
    expect(typo.fontFamilyOptions).toBeUndefined();
    expect(typo.eyebrowWeight).toBeUndefined();
    expect(typo.captionWeight).toBeUndefined();
    expect(typo.headingLetterSpacing).toBeUndefined();
    expect(typo.bodyLetterSpacing).toBeUndefined();
    expect(typo.headingSize).toBeUndefined();
    expect(typo.subheadSize).toBeUndefined();
    expect(typo.bodySize).toBeUndefined();
    expect(typo.eyebrowSize).toBeUndefined();
    expect(typo.headingLineHeight).toBeUndefined();
    expect(typo.bodyLineHeight).toBeUndefined();
  });

  it("normalises invalid addressForm to 'du'", () => {
    const input = { voice: { addressForm: "ihr" } };
    const out = transformBrandTokens(input);
    expect((out.voice as Record<string, unknown>).addressForm).toBe("du");
  });

  it("preserves valid addressForm values", () => {
    expect(
      (transformBrandTokens({ voice: { addressForm: "du" } }).voice as Record<string, unknown>).addressForm,
    ).toBe("du");
    expect(
      (transformBrandTokens({ voice: { addressForm: "Sie" } }).voice as Record<string, unknown>).addressForm,
    ).toBe("Sie");
  });

  it("is idempotent — parsed result is identical after two transforms", () => {
    const input = {
      colors: { primaryHue: 248, primary: "oklch(64% 0.16 248)", accent: "oklch(72% 0.15 168)" },
      typography: {
        fontFamily: "Inter Variable",
        fontFamilyOptions: ["Inter Variable"],
        headingWeight: 800,
        bodyLineHeight: 1.5,
      },
    };
    const out1 = transformBrandTokens(input);
    const out2 = transformBrandTokens(out1);
    // Compare via canonical parse to match the migration's actual idempotency check
    expect(JSON.stringify(brandTokensSchema.parse(out2))).toBe(
      JSON.stringify(brandTokensSchema.parse(out1)),
    );
  });

  it("produces output that parses cleanly against brandTokensSchema", () => {
    const messyInput = {
      colors: {
        primaryHue: 100,
        primary: "oklch(64% 0.16 100)",
        accent: "oklch(72% 0.15 168)",
        surface: "#ffffff",
      },
      typography: {
        fontFamily: "Inter Variable",
        fontFamilyOptions: ["Inter Variable", "Roboto"],
        headingWeight: 800,
        eyebrowWeight: 700,
        headingSize: 64,
        bodyLineHeight: 1.5,
      },
      voice: { locale: "de-DE", addressForm: "du" },
      social: { instagramHandle: "@test.ai" },
      bogusTopLevel: "ignored",
    };
    const out = transformBrandTokens(messyInput);
    expect(() => brandTokensSchema.parse(out)).not.toThrow();
  });

  it("handles completely empty input without throwing", () => {
    const out = transformBrandTokens({});
    expect(() => brandTokensSchema.parse(out)).not.toThrow();
    const parsed = brandTokensSchema.parse(out);
    expect(parsed.colors.brandHue).toBe(248);
    expect(parsed.colors.accentHue).toBe(168);
  });
});
