export interface VerifyResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Verifies a Google Gemini API key by hitting the cheap `models.list` endpoint.
 * No image generation = no cost. Used by the installer credential verify flow.
 */
export async function verifyNanoBanana(apiKey: string): Promise<VerifyResult> {
  try {
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
      }
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        message: `Gemini ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`,
      };
    }
    const json = (await resp.json()) as { models?: unknown[] };
    return {
      ok: true,
      message: "Google Gemini API key works",
      details: { modelCount: Array.isArray(json.models) ? json.models.length : 0 },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
