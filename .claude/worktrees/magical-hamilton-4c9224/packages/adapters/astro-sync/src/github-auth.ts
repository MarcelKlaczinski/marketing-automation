import { readFile } from "node:fs/promises";
import { getGlobal } from "@marketing-auto/core/credentials";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { App } from "octokit";
import { AstroSyncError } from "./types.ts";

const log = createLogger("astro-sync:auth");

let _app: App | null = null;

export async function getGitHubApp(): Promise<App> {
  if (_app) return _app;

  const env = getEnv();

  // Prefer vault credentials, fall back to env vars
  const appId = (await getGlobal("github_app", "app_id")) ?? env.GITHUB_APP_ID;
  if (!appId) {
    throw new AstroSyncError(
      "GitHub App ID not configured (set via installer or GITHUB_APP_ID env). " +
        "See packages/adapters/astro-sync/SETUP-GITHUB-APP.md",
      "auth"
    );
  }

  // In self-hosted mode, the PEM content may be stored directly in the vault.
  // In lokal mode, the vault stores a file path (same as the env var pattern).
  let privateKey: string;
  const vaultPemContent = await getGlobal("github_app", "private_key_content");
  if (vaultPemContent) {
    privateKey = vaultPemContent;
  } else {
    const keyPath =
      (await getGlobal("github_app", "private_key_path")) ?? env.GITHUB_APP_PRIVATE_KEY_PATH;
    if (!keyPath) {
      throw new AstroSyncError(
        "GitHub App private key not configured (set via installer or GITHUB_APP_PRIVATE_KEY_PATH env). " +
          "See packages/adapters/astro-sync/SETUP-GITHUB-APP.md",
        "auth"
      );
    }
    try {
      privateKey = await readFile(keyPath, "utf-8");
    } catch (e) {
      throw new AstroSyncError(
        `Failed to read GitHub App private key from ${keyPath}: ${e instanceof Error ? e.message : String(e)}`,
        "auth",
        e
      );
    }
  }

  _app = new App({
    appId,
    privateKey,
  });

  log.debug({ appId }, "GitHub App initialized");
  return _app;
}

const _installationCache = new Map<number, Awaited<ReturnType<App["getInstallationOctokit"]>>>();

export async function getInstallationOctokit(installationId: number) {
  if (_installationCache.has(installationId)) {
    return _installationCache.get(installationId)!;
  }
  const app = await getGitHubApp();
  const octokit = await app.getInstallationOctokit(installationId);
  _installationCache.set(installationId, octokit);
  return octokit;
}
