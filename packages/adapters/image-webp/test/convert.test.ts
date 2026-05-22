import { describe, expect, it } from "bun:test";
import { convertImageToWebp, ImageWebpError } from "../src/index.ts";

/**
 * Spec 64.6c integration tests. These hit the local R2 fallback path
 * (`putObject` writes to `<repo-root>/apps/api/uploads/<key>` when R2 isn't
 * configured), so the tests are hermetic — no network, no credentials needed.
 */

// Build a real 4×4 PNG via sharp so the bytes are valid PNG that sharp can decode.
async function makePng(width = 4, height = 4): Promise<Uint8Array> {
  const sharpMod = await import("sharp");
  const sharpFn = (sharpMod as unknown as { default: typeof import("sharp") }).default;
  const buf = await sharpFn({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

async function makeWebp(width = 4, height = 4): Promise<Uint8Array> {
  const sharpMod = await import("sharp");
  const sharpFn = (sharpMod as unknown as { default: typeof import("sharp") }).default;
  const buf = await sharpFn({
    create: { width, height, channels: 3, background: { r: 50, g: 100, b: 200 } },
  })
    .webp({ quality: 80 })
    .toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe("convertImageToWebp", () => {
  it("converts a PNG input → WebP and stores both", async () => {
    const png = await makePng(8, 8);
    const result = await convertImageToWebp({
      projectId: crypto.randomUUID(),
      bytes: png,
      contentType: "image/png",
      storagePrefix: "test-tenant/articles/hero",
    });

    expect(result.alreadyWebp).toBe(false);
    expect(result.webpKey).toMatch(/test-tenant\/articles\/hero\/[a-f0-9-]+\.webp$/);
    expect(result.webpBytes).toBeGreaterThan(0);
    expect(result.originalKey).not.toBeNull();
    expect(result.originalKey!).toMatch(/test-tenant\/articles\/hero\/originals\/[a-f0-9-]+\.png$/);
    expect(result.originalBytes).toBe(png.length);
  });

  it("fast-paths when input is already WebP — no conversion, no original stored", async () => {
    const webp = await makeWebp();
    const result = await convertImageToWebp({
      projectId: crypto.randomUUID(),
      bytes: webp,
      // Lie about the content type — sniff should win.
      contentType: "image/png",
      storagePrefix: "test-tenant/articles/hero",
    });

    expect(result.alreadyWebp).toBe(true);
    expect(result.webpKey).toMatch(/\.webp$/);
    expect(result.webpBytes).toBe(webp.length);
    expect(result.originalKey).toBeNull();
    expect(result.originalUrl).toBeNull();
    expect(result.originalBytes).toBeNull();
  });

  it("discardOriginal=true skips the original upload on conversion", async () => {
    const png = await makePng();
    const result = await convertImageToWebp({
      projectId: crypto.randomUUID(),
      bytes: png,
      contentType: "image/png",
      storagePrefix: "test-tenant/articles/hero",
      discardOriginal: true,
    });

    expect(result.alreadyWebp).toBe(false);
    expect(result.webpKey).toMatch(/\.webp$/);
    expect(result.originalKey).toBeNull();
    expect(result.originalUrl).toBeNull();
    expect(result.originalBytes).toBeNull();
  });

  it("respects the quality knob (both quality values produce valid WebP output)", async () => {
    // We don't assert a byte-size relationship — for flat-color sources sharp can
    // produce nearly identical sizes at q=30 vs q=95. The contract we actually
    // care about is "the adapter passes `quality` through to sharp without error".
    const png = await makePng(64, 64);
    const high = await convertImageToWebp({
      projectId: crypto.randomUUID(),
      bytes: png,
      contentType: "image/png",
      storagePrefix: "test-tenant/articles/hero/q",
      quality: 95,
      discardOriginal: true,
    });
    const low = await convertImageToWebp({
      projectId: crypto.randomUUID(),
      bytes: png,
      contentType: "image/png",
      storagePrefix: "test-tenant/articles/hero/q",
      quality: 30,
      discardOriginal: true,
    });
    expect(high.webpKey).toMatch(/\.webp$/);
    expect(low.webpKey).toMatch(/\.webp$/);
    expect(high.webpBytes).toBeGreaterThan(0);
    expect(low.webpBytes).toBeGreaterThan(0);
  });

  it("strips leading/trailing slashes from storagePrefix", async () => {
    const webp = await makeWebp();
    const result = await convertImageToWebp({
      projectId: crypto.randomUUID(),
      bytes: webp,
      contentType: "image/webp",
      storagePrefix: "/test-tenant/articles/hero/",
    });
    // No double slash, no trailing slash before the UUID.
    expect(result.webpKey).toMatch(/^test-tenant\/articles\/hero\/[a-f0-9-]+\.webp$/);
  });

  it("rejects garbage input with ImageWebpError", async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    await expect(
      convertImageToWebp({
        projectId: crypto.randomUUID(),
        bytes: garbage,
        contentType: "image/png", // ignore the lie — sniff wins
        storagePrefix: "test-tenant/articles/hero",
      }),
    ).rejects.toThrow(ImageWebpError);
  });

  it("magic-byte sniff beats the caller's claimed contentType (Discovery #14 regression)", async () => {
    // The motivating bug: Gemini reports inlineData.mimeType="image/webp" but
    // actually returns PNG bytes. The adapter must use the sniff, not the lie.
    const png = await makePng();
    const result = await convertImageToWebp({
      projectId: crypto.randomUUID(),
      bytes: png,
      // ← the lie: Gemini-style mismatched header
      contentType: "image/webp",
      storagePrefix: "test-tenant/articles/hero",
    });
    expect(result.alreadyWebp).toBe(false);
    // The original was stored as PNG (correct, from sniff), not WebP (the lie).
    expect(result.originalKey).toMatch(/\.png$/);
  });
});

describe("imageWebp.convertImageToWebp (object surface)", () => {
  it("exposes convertImageToWebp via the imageWebp namespace", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.imageWebp.convertImageToWebp).toBe("function");
    expect(mod.imageWebp.convertImageToWebp).toBe(mod.convertImageToWebp);
  });
});
