// Spec 64.7: Google Gemini Batch API for hero-image generation.
//
// The plan-coordinator (apps/api/src/lib/plan-image-batch-coordinator.ts) collects
// pending image_batch_requests rows for an approved weekly_plan and calls
// `createImageBatch` ONCE per plan. The image-batch-processor.worker.ts then
// polls `retrieveImageBatchResults` hourly and re-enqueues suspended pipelines
// via image-batch-resume.ts.
//
// API contract (verified against https://ai.google.dev/gemini-api/docs/batch-api
// 2026-05-23, see Spec 64.7 §11 for delta vs spec sketch):
//
//   POST  https://generativelanguage.googleapis.com/v1beta/models/{modelSlug}:batchGenerateContent
//   GET   https://generativelanguage.googleapis.com/v1beta/{batchName}
//
// All requests in one batch share the same model (the endpoint encodes the model
// in the path). The coordinator splits per-model when a plan mixes providers.
//
// Inline-request mode: results land in the retrieve response under
// `inlinedResponses[]`, no separate JSONL download needed (fits ≤50 hero images
// per batch comfortably).

import { getGlobal } from "@marketing-auto/core/credentials";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { buildModelRequestBody } from "./model-inputs.ts";
import {
  NANO_BANANA_MODELS,
  NanoBananaGenerationError,
  type NanoBananaModel,
  type NanoBananaResolution,
} from "./types.ts";

const log = createLogger("nano-banana-batch");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Same retry profile as the sync adapter — 5xx + 429 retry, 4xx fail-fast.
// Batch endpoints don't usually 429 the same way (the work is queued, not
// executed inline), but the create call can still 429 on quota burst.
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const RATE_LIMIT_BASE_BACKOFF_MS = 1000;

async function getApiKey(): Promise<string> {
  const fromVault = await getGlobal("nano-banana", "api_key");
  if (fromVault) return fromVault;
  const fromEnv = getEnv().GOOGLE_GEMINI_API_KEY;
  if (fromEnv) return fromEnv;
  throw new NanoBananaGenerationError(
    "Google Gemini API key not configured (set via installer/vault as ('nano-banana', 'api_key') or GOOGLE_GEMINI_API_KEY env)"
  );
}

// ─── Public types ──────────────────────────────────────────────────────────────

/**
 * A single per-request entry inside one `createImageBatch` call. The plan
 * coordinator maps each pending `image_batch_requests` row to one of these.
 */
export type BatchImageRequest = {
  /**
   * Stable correlation key (e.g. `img-{pipelineRunId}`). Round-trips as
   * `metadata.key` in the Gemini request and `key` on the inlined response.
   * Pattern 119 separator constraint: `^[a-zA-Z0-9_-]{1,64}$` — `-` is safe.
   */
  customId: string;
  prompt: string;
  resolution: NanoBananaResolution;
  aspectRatio: "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "4:5";
  seed: number;
  outputFormat: "webp" | "png" | "jpg";
  /** R2 prefix for the resulting object (e.g. `toolwiki/articles/hero`). */
  storagePrefix: string;
};

export type BatchCreateResult = {
  /** Full Gemini resource name, format `batches/{numericId}`. */
  batchName: string;
  /** Number of requests submitted (echo of input array length, for logging). */
  requestCount: number;
};

/**
 * Mapped from Gemini's `JOB_STATE_*` enum to a 3-state representation. The
 * processor only cares about three buckets:
 *   - processing → keep polling
 *   - succeeded  → fetch results + resume pipelines
 *   - failed     → mark all rows failed, surface to UI
 */
export type BatchState = "processing" | "succeeded" | "failed";

export type RetrieveBatchResult = {
  state: BatchState;
  /**
   * Raw Gemini `state` string (e.g. `JOB_STATE_RUNNING`). Useful for logs +
   * surfacing the precise state to the UI. Includes terminal-but-non-success
   * states like `JOB_STATE_CANCELLED` / `JOB_STATE_EXPIRED` mapped to "failed".
   */
  rawState: string;
};

