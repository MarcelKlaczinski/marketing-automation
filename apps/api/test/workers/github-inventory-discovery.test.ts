// Spec 64.20 follow-up A2 — discovery worker E2E tests.
// Mocked discovery sources via DI; real DB for dedup + persist verification.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  contentSourceInventory,
  createInventoryRow,
  cronState,
  db,
  eq,
  projects,
  and,
} from "@marketing-auto/db";
import type { DiscoveryCandidate } from "@marketing-auto/adapter-github-inventory";
import {
  GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN,
  handleDiscoveryTick,
  seedGithubInventoryDiscoveryCron,
  type DiscoveryDeps,
} from "../../src/workers/github-inventory-discovery.worker.ts";

let projectId: string;

beforeAll(async () => {
  const ts = Date.now();
  const [proj] = await db
    .insert(projects)
    .values({
      slug: `gh-disc-${ts}`,
      name: "GH Discovery Test",
      industry: "ai_education",
      pipelineTemplate: "educational",
    })
    .returning({ id: projects.id });
  projectId = proj!.id;
});

afterEach(async () => {
  await db
    .delete(contentSourceInventory)
    .where(eq(contentSourceInventory.projectId, projectId));
});

afterAll(async () => {
  await db
    .delete(contentSourceInventory)
    .where(eq(contentSourceInventory.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
});

function candidate(over: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    sourceIdentifier:  "anthropics/claude-code",
    displayName:       "Claude Code",
    description:       "Anthropic CLI",
    starsCount:        25000,
    homepageUrl:       null,
    discoverySource:   "github_search",
    awesomeListSource: null,
    ...over,
  };
}

function fakeDeps(over: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    readCreds: async () => ({ personal_access_token: "ghp_fake" }),
    discoverViaSearch: async () => ({ candidates: [], rawCount: 0, failedQueries: [] }),
    discoverViaAwesomeLists: async () => ({
      candidates: [],
      perListCounts: [],
      failedLists: [],
    }),
    ...over,
  };
}

describe("handleDiscoveryTick", () => {
  it("inserts unapproved candidates with approved_at=NULL", async () => {
    const result = await handleDiscoveryTick(
      { projectId, type: "manual" },
      fakeDeps({
        discoverViaSearch: async () => ({
          candidates: [
            candidate({ sourceIdentifier: "foo/tool-a", displayName: "Tool A" }),
            candidate({ sourceIdentifier: "bar/tool-b", displayName: "Tool B" }),
          ],
          rawCount: 2,
          failedQueries: [],
        }),
      }),
    );

    expect(result.inserted).toBe(2);
    const rows = await db
      .select()
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.projectId, projectId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.approvedAt === null)).toBe(true);
    expect(rows.every((r) => r.objectType === "tool")).toBe(true);
  });

  it("dedupes against existing rows (approved or unapproved)", async () => {
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "foo/already-seeded",
      displayName: "Already Seeded",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });

    const result = await handleDiscoveryTick(
      { projectId, type: "manual" },
      fakeDeps({
        discoverViaSearch: async () => ({
          candidates: [
            candidate({ sourceIdentifier: "foo/already-seeded", displayName: "Dup" }),
            candidate({ sourceIdentifier: "new/fresh-tool", displayName: "Fresh" }),
          ],
          rawCount: 2,
          failedQueries: [],
        }),
      }),
    );

    expect(result.inserted).toBe(1);
    expect(result.skippedDuplicate).toBe(1);

    const rows = await db
      .select()
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.projectId, projectId));
    expect(rows).toHaveLength(2);
  });

  it("assigns objectType='skill' when from a claude-skills awesome-list", async () => {
    await handleDiscoveryTick(
      { projectId, type: "manual" },
      fakeDeps({
        discoverViaAwesomeLists: async () => ({
          candidates: [
            candidate({
              sourceIdentifier:  "anthropics/skills:web-design",
              displayName:       "Web Design",
              discoverySource:   "awesome_list",
              awesomeListSource: "ComposioHQ/awesome-claude-skills",
            }),
            candidate({
              sourceIdentifier:  "foo/some-tool",
              displayName:       "Some Tool",
              discoverySource:   "awesome_list",
              awesomeListSource: "other/awesome-tools",
            }),
          ],
          perListCounts: [],
          failedLists: [],
        }),
      }),
    );

    const [skill, tool] = await Promise.all([
      db
        .select()
        .from(contentSourceInventory)
        .where(
          and(
            eq(contentSourceInventory.projectId, projectId),
            eq(contentSourceInventory.sourceIdentifier, "anthropics/skills:web-design"),
          ),
        ),
      db
        .select()
        .from(contentSourceInventory)
        .where(
          and(
            eq(contentSourceInventory.projectId, projectId),
            eq(contentSourceInventory.sourceIdentifier, "foo/some-tool"),
          ),
        ),
    ]);
    expect(skill[0]?.objectType).toBe("skill");
    expect(tool[0]?.objectType).toBe("tool");
  });

  it("merges sources — Search-API entry overrides awesome-list entry for same repo", async () => {
    await handleDiscoveryTick(
      { projectId, type: "manual" },
      fakeDeps({
        discoverViaSearch: async () => ({
          candidates: [
            candidate({
              sourceIdentifier: "foo/dual",
              displayName: "From Search",
              starsCount: 5000,
              discoverySource: "github_search",
            }),
          ],
          rawCount: 1,
          failedQueries: [],
        }),
        discoverViaAwesomeLists: async () => ({
          candidates: [
            candidate({
              sourceIdentifier:  "foo/dual",
              displayName:       "From Awesome",
              starsCount:        0,
              discoverySource:   "awesome_list",
              awesomeListSource: "x/y",
            }),
          ],
          perListCounts: [],
          failedLists: [],
        }),
      }),
    );

    const [row] = await db
      .select()
      .from(contentSourceInventory)
      .where(
        and(
          eq(contentSourceInventory.projectId, projectId),
          eq(contentSourceInventory.sourceIdentifier, "foo/dual"),
        ),
      );
    expect(row?.displayName).toBe("From Search"); // search-API wins the merge
  });

  it("returns silently when no PAT in vault — no inserts, no adapter calls", async () => {
    let searchCalled = false;
    await handleDiscoveryTick(
      { projectId, type: "manual" },
      fakeDeps({
        readCreds: async () => ({}),
        discoverViaSearch: async () => {
          searchCalled = true;
          return { candidates: [], rawCount: 0, failedQueries: [] };
        },
      }),
    );

    expect(searchCalled).toBe(false);
    const rows = await db
      .select()
      .from(contentSourceInventory)
      .where(eq(contentSourceInventory.projectId, projectId));
    expect(rows).toHaveLength(0);
  });
});

describe("seedGithubInventoryDiscoveryCron", () => {
  it("inserts cron_state row with isActive=false + default pattern", async () => {
    await seedGithubInventoryDiscoveryCron();

    const [row] = await db
      .select()
      .from(cronState)
      .where(
        and(
          eq(cronState.projectId, projectId),
          eq(cronState.jobType, "github_inventory_discovery"),
        ),
      )
      .limit(1);

    expect(row).toBeDefined();
    expect(row?.isActive).toBe(false); // opt-in, unlike refresh cron
    expect(row?.cronPattern).toBe(GITHUB_INVENTORY_DISCOVERY_DEFAULT_PATTERN);
  });
});
