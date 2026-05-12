# Storage Adapter (Cloudflare R2)

Object storage for generated assets. Uses Bun's native `Bun.S3Client` (zero deps).

## Credential Loading (Spec 32)

All R2 config is resolved from the global vault first (keys: `r2.account_id`,
`r2.access_key_id`, `r2.secret_access_key`, `r2.bucket`, `r2.public_base_url`),
falling back to env vars (`R2_ACCOUNT_ID`, etc.). Set via installer or env vars.
`getFile()`, `deleteObject()`, `presignedUrl()` are now async (previously sync) to support
the async vault lookup; all callers must `await` them.

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

## Local Dev Fallback (no R2 configured)

When R2 credentials are absent (vault + env vars both missing), `putObject` automatically
falls back to writing files to `<cwd>/uploads/<key>` and returns a URL of the form
`${APP_BASE_URL}/uploads/<key>` (e.g. `http://localhost:3000/uploads/...`).

The API server serves `/uploads/*` via Hono's `serveStatic` middleware — no extra config needed.
Generated images show up in the UI, and the `uploads/` directory in the project root acts as a
temporary local R2 bucket.

To check whether R2 is configured:
```typescript
import { isR2Configured } from "@marketing-auto/adapter-storage";
const hasR2 = await isR2Configured(); // false = local fallback active
```

## Common Mistakes

- DO NOT call `r2.put` from request-handling code unless you control the input — body size
  isn't capped in the adapter; very large uploads block the worker
- DO NOT use the same `key` for different content (no auto-versioning) — generate unique keys
  via UUID or content hash
- DO NOT delete objects pointed to by published articles (you'd 404 the page)
