/**
 * Spec 65.5-followup (2026-05-27) — `loadCandidatePool` brand-asset
 * pre-filter. Verifies that the LLM-curated path receives a pool that
 * EXCLUDES tools without a `tool_brand_assets.logo_url`. Closes the V1-launch
 * gap surfaced live by the first cron fire of `lifestyle-listicle` +
 * `top-n-comparison` against Toolwiki — LLM picked no-logo tools and the
 * post-check `ensureBrandAssetsAvailable` skipped the whole brief.
 *
 * Tests stub the Anthropic adapter so they stay offline and don't burn LLM
 * cost. The stub records what candidate UUIDs were sent in the user message
 * so we can assert no-logo tools never reach the LLM.
 */
import { mock } from "bun:test";

// Stub anthropic BEFORE pick-tools imports it. Captures the userMessage so
// tests can assert what the LLM "saw".
let capturedUserMessage: string | null = null;
mock.module("@marketing-auto/adapter-anthropic", () => ({
  anthropic: {
    messages: async (input: { userMessage: string }) => {
      capturedUserMessage = input.userMessage;
      // Return an empty pickedToolIds so the helper falls back to pool head.
      // We're testing the POOL not the LLM-pick logic.
      return {
        json: { pickedToolIds: [], reasoning: "stub" },
        raw: '{"pickedToolIds":[],"reasoning":"stub"}',
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  },
}));

// Stub persona-fit reorder too — we don't need persona-scores to test pool filtering.
mock.module(
  "../../../src/lib/persona-scoring/pick-persona-scored-tools.ts",
  () => ({
    pickPersonaScoredTools: async () => ({ scoredTools: [] }),
  }),
);

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, projects, toolBrandAssets } from "@marketing-auto/db";
import { pickToolsForBrief } from "../../../src/lib/recurring-content/brief-generators/shared/pick-tools.ts";

describe("pickToolsForBrief — brand-asset pre-filter (Spec 65.5-followup)", () => {
  let projectId: string;
  let toolALogo: string;
  let toolBLogo: string;
  let toolCNoLogo: string;
  let toolDNoRow: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `pick-tools-brand-filter-${ts}`,
        name: "pick-tools brand-filter test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    const inserted = await db
      .insert(articles)
      .values([
        {
          projectId,
          slug: `tool-a-logo-${ts}`,
          title: "Tool A with logo",
          collection: "tools",
          locale: "de",
          status: "published",
          source: "imported",
          metaDescription: "",
          toolRating: "4.8",
          toolVotes: 100,
        },
        {
          projectId,
          slug: `tool-b-logo-${ts}`,
          title: "Tool B with logo",
          collection: "tools",
          locale: "de",
          status: "published",
          source: "imported",
          metaDescription: "",
          toolRating: "4.5",
          toolVotes: 80,
        },
        {
          projectId,
          slug: `tool-c-no-logo-${ts}`,
          title: "Tool C with NULL logo_url",
          collection: "tools",
          locale: "de",
          status: "published",
          source: "imported",
          metaDescription: "",
          toolRating: "4.9", // highest rating — must STILL be filtered out
          toolVotes: 200,
        },
        {
          projectId,
          slug: `tool-d-no-row-${ts}`,
          title: "Tool D with no brand-assets row at all",
          collection: "tools",
          locale: "de",
          status: "published",
          source: "imported",
          metaDescription: "",
          toolRating: "4.7",
          toolVotes: 150,
        },
      ])
      .returning();
    if (inserted.length !== 4) throw new Error("seed INSERT failed");
    toolALogo = inserted[0]!.id;
    toolBLogo = inserted[1]!.id;
    toolCNoLogo = inserted[2]!.id;
    toolDNoRow = inserted[3]!.id;

    await db.insert(toolBrandAssets).values([
      {
        toolId: toolALogo,
        logoUrl: "https://example.com/a.svg",
        source: "manual",
        fetchedAt: new Date(),
      },
      {
        toolId: toolBLogo,
        logoUrl: "https://example.com/b.svg",
        source: "manual",
        fetchedAt: new Date(),
      },
      {
        toolId: toolCNoLogo,
        logoUrl: null, // explicit NULL logo
        source: "manual",
        fetchedAt: new Date(),
      },
      // toolDNoRow: NO row inserted — pre-filter must exclude this too
    ]);
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("LLM-curated pool EXCLUDES tools with NULL logo_url AND tools with no brand-assets row", async () => {
    capturedUserMessage = null;
    const result = await pickToolsForBrief({
      projectId,
      formatType: "top_n_comparison",
      locale: "de",
      config: { topN: 2 },
    });

    // The stubbed LLM returns `pickedToolIds: []`, which fails the
    // `z.array(...).min(1)` Zod schema → helper falls back to "stars-only"
    // pool head. The KEY assertion is that the fallback pool only contains
    // the 2 logo-having tools, NOT C or D. That proves the pre-filter ran
    // at SQL-level — the fallback path consumes the same filtered pool.
    expect(result.pickedVia).toBe("stars-only");
    expect(result.toolIds).toContain(toolALogo);
    expect(result.toolIds).toContain(toolBLogo);
    expect(result.toolIds).not.toContain(toolCNoLogo);
    expect(result.toolIds).not.toContain(toolDNoRow);

    // Verify the LLM never even SAW the no-logo tools in its candidate list
    // (the userMessage is built from `pool` after the SQL filter ran).
    expect(capturedUserMessage).not.toBeNull();
    // biome-ignore lint/style/noNonNullAssertion: assert above narrows at runtime, not at type level
    const msg = capturedUserMessage!;
    expect(msg).toContain(toolALogo);
    expect(msg).toContain(toolBLogo);
    expect(msg).not.toContain(toolCNoLogo);
    expect(msg).not.toContain(toolDNoRow);
  });

  it("falls through to 'stars-only' with reduced pool when filter shrinks below topN", async () => {
    capturedUserMessage = null;
    // topN=3 but only 2 tools have logos → pool size 2 < 3 → stars-only fallback
    const result = await pickToolsForBrief({
      projectId,
      formatType: "lifestyle_listicle",
      locale: "de",
      config: { topN: 3 },
    });
    expect(result.pickedVia).toBe("stars-only");
    expect(result.toolIds).toHaveLength(2); // only the 2 logo-having tools
    expect(result.toolIds).toContain(toolALogo);
    expect(result.toolIds).toContain(toolBLogo);
    expect(result.toolIds).not.toContain(toolCNoLogo);
    expect(result.toolIds).not.toContain(toolDNoRow);
    expect(capturedUserMessage).toBeNull(); // LLM never called for thin pool
  });

  it("manual-override path bypasses the pre-filter (Marcel-controlled — post-check is the gate)", async () => {
    capturedUserMessage = null;
    // Explicitly pass the no-logo tool — manual path returns it verbatim.
    // The brief-generator will then call ensureBrandAssetsAvailable() and
    // throw BrandAssetsMissingError, skipping the brief at render-time. The
    // manual path is "Marcel knows what he asked for" — no silent pool
    // filtering, but the post-check still gates the render. See
    // check-brand-assets.test.ts for the post-check coverage.
    const result = await pickToolsForBrief({
      projectId,
      formatType: "story_arc_clickbait",
      locale: "de",
      config: { topN: 1, manualToolIds: [toolCNoLogo] },
    });
    expect(result.pickedVia).toBe("manual");
    expect(result.toolIds).toEqual([toolCNoLogo]);
    expect(capturedUserMessage).toBeNull(); // LLM not called on manual path
  });
});
