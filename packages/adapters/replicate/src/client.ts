import Replicate from "replicate";
import type { Prediction } from "replicate";
import { randomUUID } from "node:crypto";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { getGlobal } from "@marketing-auto/core/credentials";
import { track, replicateImageCostEur } from "@marketing-auto/cost-tracker";
import type { ReplicateModel as CostReplicateModel } from "@marketing-auto/cost-tracker";
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

async function getApiToken(): Promise<string> {
  const fromVault = await getGlobal("replicate", "api_token");
  if (fromVault) return fromVault;
  const fromEnv = getEnv().REPLICATE_API_TOKEN;
  if (fromEnv) return fromEnv;
  throw new Error("Replicate API token not configured (set via installer or REPLICATE_API_TOKEN env)");
}

async function getClient(): Promise<Replicate> {
  if (_client) return _client;
  _client = new Replicate({
    auth: await getApiToken(),
    // Plain URLs instead of FileOutput — we download and re-upload to R2 ourselves
    useFileOutput: false,
  });
  return _client;
}

const COST_MODEL_MAP: Record<keyof typeof REPLICATE_MODELS, CostReplicateModel> = {
  "flux-1.1-pro": "black-forest-labs/flux-1.1-pro",
  "flux-schnell":  "black-forest-labs/flux-schnell",
  "ideogram-v3":   "ideogram-ai/ideogram-v3",
};

const FORMAT_TO_MIME: Record<string, string> = {
  webp: "image/webp",
  jpg:  "image/jpeg",
  png:  "image/png",
};

/**
 * Extracts a single image URL from Replicate's varied output shape.
 * replicate.run() can return: string, string[], { url: string | () => string }, etc.
 */
function extractImageUrl(output: unknown): string | null {
  if (typeof output === "string") return output;
  if (Array.isArray(output) && typeof output[0] === "string") return output[0] as string;
  if (output !== null && typeof output === "object" && "url" in output) {
    const url = (output as { url: unknown }).url;
    if (typeof url === "string") return url;
    if (typeof url === "function") {
      const v = (url as () => unknown)();
      if (typeof v === "string") return v;
    }
  }
  return null;
}

type TrackResult = GenerateImageResult & { prediction: Prediction };

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const client = await getClient();
  const modelSlug = REPLICATE_MODELS[input.model];
  const modelInput = buildModelInput(input);
  const ext = input.outputFormat ?? "webp";
  const mime = FORMAT_TO_MIME[ext] ?? "application/octet-stream";

  log.debug({
    projectId: input.projectId,
    operation: input.operation,
    model: input.model,
    promptLen: input.prompt.length,
    aspectRatio: input.aspectRatio,
    storagePrefix: input.storagePrefix,
  }, "Generating image");

  const trackInput = {
    projectId: input.projectId,
    service: "replicate" as const,
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    fn: async (): Promise<TrackResult> => {
      let prediction: Prediction;
      try {
        prediction = await client.predictions.create({
          model: modelSlug,
          input: modelInput,
          wait: 60,
        });

        if (prediction.status === "failed" || prediction.status === "canceled") {
          throw new ReplicateGenerationError(
            `Replicate prediction ${prediction.status}: ${String(prediction.error ?? "unknown error")}`,
          );
        }
        if (prediction.status !== "succeeded") {
          throw new ReplicateGenerationError(
            `Replicate prediction unexpected status: ${prediction.status}`,
          );
        }
      } catch (e) {
        if (e instanceof ReplicateGenerationError) throw e;
        throw new ReplicateGenerationError("Replicate API call failed", e);
      }

      const replicateUrl = extractImageUrl(prediction.output);
      if (!replicateUrl) {
        throw new ReplicateGenerationError(
          `Replicate output did not contain a URL. Got: ${JSON.stringify(prediction.output).slice(0, 200)}`,
        );
      }

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

      const seedUsed = (prediction.input as Record<string, unknown> | null)?.seed;
      const seed = typeof seedUsed === "number" ? seedUsed : null;

      return {
        publicUrl: stored.publicUrl,
        r2Key: stored.key,
        bytesStored: stored.bytesStored,
        contentType: stored.contentType,
        replicateUrl,
        seed,
        prediction,
      };
    },
    computeCostEur: () =>
      replicateImageCostEur({ model: COST_MODEL_MAP[input.model], count: 1 }),
    metadata: (r: TrackResult) => ({
      model: input.model,
      modelSlug,
      r2Key: r.r2Key,
      bytesStored: r.bytesStored,
      seed: r.seed,
      predictionId: r.prediction.id,
      durationMs: ((r.prediction.metrics?.predict_time ?? 0) as number) * 1000,
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

  log.info({
    projectId: input.projectId,
    operation: input.operation,
    model: input.model,
    publicUrl: result.publicUrl,
    bytesStored: result.bytesStored,
  }, "Image generated and stored");

  return {
    publicUrl: result.publicUrl,
    r2Key: result.r2Key,
    bytesStored: result.bytesStored,
    contentType: result.contentType,
    replicateUrl: result.replicateUrl,
    seed: result.seed,
  };
}
