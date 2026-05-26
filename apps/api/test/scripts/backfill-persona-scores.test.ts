/**
 * Spec 65.3 — backfill-persona-scores smoke tests.
 *
 * DI ports (`scoreToolFn`) keep the test offline — the real
 * `scoreToolForPersonas` would call Anthropic. We assert (a) dry-run counts
 * candidates without writing, (b) apply mode calls the injected fn for
 * incomplete tools, (c) `--force` re-scores everything, (d) the `--limit`
 * cap honours the bound.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  articles,
  db,
  eq,
  projects,
  upsertPersonaScore,
} from "@marketing-auto/db";
import { DEFAULT_PERSONAS } from "@marketing-auto/shared";
import {
  backfillPersonaScores,
  parseCliArgs,
} from "../../src/scripts/backfill-persona-scores.ts";
import type { ScoreToolResult } from "../../src/lib/persona-scoring/score-tool-for-personas.ts";

describe("backfillPersonaScores (Spec 65.3)", () => {
  let projectId: string;
  let projectSlug: string;
  const toolIds: string[] = [];

  beforeAll(async () => {
    const ts = Date.now();
    projectSlug = `backfill-ps-${ts}`;
    const [proj] = await db
      .insert(projects)
      .values({
        slug: projectSlug,
        name: "Backfill-PS test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    // 4 tool articles in primary locale.
    for (let i = 0; i < 4; i++) {
      const [row] = await db
        .insert(articles)
        .values({
          projectId,
          slug: `tool-${i}-${ts}`,
          title: `Tool ${i}`,
          collection: "tools",
          locale: "de",
          status: "published",
          source: "imported",
        })
        .returning();
      if (!row) throw new Error("article INSERT failed");
      toolIds.push(row.id);
    }
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("dry-run returns candidate count without invoking the scorer", async () => {
    let callCount = 0;
    const fakeScorer = async (): Promise<ScoreToolResult> => {
      callCount++;
      return { toolId: "x", written: [], source: "llm" };
    };

    const summary = await backfillPersonaScores({
      projectSlug,
      apply: false,
      scoreToolFn: fakeScorer,
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.candidatesBeforeRun).toBe(4); // all 4 tools incomplete
    expect(summary.totalProcessed).toBe(0);
    expect(callCount).toBe(0);
  });

  it("apply mode calls the scorer for every incomplete tool", async () => {
    const calls: string[] = [];
    const fakeScorer = async (input: { toolId: string }): Promise<ScoreToolResult> => {
      calls.push(input.toolId);
      return {
        toolId: input.toolId,
        written: [...DEFAULT_PERSONAS],
        source: "llm",
      };
    };

    const summary = await backfillPersonaScores({
      projectSlug,
      apply: true,
      scoreToolFn: fakeScorer,
    });

    expect(summary.dryRun).toBe(false);
    expect(summary.totalProcessed).toBe(4);
    expect(summary.bySource.llm).toBe(4);
    expect(summary.scoresWritten).toBe(4 * DEFAULT_PERSONAS.length);
    expect(new Set(calls)).toEqual(new Set(toolIds));
  });

  it("skips tools with complete fresh scores by default", async () => {
    // Pre-seed COMPLETE fresh scores for tool[0] so the backfill skips it.
    for (const persona of DEFAULT_PERSONAS) {
      await upsertPersonaScore({
        toolId: toolIds[0]!,
        projectId,
        persona,
        score: 7,
        reasoning: "pre-seeded",
      });
    }

    let calls = 0;
    const fakeScorer = async (input: { toolId: string }): Promise<ScoreToolResult> => {
      calls++;
      // Must NOT receive tool[0]
      expect(input.toolId).not.toBe(toolIds[0]);
      return {
        toolId: input.toolId,
        written: [...DEFAULT_PERSONAS],
        source: "llm",
      };
    };

    const summary = await backfillPersonaScores({
      projectSlug,
      apply: true,
      scoreToolFn: fakeScorer,
    });

    expect(calls).toBe(3); // tool[0] skipped
    expect(summary.totalProcessed).toBe(3);
  });

  it("--force re-scores every tool regardless of fresh-coverage", async () => {
    let calls = 0;
    const fakeScorer = async (input: { toolId: string }): Promise<ScoreToolResult> => {
      calls++;
      return {
        toolId: input.toolId,
        written: [...DEFAULT_PERSONAS],
        source: "llm",
      };
    };

    await backfillPersonaScores({
      projectSlug,
      apply: true,
      force: true,
      scoreToolFn: fakeScorer,
    });

    expect(calls).toBe(4);
  });

  it("--limit caps the number of tools processed", async () => {
    let calls = 0;
    const fakeScorer = async (input: { toolId: string }): Promise<ScoreToolResult> => {
      calls++;
      return {
        toolId: input.toolId,
        written: [...DEFAULT_PERSONAS],
        source: "llm",
      };
    };

    await backfillPersonaScores({
      projectSlug,
      apply: true,
      force: true,
      limit: 2,
      scoreToolFn: fakeScorer,
    });

    expect(calls).toBe(2);
  });

  it("aggregates failed + skipped counts into bySource", async () => {
    const fakeScorer = async (input: { toolId: string }): Promise<ScoreToolResult> => {
      // Mix of outcomes.
      if (input.toolId === toolIds[0]) {
        return { toolId: input.toolId, written: [], source: "failed", error: "boom" };
      }
      if (input.toolId === toolIds[1]) {
        return { toolId: input.toolId, written: [], source: "skipped" };
      }
      return {
        toolId: input.toolId,
        written: [...DEFAULT_PERSONAS],
        source: "llm",
      };
    };

    const summary = await backfillPersonaScores({
      projectSlug,
      apply: true,
      force: true,
      scoreToolFn: fakeScorer,
    });

    expect(summary.bySource.failed).toBe(1);
    expect(summary.bySource.skipped).toBe(1);
    expect(summary.bySource.llm).toBe(2);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.error).toBe("boom");
  });
});

describe("parseCliArgs (Spec 65.3)", () => {
  it("requires --project", () => {
    expect(() => parseCliArgs(["--apply"])).toThrow(/--project/);
  });

  it("parses --project + --apply + --force + --batch-size + --limit", () => {
    const args = parseCliArgs([
      "--project=toolwiki",
      "--apply",
      "--force",
      "--batch-size=10",
      "--limit=20",
    ]);
    expect(args.projectSlug).toBe("toolwiki");
    expect(args.apply).toBe(true);
    expect(args.force).toBe(true);
    expect(args.batchSize).toBe(10);
    expect(args.limit).toBe(20);
  });

  it("defaults to dry-run when --apply is omitted", () => {
    const args = parseCliArgs(["--project=toolwiki"]);
    expect(args.apply).toBe(false);
    expect(args.force).toBeUndefined();
  });
});
