import type { GenerateImageInput } from "./types.ts";

/**
 * Maps our typed input to the Google Gemini Image API request body shape.
 * Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/<slug>:generateContent
 *
 * Spec 64.6d (2026-05-22 live verification, Discovery 64.8 §4): minimal-shape body
 * is the ONLY shape the real Gemini Image API accepts. Both 64.6 (`imageConfig.aspectRatio`)
 * and 64.6b (`responseFormat.image.{aspectRatio,imageSize}`) field paths return HTTP 400
 * with `Invalid value at 'generation_config.…'` against the live endpoint — those keys
 * exist in the docs but not on the real API surface.
 *
 * Aspect-ratio + resolution are derived by Gemini from the prompt text. HeroImageStep
 * (and any future caller) is responsible for injecting the relevant hints via
 * `buildPromptWithResolutionHint(prompt, resolution)` from
 * `@marketing-auto/pipelines/article/lib/prompt-resolution-hints` BEFORE calling
 * the adapter — the adapter itself never modifies the prompt.
 *
 * The `resolution` field on `GenerateImageInput` is still load-bearing — it flows
 * into `nanoBananaImageCostEur({model, resolution, count})` so cost accounting
 * stays correct even though the value is not encoded in the request body.
 */
export function buildModelRequestBody(input: GenerateImageInput): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    candidateCount: 1,
    responseModalities: ["TEXT", "IMAGE"],
  };
  if (input.seed !== undefined) {
    generationConfig.seed = input.seed;
  }

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: input.prompt }],
      },
    ],
    generationConfig,
  };
}
