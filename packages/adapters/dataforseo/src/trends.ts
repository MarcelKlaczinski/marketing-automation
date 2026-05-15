import { assertCostBudget } from "@marketing-auto/core/cost";
import { EUR_PER_USD, track } from "@marketing-auto/cost-tracker";
import { createLogger } from "@marketing-auto/shared";
import { getGlobal } from "@marketing-auto/core/credentials";
import { getEnv } from "@marketing-auto/shared";
import { DataForSeoError } from "./types.ts";

const log = createLogger("dataforseo:trends");

const BASE_URL = "https://api.dataforseo.com";
// ~€0.010 per call for up to 5 keywords (DataForSEO pricing for Google Trends Explore)
const TRENDS_COST_USD = 0.011;
const DEFAULT_LOCATION = "Germany";
const DEFAULT_LANGUAGE = "de";

export type TrendsExploreInput = {
  projectId: string;
  pipelineRunId?: string;
  operation: string;
  keywords: string[];
  location?: string;
  language?: string;
  estimatedCostEur: number;
};

export type TrendsExploreItem = {
  keyword: string;
  /** Average search volume for the most recent month in the response */
  current_volume: number | null;
  /** Average search volume for the same month in the prior year */
  prev_year_volume: number | null;
  /**
   * YoY growth ratio: (current - prev_year) / prev_year.
   * null when prev_year_volume is 0 or data is unavailable.
   */
  growth_ratio: number | null;
};

type DfsKeywordDataItem = {
  keyword: string;
  months?: Array<{
    year: number;
    month: number;
    search_volume: number | null;
  }>;
};

type DfsTrendsTask = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: DfsKeywordDataItem[] | null;
};

type DfsTrendsResponse = {
  status_code?: number;
  tasks?: DfsTrendsTask[];
};

async function getCredentials(): Promise<{ username: string; password: string }> {
  const env = getEnv();
  const username = (await getGlobal("dataforseo", "login")) ?? env.DATAFORSEO_LOGIN;
  const password = (await getGlobal("dataforseo", "password")) ?? env.DATAFORSEO_PASSWORD;
  if (!username || !password) {
    throw new DataForSeoError(
      "DataForSEO credentials not configured (set via installer or DATAFORSEO_LOGIN/DATAFORSEO_PASSWORD env)"
    );
  }
  return { username, password };
}

function makeAuthHeaders(username: string, password: string): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

/**
 * Compute YoY growth ratio from monthly data points.
 * Uses the most recent month vs the same month one year earlier.
 * Exported for unit testing.
 */
export function computeGrowthRatio(months: DfsKeywordDataItem["months"]): {
  current_volume: number | null;
  prev_year_volume: number | null;
  growth_ratio: number | null;
} {
  if (!months || months.length === 0) {
    return { current_volume: null, prev_year_volume: null, growth_ratio: null };
  }

  const sorted = [...months].sort(
    (a, b) => b.year - a.year || b.month - a.month
  );

  const latest = sorted[0];
  if (!latest) return { current_volume: null, prev_year_volume: null, growth_ratio: null };

  const current_volume = latest.search_volume;

  const prevYear = sorted.find(
    (m) => m.year === latest.year - 1 && m.month === latest.month
  );
  const prev_year_volume = prevYear?.search_volume ?? null;

  let growth_ratio: number | null = null;
  if (current_volume !== null && prev_year_volume !== null && prev_year_volume > 0) {
    growth_ratio = (current_volume - prev_year_volume) / prev_year_volume;
  }

  return { current_volume, prev_year_volume, growth_ratio };
}

export async function trendsExplore(input: TrendsExploreInput): Promise<TrendsExploreItem[]> {
  if (input.keywords.length === 0) return [];
  if (input.keywords.length > 5) {
    throw new DataForSeoError(
      `trendsExplore: at most 5 keywords per call (got ${input.keywords.length})`
    );
  }

  await assertCostBudget(input.projectId, "dataforseo", input.estimatedCostEur);

  const { username, password } = await getCredentials();

  log.debug(
    { projectId: input.projectId, operation: input.operation, keywords: input.keywords },
    "DataForSEO Google Trends Explore call"
  );

  const result = await track({
    projectId: input.projectId,
    service: "dataforseo",
    operation: input.operation,
    estimatedCostEur: input.estimatedCostEur,
    ...(input.pipelineRunId !== undefined && { pipelineRunId: input.pipelineRunId }),
    fn: async () => {
      const res = await fetch(
        `${BASE_URL}/v3/keywords_data/google_trends/explore/live`,
        {
          method: "POST",
          headers: makeAuthHeaders(username, password),
          body: JSON.stringify([
            {
              keywords: input.keywords,
              location_name: input.location ?? DEFAULT_LOCATION,
              language_code: input.language ?? DEFAULT_LANGUAGE,
              type: "web_search",
              // request 24 months to get current + same month last year
              date_from: new Date(Date.now() - 730 * 86_400_000)
                .toISOString()
                .slice(0, 10),
            },
          ]),
        }
      );

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new DataForSeoError(`DataForSEO Trends HTTP ${res.status}: ${body}`);
      }

      return res.json() as Promise<DfsTrendsResponse>;
    },
    computeCostEur: (resp) => {
      const task = resp.tasks?.[0];
      if (task?.cost && task.cost > 0) {
        return task.cost * EUR_PER_USD;
      }
      return TRENDS_COST_USD * EUR_PER_USD;
    },
    metadata: () => ({
      keywords: input.keywords,
      location: input.location ?? DEFAULT_LOCATION,
    }),
  });

  const task = result.tasks?.[0];
  if (!task) {
    throw new DataForSeoError("DataForSEO Trends: no task in response");
  }
  if (task.status_code !== 20000) {
    throw new DataForSeoError(
      `DataForSEO Trends task error: ${task.status_message ?? "unknown"} (code ${task.status_code})`
    );
  }

  const items: DfsKeywordDataItem[] = task.result ?? [];

  return input.keywords.map((keyword) => {
    const item = items.find((i) => i.keyword === keyword);
    if (!item) {
      return { keyword, current_volume: null, prev_year_volume: null, growth_ratio: null };
    }
    const growth = computeGrowthRatio(item.months);
    return { keyword, ...growth };
  });
}
