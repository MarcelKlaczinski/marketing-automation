/**
 * Spec 65.5 — persistRecurringBrief integration test.
 *
 * Asserts:
 *   - INSERT runs through TopicBriefInsertSchema (source='recurring' ⇔
 *     recurringMetadata != null)
 *   - approval_status defaults to plan_pending
 *   - cluster fields stay NULL (recurring is standalone)
 *   - recurring_metadata carries definitionId + runNumber + frozen formatConfig
 *     + selected template + hookData
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  db,
  eq,
  projects,
  recurringContentDefinitions,
  topicBriefs,
  type RecurringContentDefinition,
} from "@marketing-auto/db";
import { persistRecurringBrief } from "../../../src/lib/recurring-content/brief-generators/shared/persist-brief.ts";

describe("persistRecurringBrief (Spec 65.5)", () => {
  let projectId: string;
  let definition: RecurringContentDefinition;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `persist-brief-${ts}`,
        name: "persist-brief test",
        industry: "ai_education",
        pipelineTemplate: "educational",
      })
      .returning();
    if (!proj) throw new Error("project INSERT failed");
    projectId = proj.id;

    const [def] = await db
      .insert(recurringContentDefinitions)
      .values({
        projectId,
        name: "test-def",
        formatType: "top_n_comparison",
        formatConfig: { topN: 5, categorySlug: "ai-image" },
        frequency: "weekly",
        nextRunAt: new Date(),
      })
      .returning();
    if (!def) throw new Error("definition INSERT failed");
    definition = def;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("persists a Family A brief with plan_pending status", async () => {
    const brief = await persistRecurringBrief({
      projectId,
      definition,
      briefText: "Brief body for top 5 image tools.",
      topicTitle: "Top 5 AI image generators",
      toolIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      locale: "de",
      selectedTemplate: {
        templateKey: "comparison-grid-5",
        selectedVia: "lru",
      },
      runNumber: 1,
    });
    expect(brief.source).toBe("recurring");
    expect(brief.approvalStatus).toBe("plan_pending");
    expect(brief.clusterAction).toBe("standalone");
    expect(brief.clusterId).toBeNull();
    expect(brief.topicTitle).toBe("Top 5 AI image generators");
    expect(brief.recurringMetadata).not.toBeNull();
    expect(brief.recurringMetadata?.definitionId).toBe(definition.id);
    expect(brief.recurringMetadata?.runNumber).toBe(1);
    expect(brief.recurringMetadata?.formatType).toBe("top_n_comparison");
    // formatConfig is frozen — includes the original + the selected template.
    const fc = brief.recurringMetadata?.formatConfig as Record<string, unknown>;
    expect(fc.topN).toBe(5);
    expect(fc.categorySlug).toBe("ai-image");
    expect(fc.selectedTemplateKey).toBe("comparison-grid-5");
    expect(fc.selectedTemplateVia).toBe("lru");
    expect(fc.toolIds).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
    expect(fc.outputTargets).toEqual({ article: false, social: true });
  });

  it("persists a Family B brief with hookData in recurring_metadata", async () => {
    const brief = await persistRecurringBrief({
      projectId,
      definition,
      briefText: "Hook-driven body.",
      topicTitle: "I lost my Texter job",
      toolIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      locale: "de",
      selectedTemplate: {
        templateKey: "story-arc-clickbait-dramatic",
        selectedVia: "llm-rank",
        reasoning: "matched dramatic tone",
      },
      hookData: {
        hookId: "11111111-1111-1111-1111-111111111111",
        pattern: "Ich habe meinen {profession}-Job an {tool} verloren.",
        rendered: "Ich habe meinen Texter-Job an Claude verloren.",
      },
      runNumber: 2,
      previousToolIds: ["00000000-0000-0000-0000-000000000000"],
    });
    expect(brief.recurringMetadata?.runNumber).toBe(2);
    expect(brief.recurringMetadata?.previousToolIds).toEqual([
      "00000000-0000-0000-0000-000000000000",
    ]);
    const fc = brief.recurringMetadata?.formatConfig as Record<string, unknown>;
    expect(fc.selectedTemplateKey).toBe("story-arc-clickbait-dramatic");
    expect(fc.selectedTemplateVia).toBe("llm-rank");
    expect(fc.selectedTemplateReasoning).toBe("matched dramatic tone");
    expect(fc.hookData).toEqual({
      hookId: "11111111-1111-1111-1111-111111111111",
      pattern: "Ich habe meinen {profession}-Job an {tool} verloren.",
      rendered: "Ich habe meinen Texter-Job an Claude verloren.",
    });
  });

  it("uses suggestedMeta as a 280-char snippet of briefText", async () => {
    const long = "a".repeat(500);
    const brief = await persistRecurringBrief({
      projectId,
      definition,
      briefText: long,
      topicTitle: "long brief",
      toolIds: [],
      locale: "de",
      selectedTemplate: { templateKey: "comparison-grid-3", selectedVia: "lru" },
      runNumber: 3,
    });
    expect(brief.suggestedMeta?.length).toBe(280);
  });

  it("clean up rows after test", async () => {
    // CASCADE on projects deletes the brief — but verify the test rows
    // exist before cleanup so we don't accidentally pass on a no-op.
    const rows = await db
      .select({ id: topicBriefs.id })
      .from(topicBriefs)
      .where(eq(topicBriefs.projectId, projectId));
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
