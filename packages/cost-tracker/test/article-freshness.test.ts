import { describe, expect, it } from "bun:test";
import { effectiveFreshness, effectiveFreshnessAgeDays } from "../src/article-freshness.ts";

const D = (iso: string) => new Date(iso);

describe("effectiveFreshness", () => {
  it("prefers frontmatterUpdatedAt over all others", () => {
    const article = {
      frontmatterUpdatedAt: D("2025-01-15T00:00:00Z"),
      lastRefreshedAt: D("2024-11-01T00:00:00Z"),
      publishedAt: D("2024-01-01T00:00:00Z"),
      updatedAt: D("2025-03-01T00:00:00Z"),
    };
    expect(effectiveFreshness(article).toISOString()).toBe("2025-01-15T00:00:00.000Z");
  });

  it("falls back to lastRefreshedAt when frontmatterUpdatedAt is null", () => {
    const article = {
      frontmatterUpdatedAt: null,
      lastRefreshedAt: D("2024-11-01T00:00:00Z"),
      publishedAt: D("2024-01-01T00:00:00Z"),
      updatedAt: D("2025-03-01T00:00:00Z"),
    };
    expect(effectiveFreshness(article).toISOString()).toBe("2024-11-01T00:00:00.000Z");
  });

  it("falls back to publishedAt when frontmatterUpdatedAt + lastRefreshedAt are null", () => {
    const article = {
      frontmatterUpdatedAt: null,
      lastRefreshedAt: null,
      publishedAt: D("2024-01-01T00:00:00Z"),
      updatedAt: D("2025-03-01T00:00:00Z"),
    };
    expect(effectiveFreshness(article).toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("falls back to updatedAt when the first three are null (e.g. unpublished draft)", () => {
    const article = {
      frontmatterUpdatedAt: null,
      lastRefreshedAt: null,
      publishedAt: null,
      updatedAt: D("2025-03-01T00:00:00Z"),
    };
    expect(effectiveFreshness(article).toISOString()).toBe("2025-03-01T00:00:00.000Z");
  });
});

describe("effectiveFreshnessAgeDays", () => {
  it("computes fractional days since the effective-freshness timestamp", () => {
    const now = D("2025-03-01T00:00:00Z");
    const article = {
      frontmatterUpdatedAt: D("2025-02-15T00:00:00Z"),
      lastRefreshedAt: null,
      publishedAt: null,
      updatedAt: D("2025-03-01T00:00:00Z"),
    };
    expect(effectiveFreshnessAgeDays(article, now)).toBe(14);
  });

  it("returns 0 when the article is updated at `now`", () => {
    const now = D("2025-03-01T00:00:00Z");
    const article = {
      frontmatterUpdatedAt: now,
      lastRefreshedAt: null,
      publishedAt: null,
      updatedAt: now,
    };
    expect(effectiveFreshnessAgeDays(article, now)).toBe(0);
  });
});