/**
 * One result entry after batch completion. Spec 64.15 Phase A: the adapter no
 * longer touches R2 — it returns raw decoded bytes + the sniff-able format hint
 * so the worker can route the bytes through `@marketing-auto/adapter-image-webp`
 * (Pattern 119). The worker owns DB context (projectId, storagePrefix) and is
 * the natural site for the storage hop.
 *
 * On the failure path, `error` is populated — HeroImageStep's graceful-skip
 * kicks in on resume.
 */
export type BatchImageResult =
  | {
      customId: string;
      status: "succeeded";
      imageBytes: Uint8Array;
      /** MIME-style format hint from Gemini's `inlineData.mimeType` (e.g. "webp", "png"). */
      contentTypeHint: string;
      seed: number | null;
    }
  | {
      customId: string;
      status: "failed";
      error: string;
    };

// ─── Implementation ────────────────────────────────────────────────────────────

/**
 * POST a batch to Gemini. All requests share the model encoded in the endpoint
 * path — the coordinator pre-groups by model before calling.
 *
 * Returns the assigned `batches/{id}` name. The actual generation is async;
 * the caller stores `batchName` and polls via `retrieveBatch`.
 */
export async function createImageBatch(input: {
  model: NanoBananaModel;
  displayName: string;
  requests: BatchImageRequest[];
}): Promise<BatchCreateResult> {
  if (input.requests.length === 0) {
    throw new NanoBananaGenerationError("createImageBatch called with empty requests array");
  }

  const apiKey = await getApiKey();
  const modelSlug = NANO_BANANA_MODELS[input.model];
  const url = `${GEMINI_API_BASE}/models/${modelSlug}:batchGenerateContent`;

  // One per-request body per pending row. Reuses the sync adapter's
  // `buildModelRequestBody` so request shape stays identical to sync mode —
  // any future field added to sync (e.g. negativePrompt) automatically applies
  // to batch.
  const innerRequests = input.requests.map((r) => ({
    request: buildModelRequestBody({
      // The fields below are required by GenerateImageInput's type but unused
      // by buildModelRequestBody — we satisfy the type, not the runtime.
      projectId: "(batch)",
      operation: "image_batch:submit",
      estimatedCostEur: 0,
      storagePrefix: r.storagePrefix,
      // Real fields used by buildModelRequestBody:
      model: input.model,
      prompt: r.prompt,
      aspectRatio: r.aspectRatio,
      resolution: r.resolution,
      seed: r.seed,
      outputFormat: r.outputFormat,
    }),
    metadata: { key: r.customId },
  }));

  const body = {
    batch: {
      display_name: input.displayName,
      input_config: {
        requests: {
          requests: innerRequests,
        },
      },
    },
  };

  const { response } = await callGeminiBatchWithRetry(url, apiKey, body);
  // Response shape: top-level `name` for the new contract OR `batch.name` for
  // the legacy wrapped shape. Accept both — the field appears to vary by region.
  const directName = response?.name;
  const nestedBatch = response?.batch as { name?: unknown } | undefined;
  const batchName =
    typeof directName === "string"
      ? directName
      : typeof nestedBatch?.name === "string"
        ? nestedBatch.name
        : undefined;
  if (typeof batchName !== "string" || !batchName.startsWith("batches/")) {
    throw new NanoBananaGenerationError(
      `Gemini batchGenerateContent response missing 'name' (got keys: ${Object.keys(response ?? {}).join(",")})`
    );
  }
  log.info(
    { batchName, requestCount: input.requests.length, model: input.model },
    "createImageBatch: submitted"
  );
  return { batchName, requestCount: input.requests.length };
}

/**
 * Get the current state of a batch. Maps Gemini's `JOB_STATE_*` to a 3-state
 * representation. Doesn't fetch results — call `fetchBatchResults` after seeing
 * "succeeded".
 */
export async function retrieveBatch(batchName: string): Promise<RetrieveBatchResult> {
  const apiKey = await getApiKey();
  const url = `${GEMINI_API_BASE}/${batchName}`;

  const { response } = await callGeminiBatchWithRetry(url, apiKey, null, "GET");
  const raw = extractStateString(response);
  return { state: classifyState(raw), rawState: raw };
}

