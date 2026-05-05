# Storage Adapter (Cloudflare R2)

Object storage for generated assets. Uses Bun's native `Bun.S3Client` (zero deps).

## Usage

```typescript
import { r2 } from "@marketing-auto/adapter-storage";

const result = await r2.put({
  key: "ki-wissensraum/articles/hero/uuid.webp",
  body: imageBuffer,
  contentType: "image/webp",
});
console.log(result.publicUrl);
```

## Hard Rules

- Object keys MUST follow `<project-slug>/<content-type>/<filename>` structure
- Keys MUST NOT start with `/`
- Default `Cache-Control` is `public, max-age=31536000, immutable` — for content-addressed assets
  (UUID in name). Override only if the URL is mutable.
- ALWAYS set `contentType` for images, PDFs, audio — improves CDN behavior

## Public URLs

If `R2_PUBLIC_BASE_URL` is set in `.env` (recommended), URLs use the custom domain.
Otherwise falls back to `https://pub-<account-id>.r2.dev/<key>`, which requires
the bucket to be set to "public access" in the Cloudflare dashboard.

For production: set up a custom domain. The fallback exists for dev convenience only.

## Common Mistakes

- DO NOT call `r2.put` from request-handling code unless you control the input — body size
  isn't capped in the adapter; very large uploads block the worker
- DO NOT use the same `key` for different content (no auto-versioning) — generate unique keys
  via UUID or content hash
- DO NOT delete objects pointed to by published articles (you'd 404 the page)
