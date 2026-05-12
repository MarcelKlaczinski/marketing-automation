export {
  putObject,
  objectExists,
  getFile,
  deleteObject,
  presignedUrl,
  isR2Configured,
  type PutObjectInput,
  type PutObjectResult,
} from "./r2.ts";

import * as r2Module from "./r2.ts";
export const r2 = {
  put: r2Module.putObject,
  exists: r2Module.objectExists,
  file: r2Module.getFile,
  delete: r2Module.deleteObject,
  presign: r2Module.presignedUrl,
};
