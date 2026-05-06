import Anthropic from "@anthropic-ai/sdk";

export interface VerifyResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function verifyAnthropic(apiKey: string): Promise<VerifyResult> {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  const start = Date.now();
  try {
    const result = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return {
      ok: true,
      message: "Anthropic API key works",
      details: { model: result.model, latencyMs: Date.now() - start },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
