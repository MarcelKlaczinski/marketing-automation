# Spec 13: DataForSEO Adapter

**Phase:** 2 (Cold-Start for KI-Wissensraum)
**Estimated Effort:** 1 day
**Dependencies:** Spec 00, Spec 01, Spec 03 (cost tracker), Spec 11 (anthropic adapter — pattern reference)
**Status:** Ready for implementation
**Recommended Model:** Sonnet 4.6

---

## Goal

Build the typed DataForSEO API client for **SERP analysis, keyword research, and competitor data**. This adapter is what makes data-driven topic selection possible: which keywords have actual search volume, who currently ranks for them, what content gaps exist on the SERP. Used by the Cold-Start Pipeline (Spec 14) for competitor analysis and by the future Article Pipeline (Phase 3) for per-article SERP snapshots.

The adapter wraps **three of DataForSEO's API tiers**, each with its own cost-per-call:

1. **SERP API** (live crawl, ~$0.0006 standard / ~$0.002 live): "who currently ranks for keyword X in Germany?"
2. **Labs API** (pre-computed database, ~$0.01-0.02): "what's the historical search volume, difficulty, and CPC for keyword X?"
3. **Keywords Data API** (Google Ads source, ~$0.02): "rich keyword overview with intent classification"

Plus we expose a small surface for **related keywords / suggestions** (most useful for cluster expansion).

This follows the **Spec 11 pattern**: typed entry points, cost-tracker integration on every call, project-scoped operations, German-locale defaults.

## Non-Goals

- No Backlinks API — backlink strategy is a separate Phase-4 concern
- No OnPage API — we use Google PageSpeed Insights directly (free) for technical SEO checks
- No Domain Analytics API — until we hit a use case that requires it
- No Content Analysis API — overlaps with our own Claude-based analysis
- No Amazon / App Store data — irrelevant for our content properties
- No real-time SERP polling for live rank tracking — we use Labs API's historical snapshots, way cheaper
- No raw HTTP-level retry loop — DataForSEO's TypeScript client and our cost-tracker pattern handle errors at the right layer

## Pricing & Mode Strategy

DataForSEO has two execution modes per call:

| Mode | Latency | Price (vs base) | When to use |
|------|---------|----------------|-------------|
| **Standard** (POST + GET) | ~5 min | 1× ($0.0006/SERP) | Cold-start research, batch keyword analysis, anything not user-blocking |
| **Live** | ~6 sec | 3.3× ($0.002/SERP) | When a pipeline step is waiting for the data — most of our cases |

**Our default**: **Live mode**. Reasoning:
- Pipeline steps wait for the data (BullMQ job is "active")
- 5-minute Standard polls would mean the BullMQ worker holds a slot for 5 min doing nothing
- The 3.3× cost difference at our volume is sub-€1/month
- Standard mode requires implementing task-post + ready-poll + task-get — significant complexity for marginal savings

**Override path**: each call accepts `mode: "live" | "standard"`. If we ever batch-analyze 1000+ keywords offline, switch to Standard.

## User-Facing Behavior (for developers writing pipeline steps)

After this spec, a competitor-research step looks like:

```typescript
import { dataforseo } from "@marketing-auto/adapter-dataforseo";

class CompetitorAnalysisStep extends BaseStep<{...}, {...}> {
  async execute(input, ctx) {
    // 1. Get current top 10 for the keyword
    const serp = await dataforseo.serp({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: "competitor-serp",
      keyword: "claude vs chatgpt",
      locationCode: 2276,   // Germany
      languageCode: "de",
      depth: 10,
      estimatedCostEur: 0.003,
    });
    // serp.organicResults: Array<{ position, url, title, snippet, domain }>

    // 2. Get keyword volume + difficulty for cluster planning
    const overview = await dataforseo.keywordOverview({
      projectId: ctx.projectId,
      operation: "keyword-overview",
      keywords: ["claude vs chatgpt", "ai chatbot vergleich", "...", /* up to 700 */],
      locationCode: 2276,
      languageCode: "de",
      estimatedCostEur: 0.02,
    });
    // overview.items: Array<{ keyword, searchVolume, cpc, competition, difficulty, intent }>

    // 3. Generate related keyword ideas
    const related = await dataforseo.relatedKeywords({
      projectId: ctx.projectId,
      operation: "related-keywords",
      seed: "claude vs chatgpt",
      locationCode: 2276,
      languageCode: "de",
      depth: 4,
      limit: 100,
      estimatedCostEur: 0.012,
    });

    return { /* ... */ };
  }
}
```

## Detailed Implementation

### Setup

Marcel needs to:

1. Sign up at https://dataforseo.com (free, no credit card)
2. Get $1 free credit on signup (≈ 500 standard SERP calls or 100 keyword overviews)
3. Generate API credentials in dashboard → API Access
4. **Optional now, required for production**: Make the $50 minimum deposit (covers ~6-12 months at our volume)
5. Add to `.env`:
   ```
   DATAFORSEO_LOGIN=your_login
   DATAFORSEO_PASSWORD=your_api_password
   ```

The `.env.example` already has these from Spec 00 — just fill them in.

### Package Setup

`packages/adapters/dataforseo/package.json`:

