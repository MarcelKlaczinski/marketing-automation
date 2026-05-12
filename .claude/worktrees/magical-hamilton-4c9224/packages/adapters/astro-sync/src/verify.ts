import { readFile } from "node:fs/promises";
import { App } from "octokit";

export interface VerifyResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function verifyGitHubApp(creds: Record<string, string>): Promise<VerifyResult> {
  const { app_id, private_key_path, private_key_content } = creds;
  if (!app_id) {
    return { ok: false, message: "Missing app_id" };
  }

  let privateKey: string;

  if (private_key_content) {
    privateKey = private_key_content;
  } else if (private_key_path) {
    try {
      privateKey = await readFile(private_key_path, "utf-8");
    } catch (e) {
      return {
        ok: false,
        message: `Cannot read private key at ${private_key_path}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } else {
    return { ok: false, message: "Missing private_key_path or private_key_content" };
  }

  try {
    const app = new App({ appId: app_id, privateKey });
    const res = await app.octokit.rest.apps.getAuthenticated();
    const appData = res.data;
    return {
      ok: true,
      message: `GitHub App "${appData?.name ?? app_id}" authenticated`,
      details: { appId: app_id, slug: appData?.slug },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
