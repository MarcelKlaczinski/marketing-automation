import { describe, expect, it } from "bun:test";
import {
  buildLocaleContext,
  localeFromDomain,
} from "../../src/cold-start/_lib/locale-context.ts";

describe("buildLocaleContext", () => {
  it("single DE locale", () => {
    const ctx = buildLocaleContext(["de-DE"]);
    expect(ctx.isMultiLocale).toBe(false);
    expect(ctx.primaryLocale).toBe("de-DE");
    expect(ctx.searchEngines).toEqual(["Google.de"]);
    expect(ctx.audienceDescriptors).toEqual(["German-speaking DACH professionals"]);
    expect(ctx.locationCodes).toEqual([2276]);
    expect(ctx.languageCodes).toEqual(["de"]);
  });

  it("bilingual DE+EN locale", () => {
    const ctx = buildLocaleContext(["de-DE", "en-US"]);
    expect(ctx.isMultiLocale).toBe(true);
    expect(ctx.locales).toEqual(["de-DE", "en-US"]);
    expect(ctx.searchEngines).toEqual(["Google.de", "Google.com"]);
    expect(ctx.locationCodes).toEqual([2276, 2840]);
    expect(ctx.languageCodes).toEqual(["de", "en"]);
  });

  it("unknown locale falls back gracefully without crash", () => {
    const ctx = buildLocaleContext(["xx-XX"]);
    expect(ctx.isMultiLocale).toBe(false);
    expect(ctx.primaryLocale).toBe("xx-XX");
    expect(ctx.searchEngines).toEqual(["Google.com"]);
    expect(ctx.locationCodes).toEqual([2840]);
  });

  it("empty array falls back to en-US", () => {
    const ctx = buildLocaleContext([]);
    expect(ctx.isMultiLocale).toBe(false);
    expect(ctx.primaryLocale).toBe("en-US");
    expect(ctx.languageCodes).toEqual(["en"]);
  });

  it("en-GB locale", () => {
    const ctx = buildLocaleContext(["en-GB"]);
    expect(ctx.searchEngines).toEqual(["Google.co.uk"]);
    expect(ctx.locationCodes).toEqual([2826]);
    expect(ctx.languageCodes).toEqual(["en"]);
  });
});

describe("localeFromDomain", () => {
  const dachFallback = buildLocaleContext(["de-DE"]);
  const enFallback = buildLocaleContext(["en-US"]);

  it(".de TLD → Germany/de", () => {
    const r = localeFromDomain("ki-tools.de", dachFallback);
    expect(r).toEqual({ locationCode: 2276, languageCode: "de" });
  });

  it(".at TLD → Germany/de (DACH)", () => {
    const r = localeFromDomain("example.at", dachFallback);
    expect(r).toEqual({ locationCode: 2276, languageCode: "de" });
  });

  it(".ai TLD → USA/en", () => {
    const r = localeFromDomain("toolify.ai", dachFallback);
    expect(r).toEqual({ locationCode: 2840, languageCode: "en" });
  });

  it(".com TLD → USA/en", () => {
    const r = localeFromDomain("futurepedia.io", dachFallback);
    expect(r).toEqual({ locationCode: 2840, languageCode: "en" });
  });

  it(".co.uk TLD → UK/en", () => {
    const r = localeFromDomain("bbc.co.uk", dachFallback);
    expect(r).toEqual({ locationCode: 2826, languageCode: "en" });
  });

  it("unknown TLD falls back to project primary locale", () => {
    const r = localeFromDomain("some.xyz", dachFallback);
    expect(r).toEqual({ locationCode: 2276, languageCode: "de" });
    const r2 = localeFromDomain("some.xyz", enFallback);
    expect(r2).toEqual({ locationCode: 2840, languageCode: "en" });
  });
});