```json
{
  "name": "@marketing-auto/adapter-dataforseo",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "cd ../../.. && bun test packages/adapters/dataforseo/test"
  },
  "dependencies": {
    "@marketing-auto/shared": "workspace:*",
    "@marketing-auto/db": "workspace:*",
    "@marketing-auto/cost-tracker": "workspace:*",
    "dataforseo-client": "^1.0.0"
  },
  "devDependencies": {
    "drizzle-orm": "^0.36.0"
  }
}
```

`packages/adapters/dataforseo/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

### Update cost-tracker pricing

Add to `packages/cost-tracker/src/pricing.ts`:

```typescript
// DataForSEO pricing (verified 2026-04, dataforseo.com/pricing)
export const DATAFORSEO_PRICING_USD = {
  // SERP API — Google Organic, first page
  serpStandard:  0.0006,   // ~5 min queue
  serpPriority:  0.0012,   // ~1 min queue
  serpLive:      0.002,    // immediate

  // Labs API — pre-computed database
  keywordOverviewLive:    0.0201,  // up to 700 keywords per request, but billed per item
  relatedKeywordsLive:    0.012,   // 4680 max keywords per call
  keywordSuggestionsLive: 0.012,
  rankedKeywordsLive:     0.012,

  // Keywords Data API
  searchVolumeLive: 0.025,
} as const;

export function dataforseoCostEur(input: {
  operation: keyof typeof DATAFORSEO_PRICING_USD;
  /** For SERP/related/etc: number of pages or items billed. For keyword-overview: number of keywords. */
  count: number;
}): number {
  return usdToEur(DATAFORSEO_PRICING_USD[input.operation] * input.count);
}
```

The original `dataforseoCostEur` from Spec 03 had only `serpStandard/serpPriority/serpLive/keywordSuggestions`. We expand it here.

### Types

`packages/adapters/dataforseo/src/types.ts`:

```typescript
/**
 * Common params shared across most DataForSEO endpoints.
 * Defaults reflect German-market focus for our primary tenant.
 */
export type DataForSeoCommonInput = {
  projectId: string;
  pipelineRunId?: string;
  articleId?: string;
  operation: string;
  estimatedCostEur: number;
};

/**
 * Location codes used by DataForSEO. We expose the ones relevant to our tenants.
 * Full list: https://api.dataforseo.com/v3/serp/google/locations (5000+ entries)
 */
export const LOCATION_CODES = {
  GERMANY: 2276,
  AUSTRIA: 2040,
  SWITZERLAND: 2756,
  USA: 2840,
  UK: 2826,
} as const;

export type LocationCode = (typeof LOCATION_CODES)[keyof typeof LOCATION_CODES];

/**
 * Common DataForSEO language codes. Full list available via the API.
 */
export const LANGUAGE_CODES = {
  DE: "de",
  EN: "en",
  EN_US: "en",
  EN_GB: "en",
  FR: "fr",
} as const;

export type LanguageCode = string;

/**
 * SERP API: Google Organic — top results for a keyword.
 */
export type SerpInput = DataForSeoCommonInput & {
  keyword: string;
  locationCode?: number;   // default: 2276 (Germany)
  languageCode?: string;   // default: "de"
  /** How many results to return. 10 = 1 page (cheapest). Each additional page = 0.75× base. */
  depth?: 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 90 | 100;
  /** Live = immediate (~6s). Standard = queued (~5min). Default: live. */
  mode?: "live" | "standard";
  /** Device emulation. Default: desktop. */
  device?: "desktop" | "mobile";
};

export type OrganicResult = {
  position: number;
  url: string;
  domain: string;
  title: string;
  snippet: string;
  /** SERP feature: featured_snippet, people_also_ask, image_pack, etc. — when applicable. */
  serpFeature?: string;
};

export type SerpResult = {
  keyword: string;
  totalResults: number;
  serpFeatures: string[];      // present feature types: ["featured_snippet", "people_also_ask", ...]
  organicResults: OrganicResult[];
  /** Raw "People Also Ask" questions if present. */
  peopleAlsoAsk: string[];
  /** Raw "Related Searches" if present. */
  relatedSearches: string[];
  /** URL DataForSEO used to verify (open in incognito for sanity check). */
  checkUrl: string;
};

/**
 * Labs API: Keyword Overview — search volume, CPC, difficulty, intent.
 * Up to 700 keywords per request.
 */
export type KeywordOverviewInput = DataForSeoCommonInput & {
  keywords: string[];          // 1-700 keywords
  locationCode?: number;
  languageCode?: string;
  /** Include SERP info (which URLs rank for this keyword). +25% cost. */
  includeSerpInfo?: boolean;
  /** Include clickstream-derived metrics (Anthropic-paper-like accuracy). +50% cost. */
  includeClickstreamData?: boolean;
};

export type KeywordIntent = "informational" | "navigational" | "commercial" | "transactional";

export type KeywordOverviewItem = {
  keyword: string;
  searchVolume: number | null;        // monthly searches (latest available)
  monthlySearches: Array<{ year: number; month: number; searchVolume: number }>;
  cpcUsd: number | null;
  competition: number | null;          // 0-1, paid competition
  competitionLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  /** Keyword difficulty 0-100. */
  keywordDifficulty: number | null;
  mainIntent: KeywordIntent | null;
  foreignIntent: KeywordIntent[];
  /** Top URLs ranking for this keyword if includeSerpInfo. */
  serpUrls: string[];
};

