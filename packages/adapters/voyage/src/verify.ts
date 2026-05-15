import { callVoyageEmbed } from "./client.ts";

export async function verifyVoyage(
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await callVoyageEmbed(["ping"], apiKey);
    if (!res.data[0]?.embedding?.length) {
      return { ok: false, message: "Voyage API returned empty embedding" };
    }
    return { ok: true, message: `Voyage AI credentials valid (model: ${res.model})` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
