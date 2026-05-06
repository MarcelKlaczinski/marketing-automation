/**
 * Gated integration test for the full ArticleSyncPipeline.
 *
 * Requires a live GitHub App and test repo. Gate:
 *   RUN_LIVE_ASTRO_SYNC=1
 *
 * Usage:
 *   RUN_LIVE_ASTRO_SYNC=1 bun test packages/adapters/astro-sync/test/integration.test.ts
 *
 * Prerequisites:
 * - GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_PATH in .env
 * - ki-wissensraum project in DB with astro_repo set
 * - A test article in "final_review" status (can be created by the test itself)
 *
 * The test creates a fresh article, runs the full pipeline synchronously,
 * verifies the commit on GitHub, and asserts DB state transitions.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { db, articles, astroSyncRuns, projects } from "@marketing-auto/db";
import { runPipeline } from "@marketing-auto/pipelines/engine";
import { ArticleSyncPipeline } from "../src/pipeline.ts";
import { getInstallationOctokit } from "../src/github-auth.ts";

const SKIP = !process.env.RUN_LIVE_ASTRO_SYNC;
const PROJECT_SLUG = "ki-wissensraum";

const TEST_SLUG = `astro-sync-integration-test-${Date.now()}`;

let articleId = "";
let projectId = "";
let installationId = 0;
let repoOwner = "";
let repoName = "";
let commitSha = "";

describe("ArticleSyncPipeline — live integration", () => {
  beforeAll(async () => {
    if (SKIP) return;

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, PROJECT_SLUG))
      .limit(1);

    if (!project) throw new Error(`Project "${PROJECT_SLUG}" not found in DB`);
    if (!project.astroRepo) throw new Error(`Project "${PROJECT_SLUG}" has no astroRepo configured`);

    projectId = project.id;
    const repo = project.astroRepo as { owner: string; name: string; installationId: number };
    installationId = repo.installationId;
    repoOwner = repo.owner;
    repoName = repo.name;

    // Create a fresh final_review article for this test run
    const bodyMd = `## Integration Test Article\n\nThis article was created by the Astro sync integration test.\nIt verifies the full pipeline end-to-end.\n\n## Section Two\n\nAll good here.\n`;

    const [created] = await db
      .insert(articles)
      .values({
        projectId,
        slug: TEST_SLUG,
        cornerstoneKeyword: "Integration Test",
        title: "Astro Sync Integration Test Article",
        metaDescription: "Created by the integration test suite.",
        bodyMd,
        heroImagePublicUrl: "https://picsum.photos/seed/astro-sync-test/1200/630",
        heroImageAltText: "Integration test placeholder image",
        schemaJsonLd: { "@context": "https://schema.org", "@type": "Article", headline: "Test" },
        status: "final_review",
        wordCount: bodyMd.split(/\s+/).length,
        collectionType: "blog",
      })
      .returning({ id: articles.id });

    articleId = created!.id;
  });

  afterAll(async () => {
    if (SKIP || !articleId) return;
    // Clean up test article from DB
    await db.delete(articles).where(eq(articles.id, articleId));
    // Note: the committed files in the Astro repo remain — delete manually if needed
  });

  test("pipeline runs to completion and commits to GitHub", async () => {
    if (SKIP) {
      console.log("Skipped (set RUN_LIVE_ASTRO_SYNC=1 to run)");
      return;
    }

    const pipeline = new ArticleSyncPipeline();
    const result = await runPipeline(pipeline, { articleId, projectId }, { projectId });

    if (!result.ok) throw new Error(`Pipeline failed at ${result.failedAtStep}: ${result.error}`);

    expect(result.output.articleId).toBe(articleId);
    expect(result.output.syncRunId).toBeTruthy();
    commitSha = "";

    // Verify article DB state
    const [article] = await db
      .select({
        status: articles.status,
        astroCommitSha: articles.astroCommitSha,
        astroSyncedAt: articles.astroSyncedAt,
        astroAssetPaths: articles.astroAssetPaths,
        astroFrontmatter: articles.astroFrontmatter,
      })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    expect(article).toBeTruthy();
    expect(article!.status).toBe("ready_to_publish");
    expect(article!.astroCommitSha).toBeTruthy();
    expect(article!.astroSyncedAt).toBeTruthy();
    expect(article!.astroAssetPaths?.heroImage).toContain(TEST_SLUG);
    expect(article!.astroFrontmatter?.title).toBe("Astro Sync Integration Test Article");

    commitSha = article!.astroCommitSha!;

    // Verify sync run row
    const [syncRun] = await db
      .select()
      .from(astroSyncRuns)
      .where(eq(astroSyncRuns.id, result.output.syncRunId))
      .limit(1);

    expect(syncRun!.status).toBe("succeeded");
    expect(syncRun!.commitSha).toBe(commitSha);
    expect(syncRun!.filesCommitted).toHaveLength(2);
    expect(syncRun!.bytesCommitted).toBeGreaterThan(0);
    expect(syncRun!.finishedAt).toBeTruthy();
  }, 60_000);

  test("commit is visible on GitHub", async () => {
    if (SKIP || !commitSha) return;

    const octokit = await getInstallationOctokit(installationId);
    const { data: commit } = await octokit.request(
      "GET /repos/{owner}/{repo}/git/commits/{commit_sha}",
      { owner: repoOwner, repo: repoName, commit_sha: commitSha },
    );

    expect(commit.sha).toBe(commitSha);
    expect(commit.message).toContain("Astro Sync Integration Test Article");
  }, 20_000);

  test("mdx file exists in Astro repo at correct path", async () => {
    if (SKIP || !commitSha) return;

    const octokit = await getInstallationOctokit(installationId);
    const mdxPath = `src/content/blog/${TEST_SLUG}.mdx`;

    const res = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { owner: repoOwner, repo: repoName, path: mdxPath, ref: commitSha },
    );

    expect(Array.isArray(res.data)).toBe(false);
    const fileData = res.data as { type: string; content?: string; size: number };
    expect(fileData.type).toBe("file");
    const content = Buffer.from(fileData.content ?? "", "base64").toString("utf-8");
    expect(content).toContain("AUTO-GENERATED");
    expect(content).toContain("Astro Sync Integration Test Article");
    expect(content).toContain("---");
  }, 20_000);

  test("hero image exists in Astro repo at correct path", async () => {
    if (SKIP || !commitSha) return;

    const octokit = await getInstallationOctokit(installationId);
    const imagePath = `src/assets/articles/${TEST_SLUG}/hero.jpg`;

    const res = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      { owner: repoOwner, repo: repoName, path: imagePath, ref: commitSha },
    );

    expect(Array.isArray(res.data)).toBe(false);
    const fileData = res.data as { type: string; size: number };
    expect(fileData.type).toBe("file");
    expect(fileData.size).toBeGreaterThan(1000);
  }, 20_000);

  test("sync is idempotent — second run overwrites mdx without error", async () => {
    if (SKIP || !commitSha) return;

    // Reset article status to allow re-sync
    await db
      .update(articles)
      .set({ status: "final_review" })
      .where(eq(articles.id, articleId));

    const pipeline = new ArticleSyncPipeline();
    const result = await runPipeline(pipeline, { articleId, projectId }, { projectId });

    if (!result.ok) throw new Error(`Pipeline failed at ${result.failedAtStep}: ${result.error}`);
    expect(result.output.articleId).toBe(articleId);

    const [article] = await db
      .select({ astroCommitSha: articles.astroCommitSha })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    // A new commit should have been made (different SHA)
    expect(article!.astroCommitSha).toBeTruthy();
    expect(article!.astroCommitSha).not.toBe(commitSha);
  }, 60_000);
});
