// Spec 65.7-followup — dispatch-coverage regression guard.
//
// Two test classes:
//   1. Registry-gap guard: every templateKey registered in bootstrap.ts must
//      live in FAMILY_A_TEMPLATE_KEYS or FAMILY_B_TEMPLATE_KEYS. This catches
//      the very gap-class the spec fixes — a templateKey registered in
//      bootstrap.ts but with no worker dispatch branch would throw
//      `Unknown templateKey` at render time.
//   2. Dispatch coverage: for every templateKey in either family set,
//      `dispatchByTemplateKey` must route to the matching render-server fn.
//      Plus the "unknown templateKey" fail-loud path.
//
// Stays offline: render-server fns are mock functions; no Remotion bundle.
import { beforeAll, describe, expect, it, mock } from "bun:test";

import {
  FAMILY_A_TEMPLATE_KEYS,
  FAMILY_B_TEMPLATE_KEYS,
  dispatchByTemplateKey,
  isFamilyA,
  isFamilyB,
  type RenderServerLike,
} from "../../src/workers/social-render.worker.ts";

import { bootstrapTemplates, templateRegistry } from "@marketing-auto/social/templates";

beforeAll(() => {
  bootstrapTemplates();
});

// ─── Registry-gap guard ──────────────────────────────────────────────────────

describe("registered templates have worker dispatch coverage (Spec 65.7-followup)", () => {
  it("every templateKey in bootstrap.ts is in FAMILY_A or FAMILY_B set", () => {
    const registered = templateRegistry.list().map((t) => t.key);
    expect(registered.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const key of registered) {
      if (!isFamilyA(key) && !isFamilyB(key)) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Registered templates without worker dispatch: ${missing.join(", ")}\n` +
          `Add them to FAMILY_A_TEMPLATE_KEYS or FAMILY_B_TEMPLATE_KEYS in apps/api/src/workers/social-render.worker.ts.`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("FAMILY_A and FAMILY_B sets are disjoint", () => {
    const overlap = (FAMILY_A_TEMPLATE_KEYS as readonly string[]).filter((k) =>
      (FAMILY_B_TEMPLATE_KEYS as readonly string[]).includes(k),
    );
    expect(overlap).toEqual([]);
  });
});

// ─── Dispatch coverage ───────────────────────────────────────────────────────

function buildMockRenderServer(): {
  server: RenderServerLike;
  calls: Map<keyof RenderServerLike, Array<Record<string, unknown>>>;
} {
  const calls = new Map<keyof RenderServerLike, Array<Record<string, unknown>>>();
  const stub = (name: keyof RenderServerLike) =>
    mock(async (input: Record<string, unknown>) => {
      const list = calls.get(name) ?? [];
      list.push(input);
      calls.set(name, list);
      return { slides: [Buffer.from(`slide-${String(name)}`)], sequenceCount: 1 };
    });

  const server: RenderServerLike = {
    renderComparisonGrid3: stub("renderComparisonGrid3"),
    renderComparisonGrid4: stub("renderComparisonGrid4"),
    renderComparisonGrid5: stub("renderComparisonGrid5"),
    renderVerdictPerUseCase: stub("renderVerdictPerUseCase"),
    renderSingleToolSpotlight: stub("renderSingleToolSpotlight"),
    renderProConVerdict: stub("renderProConVerdict"),
    renderHeadToHeadVs: stub("renderHeadToHeadVs"),
    renderHeadToHeadDeepDive: stub("renderHeadToHeadDeepDive"),
    renderStoryArcClickbait: stub("renderStoryArcClickbait"),
    renderLifestyleListicle: stub("renderLifestyleListicle"),
    renderOpinionRecommendation: stub("renderOpinionRecommendation"),
    renderToolTierRanking: stub("renderToolTierRanking"),
  };
  return { server, calls };
}

const TEMPLATE_KEY_TO_RENDER_FN: Record<string, keyof RenderServerLike> = {
  "comparison-grid-3": "renderComparisonGrid3",
  "comparison-grid-4": "renderComparisonGrid4",
  "comparison-grid-5": "renderComparisonGrid5",
  "verdict-per-use-case": "renderVerdictPerUseCase",
  "single-tool-spotlight": "renderSingleToolSpotlight",
  "pro-con-verdict": "renderProConVerdict",
  "head-to-head-vs": "renderHeadToHeadVs",
  "head-to-head-deep-dive": "renderHeadToHeadDeepDive",
  "story-arc-clickbait": "renderStoryArcClickbait",
  "lifestyle-listicle": "renderLifestyleListicle",
  "opinion-recommendation": "renderOpinionRecommendation",
  "tool-tier-ranking": "renderToolTierRanking",
};

describe("dispatchByTemplateKey routes to the matching render-server fn", () => {
  const allKeys = [
    ...(FAMILY_A_TEMPLATE_KEYS as readonly string[]),
    ...(FAMILY_B_TEMPLATE_KEYS as readonly string[]),
  ];

  it.each(allKeys)("routes %s to its render fn exactly once", async (templateKey) => {
    const { server, calls } = buildMockRenderServer();
    const fullInput = { __probe: templateKey, brandTokens: {}, overrides: {} };

    const result = await dispatchByTemplateKey(templateKey, fullInput, server);

    const expectedFn = TEMPLATE_KEY_TO_RENDER_FN[templateKey];
    expect(expectedFn).toBeDefined();
    if (!expectedFn) throw new Error(`unmapped templateKey: ${templateKey}`);

    // Matching fn called once with the spread input
    expect(calls.get(expectedFn)?.length ?? 0).toBe(1);
    expect(calls.get(expectedFn)?.[0]).toMatchObject({ __probe: templateKey });

    // No other render fn was called
    for (const [name, list] of calls.entries()) {
      if (name === expectedFn) continue;
      expect(list.length).toBe(0);
    }

    // Result is the stub shape
    expect(result.sequenceCount).toBe(1);
    expect(result.slides.length).toBe(1);
  });

  it("throws on an unknown templateKey", async () => {
    const { server } = buildMockRenderServer();
    await expect(
      dispatchByTemplateKey("definitely-not-a-template", {}, server),
    ).rejects.toThrow(/Unknown templateKey/);
  });
});