export type KeywordOverviewResult = {
  items: KeywordOverviewItem[];
};

/**
 * Labs API: Related Keywords — keyword expansion from a seed.
 */
export type RelatedKeywordsInput = DataForSeoCommonInput & {
  seed: string;
  locationCode?: number;
  languageCode?: string;
  /** Tree depth. Default: 4 (broader). 1 = closest variants. */
  depth?: 1 | 2 | 3 | 4;
  /** Max keywords to return. Default: 100. Max: 4680. */
  limit?: number;
  /** Filter by min search volume. */
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

/**
 * Labs API: Ranked Keywords — what does THIS DOMAIN rank for?
 * Used for competitor analysis ("what is horstmar.de ranking for?").
 */
export type RankedKeywordsInput = DataForSeoCommonInput & {
  domain: string;            // e.g., "horstmar.de"
  locationCode?: number;
  languageCode?: string;
  limit?: number;             // default 100, max 1000 per call
  /** Filter to only show keywords where the domain ranks in top N. Default: top 100. */
  maxPosition?: number;
};

export type RankedKeywordItem = {
  keyword: string;
  position: number;
  url: string;
  searchVolume: number | null;
  estimatedTrafficVolume: number | null;  // ETV
  cpcUsd: number | null;
};

export type RankedKeywordsResult = {
  domain: string;
  items: RankedKeywordItem[];
  totalCount: number;
};

export class DataForSeoError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DataForSeoError";
  }
}
```

### The Adapter

`packages/adapters/dataforseo/src/client.ts`:

```typescript
import * as dfs from "dataforseo-client";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { track, dataforseoCostEur } from "@marketing-auto/cost-tracker";
import {
  type SerpInput,
  type SerpResult,
  type OrganicResult,
  type KeywordOverviewInput,
  type KeywordOverviewResult,
  type KeywordOverviewItem,
  type KeywordIntent,
  type RelatedKeywordsInput,
  type RelatedKeywordsResult,
  type RankedKeywordsInput,
  type RankedKeywordsResult,
  DataForSeoError,
} from "./types.ts";

const log = createLogger("dataforseo");

const BASE_URL = "https://api.dataforseo.com";
const DEFAULT_LOCATION = 2276;  // Germany
const DEFAULT_LANGUAGE = "de";

let _serpApi: dfs.SerpApi | null = null;
let _labsApi: dfs.DataforseoLabsApi | null = null;

function getCredentials(): { username: string; password: string } {
  const env = getEnv();
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set");
  }
  return { username: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD };
}

function authFetch(
  username: string,
  password: string,
): (url: RequestInfo, init?: RequestInit) => Promise<Response> {
  const token = btoa(`${username}:${password}`);
  return (url, init) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
      },
    });
}

function getSerpApi(): dfs.SerpApi {
  if (_serpApi) return _serpApi;
  const { username, password } = getCredentials();
  _serpApi = new dfs.SerpApi(BASE_URL, { fetch: authFetch(username, password) });
  return _serpApi;
}

function getLabsApi(): dfs.DataforseoLabsApi {
  if (_labsApi) return _labsApi;
  const { username, password } = getCredentials();
  _labsApi = new dfs.DataforseoLabsApi(BASE_URL, { fetch: authFetch(username, password) });
  return _labsApi;
}

/**
 * Validates a DataForSEO response envelope. Throws DataForSeoError on protocol errors.
 * Returns the first task on success.
 */
function validateResponse<T extends { tasks?: Array<{ status_code?: number; status_message?: string; result?: unknown }> }>(
  resp: T,
  topStatusCode: number | undefined,
): NonNullable<NonNullable<T["tasks"]>[number]> {
  if (topStatusCode && topStatusCode !== 20000) {
    throw new DataForSeoError(
      `DataForSEO API error: status ${topStatusCode}`,
      topStatusCode,
    );
  }
  const tasks = resp.tasks;
  if (!tasks || tasks.length === 0) {
    throw new DataForSeoError("DataForSEO response had no tasks");
  }
  const task = tasks[0]!;
  if (task.status_code !== 20000) {
    throw new DataForSeoError(
      `DataForSEO task error: ${task.status_message ?? "unknown"} (code ${task.status_code})`,
      task.status_code,
    );
  }
  return task as NonNullable<NonNullable<T["tasks"]>[number]>;
}

// ───────────────────────────────────────────
// SERP API
// ───────────────────────────────────────────

