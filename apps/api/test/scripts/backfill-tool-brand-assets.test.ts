/**
 * Spec 65.2 — backfill-tool-brand-assets smoke tests.
 *
 * Real DB, mocked resolver. Covers dry-run no-op, apply happy path, project
 * isolation (Memory D26), error tolerance, and per-source counting.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  eq,
  getBrandAssetsForTool,
  projects,
} from "@marketing-auto/db";
import { backfillToolBrandAssets } from "../../src/scripts/backfill-tool-brand-assets.ts";
import type { ResolvedToolBrandAsset } from "../../src/lib/tool-brand-asset-service.ts";

describe("backfillToolBrandAssets (Spec 65.2)", () => {
  let projectId: string;
  let projectSlug: string;
  let toolIds: string[] = [];

  beforeAll(async () => {
    const ts = Date.now();
    projectSlug = `tba-backfill-${ts}`;
    const [project] = await db
      .insert(projects)
      .values({
        slug: projectSlug,
        name: "Backfill Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!project) throw new Error("project INSERT failed");
    projectId = project.id;

    // Seed 4 tool-articles + 1 blog-article (which must NOT be picked up).
    for (let i = 0; i < 4; i++) {
      const [row] = await db
        .insert(articles)
        .values({
          projectId,
          source: "imported",
          collection: "tools",
          locale: "de",
          slug: `tool-${ts}-${i}`,
          title: `Tool ${i}`,
          status: "proposed",
        })
        .returning();
      if (!row) throw new Error("seed tool insert failed");
      toolIds.push(row.id);
    }
    await db.insert(articles).values({
      projectId,
      source: "imported",
      collection: "blog",
      locale: "de",
      slug: `blog-${ts}`,
      title: "Blog Decoy",
      status: "proposed",
    });
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("dry-run reports candidate count without writing", async () => {
    const summary = await backfillToolBrandAssets({
      projectSlug,
      apply: false,
    });
    expect(summary.dryRun).toBe(true);
    expect(summary.candidatesBeforeRun).toBe(4);
    expect(summary.totalProcessed).toBe(0);

    // Confirm no rows landed.
    for (const id of toolIds) {
      const row = await getBrandAssetsForTool(id);
      expect(row).toBeNull();
    }
  });

  it("apply mode resolves + upserts every tool with needs_review=true", async () => {
    // Stub resolver: alternate between lobe-icons and deterministic-avatar.
    let i = 0;
    const stubResolver = async (
      input: Parameters<typeof backfillToolBrandAssets>[0] extends {
        resolver?: infer R;
      }
        ? R extends (...a: never[]) => Promise<infer Res>
          ? Res
          : never
        : never,
    ) => input;
    // The above is dense; use a direct lambda instead.
    const counts = { hits: 0, avatars: 0 };
    const resolver = async (input: {
      toolId: string;
      toolSlug: string;
      projectId: string;
      projectSlug: string;
    }): Promise<ResolvedToolBrandAsset> => {
      i++;
      if (i % 2 === 1) {
        counts.hits++;
        return {
          logoUrl: `https://r2.test/${input.projectSlug}/tool-brand-assets/${input.toolId}.svg`,
          logoR2Key: `${input.projectSlug}/tool-brand-assets/${input.toolId}.svg`,
          source: "lobe-icons",
          sourceRef: `${input.toolSlug}-color`,
          brandColorHint: "#7B61FF",
          logoWordmarkUrl: null,
          additionalBrandColors: [],        };
      }
      counts.avatars++;
      return {
        logoUrl: null,
        logoR2Key: null,
        source: "deterministic-avatar",
        sourceRef: null,
        brandColorHint: null,
          logoWordmarkUrl: null,
          additionalBrandColors: [],      };
    };

    const summary = await backfillToolBrandAssets({
      projectSlug,
      apply: true,
      resolver,
    });

    expect(summary.dryRun).toBe(false);
    expect(summary.totalProcessed).toBe(4);
    expect(summary.bySource["lobe-icons"]).toBe(counts.hits);
    expect(summary.bySource["deterministic-avatar"]).toBe(counts.avatars);
    expect(summary.needsReviewCount).toBe(4);
    expect(summary.errors).toEqual([]);

    // Every tool has a row, all needs_review=true, brandNameCanonical seeded.
    for (const id of toolIds) {
      const row = await getBrandAssetsForTool(id);
      expect(row).not.toBeNull();
      expect(row?.needsReview).toBe(true);
      expect(row?.brandNameCanonical).toBeTruthy();
      expect(["lobe-icons", "deterministic-avatar"]).toContain(row?.source ?? "");
    }

    // Suppress unused warning for the dead lambda above.
    void stubResolver;
  });

  it("re-running apply on a fully-backfilled project is a no-op", async () => {
    let invoked = 0;
    const resolver = async (): Promise<ResolvedToolBrandAsset> => {
      invoked++;
      return {
        logoUrl: null,
        logoR2Key: null,
        source: "deterministic-avatar",
        sourceRef: null,
        brandColorHint: null,
          logoWordmarkUrl: null,
          additionalBrandColors: [],      };
    };

    const summary = await backfillToolBrandAssets({
      projectSlug,
      apply: true,
      resolver,
    });
    expect(summary.candidatesBeforeRun).toBe(0);
    expect(summary.totalProcessed).toBe(0);
    expect(invoked).toBe(0);
  });

  it("tolerates resolver errors per-tool and keeps processing", async () => {
    // Seed two new tools.
    const ts = Date.now();
    const newTools: string[] = [];
    for (let i = 0; i < 2; i++) {
      const [row] = await db
        .insert(articles)
        .values({
          projectId,
          source: "imported",
          collection: "tools",
          locale: "de",
          slug: `tool-err-${ts}-${i}`,
          title: `Errtool ${i}`,
          status: "proposed",
        })
        .returning();
      if (!row) throw new Error("seed err tool failed");
      newTools.push(row.id);
    }

    let i = 0;
    const resolver = async (input: {
      toolId: string;
      toolSlug: string;
      projectId: string;
      projectSlug: string;
    }): Promise<ResolvedToolBrandAsset> => {
      i++;
      if (i === 1) throw new Error("simulated chain failure");
      return {
        logoUrl: `https://r2.test/x/${input.toolId}.svg`,
        logoR2Key: `x/${input.toolId}.svg`,
        source: "iconify",
        sourceRef: `logos:${input.toolSlug}`,
        brandColorHint: null,
          logoWordmarkUrl: null,
          additionalBrandColors: [],      };
    };

    const summary = await backfillToolBrandAssets({
      projectSlug,
      apply: true,
      resolver,
    });
    expect(summary.errors.length).toBe(1);
    expect(summary.totalProcessed).toBe(1);
    expect(summary.bySource.iconify).toBe(1);
  });

  it("respects the optional `limit` cap", async () => {
    // Seed 5 new tools.
    const ts = Date.now();
    for (let i = 0; i < 5; i++) {
      await db
        .insert(articles)
        .values({
          projectId,
          source: "imported",
          collection: "tools",
          locale: "de",
          slug: `tool-cap-${ts}-${i}`,
          title: `Cap ${i}`,
          status: "proposed",
        });
    }

    const resolver = async (): Promise<ResolvedToolBrandAsset> => ({
      logoUrl: null,
      logoR2Key: null,
      source: "deterministic-avatar",
      sourceRef: null,
      brandColorHint: null,
          logoWordmarkUrl: null,
          additionalBrandColors: [],    });

    const summary = await backfillToolBrandAssets({
      projectSlug,
      apply: true,
      resolver,
      limit: 2,
    });
    expect(summary.totalProcessed).toBe(2);
  });

  it("rejects missing project slug at the API boundary", async () => {
    await expect(
      backfillToolBrandAssets({
        projectSlug: `nope-${Date.now()}`,
        apply: false,
      }),
    ).rejects.toThrow(/not found/);
  });
});
