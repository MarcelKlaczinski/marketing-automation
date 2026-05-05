import { S3Client } from "bun";
import type { S3File } from "bun";
import { getEnv, createLogger } from "@marketing-auto/shared";

const log = createLogger("storage-r2");

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;

  const env = getEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    throw new Error(
      "R2 not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env",
    );
  }

  _client = new S3Client({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  });
  return _client;
}

/**
 * Public URL for an object. Prefers custom domain (R2_PUBLIC_BASE_URL); falls back
 * to the R2.dev pub URL pattern (which requires public-bucket setting in dashboard).
 */
function publicUrlFor(key: string): string {
  const env = getEnv();
  if (env.R2_PUBLIC_BASE_URL) {
    return `${env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
  }
  return `https://pub-${env.R2_ACCOUNT_ID}.r2.dev/${key}`;
}

export type PutObjectInput = {
  /** Object key (path within bucket). Must not start with /. */
  key: string;
  /** Body data. Bun's S3 client accepts Buffer, ArrayBuffer, Uint8Array, Blob, string. */
  body: Buffer | ArrayBuffer | Uint8Array | Blob | string;
  /** MIME type (e.g. "image/webp"). Falls back to "application/octet-stream". */
  contentType?: string;
  /** Cache-Control header. Default: "public, max-age=31536000, immutable" for content-addressed assets. */
  cacheControl?: string;
};

export type PutObjectResult = {
  key: string;
  publicUrl: string;
  bytesStored: number;
  contentType: string;
};

export async function putObject(input: PutObjectInput): Promise<PutObjectResult> {
  const client = getClient();
  const file = client.file(input.key);

  const contentType = input.contentType ?? "application/octet-stream";

  const bytesStored = await file.write(input.body, {
    type: contentType,
  });

  const url = publicUrlFor(input.key);

  log.debug({ key: input.key, bytesStored, contentType }, "R2 put");

  return {
    key: input.key,
    publicUrl: url,
    bytesStored,
    contentType,
  };
}

export async function objectExists(key: string): Promise<boolean> {
  const client = getClient();
  return await client.exists(key);
}

export function getFile(key: string): S3File {
  return getClient().file(key);
}

export async function deleteObject(key: string): Promise<boolean> {
  const client = getClient();
  try {
    await client.delete(key);
    return true;
  } catch (e) {
    log.warn({ key, err: e }, "R2 delete failed");
    return false;
  }
}

export function presignedUrl(input: {
  key: string;
  method: "GET" | "PUT";
  expiresInSeconds?: number;
}): string {
  const client = getClient();
  return client.presign(input.key, {
    method: input.method,
    expiresIn: input.expiresInSeconds ?? 3600,
  });
}
