// Spec 62.4 §6.1: DistributeSlotDatesStep — slot placement heuristics.

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
        if (name === "apply-sibling-locale") return { siblingItems: [] } as never;
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
        if (name === "apply-sibling-locale") return { siblingItems: [] } as never;
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
        if (name === "apply-sibling-locale") return { siblingItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    const dates = items.map((it) => (it.slotDate as Date).toISOString().slice(0, 10));
    expect(dates).toEqual(["2026-05-28", "2026-05-29"]);
  });

  it("places sibling at parent.slotDate + 1 day", async () => {
    const parent = draft({ contentType: "cluster", locale: "de" });
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: [parent] } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        if (name === "apply-sibling-locale")
          return {
            siblingItems: [
              draft({
                contentType: "cluster",
                locale: "en",
                sourceKind: "sibling_locale",
                parentDraftId: parent.draftId,
              }),
            ],
          } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    const parentOut = items.find((it) => it.draftId === parent.draftId)!;
    const siblingOut = items.find((it) => it.sourceKind === "sibling_locale")!;
    const diffMs =
      (siblingOut.slotDate as Date).getTime() - (parentOut.slotDate as Date).getTime();
    expect(diffMs).toBe(86_400_000);
  });

  it("clamps sibling that would overflow into next week to Sunday", async () => {
    // Make the parent land on Sunday 2026-05-31 (cluster #7 in Mon..Sun rotation).
    const parents = Array.from({ length: 7 }, () => draft({ contentType: "cluster", locale: "de" }));
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: parents } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        if (name === "apply-sibling-locale")
          return {
            siblingItems: [
              draft({
                contentType: "cluster",
                locale: "en",
                sourceKind: "sibling_locale",
                parentDraftId: parents[6]!.draftId,
              }),
            ],
          } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId, targetYear, targetIsoWeek }, ctx);
    const items = out.distributedItems as PlanningItemDraft[];
    const sibling = items.find((it) => it.sourceKind === "sibling_locale")!;
    // Sunday parent + 1 day would be next-week Monday → clamped to Sunday.
    expect((sibling.slotDate as Date).toISOString().slice(0, 10)).toBe("2026-05-31");
  });
});
