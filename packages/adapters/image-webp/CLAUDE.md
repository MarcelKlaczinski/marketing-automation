# Image-to-WebP Adapter

Always-on hop between an image producer (Gemini / Replicate / future manual
upload) and R2 storage. Inputs that are NOT already WebP are decoded by `sharp`
and re-encoded as WebP; the canonical asset is always WebP, and the
pre-conversion original is preserved alongside for forensic fallback.

## Why this exists (Spec 64.6c)

Spec 64.6 Discovery #14 revealed that the Gemini Image API silently ignores our
`outputFormat: "webp"` hint and returns whatever it wants. R2 keys ended with
`.webp` while the bytes were PNG. Browsers still rendered correctly because the
Content-Type header was honest, but anyone inspecting R2 (or migrating to a
different CDN) would hit a "filename lies" trap.

This adapter solves it at the boundary: we sniff the **actual magic bytes** of
every image and convert if needed, regardless of what the producer claims in
`Content-Type` headers or `inlineData.mimeType`.

## Hard Rules

- **NEVER trust the producer's reported MIME type.** Magic-byte sniffing is the
  source of truth. Gemini lies. Some Replicate models lie.
- **ALL image storage goes through this adapter** — never call
  `adapter-storage.putObject` directly for images. Use it only for non-image
  blobs (JSON exports, ZIPs, etc.).
- **`projectId` is required** even though the adapter doesn't track cost. Lets
  log lines and future debugging tools group writes by tenant.
- **`storagePrefix` must NOT include a filename** — the adapter appends `<uuid>.webp`
  itself. Leading/trailing slashes are stripped.

## Usage

```typescript
import { convertImageToWebp } from "@marketing-auto/adapter-image-webp";

const result = await convertImageToWebp({
  projectId,
  bytes: rawImageBytes,           // Uint8Array from any producer
  contentType: "image/png",       // hint only — sniff wins
  storagePrefix: "toolwiki/articles/hero",
  // quality: 85,                 // optional; default 85
  // discardOriginal: false,      // optional; default false (keep originals)
});

// → {
//   webpKey: "toolwiki/articles/hero/<uuid>.webp",
//   webpUrl: "https://...",
//   webpBytes: 12345,
//   originalKey: "toolwiki/articles/hero/originals/<uuid>.png" | null,
//   originalUrl: "https://..." | null,
//   originalBytes: 67890 | null,
//   alreadyWebp: false,
// }
```

## Output Layout

| What | R2 key | When set |
|---|---|---|
| Canonical WebP | `<prefix>/<uuid>.webp` | Always |
| Original (forensic) | `<prefix>/originals/<uuid>.<ext>` | Conversion happened AND `discardOriginal !== true` |

The `<uuid>` is shared across both files so an operator can match them later
(e.g. to verify a re-render produces a different WebP from the same original).

## Magic-Byte Sniffing

`sniffImageFormat(bytes)` inspects the first 12 bytes against canonical
signatures:

| Format | Signature |
|---|---|
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| GIF | `47 49 46 38` (GIF8) |
| WebP | `RIFF` (bytes 0-3) + `WEBP` (bytes 8-11) |
| AVIF | `ftypavif` at bytes 4-11 |
| _Anything else_ | `unknown` → throws `ImageWebpError` |

`unknown` means we refuse to upload — better to fail loudly than to store junk
under a misleading extension.

## Sharp dependency

The adapter declares `sharp` as a direct dependency. It's lazy-loaded via
`await import("sharp")` so consumers that only use the sniffer (without
conversion) don't pay the native-binding load cost at import time.

**Bun ESM gotcha** (root CLAUDE.md DO-NOT): `await import("sharp")` returns
`{ default: fn }`, NOT the callable itself. The adapter extracts `.default`
via the canonical pattern. Don't change this — calling the namespace throws
`TypeError` which would be swallowed by upstream try-catch and silently produce
zero-byte uploads.

## Quality knob

Default WebP encoder quality is **85** (Google's recommendation for "visually
indistinguishable from lossless" for photographic content). Effort is fixed at
4 (sharp default). Higher effort produces ~5-10% smaller files at 2-3× CPU
cost — not worth it for hero images at ~80KB.

## Common Mistakes

- DO NOT call `convertImageToWebp` from a tight loop without rate-limiting —
  sharp is CPU-bound; ~100ms per 2K image. A batch of 50 will burn 5s of CPU.
- DO NOT pass an unknown `contentType` and expect `alreadyWebp: true` —
  the sniff is the gate, not the claim. If you don't have a content-type,
  pass `"application/octet-stream"` and let the sniff decide.
- DO NOT use this adapter for non-image bytes — sharp will throw on
  conversion, and the sniffer will throw `ImageWebpError` for `unknown`. The
  fast path (`alreadyWebp: true`) requires magic bytes; you can't fake it with
  arbitrary Uint8Array.
- DO NOT delete an `originals/<uuid>.<ext>` object via the R2 console without
  also clearing `articles.hero_image_original_r2_key` for the matching row —
  otherwise a `convert-existing-heroes` rerun will think the article was
  processed even though the forensic copy is gone.
