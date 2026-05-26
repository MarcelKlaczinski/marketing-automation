/**
 * Spec 65.9 — End-Slide selector tests.
 *
 * Covers:
 *   - Strategy 1 (definition pool) happy path + LRU within pool
 *   - Strategy 1 fall-through to Strategy 2 when pool resolves to 0 active candidates
 *   - Strategy 2 (format-type defaults) happy path + LRU among defaults
 *   - LRU cold-start fallback when every candidate type was recently used
 *   - Unknown format-type throws
 *   - No-eligible-candidates throws NoEligibleEndSlidesError
 *   - Multi-tenant guard rejects definition.projectId mismatch
 *   - Pure `pickLruEndSlide` helper coverage (no DB)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createEndSlideDefinition,
  db,
  endSlideDefinitions,
  eq,
  logTemplateUsage,
  projects,
  recurringContentDefinitions,
  templateUsageLog,
  type EndSlideDefinition,
  type RecurringContentDefinition,
} from "@marketing-auto/db";
import {
  NoEligibleEndSlidesError,
  pickLruEndSlide,
  selectEndSlideForRecurringBrief,
} from "../../../src/lib/recurring-content/brief-generators/shared/select-end-slide.ts";

describe("pickLruEndSlide (pure helper)", () => {
  function makeCandidate(id: string, type: string): EndSlideDefinition {
    return {
      id,
      projectId: "proj-x",
      name: `${type} stub`,
      type,
      config: {},
      isActive: true,
      createdAt: new Date(),
    };
  }

  it("returns first candidate when nothing was recently used", () => {
    const cands = [makeCandidate("a", "follow-cta"), makeCandidate("b", "comment-to-get")];
    const picked = pickLruEndSlide(cands, new Set());
    expect(picked.id).toBe("a");
  });

  it("skips a candidate whose type was recently used", () => {
    const cands = [makeCandidate("a", "follow-cta"), makeCandidate("b", "comment-to-get")];
    const picked = pickLruEndSlide(cands, new Set(["follow-cta"]));
    expect(picked.id).toBe("b");
  });

  it("falls back to candidates[0] when every type was recently used", () => {
    const cands = [makeCandidate("a", "follow-cta"), makeCandidate("b", "comment-to-get")];
    const picked = pickLruEndSlide(cands, new Set(["follow-cta", "comment-to-get"]));
    expect(picked.id).toBe("a");
  });

  it("throws on empty candidates (defensive — caller is supposed to gate)", () => {
    expect(() => pickLruEndSlide([], new Set())).toThrow();
  });
});

describe("selectEndSlideForRecurringBrief (DB integration)", () => {
  let projectId: string;
  let otherProjectId: string;
  let definitionId: string;
  let otherDefinitionId: string;

  // Map of type → end-slide-definition id (populated in beforeAll).
  const seedIds: Record<string, string> = {};

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `select-endslide-${ts}`,
        name: "select-end-slide test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    const [proj2] = await db
      .insert(projects)
      .values({
        slug: `select-endslide-other-${ts}`,
        name: "select-end-slide other-tenant",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj2) throw new Error("other project INSERT failed");
    otherProjectId = proj2.id;

    // Seed 4 end-slide-definitions covering all 4 types referenced by
    // FORMAT_TYPES[*].defaultEndSlides — that's the set the format-type
    // strategy can pull from.
    const seedTypes = ["comment-to-get", "link-in-bio", "tag-friend", "save-share-cta"];
    for (const type of seedTypes) {
      const row = await createEndSlideDefinition({
        projectId,
        name: `seed ${type}`,
        type,
        config: { handle: "@toolwiki.ai", description: "x", keyword: "X", resourceTitle: "X", prompt: "x", primaryAction: "save", message: "x", destination: "x", quote: "abcd" },
        isActive: true,
      });
      seedIds[type] = row.id;
    }

    // Also seed an INACTIVE row to verify it never appears as a candidate.
    await createEndSlideDefinition({
      projectId,
      name: "inactive follow-cta",
      type: "follow-cta",
      config: { handle: "@inactive" },
      isActive: false,
    });

    // top_n_comparison.defaultEndSlides = ["comment-to-get", "link-in-bio"]
    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "select-end-slide def",
        formatType: "top_n_comparison",
        formatConfig: {},
        frequency: "weekly",
        nextRunAt: new Date(),
      })
      .returning();
    if (!def) throw new Error("definition INSERT failed");
    definitionId = def.id;

    // Definition belonging to another project — used to assert the
    // multi-tenant guard.
    const [otherDef] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId: otherProjectId,
        name: "other-tenant def",
        formatType: "top_n_comparison",
        formatConfig: {},
        frequency: "weekly",
        nextRunAt: new Date(),
      })
      .returning();
    if (!otherDef) throw new Error("other definition INSERT failed");
    otherDefinitionId = otherDef.id;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(projects).where(eq(projects.id, otherProjectId));
  });

  async function loadDefinition(
    id: string,
    overrides?: Partial<typeof recurringContentDefinitions.$inferInsert>,
  ): Promise<RecurringContentDefinition> {
    if (overrides) {
      await db
        .update(recurringContentDefinitions)
        .set(overrides)
        .where(eq(recurringContentDefinitions.id, id));
    }
    const rows = await db
      .select()
      .from(recurringContentDefinitions)
      .where(eq(recurringContentDefinitions.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("definition not found");
    return row;
  }

  async function clearUsageLog(): Promise<void> {
    await db
      .delete(templateUsageLog)
      .where(eq(templateUsageLog.recurringDefinitionId, definitionId));
  }

  it("Strategy 2 — picks a default-type candidate when pool is empty (cold start)", async () => {
    await clearUsageLog();
    const def = await loadDefinition(definitionId, { endSlidePool: [] });
    const result = await selectEndSlideForRecurringBrief({ definition: def, projectId });
    // top_n_comparison defaults are ["comment-to-get", "link-in-bio"], cold-start
    // picks the first declared (comment-to-get) because createdAt ASC ordering
    // in `listEndSlideDefinitions` mirrors the seed order.
    expect(["comment-to-get", "link-in-bio"]).toContain(result.endSlideType);
    expect(result.selectedVia).toBe("format-type-default");
  });

  it("Strategy 2 — LRU skips recently-used type", async () => {
    await clearUsageLog();
    const def = await loadDefinition(definitionId, { endSlidePool: [] });
    // Log a recent use of comment-to-get → next pick must be link-in-bio.
    await logTemplateUsage({
      recurringDefinitionId: definitionId,
      templateKey: "comparison-grid-4",
      endSlideType: "comment-to-get",
    });
    const result = await selectEndSlideForRecurringBrief({ definition: def, projectId });
    expect(result.endSlideType).toBe("link-in-bio");
    expect(result.selectedVia).toBe("format-type-default");
  });

  it("Strategy 1 — picks within definition.endSlidePool when non-empty", async () => {
    await clearUsageLog();
    // Pool restricted to the `tag-friend` ID — even though top_n_comparison's
    // defaultEndSlides is [comment-to-get, link-in-bio], the pool wins.
    const tagFriendId = seedIds["tag-friend"];
    if (!tagFriendId) throw new Error("seed: tag-friend missing");
    const def = await loadDefinition(definitionId, {
      endSlidePool: [tagFriendId],
    });
    const result = await selectEndSlideForRecurringBrief({ definition: def, projectId });
    expect(result.endSlideDefinitionId).toBe(tagFriendId);
    expect(result.endSlideType).toBe("tag-friend");
    expect(result.selectedVia).toBe("lru-within-pool");
  });

  it("Strategy 1 — LRU within multi-type pool skips recently-used type", async () => {
    await clearUsageLog();
    const commentId = seedIds["comment-to-get"];
    const linkId = seedIds["link-in-bio"];
    if (!commentId || !linkId) throw new Error("seed: comment/link missing");
    const def = await loadDefinition(definitionId, {
      endSlidePool: [commentId, linkId],
    });
    await logTemplateUsage({
      recurringDefinitionId: definitionId,
      templateKey: "x",
      endSlideType: "comment-to-get",
    });
    const result = await selectEndSlideForRecurringBrief({ definition: def, projectId });
    expect(result.endSlideType).toBe("link-in-bio");
    expect(result.selectedVia).toBe("lru-within-pool");
  });

  it("Strategy 1 falls through to Strategy 2 when pool IDs are orphans (all inactive/deleted)", async () => {
    await clearUsageLog();
    const def = await loadDefinition(definitionId, {
      // Pool of UUIDs that don't exist as active rows.
      endSlidePool: ["00000000-0000-0000-0000-000000000001"],
    });
    const result = await selectEndSlideForRecurringBrief({ definition: def, projectId });
    expect(result.selectedVia).toBe("format-type-default");
    expect(["comment-to-get", "link-in-bio"]).toContain(result.endSlideType);
  });

  it("rejects definition.projectId vs input.projectId mismatch (multi-tenant guard)", async () => {
    const def = await loadDefinition(otherDefinitionId);
    await expect(
      selectEndSlideForRecurringBrief({ definition: def, projectId }),
    ).rejects.toThrow(/does not match input\.projectId/);
  });

  it("throws on unknown format-type in registry", async () => {
    await clearUsageLog();
    const def = await loadDefinition(definitionId, {
      formatType: "never_registered_format",
      endSlidePool: [],
    });
    await expect(
      selectEndSlideForRecurringBrief({ definition: def, projectId }),
    ).rejects.toThrow(/format-type 'never_registered_format' is not in FORMAT_TYPES registry/);
    // Restore for next tests.
    await loadDefinition(definitionId, { formatType: "top_n_comparison" });
  });

  it("throws NoEligibleEndSlidesError when project has no seed rows matching defaultEndSlides", async () => {
    await clearUsageLog();
    // Bulk-deactivate all our seeded rows so the format-type default-types
    // resolve to zero candidates.
    await db
      .update(endSlideDefinitions)
      .set({ isActive: false })
      .where(eq(endSlideDefinitions.projectId, projectId));

    const def = await loadDefinition(definitionId, { endSlidePool: [] });
    await expect(
      selectEndSlideForRecurringBrief({ definition: def, projectId }),
    ).rejects.toThrow(NoEligibleEndSlidesError);

    // Restore for next tests.
    await db
      .update(endSlideDefinitions)
      .set({ isActive: true })
      .where(eq(endSlideDefinitions.projectId, projectId));
    // The "inactive follow-cta" row we seeded should stay inactive.
    await db
      .update(endSlideDefinitions)
      .set({ isActive: false })
      .where(eq(endSlideDefinitions.name, "inactive follow-cta"));
  });
});
