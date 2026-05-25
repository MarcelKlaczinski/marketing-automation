// Spec 64.20 — DB helper unit + integration tests for content_source_inventory.
//
// Covers all 5 read helpers + all 7 write helpers. Hits real Postgres per the
// Marcel-rule "integration tests must hit real DB, no mocks".
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  contentSourceInventory,
  countByObjectType,
  createInventoryRow,
  db,
  eq,
  getInventoryById,
  hardDeleteInventoryRow,
  listInventoryByProject,
  listInventoryDueForRefresh,
  markInventoryError,
  markInventoryFetching,
  markInventoryOk,
  patchInventoryRow,
  projects,
  softDeleteInventoryRow,
  type GithubInventoryMetadata,
} from "../src/index.ts";

const SAMPLE_METADATA: GithubInventoryMetadata = {
  starsCount: 12345,
  forksCount: 678,
  watchersCount: 100,
  primaryLanguage: "TypeScript",
  license: "MIT",
  topics: ["ai", "agent"],
  defaultBranch: "main",
  createdAt: "2024-01-01T00:00:00.000Z",
  pushedAt: "2026-05-20T12:00:00.000Z",
  latestRelease: {
    tag: "v1.0.0",
    name: "First release",
    publishedAt: "2024-06-01T00:00:00.000Z",
  },
};

