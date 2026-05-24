/**
 * Spec 006 / F1.5: smoke tests for the bare-slug emission contract in the
 * inventory generator + downstream forecast diff.
 *
 * The inventory generator (`generate-repo-inventory.ts`) emits bare slugs
 * for `noLocaleSplit` collections (the `categories` collection in Toolwiki).
 * Pre-fix the generator preserved subdirectory prefixes (`blog/comparisons`
 * etc.), producing 31 inserts + 30 dbOnly when diffed against a DB that
 * stores 30 bare slugs. This test file covers:
 *
 * 1. Bare-slug match works — 30 unique repo slugs vs 30 DB slugs → 0 inserts,
 *    0 dbOnly (the post-fix expectation against unchanged repo state).
 * 2. Scope collision dedup — when two physical files share a bare slug
 *    across scopes (e.g. `blog/ethics-law` and `knowledge/ethics-law`), the
 *    repo emits the slug twice but `computeForecastDiff` deduplicates via
 *    `new Set`, so the diff matches against a single DB row.
 * 3. Regression repro — the pre-fix path-prefix slugs (`blog/comparisons`)
 *    against the bare-slug DB rows produces the broken counts the spec
 *    diagnosed. This locks down the diff behaviour as the contract we rely
 *    on for the fix to be observable.
 *
 * Both the generator helpers and the forecast diff are pure — no DB or
 * filesystem dependency.
 */

import { describe, expect, it } from "bun:test";
import {
  bareSlugFromPath,
  scopeFromPath,
} from "../../src/scripts/discovery/generate-repo-inventory.ts";
import {
  type DbInventoryRow,
  type RepoCollectionInventory,
  computeForecastDiff,
} from "../../src/scripts/discovery/forecast-re-import-state.ts";

describe("generate-repo-inventory — slug + scope derivation (Spec 006 F1.5)", () => {
  it("bareSlugFromPath strips subdirectory prefix and .md extension", () => {
    expect(
      bareSlugFromPath("src/content/categories/blog/comparisons.md"),
    ).toBe("comparisons");
    expect(
      bareSlugFromPath("src/content/categories/knowledge/ethics-law.md"),
    ).toBe("ethics-law");
    // Direct child (no scope subdir) — still bare.
    expect(bareSlugFromPath("src/content/blog/de/my-article.mdx")).toBe(
      "my-article",
    );
  });

  it("scopeFromPath extracts the scope subdir between root and file", () => {
    expect(
      scopeFromPath(
        "src/content/categories",
        "src/content/categories/blog/comparisons.md",
      ),
    ).toBe("blog");
    expect(
      scopeFromPath(
        "src/content/categories",
        "src/content/categories/knowledge/ethics-law.md",
      ),
    ).toBe("knowledge");
    // File sits directly under root → no scope.
    expect(
      scopeFromPath("src/content/categories", "src/content/categories/flat.md"),
    ).toBeNull();
    // Trailing slash on root is tolerated.
    expect(
      scopeFromPath(
        "src/content/categories/",
        "src/content/categories/tool/research.md",
      ),
    ).toBe("tool");
  });
});

