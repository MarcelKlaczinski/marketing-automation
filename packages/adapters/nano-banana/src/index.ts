export {
  generateImage,
  callGeminiWithRetry,
  extractInlineImage,
  type GeminiResponse,
  type GeminiCandidate,
  type GeminiPart,
} from "./client.ts";
export {
  NANO_BANANA_MODELS,
  type NanoBananaModel,
  type AspectRatio,
  type OutputFormat,
  type GenerateImageInput,
  type GenerateImageResult,
  NanoBananaGenerationError,
} from "./types.ts";

import { generateImage as _generateImage } from "./client.ts";
export const nanoBanana = {
  generateImage: _generateImage,
};
