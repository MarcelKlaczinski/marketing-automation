/**
 * Spec 65.V1.5b — Auto-approve resolver (pure helper).
 */
import { describe, expect, it } from "bun:test";
import { resolveAutoApprove } from "../../../src/lib/recurring-content/resolve-auto-approve.ts";

describe("resolveAutoApprove (Spec 65.V1.5b)", () => {
  it("returns project default when override is null", () => {
    expect(
      resolveAutoApprove({
        definitionAutoApproveOverride: null,
        projectRecurringAutoApproveDefault: false,
      }),
    ).toBe(false);
    expect(
      resolveAutoApprove({
        definitionAutoApproveOverride: null,
        projectRecurringAutoApproveDefault: true,
      }),
    ).toBe(true);
  });

  it("override wins over project default when set to true", () => {
    expect(
      resolveAutoApprove({
        definitionAutoApproveOverride: true,
        projectRecurringAutoApproveDefault: false,
      }),
    ).toBe(true);
  });

  it("override wins over project default when set to false", () => {
    expect(
      resolveAutoApprove({
        definitionAutoApproveOverride: false,
        projectRecurringAutoApproveDefault: true,
      }),
    ).toBe(false);
  });
});
