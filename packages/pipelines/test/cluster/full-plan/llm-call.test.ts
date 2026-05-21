import { describe, expect, it } from "bun:test";
import { ClusterPlanOutputSchema } from "../../../src/cluster/full-plan/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_HUB = {
  title: "Was sind KI-Code-Editoren 2026: Der vollständige Leitfaden",
  primaryKeyword: "KI-Code-Editoren",
  intentType: "overview",
  estimatedWordCount: 2000,
  h2Outline: [
    "Was ist ein KI-Code-Editor?",
    "Wie funktionieren KI-Code-Editoren?",
    "Die besten KI-Code-Editoren im Überblick",
    "Vergleich der Top-Tools",
    "Fazit und Empfehlung",
  ],
  metaDescription: "Die besten KI-Code-Editoren 2026 im Vergleich.",
};

const VALID_SPOKE = (i: number, intentType: string) => ({
  proposedTitle: `KI-Code-Editor Spoke ${i}`,
  primaryKeyword: `ki code editor spoke ${i}`,
  intentType,
  estimatedWordCount: 1200,
  rationale: "Makes sense because tools cluster benefits from direct comparison.",
  position: i,
});

const VALID_PLAN = {
  pillarId: "new",
  pillarSuggestedName: "KI-Code-Editoren",
  cluster: {
    name: "KI-Code-Editoren",
    primaryKeyword: "KI-Code-Editoren",
  },
  hub: VALID_HUB,
  spokes: [
    VALID_SPOKE(0, "review"),
    VALID_SPOKE(1, "comparison"),
    VALID_SPOKE(2, "pricing"),
    VALID_SPOKE(3, "tutorial"),
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ClusterPlanOutputSchema", () => {
  it("accepts a valid plan with 4 spokes", () => {
    const result = ClusterPlanOutputSchema.safeParse(VALID_PLAN);
    expect(result.success).toBe(true);
  });

  it("accepts a valid plan with 6 spokes", () => {
    const plan = {
      ...VALID_PLAN,
      spokes: [
        VALID_SPOKE(0, "review"),
        VALID_SPOKE(1, "comparison"),
        VALID_SPOKE(2, "pricing"),
        VALID_SPOKE(3, "tutorial"),
        VALID_SPOKE(4, "use-cases"),
        VALID_SPOKE(5, "features"),
      ],
    };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.spokes).toHaveLength(6);
  });

  it("rejects a plan with only 3 spokes (minimum is 4)", () => {
    const plan = {
      ...VALID_PLAN,
      spokes: [VALID_SPOKE(0, "review"), VALID_SPOKE(1, "comparison"), VALID_SPOKE(2, "pricing")],
    };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toMatch(/at least 4/i);
    }
  });

  it("rejects a plan with 7 spokes (maximum is 6)", () => {
    const plan = {
      ...VALID_PLAN,
      spokes: [
        VALID_SPOKE(0, "review"),
        VALID_SPOKE(1, "comparison"),
        VALID_SPOKE(2, "pricing"),
        VALID_SPOKE(3, "tutorial"),
        VALID_SPOKE(4, "use-cases"),
        VALID_SPOKE(5, "features"),
        VALID_SPOKE(6, "review"), // extra — invalid
      ],
    };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toMatch(/at most 6/i);
    }
  });

  it("rejects a spoke with an invalid intentType", () => {
    const plan = {
      ...VALID_PLAN,
      spokes: [
        ...VALID_PLAN.spokes.slice(0, 3),
        { ...VALID_SPOKE(3, "invalid-intent") }, // bad intent
      ],
    };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects a hub with an invalid intentType", () => {
    const plan = {
      ...VALID_PLAN,
      hub: { ...VALID_HUB, intentType: "review" }, // hubs cannot be 'review'
    };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects a hub with fewer than 4 h2Outline items", () => {
    const plan = {
      ...VALID_PLAN,
      hub: { ...VALID_HUB, h2Outline: ["One section", "Two sections", "Three sections"] },
    };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects spokes with duplicate intentType", () => {
    const plan = {
      ...VALID_PLAN,
      spokes: [
        VALID_SPOKE(0, "review"),
        VALID_SPOKE(1, "review"), // duplicate!
        VALID_SPOKE(2, "pricing"),
        VALID_SPOKE(3, "tutorial"),
      ],
    };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues[0]?.message ?? "";
      expect(msg).toMatch(/distinct intentType/i);
    }
  });

  it("accepts pillarId as an existing UUID", () => {
    const pillarId = crypto.randomUUID();
    const plan = { ...VALID_PLAN, pillarId, pillarSuggestedName: null };
    const result = ClusterPlanOutputSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pillarId).toBe(pillarId);
      expect(result.data.pillarSuggestedName).toBeNull();
    }
  });

  it("accepts pillarId='new' with a suggested name", () => {
    const result = ClusterPlanOutputSchema.safeParse(VALID_PLAN);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pillarId).toBe("new");
      expect(result.data.pillarSuggestedName).toBe("KI-Code-Editoren");
    }
  });

  it("parses spokes with correct position ordering", () => {
    const result = ClusterPlanOutputSchema.safeParse(VALID_PLAN);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.spokes[0]?.position).toBe(0);
      expect(result.data.spokes[3]?.position).toBe(3);
    }
  });
});

