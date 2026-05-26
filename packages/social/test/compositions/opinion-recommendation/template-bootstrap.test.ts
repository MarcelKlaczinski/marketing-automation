/**
 * Spec 65.8 — opinion-recommendation bootstrap regression.
 */
import { describe, expect, it } from "bun:test";
import { bootstrapTemplates } from "../../../src/templates/bootstrap.ts";
import { templateRegistry } from "../../../src/templates/registry.ts";

describe("opinion-recommendation bootstrap", () => {
  it("registers the template via bootstrapTemplates()", () => {
    bootstrapTemplates();
    const t = templateRegistry.list().find((row) => row.key === "opinion-recommendation");
    expect(t).toBeDefined();
    expect(t?.defaultSlideCount).toBe(6);
  });

  it("exposes renderServerFn = renderOpinionRecommendation", () => {
    const t = templateRegistry.list().find((row) => row.key === "opinion-recommendation");
    expect(t?.renderServerFn).toBe("renderOpinionRecommendation");
  });

  it("has all 3 required fixtures", () => {
    const t = templateRegistry.list().find((row) => row.key === "opinion-recommendation");
    expect(t?.mockFixtures.characteristic).toBeDefined();
    expect(t?.mockFixtures["edge-min"]).toBeDefined();
    expect(t?.mockFixtures["edge-max"]).toBeDefined();
  });

  it("rejects articles outside recurring_content collection", () => {
    const t = templateRegistry.list().find((row) => row.key === "opinion-recommendation");
    if (!t) throw new Error("template not registered");
    // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture for eligibility check
    const result = t.eligibility({ collection: "tools", domainExtras: {} } as any, {} as any);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("recurring_content");
  });

  it("rejects when recommendedTool is missing", () => {
    const t = templateRegistry.list().find((row) => row.key === "opinion-recommendation");
    if (!t) throw new Error("template not registered");
    const result = t.eligibility(
      // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture
      {
        collection: "recurring_content",
        domainExtras: {
          recurring: { formatConfig: { hookData: { rendered: "Hook", variables: {} } } },
        },
      } as any,
      // biome-ignore lint/suspicious/noExplicitAny: discovery not consumed
      {} as any,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("recommendedTool");
  });

  it("accepts when hookData + recommendedTool present", () => {
    const t = templateRegistry.list().find((row) => row.key === "opinion-recommendation");
    if (!t) throw new Error("template not registered");
    const result = t.eligibility(
      // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture
      {
        collection: "recurring_content",
        domainExtras: {
          recurring: {
            formatConfig: {
              hookData: { rendered: "Hook", variables: { profession: "Texter" } },
              recommendedTool: { slug: "claude", name: "Claude" },
            },
          },
        },
      } as any,
      // biome-ignore lint/suspicious/noExplicitAny: discovery not consumed
      {} as any,
    );
    expect(result.eligible).toBe(true);
  });
});