function extractStateString(response: unknown): string {
  if (!response || typeof response !== "object") return "JOB_STATE_UNSPECIFIED";
  const obj = response as Record<string, unknown>;
  // Gemini docs show `state` at the top level of the batch object; some
  // response shapes wrap it under `metadata.state` instead, so accept both.
  const direct = typeof obj.state === "string" ? obj.state : null;
  if (direct) return direct;
  const meta = obj.metadata as Record<string, unknown> | undefined;
  if (meta && typeof meta.state === "string") return meta.state;
  return "JOB_STATE_UNSPECIFIED";
}

export function classifyState(rawState: string): BatchState {
  if (rawState === "JOB_STATE_SUCCEEDED") return "succeeded";
  if (
    rawState === "JOB_STATE_FAILED" ||
    rawState === "JOB_STATE_CANCELLED" ||
    rawState === "JOB_STATE_EXPIRED"
  ) {
    return "failed";
  }
  // PENDING / RUNNING / UNSPECIFIED → keep polling.
  return "processing";
}

/**
 * Fetch results for a SUCCEEDED batch.
 *
 * Returns one entry per customId. Mixed success/failure within a batch is
 * normal (one prompt can be blocked while others succeed) — caller handles
 * per-row status individually.
 *
 * Spec 64.15 Phase A: the adapter no longer uploads to R2. It returns raw
 * decoded bytes + a content-type hint so the worker can pipe them through
 * `@marketing-auto/adapter-image-webp` (Pattern 119: magic-byte sniff + WebP
 * conversion + forensic original side-by-side). The hint is only that — the
 * webp adapter sniffs the actual bytes (Gemini lies, per 64.6 Discovery #14).
 */
export async function fetchBatchResults(batchName: string): Promise<BatchImageResult[]> {
  const apiKey = await getApiKey();
  const url = `${GEMINI_API_BASE}/${batchName}`;

  const { response } = await callGeminiBatchWithRetry(url, apiKey, null, "GET");
  return parseAndStoreInlinedResponses(response as Record<string, unknown>);
}

/**
 * Pure helper exported for unit tests. Walks the retrieve response's
 * `inlinedResponses[]` array and extracts inline image bytes + format hint.
 *
 * No side effects — the caller (worker) owns the R2 upload via
 * `@marketing-auto/adapter-image-webp`.
 */
export async function parseAndStoreInlinedResponses(
  response: Record<string, unknown>
): Promise<BatchImageResult[]> {
  // Inline-mode results live at `response.response.inlinedResponses.inlinedResponses[]`
  // OR `response.inlinedResponses[]` depending on the response shape variant.
  // Accept both — Gemini's exact wrapping has shifted across API versions.
  const inlined = findInlinedResponses(response);
  if (!Array.isArray(inlined) || inlined.length === 0) {
    log.warn(
      { keys: Object.keys(response).join(",") },
      "fetchBatchResults: no inlinedResponses in batch retrieve"
    );
    return [];
  }

  const results: BatchImageResult[] = [];
  for (const entry of inlined) {
    const item = entry as Record<string, unknown>;
    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const customId = typeof metadata.key === "string" ? metadata.key : "";
    if (!customId) {
      log.warn({ item }, "fetchBatchResults: inlined response missing metadata.key — skipping");
      continue;
    }

    // Per-request error path: `item.error` populated (Gemini-side blocked /
    // safety / invalid prompt). No image to upload — surface to resume worker.
    const itemError = item.error as { message?: string; code?: number } | undefined;
    if (itemError?.message) {
      results.push({
        customId,
        status: "failed",
        error: `Gemini error code ${itemError.code ?? "n/a"}: ${itemError.message}`,
      });
      continue;
    }

    const responseObj = item.response as Record<string, unknown> | undefined;
    const inlineImage = extractFirstInlineImage(responseObj);
    if (!inlineImage) {
      results.push({
        customId,
        status: "failed",
        error: "Inlined response missing inline image data",
      });
      continue;
    }

    // Spec 64.15 Phase A: surface raw bytes — the worker will route through
    // adapter-image-webp for magic-byte sniff + sharp conversion + originals/
    // forensic copy. The contentTypeHint is from Gemini's `inlineData.mimeType`
    // and is informational only (the WebP adapter sniffs the actual bytes).
    results.push({
      customId,
      status: "succeeded",
      imageBytes: inlineImage.bytes,
      contentTypeHint: `image/${inlineImage.format}`,
      seed: inlineImage.seed,
    });
  }
  return results;
}

