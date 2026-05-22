import type { GenerateImageInput, NanoBananaResolution } from "./types.ts";

/**
 * Spec 64.6b: maps our lowercase resolution tokens to Gemini's `imageSize` strings.
 *
 * Gemini docs (https://ai.google.dev/gemini-api/docs/image-generation):
 * - Flash (gemini-3-flash-image-preview) supports: "512", "1K", "2K", "4K"
 * - Pro   (gemini-3-pro-image-preview)   supports: "1K",  "2K", "4K"  (no 512)
 * - "Lowercase parameters (e.g., 1k) will be rejected." Uppercase K only.
 * - 512 has NO 'K' suffix (asymmetric naming, verbatim from docs).
 */
const GEMINI_RESOLUTION_MAP: Record<NanoBananaResolution, string> = {
  "0.5k": "512",
  "1k": "1K",
  "2k": "2K",
  "4k": "4K",
};

/**
 * Maps our typed input to the Google Gemini Image API request body shape.
 * Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/<slug>:generateContent
 *
 * Spec 64.6b corrected the field path: `generationConfig.responseFormat.image.{aspectRatio,imageSize}`
 * matches the documented API. (Spec 64.6's `imageConfig.aspectRatio` was undocumented and never
 * verified live — see Spec 64.6 §11 acceptance #18 which was deferred.)
 */
export function buildModelRequestBody(input: GenerateImageInput): Record<string, unknown> {
  const aspectRatio = input.aspectRatio ?? "16:9";
  const requestedResolution: NanoBananaResolution = input.resolution ?? "1k";

  // Pro tier doesn't support 512 — silently upgrade to "1k" rather than failing
  // a budget-approved render over a tier mismatch.
  const effectiveResolution: NanoBananaResolution =
    input.model === "nano-banana-pro" && requestedResolution === "0.5k" ? "1k" : requestedResolution;

  const imageSize = GEMINI_RESOLUTION_MAP[effectiveResolution];

  const body: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }],
      },
    ],
    generationConfig: {
      candidateCount: 1,
      responseModalities: ["TEXT", "IMAGE"],
      responseFormat: {
        image: {
          aspectRatio,
          imageSize,
        },
      },
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    },
  };

  return body;
}
