export {
  putObject,
  objectExists,
  getFile,
  deleteObject,
  presignedUrl,
  listObjects,
  isR2Configured,
  LOCAL_UPLOADS_ROOT,
  type PutObjectInput,
  type PutObjectResult,
  type ListObjectsInput,
} from "./r2.ts";

import * as r2Module from "./r2.ts";
export const r2 = {
  put: r2Module.putObject,
  exists: r2Module.objectExists,
  file: r2Module.getFile,
  delete: r2Module.deleteObject,
  presign: r2Module.presignedUrl,
  list: r2Module.listObjects,
};
