/**
 * Unit tests for the hook-engine in ExtractToolsStep (Spec 51a).
 *
 * Tests the anti-hype guard logic, pattern selection, and schema validation
 * without making real LLM calls.
 *
 * Structure:
 *   1. Anti-hype guard — forbidden words + ALL-CAPS detection
 *   2. Hook schema validation — valid/invalid patterns and fields
 *   3. Fallback hook — Number-Promise programmatic fallback when LLM fails
 *   4. End-closer schema validation
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";

// ─── Inline the validateHook logic for unit testing ───────────────────────────
// The function is module-private in steps.ts; we re-declare it here to test
// the exact same rules without importing private code.
// Uses word-boundary patterns so German "besten" does not trip "best".

const FORBIDDEN_HOOK_PATTERNS: RegExp[] = [
  /\bbest\b/i,
  /beste!/i,
  /!!!/,
  /\bkiller\b/i,
  /\bultimate\b/i,
  /\brevolutionary\b/i,
  /\brevolutionär\b/i,
  /mind-blowing/i,
  /game-changer/i,
  /\bsensation\b/i,
  /\bunbelievable\b/i,
  /must-have/i,
  /\babsolute\b/i,
  /\bcrazy\b/i,
  /\binsane\b/i,
];

function validateHook(lead: string, trail: string): boolean {
  const combined = `${lead} ${trail}`;
  for (const pattern of FORBIDDEN_HOOK_PATTERNS) {
    if (pattern.test(combined)) return false;
  }
  if (/[A-Z]{4,}/.test(lead) || /[A-Z]{4,}/.test(trail)) return false;
  return true;
}

// ─── Inline hook schema (mirrors steps.ts coverHookSchema) ───────────────────

const coverHookSchema = z.object({
  pattern: z.enum(["comparison", "number-promise", "insider-reveal", "problem-recognition", "save-promise"]),
  hookLead: z.string().max(80),
  hookTrail: z.string().max(50),
  hookEmphasisWord: z.string().max(30),
  saveTriggerIntensity: z.enum(["low", "medium", "high"]),
});

const endCloserSchema = z.object({
  pattern: z.enum(["question", "cta", "save-reminder"]),
  headlineLead: z.string().max(60),
  headlineTrail: z.string().max(60),
  headlineEmphasis: z.string().max(30).optional(),
});

// ─── Programmatic fallback builder (mirrors the steps.ts fallback) ───────────

function buildFallbackHook(tools: Array<{ name: string }>, toolCount: number) {
  return {
    pattern: "number-promise" as const,
    hookLead: `Die ${toolCount} besten`,
    hookTrail: `${tools[0]?.name ?? "KI"}-Tools im Vergleich.`,
    hookEmphasisWord: String(toolCount),
    saveTriggerIntensity: "medium" as const,
  };
}

// ---------------------------------------------------------------------------
// 1. Anti-hype guard — forbidden words
// ---------------------------------------------------------------------------

describe("validateHook — forbidden word detection", () => {
  it("accepts a clean comparison hook", () => {
    expect(validateHook("Recraft oder Ideogram?", "Eines kann mehr.")).toBe(true);
  });

  it("accepts a clean number-promise hook", () => {
    expect(validateHook("Die 3 besten", "Bild-KIs 2026.")).toBe(true);
  });

  it("accepts a clean save-promise hook", () => {
    expect(validateHook("Speichere das:", "Die besten Bild-KIs.")).toBe(true);
  });

  it("rejects a hook containing 'ultimate'", () => {
    expect(validateHook("The ultimate", "AI tool list.")).toBe(false);
  });

  it("rejects a hook containing 'killer'", () => {
    expect(validateHook("Die 3 Killer-Tools", "die alles ersetzen.")).toBe(false);
  });

  it("rejects a hook containing 'mind-blowing'", () => {
    expect(validateHook("Mind-blowing results", "from these 3 tools.")).toBe(false);
  });

  it("rejects a hook containing 'game-changer'", () => {
    expect(validateHook("This is a game-changer", "for designers.")).toBe(false);
  });

  it("rejects a hook containing 'revolutionary'", () => {
    expect(validateHook("Revolutionary approach", "to image gen.")).toBe(false);
  });

  it("rejects a hook containing 'unbelievable'", () => {
    expect(validateHook("Unbelievable tools", "you need to try.")).toBe(false);
  });

  it("rejects a hook containing 'insane'", () => {
    expect(validateHook("Insane quality", "from this tool.")).toBe(false);
  });

  it("is case-insensitive for forbidden word matching", () => {
    expect(validateHook("KILLER features", "in this release.")).toBe(false);
    expect(validateHook("Killer features", "in this release.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Anti-hype guard — ALL-CAPS detection
// ---------------------------------------------------------------------------

describe("validateHook — ALL-CAPS detection", () => {
  it("accepts normal mixed-case lead", () => {
    expect(validateHook("Recraft oder Ideogram?", "Eines kann mehr.")).toBe(true);
  });

  it("rejects lead with a 4+ character ALL-CAPS sequence", () => {
    expect(validateHook("BEST tools ever", "try them now.")).toBe(false);
  });

  it("rejects trail with a 4+ character ALL-CAPS sequence", () => {
    expect(validateHook("Die 3 besten", "MUST HAVE tools.")).toBe(false);
  });

  it("accepts abbreviations of 3 chars or less (e.g. KI, AI)", () => {
    // "KI" is 2 chars — fine. "AI" is 2 chars — fine.
    expect(validateHook("Die 3 besten KI-Tools", "AI tools 2026.")).toBe(true);
  });

  it("rejects if lead has 4+ consecutive uppercase letters", () => {
    // "ALLE" is 4 chars — rejected
    expect(validateHook("ALLE Tools im Vergleich", "hier erklärt.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Hook schema validation
// ---------------------------------------------------------------------------

describe("coverHookSchema — valid and invalid inputs", () => {
  const validHook = {
    pattern: "comparison" as const,
    hookLead: "Recraft oder Ideogram?",
    hookTrail: "Eines kann mehr.",
    hookEmphasisWord: "mehr",
    saveTriggerIntensity: "medium" as const,
  };

  it("accepts a valid comparison hook", () => {
    expect(coverHookSchema.safeParse(validHook).success).toBe(true);
  });

  it("accepts all 5 valid patterns", () => {
    const patterns = ["comparison", "number-promise", "insider-reveal", "problem-recognition", "save-promise"] as const;
    for (const pattern of patterns) {
      expect(coverHookSchema.safeParse({ ...validHook, pattern }).success).toBe(true);
    }
  });

  it("rejects an invalid pattern", () => {
    expect(coverHookSchema.safeParse({ ...validHook, pattern: "viral-bait" }).success).toBe(false);
  });

  it("rejects invalid saveTriggerIntensity", () => {
    expect(coverHookSchema.safeParse({ ...validHook, saveTriggerIntensity: "extreme" }).success).toBe(false);
  });

  it("rejects hookLead exceeding max length of 80 chars", () => {
    const long = "A".repeat(81);
    expect(coverHookSchema.safeParse({ ...validHook, hookLead: long }).success).toBe(false);
  });

  it("rejects hookTrail exceeding max length of 50 chars", () => {
    const long = "A".repeat(51);
    expect(coverHookSchema.safeParse({ ...validHook, hookTrail: long }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Programmatic fallback — Number-Promise
// ---------------------------------------------------------------------------

describe("buildFallbackHook — Number-Promise programmatic fallback", () => {
  const tools = [{ name: "Recraft" }, { name: "Ideogram" }, { name: "Midjourney" }];

  it("produces a valid Number-Promise hook", () => {
    const hook = buildFallbackHook(tools, tools.length);
    const parsed = coverHookSchema.safeParse(hook);
    expect(parsed.success).toBe(true);
  });

  it("uses 'number-promise' as pattern", () => {
    const hook = buildFallbackHook(tools, tools.length);
    expect(hook.pattern).toBe("number-promise");
  });

  it("uses tool count as emphasis word", () => {
    const hook = buildFallbackHook(tools, 5);
    expect(hook.hookEmphasisWord).toBe("5");
  });

  it("uses first tool name in trail", () => {
    const hook = buildFallbackHook(tools, tools.length);
    expect(hook.hookTrail).toContain("Recraft");
  });

  it("passes anti-hype validation", () => {
    const hook = buildFallbackHook(tools, tools.length);
    expect(validateHook(hook.hookLead, hook.hookTrail)).toBe(true);
  });

  it("handles empty tool list gracefully (falls back to 'KI')", () => {
    const hook = buildFallbackHook([], 0);
    expect(hook.hookTrail).toContain("KI");
  });
});

// ---------------------------------------------------------------------------
// 5. End-closer schema validation
// ---------------------------------------------------------------------------

describe("endCloserSchema — valid and invalid inputs", () => {
  const validCloser = {
    pattern: "question" as const,
    headlineLead: "Welches Tool nutzt du?",
    headlineTrail: "Schreib's in die Kommentare.",
  };

  it("accepts a valid question closer", () => {
    expect(endCloserSchema.safeParse(validCloser).success).toBe(true);
  });

  it("accepts all 3 valid patterns", () => {
    const patterns = ["question", "cta", "save-reminder"] as const;
    for (const pattern of patterns) {
      expect(endCloserSchema.safeParse({ ...validCloser, pattern }).success).toBe(true);
    }
  });

  it("accepts optional headlineEmphasis", () => {
    expect(endCloserSchema.safeParse({ ...validCloser, headlineEmphasis: "Kommentare" }).success).toBe(true);
  });

  it("rejects an invalid pattern", () => {
    expect(endCloserSchema.safeParse({ ...validCloser, pattern: "spam-me" }).success).toBe(false);
  });

  it("rejects headlineLead exceeding 60 chars", () => {
    expect(endCloserSchema.safeParse({ ...validCloser, headlineLead: "A".repeat(61) }).success).toBe(false);
  });

  it("rejects headlineTrail exceeding 60 chars", () => {
    expect(endCloserSchema.safeParse({ ...validCloser, headlineTrail: "A".repeat(61) }).success).toBe(false);
  });
});
