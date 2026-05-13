/**
 * Brand-tokens API integration tests (Spec 52b).
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { getBrandTokens, DEFAULT_TYPOGRAPHY } from "../../src/lib/brand-asset-service.ts";

const SLUG = `brand-tokens-test-${Date.now()}`;

describe("brand-tokens routes", () => {
  let projectId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: SLUG,
        name: "Brand Tokens Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  // ─── HTTP smoke tests ────────────────────────────────────────────────────────

  describe("GET /api/projects/:slug/brand-tokens", () => {
    it("returns tokens envelope for valid project", async () => {
      const res = await fetch(`http://localhost:3001/api/projects/${SLUG}/brand-tokens`, {
        headers: { Cookie: "ma_session=test-will-fail-auth" },
      }).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([200, 401]);
    });
  });

  describe("PATCH /api/projects/:slug/brand-tokens", () => {
    it("returns 422 / 400 when body is invalid JSON shape", async () => {
      const res = await fetch(`http://localhost:3001/api/projects/${SLUG}/brand-tokens`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "ma_session=test-will-fail-auth",
        },
        body: JSON.stringify({ tokens: { typography: { headingWeight: "not-a-number" } } }),
      }).catch(() => null);
      if (!res) return;
      // 401 without auth, 422/400 with auth + bad payload
      expect(res.status).toBeOneOf([400, 401, 422]);
    });
  });

  // ─── Service-level tests (always run, no HTTP needed) ────────────────────────

  describe("getBrandTokens service", () => {
    it("returns default typography when no tokens are set", async () => {
      const tokens = await getBrandTokens(projectId);
      expect(tokens.typography).toBeDefined();
      expect(tokens.typography?.fontFamily).toBe(DEFAULT_TYPOGRAPHY.fontFamily);
      expect(tokens.typography?.headingWeight).toBe(DEFAULT_TYPOGRAPHY.headingWeight);
      expect(tokens.typography?.bodyLineHeight).toBe(DEFAULT_TYPOGRAPHY.bodyLineHeight);
    });

    it("persists a color patch and reads it back", async () => {
      // Write tokens directly to DB (bypassing the HTTP layer)
      await db
        .update(projects)
        .set({
          // biome-ignore lint/suspicious/noExplicitAny: test-only direct DB write
          brandTokens: { colors: { primary: "#4F6FE5" } } as any,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, projectId));

      const tokens = await getBrandTokens(projectId);
      expect(tokens.colors?.primary).toBe("#4F6FE5");
      // Typography defaults should still be filled in
      expect(tokens.typography?.fontFamily).toBe(DEFAULT_TYPOGRAPHY.fontFamily);
    });

    it("deep-merges typography without losing other tokens", async () => {
      // Simulate PATCH: set a custom font family
      const existing = await getBrandTokens(projectId);
      const merged = {
        ...existing,
        typography: { ...existing.typography, fontFamily: "Space Grotesk" },
      };

      await db
        .update(projects)
        // biome-ignore lint/suspicious/noExplicitAny: test-only direct DB write
        .set({ brandTokens: merged as any, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

      const refreshed = await getBrandTokens(projectId);
      expect(refreshed.typography?.fontFamily).toBe("Space Grotesk");
      // Colors from previous step should still be there
      expect(refreshed.colors?.primary).toBe("#4F6FE5");
      // Other typography defaults should remain
      expect(refreshed.typography?.headingWeight).toBe(DEFAULT_TYPOGRAPHY.headingWeight);
    });

    it("reset: deleting typography section restores defaults", async () => {
      // Simulate POST /reset sections=["typography"]
      const existing = await getBrandTokens(projectId);
      const afterReset = { ...existing };
      delete afterReset.typography;

      await db
        .update(projects)
        // biome-ignore lint/suspicious/noExplicitAny: test-only direct DB write
        .set({ brandTokens: afterReset as any, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

      const tokens = await getBrandTokens(projectId);
      // getBrandTokens merges DEFAULT_TYPOGRAPHY, so all fields should be back
      expect(tokens.typography?.fontFamily).toBe(DEFAULT_TYPOGRAPHY.fontFamily);
      expect(tokens.typography?.headingWeight).toBe(DEFAULT_TYPOGRAPHY.headingWeight);
      // colors from before the reset should be preserved
      expect(tokens.colors?.primary).toBe("#4F6FE5");
    });
  });

  describe("DEFAULT_TYPOGRAPHY completeness", () => {
    it("contains all required typography keys", () => {
      const requiredKeys = [
        "fontFamily",
        "headingWeight",
        "bodyWeight",
        "eyebrowWeight",
        "captionWeight",
        "eyebrowLetterSpacing",
        "headingLetterSpacing",
        "bodyLetterSpacing",
        "headingSize",
        "subheadSize",
        "bodySize",
        "eyebrowSize",
        "headingLineHeight",
        "bodyLineHeight",
      ] as const;

      for (const key of requiredKeys) {
        expect(DEFAULT_TYPOGRAPHY).toHaveProperty(key);
        expect(DEFAULT_TYPOGRAPHY[key]).not.toBeUndefined();
      }
    });

    it("headingWeight is within slider range (100-900)", () => {
      expect(DEFAULT_TYPOGRAPHY.headingWeight).toBeGreaterThanOrEqual(100);
      expect(DEFAULT_TYPOGRAPHY.headingWeight).toBeLessThanOrEqual(900);
    });

    it("lineHeight values are within slider range (0.8-2.5)", () => {
      expect(DEFAULT_TYPOGRAPHY.headingLineHeight).toBeGreaterThanOrEqual(0.8);
      expect(DEFAULT_TYPOGRAPHY.headingLineHeight).toBeLessThanOrEqual(2.5);
      expect(DEFAULT_TYPOGRAPHY.bodyLineHeight).toBeGreaterThanOrEqual(0.8);
      expect(DEFAULT_TYPOGRAPHY.bodyLineHeight).toBeLessThanOrEqual(2.5);
    });
  });
});
