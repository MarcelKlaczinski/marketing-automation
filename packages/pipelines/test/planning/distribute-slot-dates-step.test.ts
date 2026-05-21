// Spec 62.4 §6.1 + 62.4-followup Issue 1: DistributeSlotDatesStep — slot
// placement heuristics. Sibling-locale second-pass tests removed because
// ApplySiblingLocaleStep is gone (the chained cluster → article:translation
// flow handles DE+EN inside the article pipeline).

import { describe, expect, it } from "bun:test";
import type { PlanningItemDraft } from "../../src/planning/index.ts";
import { DistributeSlotDatesStep } from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const projectId = "00000000-0000-0000-0000-0000000000ad";

function draft(overrides: Partial<PlanningItemDraft>): PlanningItemDraft {
  return {
    draftId: crypto.randomUUID(),
    contentType: "cluster",
    pipelineName: "cluster:full-plan",
    sourceKind: "floor",
    sourceBriefId: null,
    sourceSignalId: null,
    parentDraftId: null,
    locale: null,
    pipelineInput: {},
    slotDate: null,
    selectionScore: null,
    selectionReason: "test",
    estimatedCostEur: null,
    ...overrides,
  };
}

describe("DistributeSlotDatesStep", () => {
  const step = new DistributeSlotDatesStep();

  // KW22/2026 begins Mon 2026-05-25.
  const targetYear = 2026;
  const targetIsoWeek = 22;

  it("distributes 7 cluster items Mon..Sun", async () => {
    const floor = Array.from({ length: 7 }, () => draft({ contentType: "cluster" }));
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: floor } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        if (name === "select-social-post-items") return { socialItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    const dates = items.map((it) => (it.slotDate as Date).toISOString().slice(0, 10)).sort();
    expect(dates).toEqual([
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
    ]);
  });

  it("places comparison on Wednesday (offset +2 days)", async () => {
    const floor = [draft({ contentType: "comparison" })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: floor } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        if (name === "select-social-post-items") return { socialItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    expect((items[0]!.slotDate as Date).toISOString().slice(0, 10)).toBe("2026-05-27");
  });

  it("alternates ki_wissen between Thursday and Friday", async () => {
    const floor = [
      draft({ contentType: "ki_wissen" }),
      draft({ contentType: "ki_wissen" }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: floor } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        if (name === "select-social-post-items") return { socialItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    const dates = items.map((it) => (it.slotDate as Date).toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-05-28", "2026-05-29"]);
  });

  it("distributes social_post items across Mon..Sun rotation", async () => {
    const socialItems = Array.from({ length: 7 }, () =>
      draft({ contentType: "social_post", pipelineName: "article:social-image" }),
    );
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: [] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        if (name === "select-social-post-items") return { socialItems } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    const dates = items.map((it) => (it.slotDate as Date).toISOString().slice(0, 10)).sort();
    expect(dates).toEqual([
      "2026-05-25",
      "2026-05-26",
      "2026-05-27",
      "2026-05-28",
      "2026-05-29",
      "2026-05-30",
      "2026-05-31",
    ]);
  });

  it("preserves pre-assigned slotDate from social-source selectors", async () => {
    // Social items sourced from today's cluster carry the cluster's slot_date
    // (Spec 62.4-followup Issue 2 §3 — fromTodayPlans). Distribute must not
    // overwrite a non-null slotDate.
    const fixed = new Date(Date.UTC(2026, 4, 28)); // 2026-05-28 (Thu)
    const social = [
      draft({ contentType: "social_post", pipelineName: "article:social-image", slotDate: fixed }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: [] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        if (name === "select-social-post-items") return { socialItems: social } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    expect((items[0]!.slotDate as Date).toISOString().slice(0, 10)).toBe("2026-05-28");
  });
});
