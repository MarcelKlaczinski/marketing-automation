export interface VerifyResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function verifyDataForSeo(login: string, password: string): Promise<VerifyResult> {
  try {
    const credentials = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}: ${res.statusText}` };
    }
    const body = await res.json() as { status_code?: number; status_message?: string };
    if (body.status_code !== 20000) {
      return { ok: false, message: body.status_message ?? "DataForSEO API error" };
    }
    return { ok: true, message: "DataForSEO credentials work" };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
