import type { GenerateImageInput } from "./types.ts";

/**
 * Maps our typed input to the Google Gemini Image API request body shape.
 * Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/<slug>:generateImage
 *
 * Body shape follows the Gemini Image preview API: a single image generation
 * request with imageConfig + optional seed. Aspect ratio is passed as the
 * canonical ratio string ("16:9", "1:1", …); the API picks the closest 2K-class
 * resolution. We do not request multiple candidates — caller asks for one image
 * per call so the cost model stays predictable.
 */
export function buildModelRequestBody(input: GenerateImageInput): Record<string, unknown> {
  const aspectRatio = input.aspectRatio ?? "16:9";
  const outputFormat = input.outputFormat ?? "webp";

  const imageConfig: Record<string, unknown> = {
    aspectRatio,
    outputMimeType: mimeFromFormat(outputFormat),
  };

  if (input.outputQuality !== undefined && outputFormat !== "png") {
    imageConfig.outputQuality = input.outputQuality;
  }

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }],
      },
    ],
    generationConfig: {
      candidateCount: 1,
      imageConfig,
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    },
  };

  return body;
}

function mimeFromFormat(format: string): string {
  switch (format) {
    case "webp":
      return "image/webp";
    case "png":
      return "image/png";
    case "jpg":
      return "image/jpeg";
    default:
      return "image/webp";
  }
}
