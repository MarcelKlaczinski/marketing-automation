/**
 * Spec 65.3 — selectStaleTools DB integration test.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { articles, db, eq, projects } from "@marketing-auto/db";
import { selectStaleTools } from "../../../src/lib/tool-data-refresh/select-stale-tools.ts";

describe("selectStaleTools (Spec 65.3)", () => {
  let projectId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `stale-${ts}`,
        name: "Stale-Tools test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    const now = Date.now();
    const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);

    // Seed a deterministic spread of stale + fresh + wrong-locale + wrong-collection.
    await db.insert(articles).values([
      // Never refreshed → NULL-first
      {
        projectId,
        slug: `tool-null-${ts}`,
        title: "Never refreshed",
        collection: "tools",
        locale: "de",
        status: "published",
        source: "imported",
        lastRefreshedAt: null,
      },
      // 60d old → stale (over 30d threshold)
      {
        projectId,
        slug: `tool-60d-${ts}`,
        title: "60d old",
        collection: "tools",
        locale: "de",
        status: "published",
        source: "imported",
        lastRefreshedAt: days(60),
      },
      // 5d old → fresh (under 30d)
      {
        projectId,
        slug: `tool-5d-${ts}`,
        title: "5d old",
        collection: "tools",
        locale: "de",
        status: "published",
        source: "imported",
        lastRefreshedAt: days(5),
      },
      // EN sibling — primary locale filter excludes this
      {
        projectId,
        slug: `tool-en-${ts}`,
        title: "EN sibling",
        collection: "tools",
        locale: "en",
        status: "published",
        source: "imported",
        lastRefreshedAt: null,
      },
      // Wrong collection (blog) — collection filter excludes
      {
        projectId,
        slug: `blog-${ts}`,
        title: "Blog post",
        collection: "blog",
        locale: "de",
        status: "published",
        source: "imported",
        lastRefreshedAt: null,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("returns NULL-first then oldest-first, respecting locale + collection filters", async () => {
    const stale = await selectStaleTools({
      projectId,
      locale: "de",
      staleThresholdDays: 30,
      limit: 10,
    });

    // Expect exactly 2: never-refreshed + 60d-old. NOT the 5d (fresh), EN
    // sibling (wrong locale), or blog post (wrong collection).
    expect(stale).toHaveLength(2);
    expect(stale[0]?.title).toBe("Never refreshed");
    expect(stale[1]?.title).toBe("60d old");
  });

  it("respects the limit cap", async () => {
    const stale = await selectStaleTools({
      projectId,
      locale: "de",
      staleThresholdDays: 30,
      limit: 1,
    });
    expect(stale).toHaveLength(1);
    expect(stale[0]?.title).toBe("Never refreshed");
  });

  it("returns empty when nothing is stale", async () => {
    const stale = await selectStaleTools({
      projectId,
      locale: "de",
      staleThresholdDays: 365, // 365d threshold — even the 60d row is "fresh"
      limit: 10,
    });
    // NULL-lastRefreshedAt rows are ALWAYS stale (the isNull predicate is OR'd
    // against the cutoff comparison), so 1 row still qualifies regardless of
    // threshold.
    expect(stale).toHaveLength(1);
    expect(stale[0]?.title).toBe("Never refreshed");
  });
});
