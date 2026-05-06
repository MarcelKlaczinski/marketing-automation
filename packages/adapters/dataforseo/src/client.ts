import * as dfs from "dataforseo-client";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { getGlobal } from "@marketing-auto/core/credentials";
import { track, dataforseoCostEur, EUR_PER_USD } from "@marketing-auto/cost-tracker";
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
const DEFAULT_LOCATION = 2276; // Germany
const DEFAULT_LANGUAGE = "de";

let _serpApi: dfs.SerpApi | null = null;
let _labsApi: dfs.DataforseoLabsApi | null = null;

async function getCredentials(): Promise<{ username: string; password: string }> {
  const env = getEnv();
  const username = (await getGlobal("dataforseo", "login")) ?? env.DATAFORSEO_LOGIN;
  const password = (await getGlobal("dataforseo", "password")) ?? env.DATAFORSEO_PASSWORD;
  if (!username || !password) {
    throw new DataForSeoError(
      "DataForSEO credentials not configured (set via installer or DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD env)",
    );
  }
  return { username, password };
}

function makeAuthHttp(
  username: string,
  password: string,
): { fetch(url: string | URL | Request, init?: RequestInit): Promise<Response> } {
  const token = btoa(`${username}:${password}`);
  return {
    fetch(url, init) {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Basic ${token}`);
      headers.set("Content-Type", "application/json");
      return fetch(url, { ...init, headers });
    },
  };
}

async function getSerpApi(): Promise<dfs.SerpApi> {
  if (_serpApi) return _serpApi;
  const { username, password } = await getCredentials();
  _serpApi = new dfs.SerpApi(BASE_URL, makeAuthHttp(username, password));
  return _serpApi;
}

async function getLabsApi(): Promise<dfs.DataforseoLabsApi> {
  if (_labsApi) return _labsApi;
  const { username, password } = await getCredentials();
  _labsApi = new dfs.DataforseoLabsApi(
    BASE_URL,
    makeAuthHttp(username, password),
  );
  return _labsApi;
}

function validateTask<
  T extends {
    status_code?: number | undefined;
    status_message?: string | undefined;
    result?: unknown;
  },
>(
  resp: { status_code?: number | undefined; tasks?: T[] | undefined } | null,
): T {
  if (!resp) {
    throw new DataForSeoError("DataForSEO returned null response");
  }
  if (resp.status_code !== undefined && resp.status_code !== 20000) {
    throw new DataForSeoError(
      `DataForSEO API error: status ${resp.status_code}`,
      resp.status_code,
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
  return task;
}

function buildTrackBase(input: {
  projectId: string;
  operation: string;
  estimatedCostEur: number;
}) {
  return {
    projectId: input.projectId,
    service: "dataforseo" as const,
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
  };
}

async function callWithTrack<T>(opts: {
  projectId: string;
  operation: string;
  estimatedCostEur: number;
  pipelineRunId: string | undefined;
  articleId: string | undefined;
  fn: () => Promise<T>;
  computeCostEur: (result: T) => number;
  metadata: () => Record<string, unknown>;
}): Promise<T> {
  const base = buildTrackBase({
    projectId: opts.projectId,
    operation: opts.operation,
    estimatedCostEur: opts.estimatedCostEur,
  });

  if (opts.pipelineRunId !== undefined && opts.articleId !== undefined) {
    return track({
      ...base,
      pipelineRunId: opts.pipelineRunId,
      articleId: opts.articleId,
      fn: opts.fn,
      computeCostEur: opts.computeCostEur,
      metadata: opts.metadata,
    });
  }
  if (opts.pipelineRunId !== undefined) {
    return track({
      ...base,
      pipelineRunId: opts.pipelineRunId,
      fn: opts.fn,
      computeCostEur: opts.computeCostEur,
      metadata: opts.metadata,
    });
  }
  if (opts.articleId !== undefined) {
    return track({
      ...base,
      articleId: opts.articleId,
      fn: opts.fn,
      computeCostEur: opts.computeCostEur,
      metadata: opts.metadata,
    });
  }
  return track({
    ...base,
    fn: opts.fn,
    computeCostEur: opts.computeCostEur,
    metadata: opts.metadata,
  });
}

function taskReportedCostEur(task: unknown): number | null {
  if (
    task !== null &&
    typeof task === "object" &&
    "cost" in task &&
    typeof (task as { cost: unknown }).cost === "number" &&
    (task as { cost: number }).cost > 0
  ) {
    return (task as { cost: number }).cost * EUR_PER_USD;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// SERP API
// ─────────────────────────────────────────────────────────────

export async function serp(input: SerpInput): Promise<SerpResult> {
  const mode = input.mode ?? "live";

  if (mode === "standard") {
    throw new DataForSeoError(
      "Standard (queued) SERP mode is not implemented. Use mode: 'live'. " +
        "For bulk offline analysis, implement task_post + task_get polling.",
    );
  }

  const depth = input.depth ?? 10;
  const locationCode = input.locationCode ?? DEFAULT_LOCATION;
  const languageCode = input.languageCode ?? DEFAULT_LANGUAGE;
  const device = input.device ?? "desktop";

  const pages = Math.ceil(depth / 10);
  const pricedUnits = pages === 1 ? 1 : 1 + 0.75 * (pages - 1);

  log.debug(
    { projectId: input.projectId, operation: input.operation, keyword: input.keyword, depth },
    "DataForSEO SERP call",
  );

  const task = validateTask(
    await callWithTrack({
      projectId: input.projectId,
      operation: input.operation,
      estimatedCostEur: input.estimatedCostEur,
      pipelineRunId: input.pipelineRunId,
      articleId: input.articleId,
      fn: async () => {
        const req = new dfs.SerpGoogleOrganicLiveAdvancedRequestInfo();
        req.keyword = input.keyword;
        req.location_code = locationCode;
        req.language_code = languageCode;
        req.depth = depth;
        req.device = device;
        try {
          return await (await getSerpApi()).googleOrganicLiveAdvanced([req]);
        } catch (e) {
          throw new DataForSeoError("DataForSEO SERP call failed", undefined, e);
        }
      },
      computeCostEur: (resp) => {
        if (resp?.tasks?.[0]) {
          const fromApi = taskReportedCostEur(resp.tasks[0]);
          if (fromApi !== null) return fromApi;
        }
        return dataforseoCostEur({ operation: "serpLive", count: pricedUnits });
      },
      metadata: () => ({ keyword: input.keyword, locationCode, languageCode, depth, device, mode }),
    }),
  );

  const taskResult = (task.result as Array<Record<string, unknown>> | undefined)?.[0];
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
      const paaItems =
        (item.items as Array<Record<string, unknown>> | undefined) ?? [];
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

// ─────────────────────────────────────────────────────────────
// Labs API: Keyword Overview
// ─────────────────────────────────────────────────────────────

const INTENT_MAP: Record<string, KeywordIntent> = {
  informational: "informational",
  navigational: "navigational",
  commercial: "commercial",
  transactional: "transactional",
};

export async function keywordOverview(
  input: KeywordOverviewInput,
): Promise<KeywordOverviewResult> {
  if (input.keywords.length === 0) {
    throw new DataForSeoError("keywords array must contain at least 1 keyword");
  }
  if (input.keywords.length > 700) {
    throw new DataForSeoError("keywords array max length is 700");
  }

  const locationCode = input.locationCode ?? DEFAULT_LOCATION;
  const languageCode = input.languageCode ?? DEFAULT_LANGUAGE;

  log.debug(
    { projectId: input.projectId, operation: input.operation, keywordCount: input.keywords.length },
    "DataForSEO Keyword Overview call",
  );

  const task = validateTask(
    await callWithTrack({
      projectId: input.projectId,
      operation: input.operation,
      estimatedCostEur: input.estimatedCostEur,
      pipelineRunId: input.pipelineRunId,
      articleId: input.articleId,
      fn: async () => {
        const req = new dfs.DataforseoLabsGoogleKeywordOverviewLiveRequestInfo();
        req.keywords = input.keywords;
        req.location_code = locationCode;
        req.language_code = languageCode;
        req.include_serp_info = input.includeSerpInfo ?? false;
        req.include_clickstream_data = input.includeClickstreamData ?? false;
        try {
          return await (await getLabsApi()).googleKeywordOverviewLive([req]);
        } catch (e) {
          throw new DataForSeoError("Keyword overview call failed", undefined, e);
        }
      },
      computeCostEur: (resp) => {
        if (resp?.tasks?.[0]) {
          const fromApi = taskReportedCostEur(resp.tasks[0]);
          if (fromApi !== null) return fromApi;
        }
        return dataforseoCostEur({
          operation: "keywordOverviewLive",
          count: input.keywords.length / 700,
        });
      },
      metadata: () => ({
        keywordCount: input.keywords.length,
        includeSerpInfo: input.includeSerpInfo ?? false,
        includeClickstreamData: input.includeClickstreamData ?? false,
      }),
    }),
  );

  const taskResults =
    (task.result as Array<Record<string, unknown>> | undefined) ?? [];
  const taskResult = taskResults[0];
  const items = (
    (taskResult?.items as Array<Record<string, unknown>>) ?? []
  ).map((item): KeywordOverviewItem => {
    const ki = item.keyword_info as Record<string, unknown> | undefined;
    const kp = item.keyword_properties as Record<string, unknown> | undefined;
    const sii = item.search_intent_info as Record<string, unknown> | undefined;
    const monthly =
      (ki?.monthly_searches as
        | Array<{ year: number; month: number; search_volume: number }>
        | undefined) ?? [];

    return {
      keyword: String(item.keyword ?? ""),
      searchVolume:
        typeof ki?.search_volume === "number" ? ki.search_volume : null,
      monthlySearches: monthly.map((m) => ({
        year: m.year,
        month: m.month,
        searchVolume: m.search_volume,
      })),
      cpcUsd: typeof ki?.cpc === "number" ? ki.cpc : null,
      competition:
        typeof ki?.competition === "number" ? ki.competition : null,
      competitionLevel:
        (ki?.competition_level as "LOW" | "MEDIUM" | "HIGH" | null) ?? null,
      keywordDifficulty:
        typeof kp?.keyword_difficulty === "number"
          ? kp.keyword_difficulty
          : null,
      mainIntent: INTENT_MAP[String(sii?.main_intent ?? "")] ?? null,
      foreignIntent: (
        (sii?.foreign_intent as string[] | undefined) ?? []
      )
        .map((i) => INTENT_MAP[i])
        .filter((i): i is KeywordIntent => i !== undefined),
      serpUrls: (
        (
          item.serp_info as
            | { se_results?: Array<{ url: string }> }
            | undefined
        )?.se_results ?? []
      ).map((r) => r.url),
    };
  });

  return { items };
}

// ─────────────────────────────────────────────────────────────
// Labs API: Related Keywords
// ─────────────────────────────────────────────────────────────

export async function relatedKeywords(
  input: RelatedKeywordsInput,
): Promise<RelatedKeywordsResult> {
  const locationCode = input.locationCode ?? DEFAULT_LOCATION;
  const languageCode = input.languageCode ?? DEFAULT_LANGUAGE;
  const depth = input.depth ?? 4;
  const limit = input.limit ?? 100;

  log.debug(
    { projectId: input.projectId, operation: input.operation, seed: input.seed, depth, limit },
    "DataForSEO Related Keywords call",
  );

  const task = validateTask(
    await callWithTrack({
      projectId: input.projectId,
      operation: input.operation,
      estimatedCostEur: input.estimatedCostEur,
      pipelineRunId: input.pipelineRunId,
      articleId: input.articleId,
      fn: async () => {
        const req =
          new dfs.DataforseoLabsGoogleRelatedKeywordsLiveRequestInfo();
        req.keyword = input.seed;
        req.location_code = locationCode;
        req.language_code = languageCode;
        req.depth = depth;
        req.limit = limit;
        if (input.minSearchVolume !== undefined) {
          req.filters = [
            ["keyword_info.search_volume", ">", input.minSearchVolume],
          ];
        }
        try {
          return await (await getLabsApi()).googleRelatedKeywordsLive([req]);
        } catch (e) {
          throw new DataForSeoError("Related keywords call failed", undefined, e);
        }
      },
      computeCostEur: (resp) => {
        if (resp?.tasks?.[0]) {
          const fromApi = taskReportedCostEur(resp.tasks[0]);
          if (fromApi !== null) return fromApi;
        }
        return dataforseoCostEur({ operation: "relatedKeywordsLive", count: 1 });
      },
      metadata: () => ({ seed: input.seed, depth, limit }),
    }),
  );

  const taskResults =
    (task.result as Array<Record<string, unknown>> | undefined) ?? [];
  const taskResult = taskResults[0];
  const items =
    (taskResult?.items as Array<Record<string, unknown>> | undefined) ?? [];

  return {
    seed: input.seed,
    items: items.map((item) => {
      const kd = item.keyword_data as Record<string, unknown> | undefined;
      const ki = kd?.keyword_info as Record<string, unknown> | undefined;
      return {
        keyword: String(kd?.keyword ?? ""),
        depth: Number(item.depth ?? 0),
        searchVolume:
          typeof ki?.search_volume === "number" ? ki.search_volume : null,
        cpcUsd: typeof ki?.cpc === "number" ? ki.cpc : null,
        competition:
          typeof ki?.competition === "number" ? ki.competition : null,
      };
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// Labs API: Ranked Keywords
// ─────────────────────────────────────────────────────────────

export async function rankedKeywords(
  input: RankedKeywordsInput,
): Promise<RankedKeywordsResult> {
  const locationCode = input.locationCode ?? DEFAULT_LOCATION;
  const languageCode = input.languageCode ?? DEFAULT_LANGUAGE;
  const limit = input.limit ?? 100;
  const maxPosition = input.maxPosition ?? 100;

  log.debug(
    { projectId: input.projectId, operation: input.operation, domain: input.domain, limit },
    "DataForSEO Ranked Keywords call",
  );

  const task = validateTask(
    await callWithTrack({
      projectId: input.projectId,
      operation: input.operation,
      estimatedCostEur: input.estimatedCostEur,
      pipelineRunId: input.pipelineRunId,
      articleId: input.articleId,
      fn: async () => {
        const req =
          new dfs.DataforseoLabsGoogleRankedKeywordsLiveRequestInfo();
        req.target = input.domain;
        req.location_code = locationCode;
        req.language_code = languageCode;
        req.limit = limit;
        req.filters = [
          ["ranked_serp_element.serp_item.rank_absolute", "<=", maxPosition],
        ];
        try {
          return await (await getLabsApi()).googleRankedKeywordsLive([req]);
        } catch (e) {
          throw new DataForSeoError("Ranked keywords call failed", undefined, e);
        }
      },
      computeCostEur: (resp) => {
        if (resp?.tasks?.[0]) {
          const fromApi = taskReportedCostEur(resp.tasks[0]);
          if (fromApi !== null) return fromApi;
        }
        return dataforseoCostEur({ operation: "rankedKeywordsLive", count: 1 });
      },
      metadata: () => ({ domain: input.domain, limit, maxPosition }),
    }),
  );

  const taskResults =
    (task.result as Array<Record<string, unknown>> | undefined) ?? [];
  const taskResult = taskResults[0];
  const items =
    (taskResult?.items as Array<Record<string, unknown>> | undefined) ?? [];
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
        searchVolume:
          typeof ki?.search_volume === "number" ? ki.search_volume : null,
        estimatedTrafficVolume:
          typeof si?.etv === "number" ? si.etv : null,
        cpcUsd: typeof ki?.cpc === "number" ? ki.cpc : null,
      };
    }),
  };
}
