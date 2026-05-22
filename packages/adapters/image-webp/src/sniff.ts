/**
 * Magic-byte image format sniffer.
 *
 * Never trust the producer's reported MIME type — Spec 64.6 / Discovery #14
 * showed Gemini setting `inlineData.mimeType` to "image/webp" while actually
 * returning PNG bytes. We sniff the first 12 bytes ourselves and pick the
 * format the file actually is.
 */

export type SniffedFormat = "webp" | "png" | "jpeg" | "gif" | "avif" | "unknown";

const startsWith = (bytes: Uint8Array, prefix: number[]): boolean => {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  return true;
};

export function sniffImageFormat(bytes: Uint8Array): SniffedFormat {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  // GIF: 47 49 46 38 (GIF8)
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  // WebP: "RIFF" .... "WEBP" (bytes 0-3 + bytes 8-11)
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  // AVIF: bytes 4-11 = "ftypavif" or "ftypheic"/"ftypheix"/"ftyphevc"... we only care about AVIF
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 && // f
    bytes[5] === 0x74 && // t
    bytes[6] === 0x79 && // y
    bytes[7] === 0x70 && // p
    bytes[8] === 0x61 && // a
    bytes[9] === 0x76 && // v
    bytes[10] === 0x69 && // i
    bytes[11] === 0x66 // f
  ) {
    return "avif";
  }
  return "unknown";
}

const EXT_BY_FORMAT: Record<SniffedFormat, string> = {
  webp: "webp",
  png: "png",
  jpeg: "jpg",
  gif: "gif",
  avif: "avif",
  unknown: "bin",
};

const MIME_BY_FORMAT: Record<SniffedFormat, string> = {
  webp: "image/webp",
  png: "image/png",
  jpeg: "image/jpeg",
  gif: "image/gif",
  avif: "image/avif",
  unknown: "application/octet-stream",
};

export function extensionForFormat(format: SniffedFormat): string {
  return EXT_BY_FORMAT[format];
}

export function mimeForFormat(format: SniffedFormat): string {
  return MIME_BY_FORMAT[format];
}
