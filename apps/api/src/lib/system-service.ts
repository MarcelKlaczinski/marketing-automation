import { createConnection } from "node:net";
import { decrypt } from "@marketing-auto/core";
import { db, globalCredentials, systemSettings } from "@marketing-auto/db";
import { getEnv } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";

export interface AdapterStatusRow {
  configured: boolean;
  verified: boolean | null;
  lastVerifiedAt: string | null;
  missingKeys: string[];
}

export async function getAdapterStatus(
  service: string,
  requiredKeys: string[]
): Promise<AdapterStatusRow> {
  const rows = await db
    .select({ key: globalCredentials.key })
    .from(globalCredentials)
    .where(eq(globalCredentials.service, service));

  const presentKeys = new Set(rows.map((r) => r.key));
  const missingKeys = requiredKeys.filter((k) => !presentKeys.has(k));

  const [verifyRow] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, `last_verified_${service}`))
    .limit(1);

  // jsonb column typed as `unknown`; shape is always written by POST /verify/:adapter in this module
  const verifyValue = verifyRow?.value as { at: string; ok: boolean } | undefined;

  return {
    configured: missingKeys.length === 0,
    verified: verifyValue?.ok ?? null,
    lastVerifiedAt: verifyValue?.at ?? null,
    missingKeys,
  };
}

export async function getAllAdapterStatuses() {
  const [anthropic, replicate, r2, dataforseo, smtp, githubApp, producthunt, voyage] = await Promise.all([
    getAdapterStatus("anthropic", ["api_key"]),
    getAdapterStatus("replicate", ["api_token"]),
    getAdapterStatus("r2", [
      "account_id",
      "access_key_id",
      "secret_access_key",
      "bucket",
      "public_base_url",
    ]),
    getAdapterStatus("dataforseo", ["login", "password"]),
    getAdapterStatus("smtp", ["host", "port", "user", "password", "from_address"]),
    getAdapterStatus("github_app", ["app_id", "private_key_path"]),
    getAdapterStatus("producthunt", ["api_key", "api_secret"]),
    getAdapterStatus("voyage", ["api_key"]),
  ]);
  return { anthropic, replicate, r2, dataforseo, smtp, githubApp, producthunt, voyage };
}

export async function checkPostgres(): Promise<{
  configured: boolean;
  verified: boolean;
  lastVerifiedAt: string | null;
}> {
  const env = getEnv();
  if (!env.DATABASE_URL) {
    return { configured: false, verified: false, lastVerifiedAt: null };
  }
  try {
    await db.execute("SELECT 1");
    return { configured: true, verified: true, lastVerifiedAt: new Date().toISOString() };
  } catch {
    return { configured: true, verified: false, lastVerifiedAt: new Date().toISOString() };
  }
}

export async function checkRedis(): Promise<{
  configured: boolean;
  verified: boolean;
  lastVerifiedAt: string | null;
}> {
  const env = getEnv();
  if (!env.REDIS_URL) {
    return { configured: false, verified: false, lastVerifiedAt: null };
  }
  try {
    const url = new URL(env.REDIS_URL);
    const host = url.hostname;
    const port = Number.parseInt(url.port || "6379", 10);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host, port });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("timeout"));
      }, 5_000);
      socket.on("connect", () => {
        clearTimeout(timer);
        socket.destroy();
        resolve();
      });
      socket.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    return { configured: true, verified: true, lastVerifiedAt: new Date().toISOString() };
  } catch {
    return { configured: true, verified: false, lastVerifiedAt: new Date().toISOString() };
  }
}

export async function getInitializedFlag(): Promise<boolean> {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, "installed_at"))
    .limit(1);
  return !!row?.value;
}

export async function readAdapterCreds(service: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: globalCredentials.key, encryptedValue: globalCredentials.encryptedValue })
    .from(globalCredentials)
    .where(eq(globalCredentials.service, service));

  const creds: Record<string, string> = {};
  for (const row of rows) {
    creds[row.key] = decrypt(row.encryptedValue);
  }
  return creds;
}
