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
