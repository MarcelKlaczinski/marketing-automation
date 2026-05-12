export { serp, keywordOverview, relatedKeywords, rankedKeywords } from "./client.ts";
export {
  LOCATION_CODES,
  LANGUAGE_CODES,
  DataForSeoError,
  type LocationCode,
  type LanguageCode,
  type SerpInput,
  type SerpResult,
  type OrganicResult,
  type KeywordOverviewInput,
  type KeywordOverviewResult,
  type KeywordOverviewItem,
  type KeywordIntent,
  type RelatedKeywordsInput,
  type RelatedKeywordsResult,
  type RelatedKeywordItem,
  type RankedKeywordsInput,
  type RankedKeywordsResult,
  type RankedKeywordItem,
} from "./types.ts";

import {
  keywordOverview as _keywordOverview,
  rankedKeywords as _rankedKeywords,
  relatedKeywords as _relatedKeywords,
  serp as _serp,
} from "./client.ts";

export const dataforseo = {
  serp: _serp,
  keywordOverview: _keywordOverview,
  relatedKeywords: _relatedKeywords,
  rankedKeywords: _rankedKeywords,
};
