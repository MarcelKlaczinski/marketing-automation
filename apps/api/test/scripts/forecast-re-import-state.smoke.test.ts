/**
 * Spec 004 / F1: smoke tests for the noLocaleSplit matching rule in
 * `computeForecastDiff`.
 *
 * The forecast script reads `repo-inventory.json` (committed Astro snapshot)
 * and diffs it against the live DB. For `byLocale`-collections (blog,
 * authors, tools, etc.) the match is per-locale. For `noLocaleSplit`-
 * collections (today: `categories`) the match must ignore the DB `locale`
 * column entirely — the importer writes those rows with `locale='de'` even
 * though the Astro repo has no locale split, so a strict `locale IS NULL`
 * match (the pre-fix behaviour) would always classify them as new inserts.
 *
 * No DB / network — `computeForecastDiff` is pure.
 */

import { describe, expect, it } from "bun:test";
import {
  type DbInventoryRow,
  type RepoCollectionInventory,
  computeForecastDiff,
} from "../../src/scripts/discovery/forecast-re-import-state.ts";

describe("forecast-re-import-state — noLocaleSplit matching (Spec 004 F1)", () => {
  // ── Test 1: categories with locale='de' is recognized as known ─────────
  it("matches a noLocaleSplit collection against DB rows that have locale='de'", () => {
    const repo: RepoCollectionInventory[] = [
      {
        collection: "categories",
        totalFiles: 3,
        noLocaleSplit: {
          count: 3,
          slugs: ["fundamentals", "guides-tutorials", "ethics-law"],
        },
      },
    ];
    const dbRows: DbInventoryRow[] = [
      // Importer wrote these as locale='de' even though Astro has no locale
      // split. Pre-fix the script looked for locale=NULL and saw 0 matches →
      // all 3 reported as inserts.
      {
        collection: "categories",
        locale: "de",
        source: "imported",
        count: 3,
        slugs: ["fundamentals", "guides-tutorials", "ethics-law"],
      },
    ];

    const { perLocaleDiffs, summary } = computeForecastDiff(repo, dbRows);

    expect(perLocaleDiffs).toHaveLength(1);
    const diff = perLocaleDiffs[0];
    expect(diff?.collection).toBe("categories");
    expect(diff?.locale).toBeNull();
    expect(diff?.repoSlugCount).toBe(3);
    expect(diff?.dbActiveCount).toBe(3);
    expect(diff?.inserts).toEqual([]);
    expect(diff?.updates.sort()).toEqual(
      ["ethics-law", "fundamentals", "guides-tutorials"].sort(),
    );
    expect(diff?.dbOnly).toEqual([]);

    // Summary mirrors per-locale.
    expect(summary.totalInserts).toBe(0);
    expect(summary.totalUpdates).toBe(3);
    expect(summary.perCollection.categories).toEqual({
      inserts: 0,
      updates: 3,
      dbOnly: 0,
    });
  });

  // ── Test 2: byLocale still respects the locale filter ──────────────────
  it("byLocale collection still diff's per locale (regression guard)", () => {
    const repo: RepoCollectionInventory[] = [
      {
        collection: "blog",
        totalFiles: 4,
        byLocale: {
          de: { count: 2, slugs: ["de-1", "de-2"] },
          en: { count: 2, slugs: ["en-1", "en-2"] },
        },
      },
    ];
    const dbRows: DbInventoryRow[] = [
      {
        collection: "blog",
        locale: "de",
        source: "imported",
        count: 2,
        slugs: ["de-1", "de-2"],
      },
      {
        collection: "blog",
        locale: "en",
        source: "imported",
        count: 1,
        // en-2 missing → 1 insert expected for EN
        slugs: ["en-1"],
      },
    ];

    const { perLocaleDiffs, summary } = computeForecastDiff(repo, dbRows);

    // Two diffs — one per locale.
    expect(perLocaleDiffs).toHaveLength(2);
    const de = perLocaleDiffs.find((d) => d.locale === "de");
    const en = perLocaleDiffs.find((d) => d.locale === "en");

    expect(de?.inserts).toEqual([]);
    expect(de?.updates.sort()).toEqual(["de-1", "de-2"]);

    // EN side: en-2 in repo but not in DB → new insert.
    expect(en?.inserts).toEqual(["en-2"]);
    expect(en?.updates).toEqual(["en-1"]);

    // Cross-locale leakage check: DE rows in DB MUST NOT count as updates
    // for EN, even though `_any_locale` includes them. The `byLocale` path
    // looks up the per-locale key, not `_any_locale`.
    expect(en?.dbActiveCount).toBe(1);

    expect(summary.totalInserts).toBe(1);
    expect(summary.totalUpdates).toBe(3);
  });

  // ── Test 3a: empty byLocale + noLocaleSplit (real inventory shape) ─────
  it("falls through empty byLocale={} into noLocaleSplit (matches repo-inventory.json shape)", () => {
    // The repo-inventory.json generator emits `byLocale: {}` alongside the
    // populated `noLocaleSplit` block. Pre-fix, the truthy check on `{}`
    // short-circuited the entry into the per-locale branch with zero
    // Object.entries iterations, and the diff for `categories` was silently
    // missing from the report (no perLocaleDiffs entry, no perCollection
    // summary entry). This test locks that down.
    const repo: RepoCollectionInventory[] = [
      {
        collection: "categories",
        totalFiles: 2,
        byLocale: {}, // ← the footgun shape
        noLocaleSplit: { count: 2, slugs: ["alpha", "beta"] },
      },
    ];
    const dbRows: DbInventoryRow[] = [
      {
        collection: "categories",
        locale: "de",
        source: "imported",
        count: 1,
        slugs: ["alpha"],
      },
    ];

    const { perLocaleDiffs, summary } = computeForecastDiff(repo, dbRows);

    expect(perLocaleDiffs).toHaveLength(1);
    expect(perLocaleDiffs[0]?.collection).toBe("categories");
    expect(perLocaleDiffs[0]?.locale).toBeNull();
    expect(perLocaleDiffs[0]?.updates).toEqual(["alpha"]);
    expect(perLocaleDiffs[0]?.inserts).toEqual(["beta"]);
    expect(summary.perCollection.categories).toEqual({
      inserts: 1,
      updates: 1,
      dbOnly: 0,
    });
  });

  // ── Test 3: mixed — both collection types in one run ───────────────────
  it("mixes byLocale and noLocaleSplit collections in one forecast", () => {
    const repo: RepoCollectionInventory[] = [
      {
        collection: "blog",
        totalFiles: 2,
        byLocale: {
          de: { count: 1, slugs: ["blog-de"] },
          en: { count: 1, slugs: ["blog-en"] },
        },
      },
      {
        collection: "categories",
        totalFiles: 2,
        noLocaleSplit: {
          count: 2,
          // One present in DB (matches under any locale), one new.
          slugs: ["fundamentals", "new-category"],
        },
      },
    ];
    const dbRows: DbInventoryRow[] = [
      // Blog rows per locale.
      {
        collection: "blog",
        locale: "de",
        source: "imported",
        count: 1,
        slugs: ["blog-de"],
      },
      {
        collection: "blog",
        locale: "en",
        source: "imported",
        count: 1,
        slugs: ["blog-en"],
      },
      // Categories row written with locale='de' by importer.
      {
        collection: "categories",
        locale: "de",
        source: "imported",
        count: 1,
        slugs: ["fundamentals"],
      },
    ];

    const { perLocaleDiffs, summary } = computeForecastDiff(repo, dbRows);

    expect(perLocaleDiffs).toHaveLength(3); // blog DE + blog EN + categories
    const cats = perLocaleDiffs.find((d) => d.collection === "categories");
    expect(cats?.locale).toBeNull();
    expect(cats?.inserts).toEqual(["new-category"]);
    expect(cats?.updates).toEqual(["fundamentals"]);
    expect(cats?.dbActiveCount).toBe(1);

    // Summary aggregates across both collections.
    expect(summary.totalInserts).toBe(1); // new-category
    expect(summary.totalUpdates).toBe(3); // blog-de, blog-en, fundamentals
    expect(summary.perCollection.categories).toEqual({
      inserts: 1,
      updates: 1,
      dbOnly: 0,
    });
    expect(summary.perCollection.blog).toEqual({
      inserts: 0,
      updates: 2,
      dbOnly: 0,
    });
  });
});
