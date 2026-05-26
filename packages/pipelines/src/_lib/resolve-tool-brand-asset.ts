/**
 * Spec 65.V1.5a Bridge #1 — Engine reads `tool_brand_assets` from DB.
 *
 * Marcel-edits in the Settings-UI Brand-Assets page write to
 * `tool_brand_assets` (canonical tool-scoped surface from Spec 65.2). Before
 * this bridge, the Engine only consumed `project_brand_assets` (project-scoped
 * cache populated by `resolveToolIcon`'s chain walk) — so Marcel could change a
 * primary color or swap a logo and renders kept showing the old chain output.
 *
 * This module is a thin "DB-first read, chain fallback, 60s TTL cache" layer
 * that sits in FRONT of the existing `resolveToolIcon` flow. The function
 * returns `null` when no usable row exists, so callers fall through to the
 * legacy chain on miss.
 *
 * Cache strategy (Marcel-Decision 65.V1.5a §0): in-process Map keyed by
 * `${projectId}:${slug}`, TTL = 60s. No Redis pub/sub — render workers
 * re-fetch independently and the worst staleness is 60s, which is invisible
 * for an editing surface used <1×/day in practice. Per-API-process scope is
 * fine because each worker independently maintains its own cache.
 *
 * Per-locale rows (Spec 65.V1.5a Bridge #2 / migration 0122): we look up the
 * `articles` row by `(project_id, collection='tools', slug)` and take the
 * FIRST match (any locale). Since Bridge #2 backfilled identical logo + color
 * data into both DE and EN rows, the locale doesn't matter for resolution.
 * `tool_brand_assets.tool_id` is keyed on `articles.id` (per-locale), so the
 * Marcel-edit on the DE row stays in sync with the EN row only because the
 * edit-API can write to both siblings — the Settings UI currently edits the
 * DE row only, which means an EN-side Marcel-edit drift is a known V1.5
 * limitation. Acceptable: Marcel edits in one place and both renders update.
 */
import { and, articles, asc, db, eq, toolBrandAssets } from "@marketing-auto/db";
import type { ToolBrandAsset } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import type { ResolvedIcon } from "./resolve-tool-icon.ts";

const log = createLogger("resolve-tool-brand-asset");

/** 60s per Marcel-Decision §0 — short enough to feel like "live edits", long
 * enough to absorb hot-loop reads across a multi-slide render. */
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  /** `null` means DB miss (no row, or row has no `logo_url`). */
  resolved: ResolvedIcon | null;
  cachedAt: number;
}

/** Per-process cache. `(projectId, slug)` is unique under the
 * `tool_brand_assets.tool_id → articles.id` PK chain because we always
 * resolve `slug → first matching article` deterministically by locale-arbitrary
 * order. */
const cache = new Map<string, CacheEntry>();

/**
 * SVG-content cache — R2 URLs are stable (key = `<slug>/tool-brand-assets/
 * <toolId>.svg`), so the content can change in place when Marcel re-uploads.
 * Bound this cache by the same 60s TTL so a re-upload becomes effective inside
 * the same window as a DB-row edit. Without this layer, a hot render loop
 * would HTTP-fetch the SVG on every cache-miss tick.
 */
interface SvgCacheEntry {
  svg: string;
  cachedAt: number;
}
const svgCache = new Map<string, SvgCacheEntry>();

/** Allow tests to drop both caches between cases — TTL-based eviction is
 * non-deterministic across the same process unless we expose this. */
export function clearToolBrandAssetCacheForTesting(): void {
  cache.clear();
  svgCache.clear();
}

/**
 * Look up the per-tool brand asset row for `(projectId, slug)` and return it
 * shaped as a `ResolvedIcon`. Returns `null` when no usable row exists, so the
 * caller (`resolveToolIcon`) falls through to the chain.
 *
 * Side-effects: caches the resolution for 60s; on R2 fetch failure the cache
 * stores `null` so subsequent calls inside the TTL window still fall through
 * fast (no hot-loop retry storm).
 */
