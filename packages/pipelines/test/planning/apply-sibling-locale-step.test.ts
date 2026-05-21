// Spec 62.4 §6.1: ApplySiblingLocaleStep — DE cluster items get an EN sibling.

import { describe, expect, it } from "bun:test";
import type { PlanningItemDraft } from "../../src/planning/index.ts";
import { ApplySiblingLocaleStep } from "../../src/planning/index.ts";
import { makeMockCtx } from "../fixtures/mock-ctx.ts";

const projectId = "00000000-0000-0000-0000-0000000000ac";

function clusterDraft(overrides: Partial<PlanningItemDraft> = {}): PlanningItemDraft {
  return {
    draftId: crypto.randomUUID(),
    contentType: "cluster",
    pipelineName: "cluster:full-plan",
    sourceKind: "floor",
    sourceBriefId: crypto.randomUUID(),
    sourceSignalId: null,
    parentDraftId: null,
    locale: "de",
    pipelineInput: { briefId: "x" },
    slotDate: null,
    selectionScore: null,
    selectionReason: "Floor cluster",
    estimatedCostEur: null,
    ...overrides,
  };
}

describe("ApplySiblingLocaleStep", () => {
  const step = new ApplySiblingLocaleStep();

  it("clones DE cluster items into EN siblings", async () => {
    const floor = [clusterDraft({ locale: "de" })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: floor } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    const items = out.siblingItems as PlanningItemDraft[];
    expect(items).toHaveLength(1);
    expect(items[0]!.locale).toBe("en");
    expect(items[0]!.parentDraftId).toBe(floor[0]!.draftId);
    expect(items[0]!.pipelineName).toBe("article:translation");
    expect(items[0]!.sourceKind).toBe("sibling_locale");
  });

  it("ignores non-cluster items", async () => {
    const floor = [clusterDraft({ contentType: "comparison" })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: floor } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.siblingItems).toHaveLength(0);
  });

  it("ignores non-DE cluster items (already EN or locale-neutral)", async () => {
    const floor = [
      clusterDraft({ locale: "en" }),
      clusterDraft({ locale: null }),
    ];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: floor } as never;
        if (name === "select-overage-items") return { overageItems: [] } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.siblingItems).toHaveLength(0);
  });

  it("processes both floor and overage cluster items", async () => {
    const floor = [clusterDraft({ locale: "de" })];
    const overage = [clusterDraft({ locale: "de", sourceKind: "overage_signal" })];
    const ctx = makeMockCtx({
      getStepOutput: (name) => {
        if (name === "select-floor-items") return { floorItems: floor } as never;
        if (name === "select-overage-items") return { overageItems: overage } as never;
        return undefined;
      },
    });
    const out = await step.execute({ projectId }, ctx);
    expect(out.siblingItems).toHaveLength(2);
  });
});
