import { App } from "octokit";
import { readFile } from "node:fs/promises";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { AstroSyncError } from "./types.ts";

const log = createLogger("astro-sync:auth");

let _app: App | null = null;

export async function getGitHubApp(): Promise<App> {
  if (_app) return _app;

  const env = getEnv();
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY_PATH) {
    throw new AstroSyncError(
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH must be set. " +
      "See packages/adapters/astro-sync/SETUP-GITHUB-APP.md",
      "auth",
    );
  }

  let privateKey: string;
  try {
    privateKey = await readFile(env.GITHUB_APP_PRIVATE_KEY_PATH, "utf-8");
  } catch (e) {
    throw new AstroSyncError(
      `Failed to read GitHub App private key from ${env.GITHUB_APP_PRIVATE_KEY_PATH}: ${e instanceof Error ? e.message : String(e)}`,
      "auth",
      e,
    );
  }

  _app = new App({
    appId: env.GITHUB_APP_ID,
    privateKey,
  });

  log.debug({ appId: env.GITHUB_APP_ID }, "GitHub App initialized");
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