describe("content_source_inventory helpers", () => {
  let projectId: string;
  let toolsArticleId: string;
  let blogArticleId: string;

  beforeAll(async () => {
    const ts = Date.now();
    const [project] = await db
      .insert(projects)
      .values({
        slug: `csi-test-${ts}`,
        name: "CSI Test Project",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!project) throw new Error("project INSERT failed");
    projectId = project.id;

    // Tools article — used to validate the article-link rule passes.
    const [toolsArticle] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "tools",
        locale: "de",
        slug: `csi-test-tool-${ts}`,
        title: "CSI Test Tool",
        status: "proposed",
      })
      .returning();
    if (!toolsArticle) throw new Error("tools-article INSERT failed");
    toolsArticleId = toolsArticle.id;

    // Blog article — used to validate the article-link rule rejects non-tools.
    const [blogArticle] = await db
      .insert(articles)
      .values({
        projectId,
        source: "imported",
        collection: "blog",
        locale: "de",
        slug: `csi-test-blog-${ts}`,
        title: "CSI Test Blog",
        status: "proposed",
      })
      .returning();
    if (!blogArticle) throw new Error("blog-article INSERT failed");
    blogArticleId = blogArticle.id;
  });

  afterEach(async () => {
    // Strip inventory between tests to keep predicates clean.
    await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
  });

  afterAll(async () => {
    await db.delete(contentSourceInventory).where(eq(contentSourceInventory.projectId, projectId));
    await db.delete(articles).where(eq(articles.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  // ─── createInventoryRow ────────────────────────────────────────────────────

  it("createInventoryRow INSERTs with Zod validation + defaults", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "anthropics/claude-code",
      displayName: "Claude Code",
      refreshIntervalHours: 168,
    });
    expect(row.id).toBeTruthy();
    expect(row.source).toBe("github");
    expect(row.objectType).toBe("tool");
    expect(row.sourceIdentifier).toBe("anthropics/claude-code");
    expect(row.displayName).toBe("Claude Code");
    expect(row.fetchStatus).toBe("pending");
    expect(row.lastFetchedAt).toBeNull();
    expect(row.refreshIntervalHours).toBe(168);
    expect(row.approvedAt).toBeNull(); // not pre-approved unless passed
    expect(row.articleId).toBeNull();
  });

  it("createInventoryRow rejects articleId pointing to a non-tools article", async () => {
    await expect(
      createInventoryRow({
        projectId,
        source: "github",
        objectType: "tool",
        sourceIdentifier: "evil/blog-link",
        displayName: "Bad link",
        refreshIntervalHours: 168,
        articleId: blogArticleId, // blog, not tools → must throw
      }),
    ).rejects.toThrow(/collection='blog'/);
  });

  it("createInventoryRow accepts a skill row with NULL articleId", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "skill",
      sourceIdentifier: "anthropics/skills:web-design",
      displayName: "Web Design Skill",
      refreshIntervalHours: 720,
    });
    expect(row.objectType).toBe("skill");
    expect(row.articleId).toBeNull();
  });

  // ─── patchInventoryRow ─────────────────────────────────────────────────────

  it("patchInventoryRow updates editable fields", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "edit/me",
      displayName: "Old Name",
      refreshIntervalHours: 168,
    });
    const patched = await patchInventoryRow(row.id, {
      displayName: "New Name",
      description: "Updated description",
      refreshIntervalHours: 24,
    });
    expect(patched).not.toBeNull();
    expect(patched?.displayName).toBe("New Name");
    expect(patched?.description).toBe("Updated description");
    expect(patched?.refreshIntervalHours).toBe(24);
  });

  it("patchInventoryRow returns null on empty partial (no-op)", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "noop/patch",
      displayName: "Noop",
      refreshIntervalHours: 168,
    });
    const result = await patchInventoryRow(row.id, {});
    expect(result).toBeNull();
  });

  // ─── markInventoryFetching CAS ─────────────────────────────────────────────

  it("markInventoryFetching CAS: second concurrent claim returns false", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "cas/race",
      displayName: "CAS race",
      refreshIntervalHours: 168,
    });
    const first = await markInventoryFetching(row.id);
    const second = await markInventoryFetching(row.id);
    expect(first).toBe(true);
    expect(second).toBe(false); // already in 'fetching' state
  });

  // ─── markInventoryOk + markInventoryError ─────────────────────────────────

  it("markInventoryOk writes metadata + last_fetched_at + clears error", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "mark/ok",
      displayName: "Mark OK",
      refreshIntervalHours: 168,
    });
    await markInventoryFetching(row.id);
    const ok = await markInventoryOk(row.id, SAMPLE_METADATA);
    expect(ok?.fetchStatus).toBe("ok");
    expect(ok?.lastFetchedAt).not.toBeNull();
    expect(ok?.fetchError).toBeNull();
    expect(ok?.githubMetadata.starsCount).toBe(12345);
    expect(ok?.githubMetadata.topics).toEqual(["ai", "agent"]);
  });

  it("markInventoryOk rejects malformed metadata via Zod", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "mark/bad",
      displayName: "Mark bad",
      refreshIntervalHours: 168,
    });
    await markInventoryFetching(row.id);
    // Cast: deliberately construct invalid data (starsCount must be >= 0 per schema)
    // to verify the Zod parse rejects it. TS-valid data wouldn't exercise the path.
    await expect(
      markInventoryOk(row.id, { ...SAMPLE_METADATA, starsCount: -1 } as GithubInventoryMetadata),
    ).rejects.toThrow();
  });

  it("markInventoryError writes error and preserves prior metadata", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "mark/err",
      displayName: "Mark err",
      refreshIntervalHours: 168,
    });
    // First successful fetch
    await markInventoryFetching(row.id);
    await markInventoryOk(row.id, SAMPLE_METADATA);
    // Then error on next refresh
    await markInventoryFetching(row.id);
    const errRow = await markInventoryError(row.id, "rate limited");
    expect(errRow?.fetchStatus).toBe("error");
    expect(errRow?.fetchError).toBe("rate limited");
    // Prior metadata preserved
    expect(errRow?.githubMetadata.starsCount).toBe(12345);
  });

  // ─── soft + hard delete ────────────────────────────────────────────────────

  it("softDeleteInventoryRow clears approved_at", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "soft/del",
      displayName: "Soft delete",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    expect(row.approvedAt).not.toBeNull();
    const softened = await softDeleteInventoryRow(row.id);
    expect(softened?.approvedAt).toBeNull();
    // Row still exists
    const fetched = await getInventoryById(row.id);
    expect(fetched?.id).toBe(row.id);
  });

  it("hardDeleteInventoryRow removes the row", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "hard/del",
      displayName: "Hard delete",
      refreshIntervalHours: 168,
    });
    const deleted = await hardDeleteInventoryRow(row.id);
    expect(deleted).toBe(true);
    const after = await getInventoryById(row.id);
    expect(after).toBeNull();
  });

  // ─── listInventoryByProject ────────────────────────────────────────────────

  it("listInventoryByProject filters by objectType + approvedOnly", async () => {
    const now = new Date();
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "list/tool",
      displayName: "List tool",
      refreshIntervalHours: 168,
      approvedAt: now,
    });
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "skill",
      sourceIdentifier: "list/skill",
      displayName: "List skill",
      refreshIntervalHours: 720,
      approvedAt: now,
    });
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "list/unapproved",
      displayName: "Unapproved tool",
      refreshIntervalHours: 168,
      // approvedAt omitted
    });

    const allApproved = await listInventoryByProject({ projectId });
    expect(allApproved.length).toBe(2);

    const onlyTools = await listInventoryByProject({ projectId, objectType: "tool" });
    expect(onlyTools.length).toBe(1);
    expect(onlyTools[0]?.sourceIdentifier).toBe("list/tool");

    const includeUnapproved = await listInventoryByProject({ projectId, approvedOnly: false });
    expect(includeUnapproved.length).toBe(3);
  });

  // ─── listInventoryDueForRefresh ────────────────────────────────────────────

  it("listInventoryDueForRefresh picks NULL last_fetched_at first, respects interval", async () => {
    const now = new Date();
    // Row 1: NULL last_fetched_at, pre-approved — DUE
    const r1 = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "due/never",
      displayName: "Never fetched",
      refreshIntervalHours: 168,
      approvedAt: now,
    });
    // Row 2: fetched 1h ago, interval=168h — NOT DUE
    const r2 = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "due/recent",
      displayName: "Recent",
      refreshIntervalHours: 168,
      approvedAt: now,
    });
    await markInventoryFetching(r2.id);
    await markInventoryOk(r2.id, SAMPLE_METADATA);

    // Row 3: fetched 200h ago, interval=168h — DUE
    const r3 = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "due/stale",
      displayName: "Stale",
      refreshIntervalHours: 168,
      approvedAt: now,
    });
    await markInventoryFetching(r3.id);
    await markInventoryOk(r3.id, SAMPLE_METADATA);
    // Backdate lastFetchedAt manually
    await db
      .update(contentSourceInventory)
      .set({ lastFetchedAt: new Date(Date.now() - 200 * 3600 * 1000) })
      .where(eq(contentSourceInventory.id, r3.id));

    // Row 4: unapproved — NOT DUE regardless
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "due/unapproved",
      displayName: "Unapproved",
      refreshIntervalHours: 168,
    });

    const due = await listInventoryDueForRefresh({ projectId, limit: 100 });
    const ids = due.map((r) => r.id);
    expect(ids).toContain(r1.id);
    expect(ids).toContain(r3.id);
    expect(ids).not.toContain(r2.id);
    // NULL-first ordering: r1 should come before r3
    expect(ids.indexOf(r1.id)).toBeLessThan(ids.indexOf(r3.id));
  });

  it("listInventoryDueForRefresh skips 'fetching' rows", async () => {
    const r = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "skip/fetching",
      displayName: "Skip fetching",
      refreshIntervalHours: 168,
      approvedAt: new Date(),
    });
    await markInventoryFetching(r.id); // status='fetching' now

    const due = await listInventoryDueForRefresh({ projectId, limit: 100 });
    expect(due.find((row) => row.id === r.id)).toBeUndefined();
  });

  // ─── countByObjectType ─────────────────────────────────────────────────────

  it("countByObjectType returns counts of approved rows only", async () => {
    const now = new Date();
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "count/t1",
      displayName: "T1",
      refreshIntervalHours: 168,
      approvedAt: now,
    });
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "count/t2",
      displayName: "T2",
      refreshIntervalHours: 168,
      approvedAt: now,
    });
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "skill",
      sourceIdentifier: "count/s1",
      displayName: "S1",
      refreshIntervalHours: 720,
      approvedAt: now,
    });
    await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "count/unapproved",
      displayName: "Unapproved",
      refreshIntervalHours: 168,
      // approvedAt omitted — should not count
    });

    const counts = await countByObjectType(projectId);
    expect(counts.tool).toBe(2);
    expect(counts.skill).toBe(1);
  });

  // ─── article-link convention guard via patch ───────────────────────────────

  it("patchInventoryRow.articleId enforces article-link rule (rejects non-tools collection)", async () => {
    const row = await createInventoryRow({
      projectId,
      source: "github",
      objectType: "tool",
      sourceIdentifier: "patch/link",
      displayName: "Patch link",
      refreshIntervalHours: 168,
    });
    await expect(
      patchInventoryRow(row.id, { articleId: blogArticleId }),
    ).rejects.toThrow(/collection='blog'/);
    // Same tool article → accepted
    const linked = await patchInventoryRow(row.id, { articleId: toolsArticleId });
    expect(linked?.articleId).toBe(toolsArticleId);
  });

});