describe("forecast — categories bare-slug matching (Spec 006 F1.5)", () => {
  // ── Test 1: post-fix happy path ────────────────────────────────────────
  it("matches 30 bare repo slugs against 30 DB rows with 0 inserts + 0 dbOnly", () => {
    const slugs = [
      "ai-agents",
      "audio-music",
      "avatar-voice",
      "business-productivity",
      "chatbots-assistants",
      "code-assistants",
      "coding-development",
      "comparisons",
      "content-creation",
      "ethics-law",
      "fundamentals",
      "future",
      "guides-tutorials",
      "image-generation",
      "images-graphics",
      "knowledge-management",
      "marketing-seo",
      "music-generation",
      "practice",
      "practice-use-cases",
      "presentation",
      "research",
      "technology",
      "text-language",
      "tool-reviews",
      "translation",
      "trends-future",
      "video-animation",
      "video-generation",
      "voice-synthesis",
    ];
    const repo: RepoCollectionInventory[] = [
      {
        collection: "categories",
        totalFiles: 30,
        byLocale: {},
        noLocaleSplit: { count: 30, slugs },
      },
    ];
    const dbRows: DbInventoryRow[] = [
      {
        collection: "categories",
        locale: "de",
        source: "imported",
        count: 30,
        slugs,
      },
    ];

    const { perLocaleDiffs, summary } = computeForecastDiff(repo, dbRows);

    expect(perLocaleDiffs).toHaveLength(1);
    expect(perLocaleDiffs[0]?.collection).toBe("categories");
    expect(perLocaleDiffs[0]?.locale).toBeNull();
    expect(perLocaleDiffs[0]?.repoSlugCount).toBe(30);
    expect(perLocaleDiffs[0]?.dbActiveCount).toBe(30);
    expect(perLocaleDiffs[0]?.inserts).toEqual([]);
    expect(perLocaleDiffs[0]?.updates).toHaveLength(30);
    expect(perLocaleDiffs[0]?.dbOnly).toEqual([]);
    expect(summary.totalInserts).toBe(0);
    expect(summary.totalDbOnly).toBe(0);
  });

  // ── Test 2: scope-collision dedup ──────────────────────────────────────
  it("deduplicates repeated bare slug across scopes (ethics-law in two scopes)", () => {
    // The generator emits ALL physical files even when bare slugs collide —
    // Toolwiki has `categories/blog/ethics-law.md` AND `categories/knowledge/
    // ethics-law.md`, so `slugs` contains "ethics-law" twice. The DB only
    // has one row (importer's silent overwrite via unique-key collision —
    // tracked as a separate footgun in the backlog). `computeForecastDiff`
    // dedupes via `new Set` so this still counts as a match, not as an
    // extra DB-only row.
    const repo: RepoCollectionInventory[] = [
      {
        collection: "categories",
        totalFiles: 3,
        byLocale: {},
        noLocaleSplit: {
          count: 3,
          slugs: ["comparisons", "ethics-law", "ethics-law"],
          scopes: { comparisons: "blog", "ethics-law": "knowledge" },
        },
      },
    ];
    const dbRows: DbInventoryRow[] = [
      {
        collection: "categories",
        locale: "de",
        source: "imported",
        count: 2,
        // Only one ethics-law survives the importer's UPSERT — see the
        // discovery note in docs/discovery/f15-categories-slug-format-codeRead.md.
        slugs: ["comparisons", "ethics-law"],
      },
    ];

    const { perLocaleDiffs, summary } = computeForecastDiff(repo, dbRows);

    expect(perLocaleDiffs).toHaveLength(1);
    expect(perLocaleDiffs[0]?.repoSlugCount).toBe(2); // dedup
    expect(perLocaleDiffs[0]?.dbActiveCount).toBe(2);
    expect(perLocaleDiffs[0]?.inserts).toEqual([]);
    expect(perLocaleDiffs[0]?.updates.sort()).toEqual([
      "comparisons",
      "ethics-law",
    ]);
    expect(perLocaleDiffs[0]?.dbOnly).toEqual([]);
    expect(summary.totalInserts).toBe(0);
    expect(summary.totalDbOnly).toBe(0);
  });

  // ── Test 3: regression repro of the pre-fix path-prefix bug ────────────
  it("regression: pre-fix path-prefix slugs produce all-inserts + all-dbOnly", () => {
    // This test simulates the broken pre-fix state: the generator emits
    // path-prefixed slugs ("blog/comparisons", "knowledge/fundamentals"
    // etc.) while DB has bare slugs ("comparisons", "fundamentals"). The
    // diff treats the path-prefixed strings as unrecognized → all reported
    // as inserts, and all DB slugs reported as dbOnly. This locks down the
    // bug shape so we can recognize it if it ever resurfaces.
    const repo: RepoCollectionInventory[] = [
      {
        collection: "categories",
        totalFiles: 3,
        byLocale: {},
        noLocaleSplit: {
          count: 3,
          slugs: [
            "blog/comparisons",
            "knowledge/fundamentals",
            "tool/ai-agents",
          ],
        },
      },
    ];
    const dbRows: DbInventoryRow[] = [
      {
        collection: "categories",
        locale: "de",
        source: "imported",
        count: 3,
        slugs: ["comparisons", "fundamentals", "ai-agents"],
      },
    ];

    const { perLocaleDiffs, summary } = computeForecastDiff(repo, dbRows);

    expect(perLocaleDiffs).toHaveLength(1);
    expect(perLocaleDiffs[0]?.inserts.sort()).toEqual([
      "blog/comparisons",
      "knowledge/fundamentals",
      "tool/ai-agents",
    ]);
    expect(perLocaleDiffs[0]?.dbOnly.sort()).toEqual([
      "ai-agents",
      "comparisons",
      "fundamentals",
    ]);
    expect(perLocaleDiffs[0]?.updates).toEqual([]);
    expect(summary.totalInserts).toBe(3);
    expect(summary.totalDbOnly).toBe(3);
    expect(summary.totalUpdates).toBe(0);
  });
});
