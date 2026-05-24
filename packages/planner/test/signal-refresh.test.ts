// Spec 62.3: refreshSignalsForProject() unit tests.
// Uses real DB fixtures (matching the convention from goal-validator.test.ts).
// Each test creates a fresh project + planner_config + project_configuration row,
// then exercises the orchestration with stub fetchers.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  externalSignals,
  projectConfigurations,
  projects,
  upsertProjectPlannerConfig,
} from "@marketing-auto/db";
import {
  refreshSignalsForProject,
  type RefreshableSignal,
  type SignalFetcher,
  type SignalSourceName,
} from "../src/index.ts";

let projectId: string;

async function freshProject(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({
      slug: `signal-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "signal-refresh-test",
      industry: "other",
      pipelineTemplate: "educational",
      marketingContextMd: "",
    })
    .returning();
  if (!row) throw new Error("project insert failed");
  return row.id;
}

async function seedConfig(projectId: string, enabledSources: Partial<Record<SignalSourceName, boolean>>): Promise<void> {
  await db.insert(projectConfigurations).values({
    projectId,
    version: 1,
    status: "active",
    intentTaxonomyDefault: [],
    masterPrompts: {},
    topicScope: {
      languages: ["de", "en"],
      exclusions: [],
      primary_themes: [],
      relevance_keywords: [],
      min_trend_score: 25,
      min_signal_thresholds: { hackernews: 3, producthunt: 0, vendor_rss: 0 },
    },
    automationRules: [],
    signalSources: {
      producthunt: enabledSources.producthunt ?? false,
      hackernews: {
        enabled: enabledSources.hackernews ?? false,
        queries: ["test"],
        hitsPerPage: 50,
        minPoints: 5,
        // Spec 64.19 / Phase C — required since schema widened
        maxAgeDays: 30,
      },
      reddit: {
        enabled: enabledSources.reddit ?? false,
        subreddits: [],
        sortMode: "top",
        timeWindow: "week",
        minUpvotes: 50,
        minComments: 10,
        maxAgeDays: 7,
        cronPattern: "30 2 * * *",
      },
      github: {
        enabled: enabledSources.github ?? false,
        topics: [],
        timeWindowDays: 7,
        minStarsNew: 20,
        minStarsEstablished: 500,
        maxAgeDays: 14,
        cronPattern: "0 3 * * *",
      },
      vendor_rss: {
        enabled: enabledSources.vendor_rss ?? false,
        feeds: [],
        // Spec 64.19 / Phase C
        maxAgeDays: 14,
      },
      dataforseo_trends: false,
    },
  });
}

const ALL_ENABLED: Partial<Record<SignalSourceName, boolean>> = {
  producthunt: true,
  hackernews: true,
  vendor_rss: true,
  reddit: true,
  github: true,
};

function makeSignal(source: RefreshableSignal["source"], externalId: string): RefreshableSignal {
  return {
    source,
    externalId,
    title: `${source}-${externalId}`,
    rawPayload: { raw: true },
  };
}

const noopReadCreds = async () => ({});

beforeEach(async () => {
  projectId = await freshProject();
});

afterEach(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
});

describe("refreshSignalsForProject", () => {
  it("returns 5 per-source results with totalRowsAdded and durationMs", async () => {
    await seedConfig(projectId, {});

    const result = await refreshSignalsForProject({
      projectId,
      fetchers: {},
      readCreds: noopReadCreds,
    });

    expect(result.projectId).toBe(projectId);
    expect(result.sourceResults).toHaveLength(5);
    expect(new Set(result.sourceResults.map((r) => r.source))).toEqual(
      new Set(["producthunt", "hackernews", "vendor_rss", "reddit", "github"]),
    );
    expect(result.totalRowsAdded).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks disabled sources as 'skipped'", async () => {
    await seedConfig(projectId, { producthunt: false, hackernews: false, reddit: false });

    const result = await refreshSignalsForProject({
      projectId,
      fetchers: { producthunt: async () => [] },
      readCreds: noopReadCreds,
    });

    const ph = result.sourceResults.find((r) => r.source === "producthunt");
    expect(ph?.status).toBe("skipped");
    expect(ph?.notes).toContain("disabled");
  });

  it("marks enabled-but-no-fetcher-wired sources as 'skipped' with explanatory note", async () => {
    await seedConfig(projectId, ALL_ENABLED);

    const result = await refreshSignalsForProject({
      projectId,
      fetchers: {}, // no fetchers wired
      readCreds: noopReadCreds,
    });

    for (const r of result.sourceResults) {
      expect(r.status).toBe("skipped");
      expect(r.notes).toContain("No fetcher wired");
    }
  });

  it("maps adapter 'credentials' errors to 'no_credentials' status (not 'error')", async () => {
    await seedConfig(projectId, ALL_ENABLED);

    const credsThrower: SignalFetcher = async () => {
      throw new Error("reddit: client_id, client_secret, and user_agent credentials not configured");
    };

    const result = await refreshSignalsForProject({
      projectId,
      fetchers: { reddit: credsThrower },
      readCreds: noopReadCreds,
    });

    const reddit = result.sourceResults.find((r) => r.source === "reddit");
    expect(reddit?.status).toBe("no_credentials");
    expect(reddit?.error).toContain("credentials");
  });

  it("maps adapter empty array to 'filter_no_results' (not 'error')", async () => {
    await seedConfig(projectId, ALL_ENABLED);

    const result = await refreshSignalsForProject({
      projectId,
      fetchers: { github: async () => [] },
      readCreds: noopReadCreds,
    });

    const github = result.sourceResults.find((r) => r.source === "github");
    expect(github?.status).toBe("filter_no_results");
    expect(github?.rowsAdded).toBe(0);
  });

  it("error in one source does not abort the rest", async () => {
    await seedConfig(projectId, ALL_ENABLED);

    const result = await refreshSignalsForProject({
      projectId,
      fetchers: {
        reddit: async () => {
          throw new Error("non-credential network failure");
        },
        github: async () => [makeSignal("github", "ext-1")],
      },
      readCreds: noopReadCreds,
    });

    const reddit = result.sourceResults.find((r) => r.source === "reddit");
    const github = result.sourceResults.find((r) => r.source === "github");
    expect(reddit?.status).toBe("error");
    expect(github?.status).toBe("refreshed");
    expect(github?.rowsAdded).toBe(1);
  });

  it("persists signals and reports rowsAdded; second call dedupes on (source, externalId)", async () => {
    await seedConfig(projectId, ALL_ENABLED);

    const signals = [makeSignal("producthunt", "ph-1"), makeSignal("producthunt", "ph-2")];
    const fetcher: SignalFetcher = async () => signals;

    const first = await refreshSignalsForProject({
      projectId,
      fetchers: { producthunt: fetcher },
      readCreds: noopReadCreds,
    });
    expect(first.sourceResults.find((r) => r.source === "producthunt")?.rowsAdded).toBe(2);

    // Same signals again with force=true (bypass staleness gate)
    const second = await refreshSignalsForProject({
      projectId,
      force: true,
      fetchers: { producthunt: fetcher },
      readCreds: noopReadCreds,
    });
    const phSecond = second.sourceResults.find((r) => r.source === "producthunt");
    expect(phSecond?.status).toBe("refreshed");
    expect(phSecond?.rowsAdded).toBe(0); // both deduped
    expect(phSecond?.notes).toContain("deduped");
  });

  it("respects signal_max_age_hours from project_planner_config — recent data is 'fresh' not 'refreshed'", async () => {
    await seedConfig(projectId, ALL_ENABLED);
    // 2h max age: anything collected < 2h ago is fresh
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 10,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      signalMaxAgeHours: 2,
    });

    // Seed a 1h-old signal
    await db.insert(externalSignals).values({
      projectId,
      source: "producthunt",
      externalId: "seeded-ph-1",
      title: "seeded",
      rawPayload: {},
      metrics: {},
      collectedAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    let fetcherCalled = false;
    const result = await refreshSignalsForProject({
      projectId,
      fetchers: {
        producthunt: async () => {
          fetcherCalled = true;
          return [];
        },
      },
      readCreds: noopReadCreds,
    });

    const ph = result.sourceResults.find((r) => r.source === "producthunt");
    expect(ph?.status).toBe("fresh");
    expect(fetcherCalled).toBe(false);
  });

  it("force=true bypasses the staleness gate", async () => {
    await seedConfig(projectId, ALL_ENABLED);
    await upsertProjectPlannerConfig({
      projectId,
      weeklyBudgetEur: 10,
      perTypeMaxEur: null,
      topNSignalsAllowedOverage: 3,
      maxOveragePerSignal: 1,
      signalMaxAgeHours: 24,
    });

    await db.insert(externalSignals).values({
      projectId,
      source: "producthunt",
      externalId: "seeded-fresh",
      title: "seeded",
      rawPayload: {},
      metrics: {},
      collectedAt: new Date(), // brand new
    });

    let fetcherCalled = false;
    await refreshSignalsForProject({
      projectId,
      force: true,
      fetchers: {
        producthunt: async () => {
          fetcherCalled = true;
          return [];
        },
      },
      readCreds: noopReadCreds,
    });

    expect(fetcherCalled).toBe(true);
  });
});
