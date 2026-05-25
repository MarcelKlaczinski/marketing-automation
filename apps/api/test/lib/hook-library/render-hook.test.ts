/**
 * Spec 65.4 — renderHook variable-substitution unit tests.
 */
import { describe, expect, it } from "bun:test";
import { HookRenderError, renderHook } from "../../../src/lib/hook-library/render-hook.ts";

describe("renderHook (Spec 65.4)", () => {
  it("substitutes a single placeholder", () => {
    const out = renderHook("Hello {name}", { name: "Marcel" });
    expect(out).toBe("Hello Marcel");
  });

  it("substitutes multiple placeholders", () => {
    const out = renderHook(
      "Ich habe meinen {profession}-Job verloren — wegen {tool}",
      { profession: "Texter", tool: "Claude" },
    );
    expect(out).toBe("Ich habe meinen Texter-Job verloren — wegen Claude");
  });

  it("replaces every occurrence of a repeated placeholder", () => {
    const out = renderHook("{tool} und {tool} und nochmal {tool}", { tool: "Cursor" });
    expect(out).toBe("Cursor und Cursor und nochmal Cursor");
  });

  it("permits empty-string values (only undefined is an error)", () => {
    const out = renderHook("[{maybe}]", { maybe: "" });
    expect(out).toBe("[]");
  });

  it("ignores keys in the values map that the pattern doesn't reference", () => {
    const out = renderHook("{tool} rocks", { tool: "Claude", unused: "Bob" });
    expect(out).toBe("Claude rocks");
  });

  it("throws HookRenderError on missing variable, surfacing the pattern + key", () => {
    let thrown: HookRenderError | null = null;
    try {
      renderHook("Hello {missing}", {});
    } catch (e) {
      thrown = e as HookRenderError;
    }
    expect(thrown).toBeInstanceOf(HookRenderError);
    expect(thrown?.missingVariable).toBe("missing");
    expect(thrown?.pattern).toBe("Hello {missing}");
  });

  it("treats hyphens / spaces as non-variable text (only \\w+ matches)", () => {
    // {hi-there} is not a valid placeholder; should pass through verbatim.
    const out = renderHook("static {hi-there} text {ok}", { ok: "yes" });
    expect(out).toBe("static {hi-there} text yes");
  });
});