export async function serp(input: SerpInput): Promise<SerpResult> {
  const mode = input.mode ?? "live";
  const depth = input.depth ?? 10;
  const locationCode = input.locationCode ?? DEFAULT_LOCATION;
  const languageCode = input.languageCode ?? DEFAULT_LANGUAGE;
  const device = input.device ?? "desktop";

  if (mode === "standard") {
    throw new DataForSeoError(
      "Standard (queued) SERP mode is not implemented in MVP. Use mode: 'live'. " +
      "If batching becomes critical, implement task_post + task_get polling.",
    );
  }

  const api = getSerpApi();
  const task = new dfs.SerpGoogleOrganicLiveAdvancedRequestInfo();
  task.keyword = input.keyword;
  task.location_code = locationCode;
  task.language_code = languageCode;
  task.depth = depth;
  task.device = device;

  log.debug({
    projectId: input.projectId,
    operation: input.operation,
    keyword: input.keyword,
    locationCode,
    depth,
  }, "DataForSEO SERP call");

  // Pages charged: depth/10. First page = 1×, subsequent = 0.75×.
  const pages = Math.ceil(depth / 10);
  const pricedUnits = pages === 1 ? 1 : 1 + 0.75 * (pages - 1);

  const result = await track({
    projectId: input.projectId,
    service: "dataforseo",
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    fn: async () => {
      try {
        const resp = await api.googleOrganicLiveAdvanced([task]);
        const validatedTask = validateResponse(resp, resp.status_code);
        return validatedTask;
      } catch (e) {
        if (e instanceof DataForSeoError) throw e;
        throw new DataForSeoError("DataForSEO SERP call failed", undefined, e);
      }
    },
    computeCostEur: () => dataforseoCostEur({
      operation: "serpLive",
      count: pricedUnits,
    }),
    metadata: () => ({
      keyword: input.keyword,
      locationCode,
      languageCode,
      depth,
      device,
      mode,
    }),
  });

  // Parse the result
  const taskResult = (result.result as Array<Record<string, unknown>> | undefined)?.[0];
  if (!taskResult) {
    throw new DataForSeoError("DataForSEO SERP returned empty result");
  }

  const items = (taskResult.items as Array<Record<string, unknown>> | undefined) ?? [];
  const organicResults: OrganicResult[] = [];
  const peopleAlsoAsk: string[] = [];
  const relatedSearches: string[] = [];
  const featureSet = new Set<string>();

  for (const item of items) {
    const itemType = String(item.type ?? "");
    if (itemType !== "organic") featureSet.add(itemType);

    if (itemType === "organic") {
      organicResults.push({
        position: Number(item.rank_absolute ?? item.rank_group ?? 0),
        url: String(item.url ?? ""),
        domain: String(item.domain ?? ""),
        title: String(item.title ?? ""),
        snippet: String(item.description ?? ""),
      });
    } else if (itemType === "people_also_ask") {
      const paaItems = (item.items as Array<Record<string, unknown>> | undefined) ?? [];
      for (const paa of paaItems) {
        if (typeof paa.title === "string") peopleAlsoAsk.push(paa.title);
      }
    } else if (itemType === "related_searches") {
      const rsItems = (item.items as string[] | undefined) ?? [];
      relatedSearches.push(...rsItems);
    }
  }

  return {
    keyword: input.keyword,
    totalResults: Number(taskResult.se_results_count ?? 0),
    serpFeatures: [...featureSet],
    organicResults,
    peopleAlsoAsk,
    relatedSearches,
    checkUrl: String(taskResult.check_url ?? ""),
  };
}

// ───────────────────────────────────────────
// Labs API: Keyword Overview
// ───────────────────────────────────────────

const INTENT_MAP: Record<string, KeywordIntent> = {
  informational: "informational",
  navigational: "navigational",
  commercial: "commercial",
  transactional: "transactional",
};

export async function keywordOverview(input: KeywordOverviewInput): Promise<KeywordOverviewResult> {
  if (input.keywords.length === 0) {
    throw new DataForSeoError("keywords array must contain at least 1 keyword");
  }
  if (input.keywords.length > 700) {
    throw new DataForSeoError("keywords array max length is 700");
  }

  const api = getLabsApi();
  const task = new dfs.DataforseoLabsGoogleKeywordOverviewLiveRequestInfo();
  task.keywords = input.keywords;
  task.location_code = input.locationCode ?? DEFAULT_LOCATION;
  task.language_code = input.languageCode ?? DEFAULT_LANGUAGE;
  task.include_serp_info = input.includeSerpInfo ?? false;
  task.include_clickstream_data = input.includeClickstreamData ?? false;

  log.debug({
    projectId: input.projectId,
    operation: input.operation,
    keywordCount: input.keywords.length,
  }, "DataForSEO Keyword Overview call");

  const result = await track({
    projectId: input.projectId,
    service: "dataforseo",
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    fn: async () => {
      try {
        const resp = await api.googleKeywordOverviewLive([task]);
        return validateResponse(resp, resp.status_code);
      } catch (e) {
        if (e instanceof DataForSeoError) throw e;
        throw new DataForSeoError("Keyword overview call failed", undefined, e);
      }
    },
    computeCostEur: (taskRes) => {
      // Use the task's reported cost when available — DataForSEO returns it in `cost`
      const taskCost = (taskRes as unknown as { cost?: number }).cost;
      if (typeof taskCost === "number" && taskCost > 0) {
        return taskCost * 0.92; // USD → EUR conversion (matches our other adapters)
      }
      // Fallback: use list price × keyword count
      return dataforseoCostEur({
        operation: "keywordOverviewLive",
        count: input.keywords.length / 700,  // base price covers 700; this caps it
      });
    },
    metadata: () => ({
      keywordCount: input.keywords.length,
      includeSerpInfo: input.includeSerpInfo ?? false,
      includeClickstreamData: input.includeClickstreamData ?? false,
    }),
  });

  const taskResults = (result.result as Array<Record<string, unknown>> | undefined) ?? [];
  const taskResult = taskResults[0];
  const items = ((taskResult?.items as Array<Record<string, unknown>>) ?? [])
    .map((item): KeywordOverviewItem => {
      const ki = item.keyword_info as Record<string, unknown> | undefined;
      const kp = item.keyword_properties as Record<string, unknown> | undefined;
      const sii = item.search_intent_info as Record<string, unknown> | undefined;
      const monthly = (ki?.monthly_searches as Array<{ year: number; month: number; search_volume: number }> | undefined) ?? [];

      return {
        keyword: String(item.keyword ?? ""),
        searchVolume: typeof ki?.search_volume === "number" ? ki.search_volume : null,
        monthlySearches: monthly.map((m) => ({
          year: m.year,
          month: m.month,
          searchVolume: m.search_volume,
        })),
        cpcUsd: typeof ki?.cpc === "number" ? ki.cpc : null,
        competition: typeof ki?.competition === "number" ? ki.competition : null,
        competitionLevel: (ki?.competition_level as "LOW" | "MEDIUM" | "HIGH" | null) ?? null,
        keywordDifficulty: typeof kp?.keyword_difficulty === "number" ? kp.keyword_difficulty : null,
        mainIntent: INTENT_MAP[String(sii?.main_intent ?? "")] ?? null,
        foreignIntent: ((sii?.foreign_intent as string[]) ?? [])
          .map((i) => INTENT_MAP[i])
          .filter((i): i is KeywordIntent => i !== undefined),
        serpUrls: ((item.serp_info as { se_results?: Array<{ url: string }> } | undefined)?.se_results ?? [])
          .map((r) => r.url),
      };
    });

  return { items };
}

