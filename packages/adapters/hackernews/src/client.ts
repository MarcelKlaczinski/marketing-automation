const HN_ENDPOINT = "https://hn.algolia.com/api/v1";

export type HnHit = {
  objectID: string;
  title: string | null;
  story_title: string | null;
  url: string | null;
  story_url: string | null;
  author: string;
  points: number | null;
  num_comments: number | null;
  created_at: string;
  created_at_i: number;
  _tags: string[];
};

export async function searchHnByDate(
  query: string,
  hitsPerPage = 50,
): Promise<HnHit[]> {
  const params = new URLSearchParams({
    query,
    tags: "story",
    hitsPerPage: String(hitsPerPage),
  });
  const res = await fetch(`${HN_ENDPOINT}/search_by_date?${params}`, {
    headers: { "User-Agent": "marketing-auto-signal-collector/1.0" },
  });
  if (!res.ok) throw new Error(`HN Algolia search failed: ${res.status}`);
  const data = await res.json() as { hits: HnHit[] };
  return data.hits;
}
