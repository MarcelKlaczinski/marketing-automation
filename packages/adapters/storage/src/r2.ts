import { S3Client } from "bun";
import type { S3File } from "bun";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { getGlobal } from "@marketing-auto/core/credentials";

const log = createLogger("storage-r2");

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string | null;
}

let _client: S3Client | null = null;
let _config: R2Config | null = null;

async function resolveR2Config(): Promise<R2Config> {
  const env = getEnv();

  // Try vault first, fall back to env vars
  const accountId =
    (await getGlobal("r2", "account_id")) ?? env.R2_ACCOUNT_ID ?? "";
  const accessKeyId =
    (await getGlobal("r2", "access_key_id")) ?? env.R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey =
    (await getGlobal("r2", "secret_access_key")) ?? env.R2_SECRET_ACCESS_KEY ?? "";
  const bucket =
    (await getGlobal("r2", "bucket")) ?? env.R2_BUCKET ?? "";
  const publicBaseUrl =
    (await getGlobal("r2", "public_base_url")) ?? env.R2_PUBLIC_BASE_URL ?? null;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "R2 not configured. Set credentials via installer or set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in .env",
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

async function getClientAndConfig(): Promise<{ client: S3Client; config: R2Config }> {
  if (_client && _config) return { client: _client, config: _config };

  const config = await resolveR2Config();
  const client = new S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
  });

  _client = client;
  _config = config;
  return { client, config };
}

/**
 * Public URL for an object. Prefers custom domain (vault or R2_PUBLIC_BASE_URL); falls back
 * to the R2.dev pub URL pattern (which requires public-bucket setting in dashboard).
 */
function publicUrlFor(key: string, config: R2Config): string {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }
  return `https://pub-${config.accountId}.r2.dev/${key}`;
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
  const { client, config } = await getClientAndConfig();
  const file = client.file(input.key);

  const contentType = input.contentType ?? "application/octet-stream";

  const bytesStored = await file.write(input.body, {
    type: contentType,
  });

  const url = publicUrlFor(input.key, config);

  log.debug({ key: input.key, bytesStored, contentType }, "R2 put");

  return {
    key: input.key,
    publicUrl: url,
    bytesStored,
    contentType,
  };
}

export async function objectExists(key: string): Promise<boolean> {
  const { client } = await getClientAndConfig();
  return await client.exists(key);
}

export async function getFile(key: string): Promise<S3File> {
  const { client } = await getClientAndConfig();
  return client.file(key);
}

export async function deleteObject(key: string): Promise<boolean> {
  const { client } = await getClientAndConfig();
  try {
    await client.delete(key);
    return true;
  } catch (e) {
    log.warn({ key, err: e }, "R2 delete failed");
    return false;
  }
}

export async function presignedUrl(input: {
  key: string;
  method: "GET" | "PUT";
  expiresInSeconds?: number;
}): Promise<string> {
  const { client } = await getClientAndConfig();
  return client.presign(input.key, {
    method: input.method,
    expiresIn: input.expiresInSeconds ?? 3600,
  });
}