export async function resolveToolBrandAsset(
  projectId: string,
  slug: string,
): Promise<ResolvedIcon | null> {
  const cacheKey = `${projectId}:${slug}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.resolved;
  }

  // Bridge #2 (migration 0122) backfilled identical brand-asset data into BOTH
  // DE and EN sibling rows, so functionally either locale is fine. Order
  // deterministically anyway so two parallel renders of the same slug never
  // disagree on which sibling row they read (root CLAUDE.md "cursor-pagination-
  // style tiebreaker" / Spec 64.20 deterministic-ordering rule). `locale ASC`
  // makes DE win when both exist (DE-canonical Toolwiki convention).
  const rows = await db
    .select({ ba: toolBrandAssets })
    .from(toolBrandAssets)
    .innerJoin(articles, eq(articles.id, toolBrandAssets.toolId))
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.slug, slug),
      ),
    )
    .orderBy(asc(articles.locale), asc(articles.id))
    .limit(1);

  const row: ToolBrandAsset | undefined = rows[0]?.ba;
  if (!row || !row.logoUrl) {
    // Cache the negative result so the next cache-miss tick (within TTL)
    // skips the DB roundtrip and falls through to the chain immediately.
    cache.set(cacheKey, { resolved: null, cachedAt: Date.now() });
    return null;
  }

  const svg = await fetchSvgContentCached(row.logoUrl);
  if (!svg) {
    // Row exists but R2 fetch failed — treat as a miss so the chain rescues
    // the render. Avoid caching a long-lived negative here in case R2 recovers.
    cache.set(cacheKey, { resolved: null, cachedAt: Date.now() });
    return null;
  }

  const resolved: ResolvedIcon = {
    type: "svg",
    svg,
    source: row.source,
    sourceRef: row.brandNameCanonical ?? slug,
    ...(row.primaryColor !== null && row.primaryColor !== undefined
      ? { brandColor: row.primaryColor }
      : {}),
    ...(buildAdditionalBrandColors(row).length > 0
      ? { additionalBrandColors: buildAdditionalBrandColors(row) }
      : {}),
    // Wordmark is a separate R2 URL — only inline if we can fetch it cheaply.
    // V1.5: skip the wordmark fetch and let the chain populate it via
    // `project_brand_assets` instead (already wired).
  };

  cache.set(cacheKey, { resolved, cachedAt: Date.now() });
  return resolved;
}

/** Secondary + tertiary colors → ordered array of distinct hex values that
 * mirrors the existing `ResolvedIcon.additionalBrandColors` contract. Filters
 * out null/duplicate-of-primary so consumers don't need defensive cleanup. */
function buildAdditionalBrandColors(row: ToolBrandAsset): string[] {
  const out: string[] = [];
  if (row.secondaryColor && row.secondaryColor !== row.primaryColor) {
    out.push(row.secondaryColor);
  }
  if (
    row.tertiaryColor &&
    row.tertiaryColor !== row.primaryColor &&
    row.tertiaryColor !== row.secondaryColor
  ) {
    out.push(row.tertiaryColor);
  }
  return out;
}

async function fetchSvgContentCached(url: string): Promise<string | null> {
  const cached = svgCache.get(url);
  if (cached !== undefined && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.svg;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn({ url, status: res.status }, "R2 fetch failed — falling through to chain");
      return null;
    }
    const svg = await res.text();
    if (!svg.trimStart().startsWith("<")) {
      // Defensive: R2 returned non-SVG content (e.g. an error page). Treat as
      // miss so the chain rescues the render.
      log.warn({ url }, "R2 returned non-SVG content");
      return null;
    }
    svgCache.set(url, { svg, cachedAt: Date.now() });
    return svg;
  } catch (err) {
    log.warn({ url, err: err instanceof Error ? err.message : String(err) }, "R2 fetch threw");
    return null;
  }
}