// ───────────────────────────────────────────
// Labs API: Related Keywords
// ───────────────────────────────────────────

export async function relatedKeywords(input: RelatedKeywordsInput): Promise<RelatedKeywordsResult> {
  const api = getLabsApi();
  const task = new dfs.DataforseoLabsGoogleRelatedKeywordsLiveRequestInfo();
  task.keyword = input.seed;
  task.location_code = input.locationCode ?? DEFAULT_LOCATION;
  task.language_code = input.languageCode ?? DEFAULT_LANGUAGE;
  task.depth = input.depth ?? 4;
  task.limit = input.limit ?? 100;
  if (input.minSearchVolume !== undefined) {
    task.filters = [["keyword_info.search_volume", ">", input.minSearchVolume]];
  }

  log.debug({
    projectId: input.projectId,
    operation: input.operation,
    seed: input.seed,
    depth: task.depth,
    limit: task.limit,
  }, "DataForSEO Related Keywords call");

  const result = await track({
    projectId: input.projectId,
    service: "dataforseo",
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    fn: async () => {
      try {
        const resp = await api.googleRelatedKeywordsLive([task]);
        return validateResponse(resp, resp.status_code);
      } catch (e) {
        if (e instanceof DataForSeoError) throw e;
        throw new DataForSeoError("Related keywords call failed", undefined, e);
      }
    },
    computeCostEur: (taskRes) => {
      const taskCost = (taskRes as unknown as { cost?: number }).cost;
      if (typeof taskCost === "number" && taskCost > 0) return taskCost * 0.92;
      return dataforseoCostEur({ operation: "relatedKeywordsLive", count: 1 });
    },
    metadata: () => ({
      seed: input.seed,
      depth: task.depth,
      limit: task.limit,
    }),
  });

  const taskResults = (result.result as Array<Record<string, unknown>> | undefined) ?? [];
  const taskResult = taskResults[0];
  const items = (taskResult?.items as Array<Record<string, unknown>> | undefined) ?? [];

  return {
    seed: input.seed,
    items: items.map((item) => {
      const kd = item.keyword_data as Record<string, unknown> | undefined;
      const ki = kd?.keyword_info as Record<string, unknown> | undefined;
      return {
        keyword: String(kd?.keyword ?? ""),
        depth: Number(item.depth ?? 0),
        searchVolume: typeof ki?.search_volume === "number" ? ki.search_volume : null,
        cpcUsd: typeof ki?.cpc === "number" ? ki.cpc : null,
        competition: typeof ki?.competition === "number" ? ki.competition : null,
      };
    }),
  };
}

// ───────────────────────────────────────────
// Labs API: Ranked Keywords (what a competitor ranks for)
// ───────────────────────────────────────────

