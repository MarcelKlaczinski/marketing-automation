/**
 * Brand-asset-service integration tests (Spec 51).
 *
 * Uses a real DB connection. Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, projectBrandAssets, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import {
  getBrandTokens,
  resolveLogo,
  resolveToolIcon,
  getProjectAssets,
  upsertBrandAsset,
} from "../../src/lib/brand-asset-service.ts";

describe("brand-asset-service", () => {
  let projectId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `brand-asset-test-${Date.now()}`,
        name: "Brand Asset Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
        brandTokens: {
          colors: {
            primary: "oklch(64% 0.16 248)",
            primaryHue: 248,
            accent: "oklch(72% 0.15 168)",
            surface: "#ffffff",
            surfaceDark: "oklch(16% 0.02 250)",
            ink: "oklch(20% 0.025 250)",
            inkMuted: "oklch(45% 0.025 250)",
            wikiCream: "#fef9ec",
          },
          typography: {
            fontFamily: "Inter Variable",
            headingWeight: 800,
            bodyWeight: 400,
            eyebrowLetterSpacing: "0.08em",
          },
          voice: {
            locale: "de-DE",
            addressForm: "du",
            forbiddenWords: ["innovativ"],
            signaturePhrases: ["redaktionell verifiziert"],
          },
          social: {
            instagramHandle: "@test.ai",
            websiteUrl: "test.ai",
            logoAssetKey: "main",
          },
        },
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(projectBrandAssets).where(eq(projectBrandAssets.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  describe("getBrandTokens", () => {
    it("returns parsed brand tokens for a project", async () => {
      const tokens = await getBrandTokens(projectId);
      expect(tokens.colors?.primary).toBe("oklch(64% 0.16 248)");
      expect(tokens.colors?.primaryHue).toBe(248);
      expect(tokens.typography?.fontFamily).toBe("Inter Variable");
      expect(tokens.typography?.headingWeight).toBe(800);
      expect(tokens.voice?.locale).toBe("de-DE");
      expect(tokens.social?.instagramHandle).toBe("@test.ai");
    });

    it("throws when project does not exist", async () => {
      await expect(
        getBrandTokens("00000000-0000-0000-0000-000000000000")
      ).rejects.toThrow();
    });
  });

  describe("resolveToolIcon", () => {
    it("returns lobe-icon path for a known tool with DB record", async () => {
      await upsertBrandAsset({
        projectId,
        assetType: "tool_icon",
        assetKey: "claude",
        source: "lobe-icons",
        sourceRef: "claude-color",
        displayName: "Claude",
        metadata: {},
      });

      const icon = await resolveToolIcon(projectId, "claude", "dark");
      // claude has lobe-icon — should return a file path
      expect(icon.type).toBe("path");
      if (icon.type === "path") {
        expect(icon.filePath).toInclude("claude");
        expect(icon.filePath).toEndWith(".png");
      }
    });

    it("returns inline-svg for asset with source=inline-svg", async () => {
      const testSvg = "<svg><circle r='10'/></svg>";
      await upsertBrandAsset({
        projectId,
        assetType: "tool_icon",
        assetKey: "my-custom-tool",
        source: "inline-svg",
        inlineSvg: testSvg,
        displayName: "My Custom Tool",
        metadata: {},
      });

      const icon = await resolveToolIcon(projectId, "my-custom-tool");
      expect(icon.type).toBe("svg");
      if (icon.type === "svg") {
        expect(icon.svg).toBe(testSvg);
      }
    });

    it("returns deterministic avatar for an unmapped tool", async () => {
      const icon = await resolveToolIcon(projectId, "zzz-nonexistent-tool-xyz");
      expect(icon.type).toBe("avatar");
      if (icon.type === "avatar") {
        expect(icon.initials).toBe("ZZ");
        expect(icon.hue).toBeGreaterThanOrEqual(0);
        expect(icon.hue).toBeLessThan(360);
      }
    });

    it("produces consistent hue for the same slug", async () => {
      const icon1 = await resolveToolIcon(projectId, "zzz-nonexistent-tool-xyz");
      const icon2 = await resolveToolIcon(projectId, "zzz-nonexistent-tool-xyz");
      if (icon1.type === "avatar" && icon2.type === "avatar") {
        expect(icon1.hue).toBe(icon2.hue);
      }
    });
  });

  describe("resolveLogo", () => {
    it("returns wordmark from DB record", async () => {
      await upsertBrandAsset({
        projectId,
        assetType: "logo",
        assetKey: "main",
        source: "wordmark",
        sourceRef: "test.ai",
        displayName: "test.ai Wordmark",
        metadata: {},
      });

      const logo = await resolveLogo(projectId);
      expect(logo.type).toBe("wordmark");
      if (logo.type === "wordmark") {
        expect(logo.text).toBe("test.ai");
      }
    });

    it("falls back to websiteUrl wordmark when no logo asset exists", async () => {
      // Delete any existing logo asset first
      await db
        .delete(projectBrandAssets)
        .where(
          eq(projectBrandAssets.projectId, projectId)
        );

      const logo = await resolveLogo(projectId);
      // brandTokens.social.websiteUrl = "test.ai"
      expect(logo.type).toBe("wordmark");
      if (logo.type === "wordmark") {
        expect(logo.text).toBe("test.ai");
      }
    });

    it("returns svg for logo with source=inline-svg", async () => {
      const testSvg = "<svg><text>TW</text></svg>";
      await upsertBrandAsset({
        projectId,
        assetType: "logo",
        assetKey: "main",
        source: "inline-svg",
        inlineSvg: testSvg,
        displayName: "SVG Logo",
        metadata: {},
      });

      const logo = await resolveLogo(projectId);
      expect(logo.type).toBe("svg");
      if (logo.type === "svg") {
        expect(logo.svg).toBe(testSvg);
      }
    });
  });

  describe("getProjectAssets", () => {
    it("returns all assets for a project", async () => {
      const assets = await getProjectAssets(projectId);
      expect(assets.length).toBeGreaterThan(0);
    });

    it("filters by asset type", async () => {
      const icons = await getProjectAssets(projectId, "tool_icon");
      expect(icons.every((a) => a.assetType === "tool_icon")).toBe(true);
    });
  });
});
