import { getGlobal } from "@marketing-auto/core/credentials";
import { getEnv } from "@marketing-auto/shared";
import { VoyageError } from "./client.ts";

/**
 * Vault-first API key resolution: checks DB vault first, falls back to VOYAGE_API_KEY env var.
 * Throws VoyageError if neither is set.
 */
export async function getApiKeyAsync(): Promise<string> {
  const vaultKey = await getGlobal("voyage", "api_key");
  if (vaultKey) return vaultKey;

  const env = getEnv();
  const envKey = env.VOYAGE_API_KEY;
  if (envKey) return envKey;

  throw new VoyageError(
    "VOYAGE_API_KEY not configured — set it in .env or via the installer",
  );
}