export async function rankedKeywords(input: RankedKeywordsInput): Promise<RankedKeywordsResult> {
  const api = getLabsApi();
  const task = new dfs.DataforseoLabsGoogleRankedKeywordsLiveRequestInfo();
  task.target = input.domain;
  task.location_code = input.locationCode ?? DEFAULT_LOCATION;
  task.language_code = input.languageCode ?? DEFAULT_LANGUAGE;
  task.limit = input.limit ?? 100;
  task.filters = [["ranked_serp_element.serp_item.rank_absolute", "<=", input.maxPosition ?? 100]];

  log.debug({
    projectId: input.projectId,
    operation: input.operation,
    domain: input.domain,
    limit: task.limit,
  }, "DataForSEO Ranked Keywords call");

  const result = await track({
    projectId: input.projectId,
    service: "dataforseo",
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    pipelineRunId: input.pipelineRunId,
    articleId: input.articleId,
    fn: async () => {
      try {
        const resp = await api.googleRankedKeywordsLive([task]);
        return validateResponse(resp, resp.status_code);
      } catch (e) {
        if (e instanceof DataForSeoError) throw e;
        throw new DataForSeoError("Ranked keywords call failed", undefined, e);
      }
    },
    computeCostEur: (taskRes) => {
      const taskCost = (taskRes as unknown as { cost?: number }).cost;
      if (typeof taskCost === "number" && taskCost > 0) return taskCost * 0.92;
      return dataforseoCostEur({ operation: "rankedKeywordsLive", count: 1 });
    },
    metadata: () => ({
      domain: input.domain,
      limit: task.limit,
      maxPosition: input.maxPosition ?? 100,
    }),
  });

  const taskResults = (result.result as Array<Record<string, unknown>> | undefined) ?? [];
  const taskResult = taskResults[0];
  const items = (taskResult?.items as Array<Record<string, unknown>> | undefined) ?? [];
  const totalCount = Number(taskResult?.total_count ?? items.length);

  return {
    domain: input.domain,
    totalCount,
    items: items.map((item) => {
      const kd = item.keyword_data as Record<string, unknown> | undefined;
      const ki = kd?.keyword_info as Record<string, unknown> | undefined;
      const rse = item.ranked_serp_element as Record<string, unknown> | undefined;
      const si = rse?.serp_item as Record<string, unknown> | undefined;
      return {
        keyword: String(kd?.keyword ?? ""),
        position: Number(si?.rank_absolute ?? 0),
        url: String(si?.url ?? ""),
        searchVolume: typeof ki?.search_volume === "number" ? ki.search_volume : null,
        estimatedTrafficVolume: typeof si?.etv === "number" ? si.etv : null,
        cpcUsd: typeof ki?.cpc === "number" ? ki.cpc : null,
      };
    }),
  };
}
```

### Public API & Index

`packages/adapters/dataforseo/src/index.ts`:

```typescript
export { serp, keywordOverview, relatedKeywords, rankedKeywords } from "./client.ts";
export {
  LOCATION_CODES,
  LANGUAGE_CODES,
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
  DataForSeoError,
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
```

### CLAUDE.md

`packages/adapters/dataforseo/CLAUDE.md`:

```markdown
# DataForSEO Adapter

Typed SEO data adapter for SERP analysis, keyword research, and competitor intelligence.

## Hard Rules

- ALL pipeline steps that need SEO data use this adapter — never `dataforseo-client` directly
- EVERY call requires `projectId`, `operation`, `estimatedCostEur`
- Default location is Germany (2276), default language is "de" — override per call when targeting elsewhere
- Default mode for SERP is `live` — `standard` (queued, 5-min polling) is NOT implemented for MVP
- The cost-tracker uses the **actual cost reported by DataForSEO** (in the response `cost` field)
  when available, falling back to our list pricing. This handles DataForSEO's depth-based
  pricing variability (e.g., `+25%` for SERP info, `+50%` for clickstream data).

## Endpoint Selection

- `serp()`: when you need TODAY's SERP for a keyword (competitor analysis, content gap, SERP feature detection)
- `keywordOverview()`: when you need search volume, CPC, difficulty for a list of keywords (cluster planning)
- `relatedKeywords()`: when expanding a cluster (give me 100 related ideas to "claude prompts")
- `rankedKeywords()`: when analyzing a competitor's full keyword footprint ("what does horstmar.de rank for?")

## Cost Awareness

| Operation | Approx cost (live, standard params) | Use case scale |
|-----------|---------------------------------------|----------------|
| `serp` (depth=10) | €0.0018 | per article + per cluster cornerstone |
| `keywordOverview` (700 keywords) | €0.018 | once per cluster |
| `relatedKeywords` (limit=100) | €0.011 | once per cluster |
| `rankedKeywords` (limit=100) | €0.011 | once per competitor research run |

For KI-Wissensraum cold-start (50 keywords + 5 competitor analyses + 30 article SERPs):
expect total ~€0.15.

## Common Mistakes

- DO NOT pass more than 700 keywords to `keywordOverview()` — adapter throws
- DO NOT use `mode: "standard"` (not implemented) — use `live`
- DO NOT use `includeClickstreamData: true` for routine cluster planning — adds 50% cost
  for marginal accuracy improvement on common keywords. Reserve for niche/long-tail keywords.
- DO NOT call `rankedKeywords()` on every article generation — it's a periodic competitor
  research task, not a per-article need (run weekly or monthly via scheduled job)
- DO NOT forget that the `cost` field in DataForSEO responses is in USD — adapter converts
- DO NOT use `device: "mobile"` unless the project's audience is mobile-first;
  results differ significantly from desktop
```

## Acceptance Criteria

- [ ] `bun --filter @marketing-auto/adapter-dataforseo typecheck` passes
- [ ] `serp()` against live API for "claude vs chatgpt" returns at least 5 organic results
- [ ] `keywordOverview()` with 3 keywords returns 3 items, each with non-null `searchVolume` (or null only for very rare/zero-volume queries)
- [ ] `relatedKeywords()` with seed "ai chatbot" returns ≥10 items
- [ ] `rankedKeywords()` for a known domain (e.g., `wikipedia.org`) returns items
- [ ] Each call writes ONE row to `cost_logs` with `service = "dataforseo"`, `cost_eur` matching DataForSEO's reported cost (×0.92 USD→EUR), and metadata containing the operation parameters
- [ ] `serp()` with mode `"standard"` throws `DataForSeoError` with explanatory message
- [ ] `keywordOverview()` with 0 or 701 keywords throws clear error
- [ ] DataForSEO API auth failure (wrong password) bubbles up as `DataForSeoError` with status code from response
- [ ] Cost-limit-exceeded scenario throws `CostLimitExceeded` (no DataForSEO call made)
- [ ] German-locale defaults work without explicit `locationCode`/`languageCode`

## Testing Strategy

`packages/adapters/dataforseo/test/dataforseo.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, projects, costLogs } from "@marketing-auto/db";
import { serp, keywordOverview, relatedKeywords, rankedKeywords, DataForSeoError } from "../src/client.ts";

