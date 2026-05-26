/**
 * Spec 65.8 — Photographic-provider credential loader.
 *
 * Reads Pexels / Unsplash / Pixabay API keys from `global_credentials`
 * (vault, Spec 32). Mirrors the pattern in `apps/api/src/scripts/
 * verify-image-providers.ts` but lives inside the pipelines package so the
 * `StageFamilyBImagesStep` can call it directly without crossing the
 * pipelines → api dep boundary.
 *
 * Returns null per provider when the vault row is absent — the orchestrator
 * skips disabled providers silently (`searchAllProviders` honors null
 * credentials). When all 3 are null the caller falls back to gradient-only
 * rendering.
 *
 * Note on `projectId`: `globalCredentials` is platform-wide (not
 * project-scoped) — the parameter is accepted for API consistency with
 * other vault-reading helpers but is not used in the SELECT. Future per-
 * tenant credentials would extend this helper without changing call sites.
 */
import type { PexelsCredentials } from "@marketing-auto/adapter-pexels";
import type { PixabayCredentials } from "@marketing-auto/adapter-pixabay";
import type { UnsplashCredentials } from "@marketing-auto/adapter-unsplash";
import { decrypt } from "@marketing-auto/core";
import { db, eq, globalCredentials } from "@marketing-auto/db";

export interface PhotographicProviderCredentials {
  pexels: PexelsCredentials | null;
  unsplash: UnsplashCredentials | null;
  pixabay: PixabayCredentials | null;
}

async function readCreds(service: "pexels" | "unsplash" | "pixabay"): Promise<Record<string, string>> {
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

/**
 * Load all 3 provider credentials in parallel. Returns null per provider
 * when the vault entry is missing the required key — partial setups (e.g.
 * only Pexels configured) are first-class.
 */
export async function readAdapterCredsForProject(
  _projectId: string,
): Promise<PhotographicProviderCredentials> {
  const [pexelsRow, unsplashRow, pixabayRow] = await Promise.all([
    readCreds("pexels"),
    readCreds("unsplash"),
    readCreds("pixabay"),
  ]);

  return {
    pexels: pexelsRow.api_key ? { apiKey: pexelsRow.api_key } : null,
    unsplash: unsplashRow.access_key ? { accessKey: unsplashRow.access_key } : null,
    pixabay: pixabayRow.api_key ? { apiKey: pixabayRow.api_key } : null,
  };
}
