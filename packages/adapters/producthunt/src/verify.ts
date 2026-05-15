// Justified by spec Decision 10: verify logic lives in the adapter package so system.ts stays thin.
import { fetchAccessToken } from "./client.ts";

export async function verifyProductHunt(
  apiKey: string,
  apiSecret: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const accessToken = await fetchAccessToken(apiKey, apiSecret);
    const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "{ viewer { user { id } } }" }),
    });
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const body = await res.json() as { errors?: Array<{ message: string }> };
    if (body.errors?.length) return { ok: false, message: body.errors[0]?.message ?? "GraphQL error" };
    return { ok: true, message: "Product Hunt credentials valid" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
