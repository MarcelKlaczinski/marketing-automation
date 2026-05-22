export { convertImageToWebp } from "./convert.ts";
export {
  type ConvertImageToWebpInput,
  type ConvertImageToWebpResult,
  ImageWebpError,
} from "./types.ts";
export { sniffImageFormat, type SniffedFormat } from "./sniff.ts";

import { convertImageToWebp as _convertImageToWebp } from "./convert.ts";
export const imageWebp = {
  convertImageToWebp: _convertImageToWebp,
};
