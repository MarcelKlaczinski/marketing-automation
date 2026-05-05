# Spec 12: Replicate Adapter

**Phase:** 2 (Cold-Start for KI-Wissensraum)
**Estimated Effort:** 1 day
**Dependencies:** Spec 00 (foundation), Spec 01 (db schema), Spec 03 (cost tracker), Spec 11 (anthropic adapter — pattern reference)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6

---

## Goal

Build the **typed Replicate API client** for image generation (Flux 1.1 Pro for hero images, Flux Schnell for social variants, Ideogram v3 for text-on-image). Generated images are uploaded to **Cloudflare R2** for stable URLs (Replicate's CDN URLs expire after 24h, which would break long-lived blog posts and social posts).

Two integrated capabilities in one spec:
1. **Replicate adapter**: typed `generateImage()` function with per-model schemas, cost tracking, retry handling
2. **Object storage adapter**: typed R2 client using Bun's native `Bun.S3Client`, used by the Replicate adapter to persist outputs

The R2 storage piece is needed *now* (not later) because the Replicate URL is ephemeral. Hero images need stable URLs to be embedded in published Astro articles.

This spec **follows the Spec 11 pattern**: typed entry points, mandatory cost-tracker integration, project-scoped operations, idempotent (same prompt + same model = re-runnable), generates `cost_logs` rows with usable metadata.

## Non-Goals

- No image-to-image yet (Flux Kontext models) — pure text-to-image only
- No batch generation — one image at a time per call (sufficient for our flow)
- No webhook-based async — `replicate.run()` is synchronous within ~10-30s, fits BullMQ job timing
- No Replicate model fine-tuning support
- No image processing (resize, optimize, AVIF conversion) — that's a separate concern, handled in the Astro deploy adapter (Spec 21)
- No CDN-cache-warming — R2 has its own caching once a URL is hit
- No image dedup by content hash — we accept duplicate stores; storage cost is negligible (~€0.015/GB/month on R2)

## User-Facing Behavior (for developers writing pipeline steps)

After this spec, a hero-image step looks like this:

```typescript
import { replicate } from "@marketing-auto/adapter-replicate";

class GenerateHeroImageStep extends BaseStep<{...}, { imageUrl: string }> {
  async execute(input, ctx) {
    const result = await replicate.generateImage({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      articleId: input.articleId,
      operation: "hero-image",
      model: "flux-1.1-pro",
      prompt: `Modern editorial illustration: ${input.topic}, ...`,
      aspectRatio: "16:9",
      outputFormat: "webp",
      quality: 90,
      // optional: seed for reproducibility
    });

    return { imageUrl: result.publicUrl };
  }
}
```

Returns:
- `publicUrl`: stable Cloudflare R2 URL (or your custom-domain URL when configured)
- `r2Key`: the object key for later management (delete, move, etc.)
- `bytesStored`: file size
- `replicateUrl`: original Replicate URL for debugging (expires; don't persist)

## Detailed Implementation

### Setup: R2 Bucket

Marcel needs to:

1. **Create R2 bucket** in Cloudflare dashboard:
  - Name: `marketing-auto-assets` (or any unique name)
  - Location hint: EU (closer to DE users)
2. **Create API token** at *R2 → Manage API tokens*:
  - Permission: *Object Read & Write*
  - Specify bucket: `marketing-auto-assets`
  - Copy `Access Key ID`, `Secret Access Key`, and the S3 endpoint URL (`https://<account-id>.r2.cloudflarestorage.com`)
3. **(Recommended) Set up custom domain** for the bucket: e.g., `assets.marketing-auto.example.com`. Cloudflare → R2 → bucket → Settings → Public access → Connect Domain.
  - Without a custom domain, R2's public URLs require enabling "Public access" which is a one-click but exposes the entire bucket. Custom domain is cleaner.
4. Add to `.env`:
   ```
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=marketing-auto-assets
   R2_PUBLIC_BASE_URL=https://assets.marketing-auto.example.com
   ```
   `R2_PUBLIC_BASE_URL` falls back to a default if a custom domain isn't set up — see Step 3 of implementation.

### Update env config

Add to `packages/shared/src/config.ts` envSchema:

```typescript
// Cloudflare R2 (Spec 12)
R2_ACCOUNT_ID: optionalStr(z.string().min(1)),
R2_ACCESS_KEY_ID: optionalStr(z.string().min(1)),
R2_SECRET_ACCESS_KEY: optionalStr(z.string().min(1)),
R2_BUCKET: optionalStr(z.string().min(1)),
R2_PUBLIC_BASE_URL: optionalStr(z.string().url()),
```

(Reusing the `optionalStr()` helper from Spec 00's deviation — env-var-with-empty-string-coercion.)

Add to `.env.example`:
```bash
# Cloudflare R2 storage (Spec 12)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
# Optional: custom domain (https://assets.example.com). If unset, falls back to R2's pub URL.
R2_PUBLIC_BASE_URL=
```

### Storage Adapter (R2 via Bun.S3Client)

We house this under `packages/adapters/storage/` because (a) it's reusable for non-Replicate uploads later (e.g., generated PDFs), and (b) it follows the established adapters folder pattern.

`packages/adapters/storage/package.json`:

```json
{
  "name": "@marketing-auto/adapter-storage",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "cd ../../.. && bun test packages/adapters/storage/test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*"
  }
}
```

`packages/adapters/storage/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

`packages/adapters/storage/src/r2.ts`:

```typescript
import { S3Client, type S3File } from "bun";
import { getEnv, createLogger } from "@marketing-auto/shared";

const log = createLogger("storage-r2");

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;

  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    throw new Error(
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env",
    );
  }

  _client = new S3Client({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });
  return _client;
}

/**
 * Public URL for an object. Prefers custom domain (R2_PUBLIC_BASE_URL); falls back
 * to the R2.dev pub URL pattern (which requires public-bucket setting in dashboard).
 */
function publicUrlFor(key: string): string {
  const env = getEnv();
  if (env.R2_PUBLIC_BASE_URL) {
    return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  // Fallback: r2.dev URL. Requires bucket to be set to public access.
  // We don't recommend this for production — set R2_PUBLIC_BASE_URL.
  return `https://pub-${env.R2_ACCOUNT_ID}.r2.dev/${key}`;
}

export type PutObjectInput = {
  /** Object key (path within bucket). Should not start with /. */
  key: string;
  /** Body data. Bun's S3 client accepts Buffer, ArrayBuffer, Uint8Array, Blob, string, ReadableStream. */
  body: Buffer | ArrayBuffer | Uint8Array | Blob | string | ReadableStream;
  /** MIME type (e.g., "image/webp"). Falls back to "application/octet-stream". */
  contentType?: string;
  /** Cache-Control header. Default: "public, max-age=31536000, immutable" (suitable for content-addressed assets). */
  cacheControl?: string;
  /** Optional content-disposition (e.g., "attachment; filename=foo.png"). */
  contentDisposition?: string;
};

export type PutObjectResult = {
  key: string;
  publicUrl: string;
  bytesStored: number;
  contentType: string;
};

/**
 * Upload an object to R2. Returns the public URL.
 */
export async function putObject(input: PutObjectInput): Promise<PutObjectResult> {
  const client = getClient();
  const file = client.file(input.key);

  const contentType = input.contentType ?? "application/octet-stream";
  const cacheControl = input.cacheControl ?? "public, max-age=31536000, immutable";

  // Bun's S3 file.write() returns the bytes written
  const bytesStored = await file.write(input.body, {
    type: contentType,
    ...(input.contentDisposition && { acl: undefined }), // placeholder for content-disposition once Bun supports it
  });

  const url = publicUrlFor(input.key);

  log.debug({ key: input.key, bytesStored, contentType }, "R2 put");

  return {
    key: input.key,
    publicUrl: url,
    bytesStored,
    contentType,
  };
}

/**
 * Check whether an object exists.
 */
export async function objectExists(key: string): Promise<boolean> {
  const client = getClient();
  return await client.exists(key);
}

/**
 * Get a Bun S3File reference (lazy — no network IO until methods called).
 */
export function getFile(key: string): S3File {
  return getClient().file(key);
}

/**
 * Delete an object. Returns true if deleted, false if not found.
 */
export async function deleteObject(key: string): Promise<boolean> {
  const client = getClient();
  try {
    await client.delete(key);
    return true;
  } catch (e) {
    log.warn({ key, err: e }, "R2 delete failed");
    return false;
  }
}

/**
 * Generate a presigned URL for client-side upload or download.
 * Useful when you want a tenant to upload an image directly without going through your server.
 * Default expiration: 1 hour.
 */
export function presignedUrl(input: {
  key: string;
  method: "GET" | "PUT";
  expiresInSeconds?: number;
}): string {
  const client = getClient();
  return client.presign(input.key, {
    method: input.method,
    expiresIn: input.expiresInSeconds ?? 3600,
  });
}
```

`packages/adapters/storage/src/index.ts`:

```typescript
export {
  putObject,
  objectExists,
  getFile,
  deleteObject,
  presignedUrl,
  type PutObjectInput,
  type PutObjectResult,
} from "./r2.ts";

// Convenience namespace
import * as r2Module from "./r2.ts";
export const r2 = {
  put: r2Module.putObject,
  exists: r2Module.objectExists,
  file: r2Module.getFile,
  delete: r2Module.deleteObject,
  presign: r2Module.presignedUrl,
};
```

### Replicate Adapter

`packages/adapters/replicate/package.json`:

```json
{
  "name": "@marketing-auto/adapter-replicate",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "cd ../../.. && bun test packages/adapters/replicate/test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "@marketing-auto/cost-tracker": "workspace:*",
    "@marketing-auto/adapter-storage": "workspace:*",
    "replicate": "^1.0.0"
  },
  "devDependencies": {
    "drizzle-orm": "^0.36.0"
  }
}
```

`packages/adapters/replicate/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

### Types

`packages/adapters/replicate/src/types.ts`:

```typescript
/**
 * Models we use, mapped to Replicate's slugs.
 * Add new models here, with their typed input shape.
 */
export const REPLICATE_MODELS = {
  "flux-1.1-pro":   "black-forest-labs/flux-1.1-pro",
  "flux-schnell":   "black-forest-labs/flux-schnell",
  "ideogram-v3":    "ideogram-ai/ideogram-v3",
} as const;

export type ReplicateModel = keyof typeof REPLICATE_MODELS;

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9" | "3:2" | "2:3";

export type OutputFormat = "webp" | "jpg" | "png";

/**
 * Common input across image generation models.
 * Per-model input quirks are mapped in client.ts (e.g., flux-schnell ignores `quality`).
 */
export type GenerateImageInput = {
  // Tracking
  projectId: string;
  pipelineRunId?: string;
  articleId?: string;
  /** cost_logs operation field (e.g., "hero-image", "social-carousel-slide"). */
  operation: string;

  // Generation
  model: ReplicateModel;
  prompt: string;
  /** Optional negative prompt (Ideogram supports it; Flux ignores). */
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  outputFormat?: OutputFormat;
  /** 1-100, higher = better quality. flux-1.1-pro: maps to "output_quality" 80-100. */
  quality?: number;
  /** Random seed for reproducibility. If omitted, a random seed is used. */
  seed?: number;

  // Storage
  /**
   * R2 key prefix for storage. The actual key will be `${prefix}/<uuid>.<ext>`.
   * Example: "ki-wissensraum/articles/hero" → "ki-wissensraum/articles/hero/<uuid>.webp"
   */
  storagePrefix: string;

  /** Pre-flight cost estimate in EUR (for cost-tracker limit check). */
  estimatedCostEur: number;
};

export type GenerateImageResult = {
  /** Stable, public Cloudflare R2 URL. */
  publicUrl: string;
  /** R2 object key for later management. */
  r2Key: string;
  /** Size of stored file in bytes. */
  bytesStored: number;
  /** MIME type (e.g., "image/webp"). */
  contentType: string;
  /** Original Replicate URL — expires in 24h. For debug only. */
  replicateUrl: string;
  /** The seed actually used (random one if not provided). Useful for reproduction. */
  seed: number | null;
};

export class ReplicateGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ReplicateGenerationError";
  }
}
```

### Per-Model Input Builders

Each model has slightly different input shape. We isolate that in one place.

`packages/adapters/replicate/src/model-inputs.ts`:

```typescript
import type { GenerateImageInput } from "./types.ts";

/**
 * Maps our typed input to model-specific Replicate inputs.
 * Add a branch when adding a new model.
 */
export function buildModelInput(input: GenerateImageInput): Record<string, unknown> {
  switch (input.model) {
    case "flux-1.1-pro":
      return {
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio ?? "16:9",
        output_format: input.outputFormat ?? "webp",
        output_quality: input.quality ?? 90,
        ...(input.seed !== undefined && { seed: input.seed }),
        // flux-1.1-pro defaults: safety_tolerance: 2, prompt_upsampling: false
      };

    case "flux-schnell":
      return {
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio ?? "1:1",
        output_format: input.outputFormat ?? "webp",
        output_quality: input.quality ?? 80, // Schnell tops out around 80 visual quality
        num_outputs: 1,
        num_inference_steps: 4, // Schnell's signature: 4 steps
        ...(input.seed !== undefined && { seed: input.seed }),
      };

    case "ideogram-v3":
      return {
        prompt: input.prompt,
        ...(input.negativePrompt && { negative_prompt: input.negativePrompt }),
        aspect_ratio: input.aspectRatio ?? "16:9",
        // Ideogram v3 quality controlled via `style_type`, not numeric
        magic_prompt_option: "Auto",
        ...(input.seed !== undefined && { seed: input.seed }),
      };

    default: {
      const _exhaustive: never = input.model;
      throw new Error(`Unhandled model: ${_exhaustive}`);
    }
  }
}
```

### The Adapter

`packages/adapters/replicate/src/client.ts`:

```typescript
import Replicate, { type Prediction } from "replicate";
import { randomUUID } from "node:crypto";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { track, replicateImageCostEur, type ReplicateModel as CostReplicateModel } from "@marketing-auto/cost-tracker";
import { putObject } from "@marketing-auto/adapter-storage";
import {
  REPLICATE_MODELS,
  type GenerateImageInput,
  type GenerateImageResult,
  ReplicateGenerationError,
} from "./types.ts";
import { buildModelInput } from "./model-inputs.ts";

const log = createLogger("replicate");

let _client: Replicate | null = null;
function getClient(): Replicate {
  if (_client) return _client;
  const env = getEnv();
  if (!env.REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN is not set");
  }
  _client = new Replicate({
    auth: env.REPLICATE_API_TOKEN,
    // Don't use FileOutput — we want plain URLs for downloading and re-uploading to R2
    useFileOutput: false,
  });
  return _client;
}

/**
 * Maps our model alias to the cost-tracker's ReplicateModel union.
 * This is the bridge between our short-form names and the cost calculator.
 */
const COST_MODEL_MAP: Record<keyof typeof REPLICATE_MODELS, CostReplicateModel> = {
  "flux-1.1-pro":   "black-forest-labs/flux-1.1-pro",
  "flux-schnell":   "black-forest-labs/flux-schnell",
  "ideogram-v3":    "ideogram-ai/ideogram-v3",
};

const FORMAT_TO_EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png":  "png",
};

const FORMAT_TO_MIME: Record<string, string> = {
  webp: "image/webp",
  jpg:  "image/jpeg",
  png:  "image/png",
};

/**
 * Extracts a single image URL from Replicate's varied output shape.
 * Replicate.run() can return: string, string[], { output: ... }, etc.
 */
function extractImageUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0];
  if (output && typeof output === "object" && "url" in output) {
    const url = (output as { url: unknown }).url;
    if (typeof url === "string") return url;
    if (typeof url === "function") {
      const v = (url as () => unknown)();
      if (typeof v === "string") return v;
    }
  }
  return null;
}

/**
 * Generate an image, store it to R2, return the stable public URL.
 */
export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const client = getClient();
  const modelSlug = REPLICATE_MODELS[input.model];
  const modelInput = buildModelInput(input);
  const ext = input.outputFormat ?? "webp";
  const mime = FORMAT_TO_MIME[ext] ?? "image/octet-stream";

  log.debug({
    projectId: input.projectId,
    operation: input.operation,
    model: input.model,
    promptLen: input.prompt.length,
    aspectRatio: input.aspectRatio,
    storagePrefix: input.storagePrefix,
  }, "Generating image");

  // We track BOTH the Replicate generation cost AND (separately, free) the R2 storage.
  // R2 storage cost is negligible at our volume (~€0.015/GB/month) — we don't track it.
  const result = await track({
    projectId: input.projectId,
    service: "replicate",
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    fn: async () => {
      let prediction: Prediction | null = null;
      let output: unknown;
      try {
        // Use predictions.create + wait for full Prediction object (includes seed, metrics).
        // replicate.run() doesn't expose the prediction record.
        prediction = await client.predictions.create({
          model: modelSlug,
          input: modelInput,
          wait: { interval: 1000 }, // poll every 1s up to ~60s, sync API
        });

        // The wait option puts the resolved prediction in `prediction` on success.
        if (prediction.status === "failed" || prediction.status === "canceled") {
          throw new ReplicateGenerationError(
            `Replicate prediction ${prediction.status}: ${prediction.error ?? "unknown error"}`,
          );
        }
        if (prediction.status !== "succeeded") {
          throw new ReplicateGenerationError(
            `Replicate prediction unexpected status: ${prediction.status}`,
          );
        }

        output = prediction.output;
      } catch (e) {
        if (e instanceof ReplicateGenerationError) throw e;
        throw new ReplicateGenerationError("Replicate API call failed", e);
      }

      const replicateUrl = extractImageUrl(output);
      if (!replicateUrl) {
        throw new ReplicateGenerationError(
          `Replicate output did not contain a URL. Got: ${JSON.stringify(output).slice(0, 200)}`,
        );
      }

      // Download from Replicate (their CDN), upload to R2
      const downloadResp = await fetch(replicateUrl);
      if (!downloadResp.ok) {
        throw new ReplicateGenerationError(
          `Failed to download Replicate output: ${downloadResp.status} ${downloadResp.statusText}`,
        );
      }
      const bodyBuffer = new Uint8Array(await downloadResp.arrayBuffer());

      const key = `${input.storagePrefix.replace(/^\/|\/$/g, "")}/${randomUUID()}.${ext}`;
      const stored = await putObject({
        key,
        body: bodyBuffer,
        contentType: mime,
        cacheControl: "public, max-age=31536000, immutable",
      });

      // Extract the actual seed used (Flux returns it in the prediction; Ideogram in metadata)
      const seedUsed = (prediction.input as Record<string, unknown> | null)?.seed;
      const seed = typeof seedUsed === "number" ? seedUsed : null;

      return {
        publicUrl: stored.publicUrl,
        r2Key: stored.key,
        bytesStored: stored.bytesStored,
        contentType: stored.contentType,
        replicateUrl,
        seed,
        prediction,  // returned to track() so cost calculation has access
      };
    },
    computeCostEur: () => {
      // Replicate prices per-image, not per-token. count = 1.
      return replicateImageCostEur({
        model: COST_MODEL_MAP[input.model],
        count: 1,
      });
    },
    metadata: (r) => ({
      model: input.model,
      modelSlug,
      r2Key: r.r2Key,
      bytesStored: r.bytesStored,
      seed: r.seed,
      predictionId: r.prediction.id,
      durationMs: (r.prediction.metrics?.predict_time ?? 0) * 1000,
    }),
  });

  log.info({
    projectId: input.projectId,
    operation: input.operation,
    model: input.model,
    publicUrl: result.publicUrl,
    bytesStored: result.bytesStored,
  }, "Image generated and stored");

  // Strip `prediction` from the returned shape (it was for track's metadata only)
  return {
    publicUrl: result.publicUrl,
    r2Key: result.r2Key,
    bytesStored: result.bytesStored,
    contentType: result.contentType,
    replicateUrl: result.replicateUrl,
    seed: result.seed,
  };
}
```

### Public API & Index

`packages/adapters/replicate/src/index.ts`:

```typescript
export { generateImage } from "./client.ts";
export {
  REPLICATE_MODELS,
  type ReplicateModel,
  type AspectRatio,
  type OutputFormat,
  type GenerateImageInput,
  type GenerateImageResult,
  ReplicateGenerationError,
} from "./types.ts";

import { generateImage as _generateImage } from "./client.ts";
export const replicate = {
  generateImage: _generateImage,
};
```

### CLAUDE.md files

`packages/adapters/replicate/CLAUDE.md`:

```markdown
# Replicate Adapter

Image generation via Replicate. Outputs are downloaded and re-stored to R2 for stable URLs.

## Hard Rules

- ALL pipeline steps that need an image use this adapter — never `replicate` directly
- EVERY call requires `projectId`, `operation`, `estimatedCostEur`, and `storagePrefix`
- Generated URLs are R2-backed (stable). Replicate's URLs expire in 24h — never persist them.
- The `storagePrefix` should encode tenant + content-type (e.g. `ki-wissensraum/articles/hero`)
  so R2 stays browsable

## Model Routing

- `flux-1.1-pro`: hero images, anything article-quality, high prompt adherence
- `flux-schnell`: social variants, thumbnails, anything where speed/cost matter (~13× cheaper)
- `ideogram-v3`: anything with on-image text (quote cards, listicle covers)

When in doubt, use `flux-1.1-pro` for "important" images, `flux-schnell` for "supporting".

## Common Mistakes

- DO NOT pass `storagePrefix` starting or ending with `/` (the adapter strips them, but cleanly)
- DO NOT exceed quality 100 on flux-1.1-pro (no effect; just wasted typing)
- DO NOT use `flux-schnell` for hero images — visible quality drop on close inspection
- DO NOT skip `seed` if you need reproducibility (e.g., regenerating the same hero after edits)
- DO NOT call this in a tight loop — each call is ~10-20s; budget time accordingly in pipelines
```

`packages/adapters/storage/CLAUDE.md`:

```markdown
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
```

## Acceptance Criteria

### Storage adapter
- [ ] `bun --filter @marketing-auto/adapter-storage typecheck` passes
- [ ] `r2.put({ key: "test/foo.txt", body: "hello", contentType: "text/plain" })` returns a `publicUrl` that, when fetched, returns "hello"
- [ ] `r2.exists("test/foo.txt")` returns `true` after put, `false` after delete
- [ ] `r2.delete("test/foo.txt")` returns true; second call returns false (or true silently — verify R2 behavior, document either way)
- [ ] When `R2_PUBLIC_BASE_URL` is set, returned URL uses custom domain
- [ ] When `R2_PUBLIC_BASE_URL` is unset, returned URL uses `pub-<accountId>.r2.dev` pattern
- [ ] Adapter throws clear error if any of the four R2 env vars missing
- [ ] `presignedUrl({ key, method: "GET" })` returns a string starting with `https://`

### Replicate adapter
- [ ] `bun --filter @marketing-auto/adapter-replicate typecheck` passes
- [ ] `generateImage({ model: "flux-1.1-pro", prompt: "..." })` succeeds against live API
- [ ] Result URL is R2-hosted (matches `R2_PUBLIC_BASE_URL` prefix)
- [ ] Fetching the result URL returns the actual image bytes (not 404, not 403)
- [ ] `cost_logs` row created with `service = "replicate"`, `cost_eur > 0`, metadata containing `model`, `r2Key`, `bytesStored`, `predictionId`
- [ ] Same `seed` produces the same image (test with two calls)
- [ ] All three models (`flux-1.1-pro`, `flux-schnell`, `ideogram-v3`) accept calls without crashing
- [ ] Cost-limit-exceeded scenario throws `CostLimitExceeded` (no Replicate call made)
- [ ] Replicate API failure (e.g. invalid prompt blocked by safety) throws `ReplicateGenerationError`
- [ ] R2 download-and-reupload happens correctly (verify the file at the public URL is the same as the Replicate URL during the brief window the latter still works)

## Testing Strategy

Live tests gated by `RUN_LIVE_REPLICATE=1` and `RUN_LIVE_R2=1`. Default: skipped in CI to avoid spend.

`packages/adapters/storage/test/r2.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "bun:test";
import { r2 } from "../src/index.ts";

const live = process.env.RUN_LIVE_R2 === "1";
const describeLive = live ? describe : describe.skip;

describeLive("R2 storage (LIVE)", () => {
  const testKey = `test/spec-12-${Date.now()}.txt`;

  afterEach(async () => {
    try { await r2.delete(testKey); } catch {}
  });

  it("puts a string and reads it back via fetch", async () => {
    const result = await r2.put({
      key: testKey,
      body: "hello world",
      contentType: "text/plain",
    });
    expect(result.publicUrl).toMatch(/^https:\/\//);
    expect(result.bytesStored).toBe(11);

    const resp = await fetch(result.publicUrl);
    expect(resp.status).toBe(200);
    const text = await resp.text();
    expect(text).toBe("hello world");
  });

  it("exists returns true after put, false after delete", async () => {
    await r2.put({ key: testKey, body: "x" });
    expect(await r2.exists(testKey)).toBe(true);
    await r2.delete(testKey);
    expect(await r2.exists(testKey)).toBe(false);
  });

  it("presignedUrl returns a signed URL", () => {
    const url = r2.presign({ key: testKey, method: "GET" });
    expect(url).toMatch(/^https:\/\//);
    expect(url).toContain("X-Amz-Signature");
  });
});
```

`packages/adapters/replicate/test/replicate.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, costLogs } from "@marketing-auto/db";
import { generateImage, ReplicateGenerationError } from "../src/index.ts";

const live = process.env.RUN_LIVE_REPLICATE === "1";
const describeLive = live ? describe : describe.skip;

describeLive("Replicate adapter (LIVE)", () => {
  let projectId: string;
  const slug = `replicate-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug,
      name: "Replicate Adapter Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      costLimits: { daily: { replicate: 0.5 }, monthly: { replicate: 5 } },
    }).returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("generates a flux-1.1-pro image and stores to R2", async () => {
    const result = await generateImage({
      projectId,
      operation: "test-flux-pro",
      model: "flux-1.1-pro",
      prompt: "minimalist abstract illustration of a circle, monochrome, editorial style",
      aspectRatio: "16:9",
      outputFormat: "webp",
      quality: 90,
      storagePrefix: `${slug}/test`,
      estimatedCostEur: 0.05,
    });

    expect(result.publicUrl).toMatch(/^https:\/\//);
    expect(result.r2Key).toContain(slug);
    expect(result.r2Key.endsWith(".webp")).toBe(true);
    expect(result.bytesStored).toBeGreaterThan(1000); // not an empty file

    // Fetch the actual image, ensure it's served
    const resp = await fetch(result.publicUrl);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("image/webp");

    // Cost log written
    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs.length).toBe(1);
    expect(logs[0]!.service).toBe("replicate");
    expect(Number(logs[0]!.costEur)).toBeGreaterThan(0);
    const meta = logs[0]!.metadata as Record<string, unknown>;
    expect(meta.model).toBe("flux-1.1-pro");
    expect(meta.r2Key).toBe(result.r2Key);
  }, 60_000);

  it("flux-schnell completes faster and cheaper", async () => {
    const start = Date.now();
    const result = await generateImage({
      projectId,
      operation: "test-flux-schnell",
      model: "flux-schnell",
      prompt: "abstract gradient",
      aspectRatio: "1:1",
      storagePrefix: `${slug}/test`,
      estimatedCostEur: 0.01,
    });
    const durationMs = Date.now() - start;

    expect(result.publicUrl).toMatch(/^https:\/\//);
    expect(durationMs).toBeLessThan(15_000); // schnell is fast
  }, 30_000);
});

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.generateImage).toBe("function");
    expect(typeof mod.replicate.generateImage).toBe("function");
    expect(mod.REPLICATE_MODELS["flux-1.1-pro"]).toBe("black-forest-labs/flux-1.1-pro");
  });
});
```

For local manual testing, run with both flags:
```bash
RUN_LIVE_R2=1 RUN_LIVE_REPLICATE=1 bun --filter @marketing-auto/adapter-replicate test
```
Expected total cost: < $0.20 (one flux-pro + one flux-schnell + a few R2 puts).

## Open Questions / Decisions Made

**Decision 1: Bun's native `Bun.S3Client` over `@aws-sdk/client-s3`.**
Native, zero deps, ~50MB smaller bundle. Works with R2's S3-compatible API without polyfills. AWS SDK is overkill for our needs.

**Decision 2: Re-store Replicate output to R2 instead of using Replicate URLs directly.**
Replicate URLs expire in 24h. Embedding them in published Astro articles is a guaranteed 404 in 2 days. The download-then-upload adds ~1-2s but is mandatory for stable content.

**Decision 3: One adapter package per service, not a meta "media" package.**
`replicate` and `storage` are separate packages even though Replicate uses Storage internally. Keeps boundaries clean — pipeline steps that don't need image generation but need raw R2 (e.g., uploading a PDF in Spec 21+) just import storage.

**Decision 4: `predictions.create` with `wait: { interval: 1000 }` instead of `replicate.run()`.**
`replicate.run()` doesn't return the full Prediction object (no metrics, no seed visibility). The lower-level API gives us those for cost-log metadata.

**Decision 5: `useFileOutput: false` in the Replicate client.**
The new `FileOutput` API streams from Replicate's CDN — useful when going directly to disk, awkward when we need to download-then-reupload. `useFileOutput: false` returns plain URLs, simpler.

**Decision 6: `outputFormat: "webp"` as default.**
WebP is universally supported in modern browsers, ~25% smaller than equivalent JPEG, lossless option available. Astro's image pipeline handles WebP natively. AVIF would be even smaller but less compatible — defer to article publish step (Spec 21) for AVIF conversion if needed.

**Decision 7: 1-year immutable cache headers on R2 objects.**
Filenames contain UUIDs (content-addressed in effect). Browser/CDN caching is safe forever. If someone wants to "update" an image, they generate a new one with a new UUID.

**Decision 8: We do NOT track R2 storage costs.**
At our volume (~30 images/month × ~200KB = 6MB/month), R2 storage is sub-€0.01/month. Tracking adds noise to cost dashboards. If a project produces thousands of images, revisit.

**Decision 9: `storagePrefix` is caller's responsibility, not derived from project slug.**
Caller knows context — `<slug>/articles/hero` vs `<slug>/articles/inline` vs `<slug>/social/carousel`. Hardcoding the structure in the adapter would limit future use cases (PDFs, exports, etc.).

**Decision 10: Image-format → MIME map is a static lookup, not a library call.**
Three formats (`webp`, `jpg`, `png`) cover us. Adding a `mime-types` dep would be over-engineering.

## Implementation Order

1. Add R2 env vars to `packages/shared/src/config.ts` and `.env.example`
2. Create `packages/adapters/storage/` package (minimal — just the R2 wrapper)
3. Implement `r2.ts`, `index.ts`, `CLAUDE.md`
4. Test storage adapter manually with `RUN_LIVE_R2=1` (write a simple text file, verify URL works)
5. Create `packages/adapters/replicate/` package
6. Implement `types.ts` (no logic, just contract)
7. Implement `model-inputs.ts`
8. Implement `client.ts`
9. Implement `index.ts`, `CLAUDE.md`
10. `bun install` (pulls `replicate`)
11. `bun --filter @marketing-auto/adapter-replicate typecheck`
12. Manual test with `RUN_LIVE_REPLICATE=1 RUN_LIVE_R2=1`
13. Verify `cost_logs` rows in Drizzle Studio
14. Verify generated image at returned URL is viewable in browser
15. Commit: `feat(adapters): replicate image generation with R2 storage (spec 12)`

## Splitting Plan

This is borderline 1-day. Natural split if pressure shows up:

- **Session A (storage)**: Steps 1-4. R2 adapter only. Commit when text-file test works.
- **Session B (replicate)**: Steps 5-15. Replicate adapter using the storage adapter. Commit when end-to-end test works.

Run `/clear` between sessions.

## Discovered During Implementation

- **`Bun.S3Client.file().write()` does not accept `ReadableStream`** — the Bun type definition for `S3File.write()` accepts `string | ArrayBuffer | SharedArrayBuffer | Blob | S3File | ArrayBufferView | Request | Response | BunFile | Archive`, but not `ReadableStream`. The spec's `PutObjectInput.body` type was simplified to exclude `ReadableStream`. In practice we always pass `Uint8Array` from `fetch().arrayBuffer()`, so no impact.

- **`Error.cause` is reserved in modern TypeScript ESNext lib** — subclassing `Error` with a constructor parameter property named `cause` triggers TS4115 ("must have an `override` modifier"). Renamed to `originalCause` on `ReplicateGenerationError`. Callers should use `err.originalCause` when inspecting the root error.

- **`types: ["bun"]` in adapter-level tsconfig crashes typecheck** — adding `"types": ["bun"]` + `"typeRoots"` to a package tsconfig that extends `tsconfig.base.json` produces `Cannot find type definition file for 'bun'`. The Bun types resolve correctly via the workspace root without explicit declaration. Do NOT add these fields to adapter tsconfigs (the existing anthropic adapter also omits them).

## Deviations

- **`wait: 60` instead of `wait: { interval: 1000 }`** — the `replicate` npm SDK types the `wait` option on `predictions.create` as `number | boolean`, not `{ interval: number }`. Using `wait: 60` waits up to 60 seconds synchronously, which achieves the same behaviour as the spec intended.

- **`negativePrompt` guard is `!== undefined && !== ""`** — the spec used a loose truthiness check (`input.negativePrompt && ...`). Changed to explicit `!== undefined && !==  ""` so that an explicitly-passed empty string is treated the same as an absent field (Ideogram rejects empty negative prompts).
