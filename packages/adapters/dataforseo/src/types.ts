export type DataForSeoCommonInput = {
  projectId: string;
  pipelineRunId?: string;
  articleId?: string;
  operation: string;
  estimatedCostEur: number;
};

export const LOCATION_CODES = {
  GERMANY: 2276,
  AUSTRIA: 2040,
  SWITZERLAND: 2756,
  USA: 2840,
  UK: 2826,
} as const;

export type LocationCode = (typeof LOCATION_CODES)[keyof typeof LOCATION_CODES];

export const LANGUAGE_CODES = {
  DE: "de",
  EN: "en",
  FR: "fr",
} as const;

export type LanguageCode = string;

export type SerpInput = DataForSeoCommonInput & {
  keyword: string;
  locationCode?: number;
  languageCode?: string;
  depth?: 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;
  mode?: "live" | "standard";
  device?: "desktop" | "mobile";
};

export type OrganicResult = {
  position: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  serpFeature?: string;
};

export type SerpResult = {
  keyword: string;
  totalResults: number;
  serpFeatures: string[];
  organicResults: OrganicResult[];
  peopleAlsoAsk: string[];
  relatedSearches: string[];
  checkUrl: string;
};

export type KeywordOverviewInput = DataForSeoCommonInput & {
  keywords: string[];
  locationCode?: number;
  languageCode?: string;
  includeSerpInfo?: boolean;
  includeClickstreamData?: boolean;
};

export type KeywordIntent = "informational" | "navigational" | "commercial" | "transactional";

export type KeywordOverviewItem = {
  keyword: string;
  searchVolume: number | null;
  monthlySearches: Array<{ year: number; month: number; searchVolume: number }>;
  cpcUsd: number | null;
  competition: number | null;
  competitionLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  keywordDifficulty: number | null;
  mainIntent: KeywordIntent | null;
  foreignIntent: KeywordIntent[];
  serpUrls: string[];
};

export type KeywordOverviewResult = {
  items: KeywordOverviewItem[];
};

export type RelatedKeywordsInput = DataForSeoCommonInput & {
  seed: string;
  locationCode?: number;
  languageCode?: string;
  depth?: 1 | 2 | 3 | 4;
  limit?: number;
  minSearchVolume?: number;
};

export type RelatedKeywordItem = {
  keyword: string;
  depth: number;
  searchVolume: number | null;
  cpcUsd: number | null;
  competition: number | null;
};

export type RelatedKeywordsResult = {
  seed: string;
  items: RelatedKeywordItem[];
};

export type RankedKeywordsInput = DataForSeoCommonInput & {
  domain: string;
  locationCode?: number;
  languageCode?: string;
  limit?: number;
  maxPosition?: number;
};

export type RankedKeywordItem = {
  keyword: string;
  position: number;
  url: string;
  searchVolume: number | null;
  estimatedTrafficVolume: number | null;
  cpcUsd: number | null;
};

export type RankedKeywordsResult = {
  domain: string;
  items: RankedKeywordItem[];
  totalCount: number;
};

export class DataForSeoError extends Error {
  readonly statusCode?: number;
  readonly originalCause?: unknown;

  constructor(message: string, statusCode?: number, originalCause?: unknown) {
    super(message);
    this.name = "DataForSeoError";
    if (statusCode !== undefined) this.statusCode = statusCode;
    if (originalCause !== undefined) this.originalCause = originalCause;
  }
}
