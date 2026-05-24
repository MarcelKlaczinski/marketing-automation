// Spec 64.18 / Phase C.2 — pure-function unit tests for resolveComparisonCluster.
//
// Covers the 5 routing branches + the 4 Toolwiki-stuck-briefs snapshot
// (Discovery 64.18 / Phase C.1 §1). No DB; uses inline ComparisonClusterEntry
// fixtures mirroring the live Toolwiki shape.

import { describe, expect, it } from "bun:test";
import {
  resolveComparisonCluster,
  type ComparisonClusterEntry,
  type ResolverToolInfo,
} from "../src/comparison-routing.ts";

// ─── Fixtures: real Toolwiki cluster shape (Discovery §3) ────────────────────

const TOOLWIKI_COMPARISON_CLUSTERS: ComparisonClusterEntry[] = [
  {
    clusterId: "cl-chatbot",
    clusterName: "chatbot-comparisons-2026",
    matchTokens: new Set([
      "chatbot-comparisons-2026",
      "chatbot",
      "comparisons",
      "2026",
      "chatbots-assistants",
      "text-language",
    ]),
  },
  {
    clusterId: "cl-image",
    clusterName: "image-comparisons-2026",
    matchTokens: new Set([
      "image-comparisons-2026",
      "image",
      "comparisons",
      "2026",
      "image-generation",
      "images-graphics",
    ]),
  },
  {
    clusterId: "cl-voice",
    clusterName: "voice-comparisons-2026",
    matchTokens: new Set([
      "voice-comparisons-2026",
      "voice",
      "comparisons",
      "2026",
      "voice-cloning",
      "audio-music",
    ]),
  },
];

function tool(
  slug: string,
  category: string | null,
  subcategory: string | null,
): ResolverToolInfo {
  return { slug, category, subcategory };
}

// ─── Branch tests ─────────────────────────────────────────────────────────────

