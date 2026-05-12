import { S3Client } from "bun";

export interface VerifyResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function verifyR2(creds: Record<string, string>): Promise<VerifyResult> {
  const { account_id, access_key_id, secret_access_key, bucket } = creds;
  if (!account_id || !access_key_id || !secret_access_key || !bucket) {
    return { ok: false, message: "Missing required R2 credentials" };
  }

  try {
    const client = new S3Client({
      accessKeyId: access_key_id,
      secretAccessKey: secret_access_key,
      bucket,
      endpoint: `https://${account_id}.r2.cloudflarestorage.com`,
    });
    // List with max 1 key — cheap existence check
    await client.list({ maxKeys: 1 });
    return { ok: true, message: "R2 bucket accessible", details: { bucket } };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
