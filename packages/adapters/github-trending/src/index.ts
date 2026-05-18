import { z } from "zod";
import { createLogger } from "@marketing-auto/shared";
import type { ExternalSignalSource, RawSignal, SignalSourceContext } from "@marketing-auto/pipelines";
import { searchRepositories, type GitHubCredentials } from "./client.ts";
import { buildTrendingQueries } from "./heuristic.ts";
import type { RawGitHubRepo } from "./types.ts";

export type { GitHubCredentials } from "./client.ts";

const log = createLogger("adapter:github-trending");

// ─── Input schema ─────────────────────────────────────────────────────────────

const _InputSchema = z.object({
  topics: z.array(z.string().min(1)).min(1),
  timeWindowDays: z.number().int().positive(),
  minStarsNew: z.number().int().min(0).default(20),
  minStarsEstablished: z.number().int().min(0).default(500),
  maxAgeDays: z.number().int().positive().default(14),
  perQueryLimit: z.number().int().positive().max(100).default(30),
  credentials: z.object({
    personalAccessToken: z.string().min(1),
  }),
});

type Input = z.infer<typeof _InputSchema>;
// Cast: safe — .parse() always returns Input; narrows the class property type
// away from the wide ZodObject shape (same pattern as adapter-reddit).
const InputSchema = _InputSchema as z.ZodType<Input>;

type TrendingCategory = "new_rising" | "active_established";

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeRepo(
  raw: RawGitHubRepo,
  category: TrendingCategory,
  maxAgeDays: number,
): RawSignal | null {
  if (raw.archived) return null;

  // Defensive age check (GitHub query already filters but guard against API edge cases)
  const referenceDate =
    category === "new_rising" ? new Date(raw.created_at) : new Date(raw.pushed_at);
  const ageDays = (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > maxAgeDays) return null;

  const signal: RawSignal = {
    source: "github",
    externalId: `gh_${raw.full_name.replace("/", "_")}`,
    url: raw.html_url,
    title: raw.full_name,
    publishedAt: new Date(raw.created_at),
    rawPayload: {
      name: raw.name,
      homepage: raw.homepage ?? null,
      language: raw.language ?? null,
      topics: raw.topics ?? [],
      license: raw.license?.spdx_id ?? null,
      trendingCategory: category,
      pushedAt: raw.pushed_at,
    },
    metrics: {
      stars: raw.stargazers_count,
      forks: raw.forks_count,
      watchers: raw.watchers_count,
      openIssues: raw.open_issues_count,
    },
  };

  if (raw.description) {
    signal.summary = raw.description;
  }

  return signal;
}

// ─── GitHubSignalSource ───────────────────────────────────────────────────────

export class GitHubSignalSource implements ExternalSignalSource<Input> {
  readonly source = "github" as const;
  readonly inputSchema = InputSchema;

  async fetch(input: Input, ctx: SignalSourceContext): Promise<RawSignal[]> {
    const parsed = this.inputSchema.parse(input) as Input;
    const creds: GitHubCredentials = parsed.credentials;

    const queries = buildTrendingQueries({
      topics: parsed.topics,
      timeWindowDays: parsed.timeWindowDays,
      minStarsNew: parsed.minStarsNew,
      minStarsEstablished: parsed.minStarsEstablished,
    });

    const seen = new Set<string>();
    const signals: RawSignal[] = [];

    try {
      const newRising = await searchRepositories(
        queries.newRisingQuery,
        creds,
        parsed.perQueryLimit,
      );
      for (const raw of newRising.items) {
        if (seen.has(raw.full_name)) continue;
        seen.add(raw.full_name);
        const signal = normalizeRepo(raw, "new_rising", parsed.maxAgeDays);
        if (signal) signals.push(signal);
      }
    } catch (err) {
      log.warn(
        { projectId: ctx.projectId, err, query: queries.newRisingQuery },
        "GitHub new-rising query failed; continuing",
      );
    }

    try {
      const activeEstablished = await searchRepositories(
        queries.activeEstablishedQuery,
        creds,
        parsed.perQueryLimit,
      );
      for (const raw of activeEstablished.items) {
        if (seen.has(raw.full_name)) continue;
        seen.add(raw.full_name);
        const signal = normalizeRepo(raw, "active_established", parsed.maxAgeDays);
        if (signal) signals.push(signal);
      }
    } catch (err) {
      log.warn(
        { projectId: ctx.projectId, err, query: queries.activeEstablishedQuery },
        "GitHub active-established query failed; continuing",
      );
    }

    log.info(
      {
        projectId: ctx.projectId,
        topicCount: parsed.topics.length,
        uniqueRepos: signals.length,
      },
      "GitHub signal collection complete",
    );

    return signals;
  }
}
