import { randomUUID } from "node:crypto";
import { putObject } from "@marketing-auto/adapter-storage";
import { assertCostBudget, estimateCostEur } from "@marketing-auto/core/cost";
import { getGlobal } from "@marketing-auto/core/credentials";
import { nanoBananaImageCostEur, track } from "@marketing-auto/cost-tracker";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { buildModelRequestBody } from "./model-inputs.ts";
import {
  type GenerateImageInput,
  type GenerateImageResult,
  NANO_BANANA_MODELS,
  NanoBananaGenerationError,
} from "./types.ts";

const log = createLogger("nano-banana");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ATTEMPTS = 3;
// 5xx + network: 500ms / 1s / 2s (max 3.5s total wait)
const BASE_BACKOFF_MS = 500;
// Spec 64.6b: 429 rate-limit backoff is more aggressive — 1s / 2s / 4s (max 7s).
// Justification: quota recovery needs a longer window than a transient 5xx blip;
// hammering at 500ms during a 429 burst only burns more quota.
const RATE_LIMIT_BASE_BACKOFF_MS = 1000;

const FORMAT_TO_MIME: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
};

const FORMAT_TO_EXT: Record<string, string> = {
  webp: "webp",
  png: "png",
  jpg: "jpg",
};

async function getApiKey(): Promise<string> {
  const fromVault = await getGlobal("nano-banana", "api_key");
  if (fromVault) return fromVault;
  const fromEnv = getEnv().GOOGLE_GEMINI_API_KEY;
  if (fromEnv) return fromEnv;
  throw new NanoBananaGenerationError(
    "Google Gemini API key not configured (set via installer/vault as ('nano-banana', 'api_key') or GOOGLE_GEMINI_API_KEY env)"
  );
}

export type GeminiPart = {
  inlineData?: { mimeType?: string; data?: string };
  text?: string;
};

export type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  seed?: number;
};

export type GeminiResponse = {
  candidates?: GeminiCandidate[];
  error?: { message?: string; code?: number };
};

export function extractInlineImage(
  resp: GeminiResponse
): { bytes: Uint8Array; mimeType: string; seed: number | null } | null {
  const candidate = resp.candidates?.[0];
  if (!candidate) return null;
  const part = candidate.content?.parts?.find((p) => p.inlineData?.data);
  const data = part?.inlineData?.data;
  if (!data) return null;
  const buffer = Buffer.from(data, "base64");
  return {
    bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    mimeType: part?.inlineData?.mimeType ?? "image/webp",
    seed: typeof candidate.seed === "number" ? candidate.seed : null,
  };
}