describe("resolveComparisonCluster (Spec 64.18 / Phase C.2)", () => {
  it("returns create_new when cluster index is empty", () => {
    const r = resolveComparisonCluster(
      tool("a", "text-language", "chatbots-assistants"),
      tool("b", "text-language", "chatbots-assistants"),
      [],
    );
    expect(r.clusterAction).toBe("create_new");
    expect(r.clusterId).toBeNull();
    expect(r.matchedBy).toBe("none");
  });

  it("Priority 1: both tools share subcategory → routes via subcategory match", () => {
    // claude + chatgpt (both chatbots-assistants) → chatbot-comparisons-2026.
    const r = resolveComparisonCluster(
      tool("claude", "text-language", "chatbots-assistants"),
      tool("chatgpt", "text-language", "chatbots-assistants"),
      TOOLWIKI_COMPARISON_CLUSTERS,
    );
    expect(r.clusterAction).toBe("append_to_existing");
    if (r.clusterAction === "append_to_existing") {
      expect(r.clusterId).toBe("cl-chatbot");
      expect(r.matchedBy).toBe("subcategory");
    }
  });

  it("Priority 2: one tool's subcategory anchors (chatbot-anchor pattern)", () => {
    // Claude (chatbots-assistants) vs DeepL (translation) — both `text-language`
    // category, different subcategories. Claude's subcategory matches the
    // chatbot cluster → routes there. Matches Discovery §1 stuck brief
    // "Claude vs DeepL" expected outcome.
    const r = resolveComparisonCluster(
      tool("claude", "text-language", "chatbots-assistants"),
      tool("deepl", "text-language", "translation"),
      TOOLWIKI_COMPARISON_CLUSTERS,
    );
    expect(r.clusterAction).toBe("append_to_existing");
    if (r.clusterAction === "append_to_existing") {
      expect(r.clusterId).toBe("cl-chatbot");
      expect(r.matchedBy).toBe("subcategory");
    }
  });

  it("Priority 2 (reverse): tool B's subcategory anchors when A has none", () => {
    const r = resolveComparisonCluster(
      tool("unknown", "text-language", null),
      tool("chatgpt", "text-language", "chatbots-assistants"),
      TOOLWIKI_COMPARISON_CLUSTERS,
    );
    expect(r.clusterAction).toBe("append_to_existing");
    if (r.clusterAction === "append_to_existing") {
      expect(r.clusterId).toBe("cl-chatbot");
    }
  });

  it("Priority 3: category-level match when no subcategory hit", () => {
    // Build a cluster whose only token is the category, then a pair without
    // matching subcategories.
    const categoryOnlyClusters: ComparisonClusterEntry[] = [
      {
        clusterId: "cl-cat",
        clusterName: "ai-coding-tools",
        matchTokens: new Set(["ai-coding-tools", "coding-development", "coding"]),
      },
    ];
    const r = resolveComparisonCluster(
      tool("cursor", "coding-development", "ide-extensions"),
      tool("copilot", "coding-development", "code-completion"),
      categoryOnlyClusters,
    );
    expect(r.clusterAction).toBe("append_to_existing");
    if (r.clusterAction === "append_to_existing") {
      expect(r.clusterId).toBe("cl-cat");
      expect(r.matchedBy).toBe("category");
    }
  });

  it("falls through to create_new on cross-category un-matchable pairs", () => {
    // text-language tool vs audio-music tool where neither subcategory nor
    // category hits any cluster's tokens.
    const irrelevantClusters: ComparisonClusterEntry[] = [
      {
        clusterId: "cl-presentation",
        clusterName: "ai-presentation-tools-2026",
        matchTokens: new Set(["ai-presentation-tools-2026", "presentation"]),
      },
    ];
    const r = resolveComparisonCluster(
      tool("deepl", "text-language", "translation"),
      tool("elevenlabs", "audio-music", "voice-cloning"),
      irrelevantClusters,
    );
    expect(r.clusterAction).toBe("create_new");
    expect(r.clusterId).toBeNull();
    expect(r.matchedBy).toBe("none");
  });

  it("subcategory match is case-insensitive (live Toolwiki has mixed casing)", () => {
    const r = resolveComparisonCluster(
      tool("a", "Text-Language", "Chatbots-Assistants"),
      tool("b", "TEXT-LANGUAGE", "chatbots-assistants"),
      TOOLWIKI_COMPARISON_CLUSTERS,
    );
    expect(r.clusterAction).toBe("append_to_existing");
  });

  it("ignores tools with null subcategory + null category", () => {
    const r = resolveComparisonCluster(
      tool("ghost-a", null, null),
      tool("ghost-b", null, null),
      TOOLWIKI_COMPARISON_CLUSTERS,
    );
    expect(r.clusterAction).toBe("create_new");
  });
});

// ─── Toolwiki-stuck-briefs snapshot ──────────────────────────────────────────

describe("resolveComparisonCluster — 4 Toolwiki stuck briefs (Discovery 64.18 / Phase C.1 §1)", () => {
  const claude = tool("claude", "text-language", "chatbots-assistants");
  const chatgpt = tool("chatgpt", "text-language", "chatbots-assistants");
  const perplexity = tool("perplexity", "text-language", "research");
  const deepl = tool("deepl", "text-language", "translation");

  it.each([
    ["Claude vs Perplexity", claude, perplexity],
    ["ChatGPT vs Perplexity", chatgpt, perplexity],
    ["Claude vs DeepL", claude, deepl],
    ["ChatGPT vs DeepL", chatgpt, deepl],
  ])("%s routes to chatbot-comparisons-2026", (_name, a, b) => {
    const r = resolveComparisonCluster(a, b, TOOLWIKI_COMPARISON_CLUSTERS);
    expect(r.clusterAction).toBe("append_to_existing");
    if (r.clusterAction === "append_to_existing") {
      expect(r.clusterId).toBe("cl-chatbot");
    }
  });
});