const live = process.env.RUN_LIVE_DATAFORSEO === "1";
const describeLive = live ? describe : describe.skip;

describeLive("DataForSEO adapter (LIVE)", () => {
  let projectId: string;
  const slug = `dataforseo-test-${Date.now()}`;

  beforeAll(async () => {
    const [p] = await db.insert(projects).values({
      slug,
      name: "DataForSEO Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
      costLimits: { daily: { dataforseo: 1.0 }, monthly: { dataforseo: 10 } },
    }).returning();
    projectId = p!.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("serp returns Germany Google organic results for a German query", async () => {
    const result = await serp({
      projectId,
      operation: "test-serp",
      keyword: "claude vs chatgpt vergleich",
      depth: 10,
      estimatedCostEur: 0.005,
    });

    expect(result.organicResults.length).toBeGreaterThan(3);
    expect(result.organicResults[0]!.url).toMatch(/^https?:\/\//);
    expect(result.checkUrl).toContain("google.de");

    const logs = await db.select().from(costLogs).where(eq(costLogs.projectId, projectId));
    expect(logs[logs.length - 1]!.service).toBe("dataforseo");
    expect(Number(logs[logs.length - 1]!.costEur)).toBeGreaterThan(0);
  }, 30_000);

  it("keywordOverview returns search volume for known keyword", async () => {
    const result = await keywordOverview({
      projectId,
      operation: "test-overview",
      keywords: ["chatgpt", "claude ai", "künstliche intelligenz"],
      estimatedCostEur: 0.05,
    });

    expect(result.items.length).toBe(3);
    // "chatgpt" has high volume in Germany — expect non-null
    const chatgpt = result.items.find((i) => i.keyword === "chatgpt");
    expect(chatgpt?.searchVolume).toBeGreaterThan(10_000);
  }, 30_000);

  it("relatedKeywords returns related ideas", async () => {
    const result = await relatedKeywords({
      projectId,
      operation: "test-related",
      seed: "ki tools",
      limit: 50,
      estimatedCostEur: 0.015,
    });

    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items[0]!.keyword).toBeDefined();
  }, 30_000);

  it("rankedKeywords returns keywords for wikipedia.org", async () => {
    const result = await rankedKeywords({
      projectId,
      operation: "test-ranked",
      domain: "de.wikipedia.org",
      limit: 50,
      maxPosition: 50,
      estimatedCostEur: 0.015,
    });

    expect(result.items.length).toBeGreaterThan(10);
  }, 30_000);

  it("standard mode throws explanatory error", async () => {
    expect(serp({
      projectId,
      operation: "test-standard",
      keyword: "test",
      mode: "standard",
      estimatedCostEur: 0.001,
    })).rejects.toThrow(DataForSeoError);
  });
});

describe("type exports", () => {
  it("exports the right surface", async () => {
    const mod = await import("../src/index.ts");
    expect(typeof mod.serp).toBe("function");
    expect(typeof mod.keywordOverview).toBe("function");
    expect(typeof mod.relatedKeywords).toBe("function");
    expect(typeof mod.rankedKeywords).toBe("function");
    expect(mod.LOCATION_CODES.GERMANY).toBe(2276);
    expect(mod.dataforseo.serp).toBe(mod.serp);
  });
});
```

For live tests:
```bash
RUN_LIVE_DATAFORSEO=1 bun --filter @marketing-auto/adapter-dataforseo test
```
Expected total cost: < $0.10 from your $1 free trial.

## Open Questions / Decisions Made

**Decision 1: Live mode default, Standard mode not implemented for MVP.**
Standard's task-post + ready-poll + task-get flow adds ~150 lines of polling code for a 3.3× cost saving that amounts to <€1/month. If we ever need batch SERP collection (e.g., daily rank tracking for 1000 keywords), revisit.

**Decision 2: Use the official `dataforseo-client` SDK, not raw fetch.**
The SDK provides typed request builders for every endpoint. Saves us maintaining type definitions for DataForSEO's complex response shapes. The auth pattern (Basic + base64) is unusual but well-documented.

**Decision 3: Trust DataForSEO's reported `cost` field over our list pricing.**
The list pricing has too many edge cases (depth multipliers, parameter surcharges, discounts). The response includes the actual cost, which is what they bill against the deposit. Our list-pricing constants are the **fallback** if the response doesn't include `cost` (rare).

**Decision 4: USD→EUR conversion at 0.92 (matches our other adapters).**
Same constant as `cost-tracker/pricing.ts`. If FX shifts significantly, update one file.

**Decision 5: German defaults baked in.**
Most pipeline steps for our primary tenant (KI-Wissensraum) target Germany. Defaults reduce per-call boilerplate. Bellemann (also Germany), Balkonkraftwerk (likely Germany) — same defaults work. Override per call for international.

**Decision 6: One adapter, multiple endpoint families.**
The SDK has `SerpApi`, `DataforseoLabsApi`, `KeywordsDataApi`, `BacklinksApi`, etc. — different classes. We expose one cohesive surface (`serp`, `keywordOverview`, `relatedKeywords`, `rankedKeywords`) so callers don't need to know which "API class" lives behind which endpoint.

**Decision 7: Result shapes are flattened, not 1:1 with DataForSEO's response.**
DataForSEO returns deeply nested JSON (tasks → result → items → keyword_info → competition_level). We flatten to ergonomic, type-safe structures. Trade-off: if DataForSEO adds fields, we re-parse. Worth it.

**Decision 8: No SERP feature parsing beyond "present features" + PAA + Related Searches.**
Featured snippets, knowledge panels, image packs, etc. are all in DataForSEO's response, but parsing them all into typed structures is significant code. We surface their existence in `serpFeatures: string[]` and let pipeline steps drill in via the raw response if needed (future enhancement: expose `rawTask` field).

**Decision 9: Hard limit on `keywordOverview` keyword count.**
DataForSEO's max is 700 per request. Adapter throws above that — caller should batch.

**Decision 10: `rankedKeywords` for competitor analysis is not for daily use.**
It's costly enough (€0.01 per call) and the data changes slowly enough that running it weekly via a scheduled job is the right cadence. Document this in the CLAUDE.md and the future Phase-3 spec that uses it.

## Implementation Order

1. Update cost-tracker pricing in `packages/cost-tracker/src/pricing.ts` (extend `DATAFORSEO_PRICING_USD`)
2. Create `packages/adapters/dataforseo/` with package.json, tsconfig.json, CLAUDE.md
3. Implement `src/types.ts`
4. Implement `src/client.ts` (one endpoint at a time: serp → keywordOverview → relatedKeywords → rankedKeywords)
5. Implement `src/index.ts`
6. `bun install` (pulls `dataforseo-client`)
7. `bun --filter @marketing-auto/adapter-dataforseo typecheck`
8. Sign up for DataForSEO, set credentials in `.env`
9. Manual smoke test: SERP for "test" + keyword overview for ["test"]
10. Run full test suite: `RUN_LIVE_DATAFORSEO=1 bun --filter @marketing-auto/adapter-dataforseo test`
11. Verify `cost_logs` rows in Drizzle Studio
12. Commit: `feat(adapters): dataforseo client for SERP + keyword + competitor data (spec 13)`

## Splitting Plan

Single session, ~1 day. Natural split if pressure shows up:

- **Session A**: types + serp() + tests for SERP, commit
- **Session B**: keywordOverview + relatedKeywords + rankedKeywords + tests, commit

Run `/clear` between sessions.

## Discovered During Implementation

- **`dataforseo-client` shipped as v2.0.24**, not ^1.0.0 as spec assumed. All class and method
  names (`SerpApi`, `DataforseoLabsApi`, `SerpGoogleOrganicLiveAdvancedRequestInfo`, etc.) are
  identical in v2. The lockfile pins 2.0.24.
- **`RequestInfo` is not in scope under Bun's TS config.** The SDK constructor's `http.fetch`
  parameter types its `url` arg as `RequestInfo`, but using that name directly in adapter code
  produces `TS2552: Cannot find name 'RequestInfo'`. Use `string | URL | Request` instead —
  the union that `RequestInfo` aliases in lib.dom.d.ts. Added to root CLAUDE.md Common Mistakes.
- **`EUR_PER_USD` should be imported, not re-declared.** Writing a local `USD_TO_EUR = 0.92`
  constant duplicates the canonical value in `cost-tracker/src/pricing.ts`. Importing `EUR_PER_USD`
  from `@marketing-auto/cost-tracker` keeps all adapters in sync when FX is updated.

## Deviations

- **`DataForSeoError.cause` → `originalCause`** — spec declared `public readonly cause?: unknown`
  on the Error subclass. `Error.cause` is a reserved built-in in ESNext lib; TypeScript requires
  `override` on it. Renamed to `originalCause` per the existing CLAUDE.md rule.
- **`callWithTrack` helper extracted** — spec inlined the 4-branch optional-spread pattern
  (`pipelineRunId + articleId`, `pipelineRunId only`, `articleId only`, neither) inside each
  endpoint. Extracted into a shared `callWithTrack` helper to avoid repeating 30 lines × 4
  endpoints. Behaviour is identical.
- **`USD_TO_EUR` constant removed** — spec had a local `const USD_TO_EUR = 0.92`. Implementation
  imports `EUR_PER_USD` from `@marketing-auto/cost-tracker` instead (see Discovery above).
