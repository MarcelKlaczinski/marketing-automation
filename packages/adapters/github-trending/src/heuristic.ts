export interface TrendingQueryInput {
  topics: string[];
  timeWindowDays: number;
  minStarsNew: number;
  minStarsEstablished: number;
}

export interface TrendingQueries {
  newRisingQuery: string;
  activeEstablishedQuery: string;
}

/**
 * Builds two GitHub search queries for trending AI-tool repos.
 *
 * GitHub topic qualifiers are OR-combined when space-separated, so
 * `topic:ai-tools topic:llm stars:>20` matches repos with EITHER topic AND stars>20.
 * If the API returns near-zero results (possible future regression), switch to
 * per-topic queries merged in the adapter.
 */
export function buildTrendingQueries(input: TrendingQueryInput): TrendingQueries {
  const sinceDate = new Date(Date.now() - input.timeWindowDays * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString().split("T")[0]; // YYYY-MM-DD

  const topicQuery = input.topics.map((t) => `topic:${t}`).join(" ");

  return {
    newRisingQuery: `${topicQuery} created:>${sinceIso} stars:>${input.minStarsNew}`,
    activeEstablishedQuery: `${topicQuery} pushed:>${sinceIso} stars:>${input.minStarsEstablished}`,
  };
}
