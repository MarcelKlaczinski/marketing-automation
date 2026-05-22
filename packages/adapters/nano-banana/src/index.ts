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
  type NanoBananaResolution,
  type AspectRatio,
  type OutputFormat,
  type GenerateImageInput,
  type GenerateImageResult,
  NanoBananaGenerationError,
} from "./types.ts";

// Spec 64.7: batch surface
export {
  createImageBatch,
  retrieveBatch,
  fetchBatchResults,
  parseAndStoreInlinedResponses,
  classifyState,
  type BatchImageRequest,
  type BatchCreateResult,
  type RetrieveBatchResult,
  type BatchImageResult,
  type BatchState,
} from "./batch.ts";

import { generateImage as _generateImage } from "./client.ts";
import {
  createImageBatch as _createImageBatch,
  retrieveBatch as _retrieveBatch,
  fetchBatchResults as _fetchBatchResults,
} from "./batch.ts";

export const nanoBanana = {
  generateImage: _generateImage,
  createImageBatch: _createImageBatch,
  retrieveBatch: _retrieveBatch,
  fetchBatchResults: _fetchBatchResults,
};
