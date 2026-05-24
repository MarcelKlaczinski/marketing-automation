/**
 * Spec 000 — RepoImportPipeline wiring for MirrorHeroImagesStep.
 *
 * Confirms the new step sits between ParseFrontmatterBatchStep and
 * UpsertArticlesStep AND the two bridges produce the expected shapes.
 * Bridges are pure-sync functions on the Pipeline instance, so this
 * test stays offline (no DB, no Octokit, no R2).
 *
 * Run:
 *   bun test packages/adapters/astro-sync/test/mirror-hero-images-pipeline.test.ts
 */

import { describe, expect, test } from "bun:test";
import type { BaseStep } from "@marketing-auto/pipelines/engine";
import { RepoImportPipeline } from "../src/import/pipeline.ts";

const PIPELINE_INPUT = {
  projectId: "11111111-1111-1111-1111-111111111111",
  importRunId: "22222222-2222-2222-2222-222222222222",
  astroRepo: {
    owner: "test-owner",
    name: "test-repo",
    installationId: 1,
    defaultBranch: "main",
    contentRoot: "src/content",
    assetsRoot: "src/assets",
  },
  forceAll: false,
};

function stepByName(p: RepoImportPipeline, name: string): BaseStep<unknown, unknown> {
  const s = (p.steps as ReadonlyArray<BaseStep<unknown, unknown>>).find(
    (x) => x.name === name,
  );
  if (!s) throw new Error(`step not found: ${name}`);
  return s;
}

describe("RepoImportPipeline — mirror-hero-images wiring (Spec 000)", () => {
  test("the new step sits between parse-frontmatter-batch and upsert-articles", () => {
    const p = new RepoImportPipeline();
    const names = p.steps.map((s) => s.name);
    const parseIdx = names.indexOf("parse-frontmatter-batch");
    const mirrorIdx = names.indexOf("mirror-hero-images");
    const upsertIdx = names.indexOf("upsert-articles");
    expect(parseIdx).toBeGreaterThanOrEqual(0);
    expect(mirrorIdx).toBe(parseIdx + 1);
    expect(upsertIdx).toBe(mirrorIdx + 1);
  });

  test("parse → mirror bridge carries projectId + astroRepo + headCommitSha + parsed", () => {
    const p = new RepoImportPipeline();
    const fromStep = stepByName(p, "parse-frontmatter-batch");
    const toStep = stepByName(p, "mirror-hero-images");

    const parseOutput = {
      parsed: [{ filePath: "src/content/blog/foo.mdx", typed: { slug: "foo" } }],
      failedCount: 0,
    };
    // Bridges read previous outputs via getStepOutput — provide the
    // list-content-files output the mirror bridge expects.
    const stepOutputs: Record<string, unknown> = {
      "list-content-files": { headCommitSha: "abc123", files: [] },
    };
    const getStepOutput = <T = unknown>(name: string) =>
      stepOutputs[name] as T | undefined;

    const bridged = p.bridge(fromStep, toStep, parseOutput, PIPELINE_INPUT, getStepOutput);
    expect(bridged).toEqual({
      projectId: PIPELINE_INPUT.projectId,
      astroRepo: PIPELINE_INPUT.astroRepo,
      headCommitSha: "abc123",
      parsed: parseOutput.parsed,
    });
  });

  test("parse → mirror bridge throws when list-content-files output missing", () => {
    const p = new RepoImportPipeline();
    const fromStep = stepByName(p, "parse-frontmatter-batch");
    const toStep = stepByName(p, "mirror-hero-images");
    const parseOutput = { parsed: [], failedCount: 0 };
    const emptyGetStepOutput = () => undefined;
    expect(() =>
      p.bridge(fromStep, toStep, parseOutput, PIPELINE_INPUT, emptyGetStepOutput),
    ).toThrow(/list-content-files output unavailable/);
  });

  test("mirror → upsert bridge passes through the augmented parsed entries", () => {
    const p = new RepoImportPipeline();
    const fromStep = stepByName(p, "mirror-hero-images");
    const toStep = stepByName(p, "upsert-articles");

    const augmented = [
      {
        filePath: "src/content/blog/foo.mdx",
        typed: { slug: "foo" },
        hero: {
          heroImageR2Key: "toolwiki/articles/hero/abc.webp",
          heroImagePublicUrl: "https://cdn.example.com/.../abc.webp",
          heroImageOriginalR2Key: null,
          heroImageSourceSha256: "a".repeat(64),
          heroImageAltText: "Alt",
        },
      },
      { filePath: "src/content/tool-categories/x.mdx", typed: { slug: "x" }, hero: null },
    ];
    const mirrorOutput = {
      parsed: augmented,
      stats: {
        mirrored: 1,
        reused: 0,
        unchanged: 0,
        skippedByCollection: 1,
        skippedNoHero: 0,
        failed: 0,
        uniqueHashes: 1,
      },
    };
    const getStepOutput = () => undefined;
    const bridged = p.bridge(fromStep, toStep, mirrorOutput, PIPELINE_INPUT, getStepOutput);
    expect(bridged).toEqual({
      projectId: PIPELINE_INPUT.projectId,
      parsed: augmented,
    });
  });

  test("final detect-content-gaps → update-import-run still resolves parse output", () => {
    // Regression: when I rename `parse-frontmatter-batch` or change its output
    // shape, this bridge breaks. Spec 000 changed neither, so this is the
    // green-bar safety net.
    const p = new RepoImportPipeline();
    const fromStep = stepByName(p, "detect-content-gaps");
    const toStep = stepByName(p, "update-import-run");
    const stepOutputs: Record<string, unknown> = {
      "list-content-files": { headCommitSha: "abc", files: [{}, {}] },
      "filter-changed-files": { changed: [], unchangedCount: 2, removedPaths: [] },
      "parse-frontmatter-batch": { parsed: [{}], failedCount: 0 },
      "upsert-articles": { inserted: 1, updated: 0, failed: 0 },
      "link-translation-pairs": { totalPairs: 0, orphans: 0, unkeyed: 0 },
    };
    const getStepOutput = <T = unknown>(name: string) =>
      stepOutputs[name] as T | undefined;
    const bridged = p.bridge(
      fromStep,
      toStep,
      {},
      PIPELINE_INPUT,
      getStepOutput,
    );
    expect(bridged).toEqual({
      importRunId: PIPELINE_INPUT.importRunId,
      filesDiscovered: 2,
      filesParsed: 1,
      articlesInserted: 1,
      articlesUpdated: 0,
      articlesUnchanged: 2,
      articlesFailed: 0,
      totalPairs: 0,
      orphans: 0,
      headCommitSha: "abc",
    });
  });
});