function findInlinedResponses(response: Record<string, unknown>): unknown[] | null {
  // Common shapes (observed across the Gemini API surface for batches):
  //   { response: { inlinedResponses: { inlinedResponses: [...] } } }
  //   { response: { inlinedResponses: [...] } }
  //   { inlinedResponses: [...] }
  const candidates = [
    (response.response as Record<string, unknown> | undefined)?.inlinedResponses,
    response.inlinedResponses,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
    if (c && typeof c === "object") {
      const inner = (c as Record<string, unknown>).inlinedResponses;
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}

function extractFirstInlineImage(
  responseObj: Record<string, unknown> | undefined
): { bytes: Uint8Array; format: string; seed: number | null } | null {
  if (!responseObj) return null;
  const candidates = responseObj.candidates as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (!first) return null;
  const content = first.content as Record<string, unknown> | undefined;
  const parts = content?.parts as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const inlineData = part.inlineData as { data?: string; mimeType?: string } | undefined;
    const data = inlineData?.data;
    if (typeof data !== "string") continue;
    const buffer = Buffer.from(data, "base64");
    const mime = inlineData?.mimeType ?? "image/webp";
    const format = mime.split("/")[1] ?? "webp";
    const seedRaw = first.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : null;
    return {
      bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      format,
      seed,
    };
  }
  return null;
}

// ─── HTTP transport (mirrors sync adapter's retry profile) ────────────────────

async function callGeminiBatchWithRetry(
  url: string,
  apiKey: string,
  body: Record<string, unknown> | null,
  method: "POST" | "GET" = "POST"
): Promise<{ response: Record<string, unknown> }> {
  let lastError: unknown = null;
  let lastWasRateLimit = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const init: RequestInit = {
        method,
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
      };
      if (body !== null) init.body = JSON.stringify(body);

      const resp = await fetch(url, init);

      if (resp.status === 429) {
        const text = await resp.text().catch(() => "");
        lastError = new NanoBananaGenerationError(
          `Gemini batch 429 ${resp.statusText}: ${text.slice(0, 200)}`
        );
        lastWasRateLimit = true;
        log.warn(
          { attempt, status: 429, bodyExcerpt: text.slice(0, 200) },
          "Batch 429 — backing off"
        );
      } else if (resp.status >= 500 && resp.status < 600) {
        const text = await resp.text().catch(() => "");
        lastError = new NanoBananaGenerationError(
          `Gemini batch ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`
        );
        lastWasRateLimit = false;
        log.warn({ attempt, status: resp.status }, "Batch transient failure — retrying");
      } else if (!resp.ok) {
        // 4xx (non-429) → fail-fast.
        const text = await resp.text().catch(() => "");
        throw new NanoBananaGenerationError(
          `Gemini batch ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`
        );
      } else {
        const json = (await resp.json()) as Record<string, unknown>;
        const apiError = json.error as { message?: string; code?: number } | undefined;
        if (apiError?.message) {
          throw new NanoBananaGenerationError(
            `Gemini batch API error: ${apiError.message} (code ${apiError.code ?? "n/a"})`
          );
        }
        return { response: json };
      }
    } catch (e) {
      if (
        e instanceof NanoBananaGenerationError &&
        !String(e.message).startsWith("Gemini batch 5") &&
        !String(e.message).startsWith("Gemini batch 429")
      ) {
        throw e;
      }
      lastError = e;
      lastWasRateLimit = false;
      log.warn({ attempt, err: e }, "Batch call threw — retrying");
    }

    if (attempt < MAX_ATTEMPTS) {
      const base = lastWasRateLimit ? RATE_LIMIT_BASE_BACKOFF_MS : BASE_BACKOFF_MS;
      const backoff = base * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  if (lastWasRateLimit) {
    throw new NanoBananaGenerationError(
      `Batch rate limited after ${MAX_ATTEMPTS} attempts`,
      lastError
    );
  }
  throw new NanoBananaGenerationError(
    `Batch call failed after ${MAX_ATTEMPTS} attempts`,
    lastError
  );
}
