import { describe, expect, it } from "bun:test";
import { deriveSecondaryLabel } from "../src/shared/PricingChip.tsx";

describe("deriveSecondaryLabel", () => {
  it("free + 'Kostenlos' collapses to single badge", () => {
    expect(deriveSecondaryLabel("free", "Kostenlos")).toBeNull();
    expect(deriveSecondaryLabel("free", "")).toBeNull();
  });

  it("freemium prefixes 'ab N' price with 'Pro'", () => {
    expect(deriveSecondaryLabel("freemium", "ab 12 $/Mo")).toBe("Pro ab 12 $/Mo");
    expect(deriveSecondaryLabel("freemium", "ab 0€")).toBe("Pro ab 0€");
  });

  it("freemium leaves an already-disambiguated 'Pro' label alone", () => {
    expect(deriveSecondaryLabel("freemium", "Pro ab 12 $/Mo")).toBe("Pro ab 12 $/Mo");
  });

  it("freemium with empty label collapses to single badge", () => {
    expect(deriveSecondaryLabel("freemium", "")).toBeNull();
  });

  it("paid leaves 'ab N €/Mo' as-is", () => {
    expect(deriveSecondaryLabel("paid", "ab 8 $/Mo")).toBe("ab 8 $/Mo");
    expect(deriveSecondaryLabel("paid", "ab 10€/Monat")).toBe("ab 10€/Monat");
  });
});
