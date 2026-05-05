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
  serp as _serp,
  keywordOverview as _keywordOverview,
  relatedKeywords as _relatedKeywords,
  rankedKeywords as _rankedKeywords,
} from "./client.ts";

export const dataforseo = {
  serp: _serp,
  keywordOverview: _keywordOverview,
  relatedKeywords: _relatedKeywords,
  rankedKeywords: _rankedKeywords,
};