describe("buildClusterPlanPrompt", () => {
  it("includes existing pillar IDs in system prompt", async () => {
    const { buildClusterPlanPrompt } = await import(
      "../../../src/cluster/full-plan/prompts.ts"
    );
    const pillarId = crypto.randomUUID();
    const { systemPrompt } = buildClusterPlanPrompt({
      triggerBrief: makeBrief(),
      projectId: crypto.randomUUID(),
      projectName: "ToolWiki",
      projectMarketingContextMd: null,
      existingPillars: [{ id: pillarId, name: "KI-Tools" }],
      existingClusters: [],
    });
    expect(systemPrompt).toContain(pillarId);
    expect(systemPrompt).toContain("KI-Tools");
  });

  it("includes trend metadata in user message", async () => {
    const { buildClusterPlanPrompt } = await import(
      "../../../src/cluster/full-plan/prompts.ts"
    );
    const { userMessage } = buildClusterPlanPrompt({
      triggerBrief: makeBrief({ trendScore: 72, freshnessWindow: "rising" }),
      projectId: crypto.randomUUID(),
      projectName: "ToolWiki",
      projectMarketingContextMd: null,
      existingPillars: [],
      existingClusters: [],
    });
    expect(userMessage).toContain("72");
    expect(userMessage).toContain("rising");
  });

  it("falls back gracefully when no existing clusters", async () => {
    const { buildClusterPlanPrompt } = await import(
      "../../../src/cluster/full-plan/prompts.ts"
    );
    const { systemPrompt } = buildClusterPlanPrompt({
      triggerBrief: makeBrief(),
      projectId: crypto.randomUUID(),
      projectName: "ToolWiki",
      projectMarketingContextMd: null,
      existingPillars: [],
      existingClusters: [],
    });
    expect(systemPrompt).toContain("(none yet)");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBrief(trendMeta?: { trendScore?: number; freshnessWindow?: "breaking" | "rising" | "stable" }) {
  const trendMetadata = trendMeta
    ? {
        trendScore: trendMeta.trendScore ?? 65,
        signals: [] as [],
        freshnessWindow: trendMeta.freshnessWindow ?? ("rising" as const),
      }
    : null;

  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    source: "trend_discovery" as const,
    topicTitle: "KI-Code-Editoren 2026",
    primaryKeyword: "KI-Code-Editoren",
    secondaryKeywords: ["cursor ai", "windsurf editor"],
    locale: "de",
    intentType: null,
    clusterId: null,
    clusterAction: "create_new" as const,
    searchVolumeDe: null,
    searchVolumeEn: null,
    difficulty: null,
    serpSnapshot: null,
    suggestedTitle: null,
    suggestedSlug: null,
    suggestedMeta: null,
    heroImagePrompt: null,
    generationMode: null,
    approvalRequired: true,
    approvalStatus: "pending" as const,
    approvedBy: null,
    approvedAt: null,
    gapId: null,
    gapMetadata: null,
    trendMetadata,
    refreshMetadata: null,
    comparisonMetadata: null,
    routedArticleId: null,
    routedCornerstoneSpecId: null,
    routedClusterId: null,
    routedViaPlanItemId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
