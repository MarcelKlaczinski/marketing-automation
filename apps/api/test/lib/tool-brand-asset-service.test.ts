/**
 * Spec 65.2 — tool-brand-asset service smoke tests.
 *
 * Covers the validation rules on `uploadCustomLogo` (SVG sniff + 100KB cap)
 * and the avatar-fallback shape. The chain-hit happy path is exercised
 * end-to-end by the backfill-script smoke + the API-route smoke; mocking the
 * pipelines `resolveToolIcon` here would duplicate that coverage.
 */
import { describe, expect, it } from "bun:test";
import {
  MAX_LOGO_BYTES,
  uploadCustomLogo,
} from "../../src/lib/tool-brand-asset-service.ts";

describe("uploadCustomLogo validation (Spec 65.2)", () => {
  it("rejects non-SVG body", async () => {
    await expect(
      uploadCustomLogo({
        toolId: "00000000-0000-0000-0000-000000000001",
        projectSlug: "test",
        svgContent: "<html>not svg</html>",
      }),
    ).rejects.toThrow(/valid SVG/);
  });

  it("rejects empty body", async () => {
    await expect(
      uploadCustomLogo({
        toolId: "00000000-0000-0000-0000-000000000001",
        projectSlug: "test",
        svgContent: "",
      }),
    ).rejects.toThrow(/valid SVG/);
  });

  it("rejects body over 100KB cap", async () => {
    const oversized = `<svg>${"x".repeat(MAX_LOGO_BYTES + 1)}</svg>`;
    await expect(
      uploadCustomLogo({
        toolId: "00000000-0000-0000-0000-000000000001",
        projectSlug: "test",
        svgContent: oversized,
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it("accepts well-formed SVG within cap (local R2 fallback)", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    const result = await uploadCustomLogo({
      toolId: "00000000-0000-0000-0000-000000000099",
      projectSlug: "test-spec-65-2",
      svgContent: svg,
    });
    expect(result.logoR2Key).toBe("test-spec-65-2/tool-brand-assets/00000000-0000-0000-0000-000000000099.svg");
    expect(typeof result.logoUrl).toBe("string");
    expect(result.logoUrl.length).toBeGreaterThan(0);
  });

  it("accepts SVG with XML declaration prefix", async () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const result = await uploadCustomLogo({
      toolId: "00000000-0000-0000-0000-000000000098",
      projectSlug: "test-spec-65-2",
      svgContent: svg,
    });
    expect(result.logoR2Key).toContain("test-spec-65-2/tool-brand-assets/");
  });
});
