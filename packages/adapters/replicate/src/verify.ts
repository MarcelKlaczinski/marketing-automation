import Replicate from "replicate";

export interface VerifyResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function verifyReplicate(apiToken: string): Promise<VerifyResult> {
  const client = new Replicate({ auth: apiToken });
  try {
    // List a page of models — cheap read, no inference
    const page = await client.models.list();
    return {
      ok: true,
      message: "Replicate API token works",
      details: { resultCount: page.results?.length ?? 0 },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
