import { randomUUID } from "node:crypto";
import { putObject } from "@marketing-auto/adapter-storage";
import { createLogger } from "@marketing-auto/shared";
import { extensionForFormat, mimeForFormat, sniffImageFormat } from "./sniff.ts";
import {
  type ConvertImageToWebpInput,
  type ConvertImageToWebpResult,
  ImageWebpError,
} from "./types.ts";

const log = createLogger("image-webp");

const DEFAULT_QUALITY = 85;

/**
 * Bun's ESM resolver returns `{ default: fn }` for `await import("sharp")`,
 * NOT the callable itself. Calling the namespace throws TypeError. Same gotcha
 * the existing hero-generation pipeline already documents (root CLAUDE.md
 * "await import sharp" rule). Lazy-load so the sharp native binding doesn't
 * load at adapter import-time — keeps test-only consumers cheap.
 */
interface SharpPipeline {
  resize(opts: { width?: number; fit?: "inside"; withoutEnlargement?: boolean }): SharpPipeline;
  webp(options: { quality: number; effort?: number }): {
    toBuffer(): Promise<Buffer>;
  };
}
type SharpCallable = (input: Uint8Array | Buffer) => SharpPipeline;

async function loadSharp(): Promise<SharpCallable> {
  try {
    const mod = await import("sharp");
    const callable = (mod as unknown as { default: SharpCallable }).default;
    if (typeof callable !== "function") {
      throw new ImageWebpError(
        `sharp default export is not callable (got ${typeof callable}) — Bun ESM gotcha`
      );
    }
    return callable;
  } catch (err) {
    throw new ImageWebpError(
      "Failed to load `sharp` — make sure the package is installed",
      err
    );
  }
}

async function encodeWebp(
  bytes: Uint8Array,
  quality: number,
  maxWidth: number | undefined,
): Promise<Uint8Array> {
  const sharpFn = await loadSharp();
  const buffer = bytes instanceof Buffer ? bytes : Buffer.from(bytes);
  // effort 4 = sharp default; higher values produce smaller files at the cost of CPU.
  // 4 is fine for hero images (~80KB → ~50KB at effort 6); the cost-benefit drops past 4.
  //
  // Spec 65.16 V1.6-followup — optional downscale BEFORE webp encode. `fit: "inside"`
  // preserves aspect ratio (only the long edge is capped); `withoutEnlargement` makes
  // smaller inputs pass through untouched. Without `maxWidth`, the pipeline preserves
  // source dimensions (legacy hero-image path).
  const pipeline = sharpFn(buffer);
  const resized = maxWidth !== undefined
    ? pipeline.resize({ width: maxWidth, fit: "inside", withoutEnlargement: true })
    : pipeline;
  const result = await resized.webp({ quality, effort: 4 }).toBuffer();
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
}

/**
 * Convert an image input to WebP and store both the converted asset and (by
 * default) the original in R2. See [types.ts](./types.ts) for the full contract.
 *
 * Magic-byte sniffing is the source of truth for "is this already WebP?" — the
 * caller's `contentType` is logged as a hint but never consulted for the decision
 * branch (Spec 64.6 Discovery #14: Gemini lies). When sniff = "webp", the bytes
 * are uploaded as-is and no sharp conversion runs (fast path).
 */
export async function convertImageToWebp(
  input: ConvertImageToWebpInput
): Promise<ConvertImageToWebpResult> {
  const sniffed = sniffImageFormat(input.bytes);
  const cleanPrefix = input.storagePrefix.replace(/^\/|\/$/g, "");
  const fileId = randomUUID();
  const quality = input.quality ?? DEFAULT_QUALITY;
  const discardOriginal = input.discardOriginal ?? false;

  if (sniffed === "unknown") {
    throw new ImageWebpError(
      `Unrecognized image format (claimed contentType=${input.contentType}, ${input.bytes.length} bytes). ` +
        `First 16 bytes: ${Array.from(input.bytes.slice(0, 16))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")}`
    );
  }

  // Fast path: input is already WebP — no conversion, no original storage.
  // Browser-side: matches the .webp extension on the R2 key; cache-control is set
  // for content-addressed long-cache because the UUID guarantees uniqueness.
  if (sniffed === "webp") {
    const webpKey = `${cleanPrefix}/${fileId}.webp`;
    const stored = await putObject({
      key: webpKey,
      body: input.bytes,
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });
    log.debug(
      {
        projectId: input.projectId,
        webpKey: stored.key,
        bytes: stored.bytesStored,
        claimedContentType: input.contentType,
      },
      "image-webp: input already WebP — fast path"
    );
    return {
      webpKey: stored.key,
      webpUrl: stored.publicUrl,
      webpBytes: stored.bytesStored,
      originalKey: null,
      originalUrl: null,
      originalBytes: null,
      alreadyWebp: true,
    };
  }

  // Convert path. Run sharp first — if encoding fails we don't want a half-stored
  // original orphaned in R2 with no canonical WebP referencing it.
  const webpBytes = await encodeWebp(input.bytes, quality, input.maxWidth);

  const webpKey = `${cleanPrefix}/${fileId}.webp`;
  const webpStored = await putObject({
    key: webpKey,
    body: webpBytes,
    contentType: "image/webp",
    cacheControl: "public, max-age=31536000, immutable",
  });

  // Original storage is best-effort: a failure here logs warn but the WebP
  // upload already succeeded — caller still gets a usable result. The forensic
  // value of the original isn't worth crashing the pipeline over.
  let originalKey: string | null = null;
  let originalUrl: string | null = null;
  let originalBytes: number | null = null;

  if (!discardOriginal) {
    const ext = extensionForFormat(sniffed);
    const mime = mimeForFormat(sniffed);
    const originalKeyCandidate = `${cleanPrefix}/originals/${fileId}.${ext}`;
    try {
      const originalStored = await putObject({
        key: originalKeyCandidate,
        body: input.bytes,
        contentType: mime,
        cacheControl: "public, max-age=31536000, immutable",
      });
      originalKey = originalStored.key;
      originalUrl = originalStored.publicUrl;
      originalBytes = originalStored.bytesStored;
    } catch (err) {
      log.warn(
        { err, projectId: input.projectId, attemptedKey: originalKeyCandidate },
        "image-webp: failed to store original — WebP already uploaded, continuing without forensic copy"
      );
    }
  }

  log.info(
    {
      projectId: input.projectId,
      webpKey: webpStored.key,
      webpBytes: webpStored.bytesStored,
      originalKey,
      originalBytes,
      sniffed,
      claimedContentType: input.contentType,
      quality,
    },
    "image-webp: converted + stored"
  );

  return {
    webpKey: webpStored.key,
    webpUrl: webpStored.publicUrl,
    webpBytes: webpStored.bytesStored,
    originalKey,
    originalUrl,
    originalBytes,
    alreadyWebp: false,
  };
}
