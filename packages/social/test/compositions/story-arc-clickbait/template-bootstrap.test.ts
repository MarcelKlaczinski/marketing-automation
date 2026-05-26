/**
 * Spec 65.8 — bootstrap regression: story-arc-clickbait registers cleanly
 * alongside Family-A templates, has all 3 required fixtures, and exposes
 * its `renderServerFn` for the preview/dispatch surface.
 */
import { describe, expect, it } from "bun:test";
import { bootstrapTemplates } from "../../../src/templates/bootstrap.ts";
import { templateRegistry } from "../../../src/templates/registry.ts";

describe("story-arc-clickbait bootstrap", () => {
  it("registers the template via bootstrapTemplates()", () => {
    bootstrapTemplates();
    const t = templateRegistry.list().find((t) => t.key === "story-arc-clickbait");
    expect(t).toBeDefined();
    expect(t?.key).toBe("story-arc-clickbait");
    expect(t?.defaultSlideCount).toBe(7);
  });

  it("exposes renderServerFn matching the render-server.ts export name", () => {
    const t = templateRegistry.list().find((t) => t.key === "story-arc-clickbait");
    expect(t?.renderServerFn).toBe("renderStoryArcClickbait");
  });

  it("has all 3 required fixtures (characteristic / edge-min / edge-max)", () => {
    const t = templateRegistry.list().find((t) => t.key === "story-arc-clickbait");
    expect(t?.mockFixtures).toBeDefined();
    expect(t?.mockFixtures.characteristic).toBeDefined();
    expect(t?.mockFixtures["edge-min"]).toBeDefined();
    expect(t?.mockFixtures["edge-max"]).toBeDefined();
  });

  it("declares plannerMeta.contentType='story' (Family B)", () => {
    const t = templateRegistry.list().find((t) => t.key === "story-arc-clickbait");
    expect(t?.plannerMeta.contentType).toBe("story");
    expect(t?.plannerMeta.estimatedEngagementTier).toBe("high");
  });

  it("rejects articles outside the recurring_content collection in eligibility", () => {
    const t = templateRegistry.list().find((t) => t.key === "story-arc-clickbait");
    if (!t) throw new Error("template not registered");
    const result = t.eligibility(
      // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture for eligibility check
      { collection: "tools", domainExtras: {} } as any,
      // biome-ignore lint/suspicious/noExplicitAny: discovery is not consumed by this eligibility predicate
      {} as any,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("recurring_content");
  });

  it("rejects recurring_content articles missing hookData", () => {
    const t = templateRegistry.list().find((t) => t.key === "story-arc-clickbait");
    if (!t) throw new Error("template not registered");
    const result = t.eligibility(
      // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture
      { collection: "recurring_content", domainExtras: { recurring: {} } } as any,
      // biome-ignore lint/suspicious/noExplicitAny: discovery is not consumed
      {} as any,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("hookData");
  });

  it("accepts recurring_content articles with hookData set", () => {
    const t = templateRegistry.list().find((t) => t.key === "story-arc-clickbait");
    if (!t) throw new Error("template not registered");
    const result = t.eligibility(
      // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture
      {
        collection: "recurring_content",
        domainExtras: {
          recurring: {
            formatConfig: {
              hookData: { rendered: "Hook text", variables: { profession: "Texter" } },
            },
          },
        },
      } as any,
      // biome-ignore lint/suspicious/noExplicitAny: discovery is not consumed
      {} as any,
    );
    expect(result.eligible).toBe(true);
  });
});
