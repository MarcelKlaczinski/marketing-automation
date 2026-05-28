/**
 * Spec 65.16 — unit tests for the NB2 prompt builder.
 *
 * Pure-function tests: no I/O, no LLM calls. Confirms:
 *   - Positive prompt contains the preset's base + texture direction
 *   - Slide-role drives the composition fragment
 *   - Anti-AI-slop phrases (global + per-preset) appear as "NOT ..." in output
 *   - Aspect-ratio hint is always present (vertical 4:5)
 *   - Hero subject anchor uses first hookContext variable when present
 *   - Empty hookContext falls back gracefully without throwing
 */
import { describe, expect, it } from "bun:test";
import {
  buildNB2Prompt,
  DEFAULT_PRESET_KEY,
  GLOBAL_AVOID_PHRASES,
  isPresetKey,
  PRESET_CATALOG,
  PRESET_KEYS,
} from "../../src/presets/index.ts";

describe("buildNB2Prompt", () => {
  const baseHook = {
    rendered: "Vergiss ChatGPT — Claude ist die Wahl der Profis",
    variables: { tool: "Claude", established: "ChatGPT" },
  };

  it("emits the preset base + texture direction in the prompt", () => {
    const result = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "cover",
      beatText: "Tech-Profi steht vor zwei Monitoren mit Code-Editor.",
      hookContext: baseHook,
    });
    const expected = PRESET_CATALOG["dark-neon-grid"];
    expect(result.prompt).toContain(expected.nb2.baseDirection);
    expect(result.prompt).toContain(expected.nb2.textureDirection);
  });

  it("varies the composition fragment by slide-role", () => {
    const cover = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "cover",
      beatText: "anything",
      hookContext: baseHook,
    });
    const conflict = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "conflict",
      beatText: "anything",
      hookContext: baseHook,
    });
    expect(cover.prompt).toContain("hero composition");
    expect(conflict.prompt).toContain("tension and contrast");
    expect(cover.prompt).not.toEqual(conflict.prompt);
  });

  it("includes all global anti-AI-slop phrases as 'NOT ...' in output", () => {
    const result = buildNB2Prompt({
      preset: "blue-tech-gradient",
      slideRole: "item",
      beatText: "Use-case demo",
      hookContext: baseHook,
    });
    for (const phrase of GLOBAL_AVOID_PHRASES) {
      expect(result.prompt).toContain(`NOT ${phrase}`);
    }
  });

  it("includes per-preset avoid phrases (dark-neon avoids pastel)", () => {
    const result = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "cover",
      beatText: "",
      hookContext: baseHook,
    });
    expect(result.prompt).toContain("NOT pastel or soft colors");
    expect(result.prompt).toContain("NOT daylight or sunny lighting");
  });

  it("includes per-preset avoid phrases (light-editorial avoids neon)", () => {
    const result = buildNB2Prompt({
      preset: "light-editorial",
      slideRole: "cover",
      beatText: "",
      hookContext: baseHook,
    });
    expect(result.prompt).toContain("NOT neon or harsh saturated colors");
    expect(result.prompt).toContain("NOT dark background or low-key lighting");
  });

  it("includes per-preset avoid phrases (blue-tech avoids purple-gradient)", () => {
    const result = buildNB2Prompt({
      preset: "blue-tech-gradient",
      slideRole: "payoff",
      beatText: "",
      hookContext: baseHook,
    });
    expect(result.prompt).toContain("NOT purple-dominant gradients");
    expect(result.prompt).toContain("NOT dark scene or low-key lighting");
  });

  it("always injects the vertical 4:5 aspect ratio hint", () => {
    for (const preset of PRESET_KEYS) {
      const result = buildNB2Prompt({
        preset,
        slideRole: "cover",
        beatText: "",
        hookContext: baseHook,
      });
      expect(result.prompt).toContain("vertical 4:5");
    }
  });

  it("anchors the scene on the first hookContext variable", () => {
    const result = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "hot-take",
      beatText: "Bold opinion about coding assistants.",
      hookContext: {
        rendered: "ignored",
        variables: { tool: "Claude" },
      },
    });
    expect(result.prompt).toContain("Subject anchor: Claude");
  });

  it("falls back to rendered hook when no variables are set", () => {
    const result = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "cover",
      beatText: "",
      hookContext: {
        rendered: "Plain manual hook",
        variables: {},
      },
    });
    expect(result.prompt).toContain("Subject anchor: Plain manual hook");
  });

  it("survives empty rendered + empty variables without throwing", () => {
    const result = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "cover",
      beatText: "",
      hookContext: { rendered: "", variables: {} },
    });
    expect(result.prompt).not.toContain("Subject anchor:");
    expect(result.prompt).toContain("vertical 4:5");
  });

  it("truncates very long beatText to a reasonable scene-context line", () => {
    const longBeat = "a".repeat(600);
    const result = buildNB2Prompt({
      preset: "dark-neon-grid",
      slideRole: "cover",
      beatText: longBeat,
      hookContext: baseHook,
    });
    // Beat block should be present but bounded — no more than ~280 chars
    // (240 cap + "Scene context: " prefix + ellipsis + ".").
    const beatLine = result.prompt
      .split("\n")
      .find((line) => line.startsWith("Scene context:"));
    expect(beatLine).toBeDefined();
    expect((beatLine ?? "").length).toBeLessThanOrEqual(280);
  });
});

describe("PRESET_CATALOG", () => {
  it("has exactly the 3 V1.6 keys", () => {
    expect(PRESET_KEYS).toEqual([
      "dark-neon-grid",
      "light-editorial",
      "blue-tech-gradient",
    ]);
    expect(Object.keys(PRESET_CATALOG).sort()).toEqual([...PRESET_KEYS].sort());
  });

  it("each preset has a display name + description + colors + typography + nb2 direction", () => {
    for (const key of PRESET_KEYS) {
      const entry = PRESET_CATALOG[key];
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.colors.textPrimary).toMatch(/^#|^oklch/);
      expect(entry.colors.textAccent).toMatch(/^#|^oklch/);
      expect(entry.typography.displayFontFamily.length).toBeGreaterThan(0);
      expect(entry.nb2.baseDirection.length).toBeGreaterThan(0);
      expect(entry.nb2.textureDirection.length).toBeGreaterThan(0);
      expect(entry.nb2.avoidPhrases.length).toBeGreaterThan(0);
    }
  });

  it("default preset key is in the catalog", () => {
    expect(PRESET_KEYS).toContain(DEFAULT_PRESET_KEY);
  });

  it("isPresetKey narrows valid + rejects invalid", () => {
    expect(isPresetKey("dark-neon-grid")).toBe(true);
    expect(isPresetKey("light-editorial")).toBe(true);
    expect(isPresetKey("not-a-preset")).toBe(false);
    expect(isPresetKey(42)).toBe(false);
    expect(isPresetKey(null)).toBe(false);
    expect(isPresetKey(undefined)).toBe(false);
  });

  it("colors are visually distinct across presets (sanity check for design-skill 'vary aesthetics')", () => {
    const surfaces = PRESET_KEYS.map((k) => PRESET_CATALOG[k].colors.emotionSurface);
    // Distinct surface colors are the cheap proxy for "presets look different".
    expect(new Set(surfaces).size).toBe(PRESET_KEYS.length);
  });
});
