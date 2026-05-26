/**
 * Spec 65.8 — lifestyle-listicle bootstrap regression.
 */
import { describe, expect, it } from "bun:test";
import { bootstrapTemplates } from "../../../src/templates/bootstrap.ts";
import { templateRegistry } from "../../../src/templates/registry.ts";

describe("lifestyle-listicle bootstrap", () => {
  it("registers the template via bootstrapTemplates()", () => {
    bootstrapTemplates();
    const t = templateRegistry.list().find((row) => row.key === "lifestyle-listicle");
    expect(t).toBeDefined();
    expect(t?.defaultSlideCount).toBe(6);
  });

  it("exposes renderServerFn = renderLifestyleListicle", () => {
    const t = templateRegistry.list().find((row) => row.key === "lifestyle-listicle");
    expect(t?.renderServerFn).toBe("renderLifestyleListicle");
  });

  it("has all 3 required fixtures", () => {
    const t = templateRegistry.list().find((row) => row.key === "lifestyle-listicle");
    expect(t?.mockFixtures.characteristic).toBeDefined();
    expect(t?.mockFixtures["edge-min"]).toBeDefined();
    expect(t?.mockFixtures["edge-max"]).toBeDefined();
  });

  it("rejects articles outside recurring_content collection", () => {
    const t = templateRegistry.list().find((row) => row.key === "lifestyle-listicle");
    if (!t) throw new Error("template not registered");
    // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture for eligibility check
    const result = t.eligibility({ collection: "tools", domainExtras: {} } as any, {} as any);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("recurring_content");
  });

  it("rejects when featuredTool is missing", () => {
    const t = templateRegistry.list().find((row) => row.key === "lifestyle-listicle");
    if (!t) throw new Error("template not registered");
    const result = t.eligibility(
      // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture
      {
        collection: "recurring_content",
        domainExtras: {
          recurring: {
            formatConfig: { hookData: { rendered: "Hook", variables: {} } },
          },
        },
      } as any,
      // biome-ignore lint/suspicious/noExplicitAny: discovery not consumed
      {} as any,
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("featuredTool");
  });

  it("accepts when both hookData + featuredTool present", () => {
    const t = templateRegistry.list().find((row) => row.key === "lifestyle-listicle");
    if (!t) throw new Error("template not registered");
    const result = t.eligibility(
      // biome-ignore lint/suspicious/noExplicitAny: minimal article fixture
      {
        collection: "recurring_content",
        domainExtras: {
          recurring: {
            formatConfig: {
              hookData: { rendered: "Hook", variables: { profession: "Texter" } },
              featuredTool: { slug: "chatgpt", name: "ChatGPT" },
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
