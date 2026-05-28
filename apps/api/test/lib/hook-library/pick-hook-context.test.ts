/**
 * Spec 65.14 — pickHook context extension tests.
 *
 * Pure-function checks against `buildHookPickerUserMessage` — assert that
 * the new Spec-65.14 fields (`briefTopic`, `competitorTool`) and the
 * existing `dramaIntensity` per-candidate metadata land in the prompt body
 * the LLM sees. Offline, no DB.
 */
import { describe, expect, it } from "bun:test";
import type { HookTemplate } from "@marketing-auto/db";

import { buildHookPickerUserMessage } from "../../../src/lib/hook-library/pick-hook.ts";

function hookFixture(overrides: Partial<HookTemplate> = {}): HookTemplate {
  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectId: overrides.projectId ?? "11111111-1111-1111-1111-111111111111",
    formatType: overrides.formatType ?? "story_arc_clickbait",
    pattern: overrides.pattern ?? "{n} reasons {tool} replaces {profession}",
    language: overrides.language ?? "de",
    variables: overrides.variables ?? ["n", "tool", "profession"],
    dramaIntensity: overrides.dramaIntensity ?? "moderate",
    usageCount: overrides.usageCount ?? 0,
    lastUsedAt: overrides.lastUsedAt ?? null,
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
  };
}

describe("buildHookPickerUserMessage — Spec 65.14 context extension", () => {
  it("embeds briefTopic when supplied", () => {
    const out = buildHookPickerUserMessage([hookFixture()], {
      briefTopic: "career-disruption narrative featuring Claude for Texter",
      toolNames: ["Claude"],
    });
    expect(out).toContain("career-disruption narrative featuring Claude for Texter");
    expect(out).toContain("Brief topic:");
  });

  it("falls back to '(not provided)' when briefTopic is omitted", () => {
    const out = buildHookPickerUserMessage([hookFixture()], {
      toolNames: ["Claude"],
    });
    expect(out).toContain("Brief topic: (not provided)");
  });

  it("embeds competitorTool as '{established}' anchor when supplied", () => {
    const out = buildHookPickerUserMessage([hookFixture()], {
      toolNames: ["Claude"],
      competitorTool: "ChatGPT",
    });
    expect(out).toContain("ChatGPT");
    expect(out).toMatch(/Competitor.*\{established\}/);
  });

  it("falls back to '(none)' when competitorTool is omitted", () => {
    const out = buildHookPickerUserMessage([hookFixture()], {
      toolNames: ["Claude"],
    });
    expect(out).toMatch(/Competitor.*\(none\)/);
  });

  it("renders dramaIntensity per-candidate so LLM sees the tag inline", () => {
    const subtle = hookFixture({
      id: "11111111-1111-1111-1111-111111111111",
      dramaIntensity: "subtle",
      pattern: "subtle-pat",
    });
    const moderate = hookFixture({
      id: "22222222-2222-2222-2222-222222222222",
      dramaIntensity: "moderate",
      pattern: "moderate-pat",
    });
    const aggressive = hookFixture({
      id: "33333333-3333-3333-3333-333333333333",
      dramaIntensity: "aggressive",
      pattern: "aggressive-pat",
    });
    const out = buildHookPickerUserMessage([subtle, moderate, aggressive], {
      toolNames: ["Claude"],
    });
    expect(out).toContain("intensity=subtle");
    expect(out).toContain("intensity=moderate");
    expect(out).toContain("intensity=aggressive");
    expect(out).toContain("subtle-pat");
    expect(out).toContain("aggressive-pat");
  });

  it("topic-coherence-first selection rule appears in user-message", () => {
    const out = buildHookPickerUserMessage([hookFixture()], {
      toolNames: ["Claude"],
      briefTopic: "lifestyle-listicle for Solopreneur",
    });
    // Spec 65.14 §3.6 reordered selection rules so topic-coherence wins.
    expect(out).toContain("Pick by topic-coherence first");
    expect(out).toContain("tool-fit");
    expect(out).toContain("drama-pattern-match");
  });

  it("renders all candidate IDs (LLM must be able to address each)", () => {
    const a = hookFixture({ id: "11111111-1111-1111-1111-111111111111", pattern: "alpha" });
    const b = hookFixture({ id: "22222222-2222-2222-2222-222222222222", pattern: "beta" });
    const out = buildHookPickerUserMessage([a, b], { toolNames: ["X"] });
    expect(out).toContain("11111111-1111-1111-1111-111111111111");
    expect(out).toContain("22222222-2222-2222-2222-222222222222");
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });

  it("undefined contentContext → all fields render with safe defaults", () => {
    const out = buildHookPickerUserMessage([hookFixture()], undefined);
    expect(out).toContain("Brief topic: (not provided)");
    expect(out).toContain("Tools featured: (none)");
    expect(out).toContain("Profession pool: (n/a)");
    expect(out).toContain("Life area: (n/a)");
    expect(out).toMatch(/Competitor.*\(none\)/);
  });
});
