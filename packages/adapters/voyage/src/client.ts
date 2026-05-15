import { getEnv } from "@marketing-auto/shared";

const BASE_URL = "https://api.voyageai.com/v1";

// voyage-3: 1024-dim output, $0.06 / 1M tokens
export const VOYAGE_MODEL = "voyage-3";
// $0.06 / 1M tokens
export const VOYAGE_COST_USD_PER_TOKEN = 0.000_000_06;

export class VoyageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoyageError";
  }
}

export function getApiKey(): string {
  const env = getEnv();
  const key = env.VOYAGE_API_KEY;
  if (!key) {
    throw new VoyageError(
      "VOYAGE_API_KEY not configured — set it in .env or via the installer"
    );
  }
  return key;
}

export type VoyageEmbedResponse = {
  object: string;
  data: Array<{ object: "embedding"; embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
};

export async function callVoyageEmbed(
  texts: string[],
  apiKey: string,
): Promise<VoyageEmbedResponse> {
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoyageError(`Voyage API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<VoyageEmbedResponse>;
}
