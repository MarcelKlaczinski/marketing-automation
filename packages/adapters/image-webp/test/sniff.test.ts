import { describe, expect, it } from "bun:test";
import { sniffImageFormat } from "../src/sniff.ts";

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0]);
const GIF87_HEADER = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0,
]);
const WEBP_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const AVIF_HEADER = new Uint8Array([
  0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
]);

describe("sniffImageFormat", () => {
  it("identifies PNG by 8-byte magic", () => {
    expect(sniffImageFormat(PNG_HEADER)).toBe("png");
  });

  it("identifies JPEG by FF D8 FF prefix", () => {
    expect(sniffImageFormat(JPEG_HEADER)).toBe("jpeg");
  });

  it("identifies GIF by GIF8 prefix", () => {
    expect(sniffImageFormat(GIF87_HEADER)).toBe("gif");
  });

  it("identifies WebP by RIFF…WEBP pattern (bytes 0-3 + 8-11)", () => {
    expect(sniffImageFormat(WEBP_HEADER)).toBe("webp");
  });

  it("identifies AVIF by ftyp.avif at bytes 4-11", () => {
    expect(sniffImageFormat(AVIF_HEADER)).toBe("avif");
  });

  it("returns 'unknown' on garbage", () => {
    expect(sniffImageFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe("unknown");
  });

  it("returns 'unknown' on empty input", () => {
    expect(sniffImageFormat(new Uint8Array(0))).toBe("unknown");
  });

  it("returns 'unknown' on RIFF without WEBP marker (e.g. WAV)", () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(sniffImageFormat(wav)).toBe("unknown");
  });
});
