import { describe, it, expect } from "bun:test";
import { iconifyAdapter } from "../../src/_lib/icon-sources/iconify.ts";

describe("iconifyAdapter", () => {
  it("resolves midjourney from logos set", async () => {
    const result = await iconifyAdapter.tryResolve("midjourney");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("iconify");
    expect(result!.sourceRef).toBe("logos:midjourney");
    expect(result!.svgContent).toContain("<svg");
    expect(result!.format).toBe("svg");
  });

  it("resolves openai", async () => {
    const result = await iconifyAdapter.tryResolve("openai");
    expect(result).not.toBeNull();
    expect(result!.sourceRef).toBe("logos:openai");
  });

  it("resolves chatgpt via openai alias", async () => {
    const result = await iconifyAdapter.tryResolve("chatgpt");
    expect(result).not.toBeNull();
    expect(result!.sourceRef).toBe("logos:openai");
  });

  it("resolves flux", async () => {
    const result = await iconifyAdapter.tryResolve("flux");
    expect(result).not.toBeNull();
  });

  it("resolves stability AI", async () => {
    const result = await iconifyAdapter.tryResolve("stability");
    expect(result).not.toBeNull();
    expect(result!.sourceRef).toContain("stability-ai");
  });

  it("returns null for tools not in any iconify set (recraft)", async () => {
    const result = await iconifyAdapter.tryResolve("recraft");
    expect(result).toBeNull();
  });

  it("returns null for completely unknown slug", async () => {
    const result = await iconifyAdapter.tryResolve("zzz-unknown-tool-xyz");
    expect(result).toBeNull();
  });

  it("SVG output has valid viewBox attribute", async () => {
    const result = await iconifyAdapter.tryResolve("midjourney");
    expect(result!.svgContent).toMatch(/viewBox="[\d\s.]+"/);
  });
});
