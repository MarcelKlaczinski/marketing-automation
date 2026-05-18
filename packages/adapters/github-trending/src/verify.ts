import { API_BASE, type GitHubCredentials } from "./client.ts";

export async function verifyGitHub(
  credentials: GitHubCredentials,
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(`${API_BASE}/user`, {
      headers: {
        Authorization: `Bearer ${credentials.personalAccessToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "toolwiki-verify",
      },
    });

    if (response.status === 401) {
      return { ok: false, message: "Invalid GitHub PAT" };
    }
    if (!response.ok) {
      return { ok: false, message: `Verify failed: ${response.status}` };
    }
    return { ok: true, message: "GitHub credentials verified" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
