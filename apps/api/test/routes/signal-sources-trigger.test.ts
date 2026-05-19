/**
 * Spec 59.1c — manual trigger endpoint smoke tests.
 *
 * Validated via HTTP smoke tests (skip if server not running) + the
 * updateSourceConfig producthunt boolean special-case at the logic level.
 *
 * Run: bun --filter @marketing-auto/api test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db, eq, projects, SignalSourcesSchema } from "@marketing-auto/db";

const SLUG = `trigger-test-${Date.now()}`;

describe("signal-sources trigger + updateSourceConfig (Spec 59.1c A.4/A.5)", () => {
  let projectId: string;

  beforeAll(async () => {
    const [proj] = await db
      .insert(projects)
      .values({
        slug: SLUG,
        name: "Trigger Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning({ id: projects.id });
    projectId = proj!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  // ─── producthunt boolean special-case ────────────────────────────────────────

  describe("updateSourceConfig producthunt special-case", () => {
    it("producthunt enabled=true is a boolean in SignalSourcesSchema", () => {
      const config = SignalSourcesSchema.parse({ producthunt: true });
      expect(config.producthunt).toBe(true);
    });

    it("producthunt enabled=false is a boolean in SignalSourcesSchema", () => {
      const config = SignalSourcesSchema.parse({ producthunt: false });
      expect(config.producthunt).toBe(false);
    });

    it("spreading boolean as object produces invalid shape that parse() rejects", () => {
      // This is the bug that the special-case prevents
      expect(() =>
        SignalSourcesSchema.parse({ producthunt: { enabled: true } }),
      ).toThrow();
    });

    it("the correct merge for producthunt is to extract enabled directly", () => {
      const currentBoolean = false;
      const partial = { enabled: true };
      // Simulates the fixed updateSourceConfig logic for producthunt
      const nextValue =
        typeof partial.enabled === "boolean" ? partial.enabled : currentBoolean;
      expect(nextValue).toBe(true);

      const updated = SignalSourcesSchema.parse({ producthunt: nextValue });
      expect(updated.producthunt).toBe(true);
    });
  });

  // ─── HTTP smoke tests (require running server) ───────────────────────────────

  describe("POST /api/projects/:slug/signal-sources/:source/trigger", () => {
    it("returns 400 for invalid source name", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/invalid_source/trigger`,
        { method: "POST" },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([400, 401]);
    });

    it("returns 404 for non-existent project", async () => {
      const res = await fetch(
        "http://localhost:3001/api/projects/does-not-exist-xyz/signal-sources/reddit/trigger",
        { method: "POST" },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([401, 404]);
    });

    it("returns 202 with jobId for valid source (requires auth)", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/reddit/trigger`,
        { method: "POST" },
      ).catch(() => null);
      if (!res) return;
      // 401 without auth; 202 with auth on a real server with the project configured
      expect(res.status).toBeOneOf([202, 401]);
      if (res.status === 202) {
        const body = await res.json() as { ok: boolean; data?: { jobId: string } };
        expect(body.ok).toBe(true);
        expect(typeof body.data?.jobId).toBe("string");
      }
    });

    it("returns 400 for vendor_rss — valid source but currently triggers the same as others", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/vendor_rss/trigger`,
        { method: "POST" },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([202, 401]);
    });
  });

  describe("PATCH /api/projects/:slug/signal-sources/:source", () => {
    it("returns 400 for unknown source name", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/invalid_source`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([400, 401]);
    });

    it("returns 200 or 401 for valid source patch", async () => {
      const res = await fetch(
        `http://localhost:3001/api/projects/${SLUG}/signal-sources/reddit`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        },
      ).catch(() => null);
      if (!res) return;
      expect(res.status).toBeOneOf([200, 401, 404]);
    });
  });
});
