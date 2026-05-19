import Parser from "rss-parser";

const parser = new Parser({ timeout: 10_000 });

export async function verifyRssFeed(
  url: string,
): Promise<{ ok: boolean; error?: string; title?: string }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "marketing-auto-rss-verify/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }
    const text = await response.text();
    const parsed = await parser.parseString(text);
    if (!parsed || !parsed.items) {
      return { ok: false, error: "Not a valid RSS/Atom feed" };
    }
    const result: { ok: boolean; title?: string } = { ok: true };
    if (parsed.title) result.title = parsed.title;
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
