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
      };

    case "flux-schnell":
      return {
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio ?? "1:1",
        output_format: input.outputFormat ?? "webp",
        output_quality: input.quality ?? 80,
        num_outputs: 1,
        num_inference_steps: 4,
        ...(input.seed !== undefined && { seed: input.seed }),
      };

    case "ideogram-v3":
      return {
        prompt: input.prompt,
        ...(input.negativePrompt !== undefined &&
          input.negativePrompt !== "" && { negative_prompt: input.negativePrompt }),
        aspect_ratio: input.aspectRatio ?? "16:9",
        magic_prompt_option: "Auto",
        ...(input.seed !== undefined && { seed: input.seed }),
      };

    default: {
      const _exhaustive: never = input.model;
      throw new Error(`Unhandled model: ${_exhaustive}`);
    }
  }
}