export async function callGeminiWithRetry(
  url: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<{ response: GeminiResponse; durationMs: number }> {
  let lastError: unknown = null;
  let lastWasRateLimit = false;
  const totalStart = Date.now();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      // Spec 64.6b: 429 rate-limit gets its own retry branch with longer backoff
      // (1s/2s/4s). Failure message is distinct so callers + tests can tell apart
      // "quota exhausted" from "transient 5xx blip".
      if (resp.status === 429) {
        const text = await resp.text().catch(() => "");
        lastError = new NanoBananaGenerationError(
          `Gemini 429 ${resp.statusText}: ${text.slice(0, 200)}`
        );
        lastWasRateLimit = true;
        log.warn(
          { attempt, status: 429, bodyExcerpt: text.slice(0, 200) },
          "Gemini rate-limited — backing off"
        );
      } else if (resp.status >= 500 && resp.status < 600) {
        // 5xx → retryable transient
        const text = await resp.text().catch(() => "");
        lastError = new NanoBananaGenerationError(
          `Gemini ${resp.status} ${resp.statusText}: ${text.slice(0, 200)}`
        );
        lastWasRateLimit = false;
        log.warn({ attempt, status: resp.status }, "Gemini transient failure — retrying");
      } else if (!resp.ok) {
        // 4xx (non-429) → fail-fast. Auth, invalid prompt, blocked content — no point retrying.
        const text = await resp.text().catch(() => "");
        throw new NanoBananaGenerationError(
          `Gemini ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`
        );
      } else {
        const json = (await resp.json()) as GeminiResponse;
        if (json.error) {
          throw new NanoBananaGenerationError(
            `Gemini API error: ${json.error.message ?? "unknown"} (code ${json.error.code ?? "n/a"})`
          );
        }
        return { response: json, durationMs: Date.now() - totalStart };
      }
    } catch (e) {
      // Fail-fast errors (4xx non-429 + JSON parse + API error payloads) carry messages that
      // start with "Gemini <status>" or "Gemini API error". "Gemini 5" + "Gemini 429" are
      // the only patterns that go through the retry path.
      if (
        e instanceof NanoBananaGenerationError &&
        !String(e.message).startsWith("Gemini 5") &&
        !String(e.message).startsWith("Gemini 429")
      ) {
        throw e;
      }
      lastError = e;
      lastWasRateLimit = false;
      log.warn({ attempt, err: e }, "Gemini call threw — retrying");
    }

    if (attempt < MAX_ATTEMPTS) {
      const base = lastWasRateLimit ? RATE_LIMIT_BASE_BACKOFF_MS : BASE_BACKOFF_MS;
      const backoff = base * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  if (lastWasRateLimit) {
    throw new NanoBananaGenerationError(
      `Rate limited after ${MAX_ATTEMPTS} attempts`,
      lastError
    );
  }
  throw new NanoBananaGenerationError(
    `Gemini call failed after ${MAX_ATTEMPTS} attempts`,
    lastError
  );
}

type TrackResult = GenerateImageResult;

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  await assertCostBudget(
    input.projectId,
    "google-gemini",
    estimateCostEur("google-gemini", input.operation)
  );

  const apiKey = await getApiKey();
  const modelSlug = NANO_BANANA_MODELS[input.model];
  const url = `${GEMINI_API_BASE}/${modelSlug}:generateContent`;
  const body = buildModelRequestBody(input);
  const ext = FORMAT_TO_EXT[input.outputFormat ?? "webp"] ?? "webp";
  const fallbackMime = FORMAT_TO_MIME[input.outputFormat ?? "webp"] ?? "application/octet-stream";
  // Spec 64.6b: resolution flows through to cost calculation. Default "1k" mirrors the
  // projects.image_generation_resolution column default — callers that don't know the
  // resolution end up with the same accounting as legacy 64.6 callers.
  const resolution = input.resolution ?? "1k";

  log.debug(
    {
      projectId: input.projectId,
      operation: input.operation,
      model: input.model,
      modelSlug,
      promptLen: input.prompt.length,
      aspectRatio: input.aspectRatio,
      resolution,
      seedProvided: input.seed !== undefined,
      storagePrefix: input.storagePrefix,
    },
    "Generating image (Nano Banana)"
  );

  const trackInput = {
    projectId: input.projectId,
    service: "google-gemini" as const,
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    fn: async (): Promise<TrackResult> => {
      const { response, durationMs } = await callGeminiWithRetry(url, apiKey, body);
      const extracted = extractInlineImage(response);
      if (!extracted) {
        throw new NanoBananaGenerationError(
          `Gemini response missing inlineData. Keys: ${Object.keys(response).join(",")}`
        );
      }

      const mime = extracted.mimeType || fallbackMime;
      const key = `${input.storagePrefix.replace(/^\/|\/$/g, "")}/${randomUUID()}.${ext}`;
      const stored = await putObject({
        key,
        body: extracted.bytes,
        contentType: mime,
        cacheControl: "public, max-age=31536000, immutable",
      });

      return {
        publicUrl: stored.publicUrl,
        r2Key: stored.key,
        bytesStored: stored.bytesStored,
        contentType: stored.contentType,
        seed: extracted.seed ?? input.seed ?? null,
        durationMs,
        modelSlug,
      };
    },
    computeCostEur: () => nanoBananaImageCostEur({ model: input.model, resolution, count: 1 }),
    metadata: (r: TrackResult) => ({
      model: input.model,
      modelSlug,
      resolution,
      r2Key: r.r2Key,
      bytesStored: r.bytesStored,
      seed: r.seed,
      durationMs: r.durationMs,
    }),
  };

  // Add optional fields conditionally to satisfy exactOptionalPropertyTypes
  const result = await (input.pipelineRunId !== undefined && input.articleId !== undefined
    ? track({ ...trackInput, pipelineRunId: input.pipelineRunId, articleId: input.articleId })
    : input.pipelineRunId !== undefined
      ? track({ ...trackInput, pipelineRunId: input.pipelineRunId })
      : input.articleId !== undefined
        ? track({ ...trackInput, articleId: input.articleId })
        : track(trackInput));

  log.info(
    {
      projectId: input.projectId,
      operation: input.operation,
      model: input.model,
      publicUrl: result.publicUrl,
      bytesStored: result.bytesStored,
      seed: result.seed,
    },
    "Image generated and stored"
  );

  return result;
}
