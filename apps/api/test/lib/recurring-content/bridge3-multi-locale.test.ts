/**
 * Spec 65.V1.5a Bridge #3 — multi-locale fan-out tests.
 *
 * Covers:
 *   1. `resolveTargetLocales` normalisation:
 *      - empty / null / non-array → fallback
 *      - 2-letter codes pass through
 *      - BCP-47 tags collapse to 2-letter
 *      - unknown codes filtered out
 *      - dedup preserves order
 *   2. `persistRecurringBrief` with `runGroupId` + locale stamps
 *      `recurring_metadata.runGroupId` + `recurring_metadata.targetLocale`
 *   3. Two sibling briefs from the same fire share the same `runGroupId`
 *
 * The worker's full fan-out is integration-tested via the per-locale
 * persist + `resolveTargetLocales` together. Mocking the BullMQ worker
 * end-to-end would require mocking LLM calls in 5 generators — heavy and
 * not in V1.5 scope.
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
import { resolveTargetLocales } from "../../../src/workers/recurring-brief-generator.worker.ts";

describe("resolveTargetLocales (pure helper)", () => {
  it("falls back when input is null", () => {
    expect(resolveTargetLocales(null, "de")).toEqual(["de"]);
  });

  it("falls back when input is undefined", () => {
    expect(resolveTargetLocales(undefined, "en")).toEqual(["en"]);
  });

  it("falls back when input is a non-array", () => {
    expect(resolveTargetLocales("de", "de")).toEqual(["de"]);
    expect(resolveTargetLocales(42, "de")).toEqual(["de"]);
    expect(resolveTargetLocales({ de: true }, "de")).toEqual(["de"]);
  });

  it("falls back when array is empty", () => {
    expect(resolveTargetLocales([], "de")).toEqual(["de"]);
  });

  it("falls back when array has no recognised entries", () => {
    expect(resolveTargetLocales(["fr", "es"], "de")).toEqual(["de"]);
    expect(resolveTargetLocales([null, 42, true], "de")).toEqual(["de"]);
  });

  it("passes through 2-letter de + en", () => {
    expect(resolveTargetLocales(["de"], "en")).toEqual(["de"]);
    expect(resolveTargetLocales(["en"], "de")).toEqual(["en"]);
    expect(resolveTargetLocales(["de", "en"], "de")).toEqual(["de", "en"]);
  });

  it("collapses BCP-47 tags to 2-letter codes", () => {
    expect(resolveTargetLocales(["de-DE"], "en")).toEqual(["de"]);
    expect(resolveTargetLocales(["en-US"], "de")).toEqual(["en"]);
    expect(resolveTargetLocales(["de-DE", "en-US"], "de")).toEqual(["de", "en"]);
  });

  it("filters unknown codes silently", () => {
    expect(resolveTargetLocales(["de", "fr", "en"], "de")).toEqual(["de", "en"]);
  });

  it("dedups preserving order", () => {
    expect(resolveTargetLocales(["en", "de", "en", "de"], "de")).toEqual([
      "en",
      "de",
    ]);
    expect(resolveTargetLocales(["de", "de-DE", "de-AT"], "en")).toEqual(["de"]);
  });

  it("is case-insensitive", () => {
    expect(resolveTargetLocales(["DE", "EN"], "de")).toEqual(["de", "en"]);
    expect(resolveTargetLocales(["De-De"], "de")).toEqual(["de"]);
  });
});

describe("persistRecurringBrief — Bridge #3 runGroupId + targetLocale", () => {
  let projectId: string;
  let definition: RecurringContentDefinition;

  beforeAll(async () => {
    const ts = Date.now();
    const [proj] = await db
      .insert(projects)
      .values({
        slug: `bridge3-${ts}`,
        name: "bridge3 test",
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
        formatConfig: { topN: 5 },
        frequency: "weekly",
        nextRunAt: new Date(),
        targetLocales: ["de", "en"],
      })
      .returning();
    if (!def) throw new Error("definition INSERT failed");
    definition = def;
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, projectId));
  });

  it("stamps runGroupId + targetLocale into recurring_metadata", async () => {
    const runGroupId = crypto.randomUUID();
    const brief = await persistRecurringBrief({
      projectId,
      definition,
      briefText: "DE body.",
      topicTitle: "DE brief",
      toolIds: [],
      locale: "de",
      selectedTemplate: { templateKey: "comparison-grid-5", selectedVia: "lru" },
      runNumber: 1,
      runGroupId,
    });

    expect(brief.recurringMetadata?.runGroupId).toBe(runGroupId);
    expect(brief.recurringMetadata?.targetLocale).toBe("de");
  });

  it("omits runGroupId when single-locale fire (no runGroupId passed)", async () => {
    const brief = await persistRecurringBrief({
      projectId,
      definition,
      briefText: "single-locale body.",
      topicTitle: "single",
      toolIds: [],
      locale: "de",
      selectedTemplate: { templateKey: "comparison-grid-5", selectedVia: "lru" },
      runNumber: 2,
      // no runGroupId
    });

    expect(brief.recurringMetadata?.runGroupId).toBeUndefined();
    // targetLocale is still stamped per Bridge #3 (denormalised mirror).
    expect(brief.recurringMetadata?.targetLocale).toBe("de");
  });

  it("two sibling briefs from the same fire share the same runGroupId", async () => {
    const runGroupId = crypto.randomUUID();

    const deBrief = await persistRecurringBrief({
      projectId,
      definition,
      briefText: "DE body.",
      topicTitle: "DE brief",
      toolIds: [],
      locale: "de",
      selectedTemplate: { templateKey: "comparison-grid-5", selectedVia: "lru" },
      runNumber: 3,
      runGroupId,
    });

    const enBrief = await persistRecurringBrief({
      projectId,
      definition,
      briefText: "EN body.",
      topicTitle: "EN brief",
      toolIds: [],
      locale: "en",
      selectedTemplate: { templateKey: "comparison-grid-5", selectedVia: "lru" },
      runNumber: 3,
      runGroupId,
    });

    expect(deBrief.recurringMetadata?.runGroupId).toBe(runGroupId);
    expect(enBrief.recurringMetadata?.runGroupId).toBe(runGroupId);
    expect(deBrief.recurringMetadata?.targetLocale).toBe("de");
    expect(enBrief.recurringMetadata?.targetLocale).toBe("en");
    expect(deBrief.locale).toBe("de");
    expect(enBrief.locale).toBe("en");
  });

  it("siblings can be discovered by querying runGroupId", async () => {
    const runGroupId = crypto.randomUUID();
    await persistRecurringBrief({
      projectId,
      definition,
      briefText: "DE body.",
      topicTitle: "twin DE",
      toolIds: [],
      locale: "de",
      selectedTemplate: { templateKey: "comparison-grid-5", selectedVia: "lru" },
      runNumber: 4,
      runGroupId,
    });
    await persistRecurringBrief({
      projectId,
      definition,
      briefText: "EN body.",
      topicTitle: "twin EN",
      toolIds: [],
      locale: "en",
      selectedTemplate: { templateKey: "comparison-grid-5", selectedVia: "lru" },
      runNumber: 4,
      runGroupId,
    });

    // Use the SQL `->>` jsonb path operator via Drizzle's sql helper.
    const { sql } = await import("drizzle-orm");
    const siblings = await db
      .select({
        id: topicBriefs.id,
        locale: topicBriefs.locale,
        title: topicBriefs.topicTitle,
      })
      .from(topicBriefs)
      .where(sql`${topicBriefs.recurringMetadata}->>'runGroupId' = ${runGroupId}`)
      .orderBy(topicBriefs.locale);

    expect(siblings.length).toBe(2);
    expect(siblings[0]!.locale).toBe("de");
    expect(siblings[1]!.locale).toBe("en");
  });
});
