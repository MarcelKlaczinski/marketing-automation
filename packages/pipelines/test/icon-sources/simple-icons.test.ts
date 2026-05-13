import { describe, it, expect } from "bun:test";
import { simpleIconsAdapter } from "../../src/_lib/icon-sources/simple-icons.ts";

describe("simpleIconsAdapter", () => {
  it("resolves claude to Claude brand SVG", async () => {
    const result = await simpleIconsAdapter.tryResolve("claude");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("simple-icons");
    expect(result!.sourceRef).toBe("claude");
    expect(result!.svgContent).toContain("<svg");
    expect(result!.brandColor).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(result!.format).toBe("svg");
  });

  it("resolves figma with correct brand color", async () => {
    const result = await simpleIconsAdapter.tryResolve("figma");
    expect(result).not.toBeNull();
    expect(result!.brandColor).toBe("#F24E1E");
  });

  it("resolves perplexity", async () => {
    const result = await simpleIconsAdapter.tryResolve("perplexity");
    expect(result).not.toBeNull();
    expect(result!.sourceRef).toBe("perplexity");
  });

  it("resolves notion", async () => {
    const result = await simpleIconsAdapter.tryResolve("notion");
    expect(result).not.toBeNull();
  });

  it("resolves elevenlabs", async () => {
    const result = await simpleIconsAdapter.tryResolve("elevenlabs");
    expect(result).not.toBeNull();
  });

  it("resolves github-copilot via alias", async () => {
    const result = await simpleIconsAdapter.tryResolve("github-copilot");
    expect(result).not.toBeNull();
    expect(result!.sourceRef).toBe("githubcopilot");
  });

  it("returns null for unknown slug not in simple-icons", async () => {
    const result = await simpleIconsAdapter.tryResolve("recraft");
    expect(result).toBeNull();
  });

  it("returns null for completely unknown slug", async () => {
    const result = await simpleIconsAdapter.tryResolve("zzz-unknown-tool-xyz");
    expect(result).toBeNull();
  });
});
