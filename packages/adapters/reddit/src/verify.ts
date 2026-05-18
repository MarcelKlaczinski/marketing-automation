import { getAccessToken, API_BASE } from "./client.ts";
import type { RedditCredentials } from "./client.ts";

export async function verifyReddit(
  creds: RedditCredentials,
): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await getAccessToken(creds);

    const response = await fetch(`${API_BASE}/r/test/about.json`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": creds.userAgent,
      },
    });

    if (!response.ok) {
      return { ok: false, message: `Verification call failed: ${response.status}` };
    }

    return { ok: true, message: "Reddit credentials verified" };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
