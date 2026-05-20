// Spec 62.0a Section 5.1: canonical article-freshness definition.
//
// "Effective freshness" is the most-recent meaningful update timestamp for an article.
// Order of preference: frontmatterUpdatedAt → lastRefreshedAt → publishedAt → updatedAt.
//
// - frontmatterUpdatedAt is the Astro `updated:` frontmatter field; for imported articles
//   it is the author's real edit marker.
// - lastRefreshedAt is set by the article-refresh pipeline.
// - publishedAt is the initial publish timestamp.
// - updatedAt is the Drizzle-managed row update — often unrelated to content changes
//   (status flips, schema extensions, etc.), so it lives last in the fallback chain.
//
// Both the SQL and JS variants below produce identical values. Every consumer that
// computes "how stale is this article" — refresh-detector, /refresh-candidates,
// /discovery-counts, the weekly-budget cost-estimator — must use one of these helpers
// so the views agree.

import { articles } from "@marketing-auto/db";
import { sql, type SQL } from "drizzle-orm";

/**
 * SQL variant for use inside Drizzle queries. Returns a Date-typed expression that
 * can be compared with `lt(effectiveFreshnessSql, cutoffDate.toISOString())` or
 * interpolated into a raw `sql\`\`` template with `${cutoff.toISOString()}`.
 *
 * Cast as `SQL<Date>` so callers can pass it to typed Drizzle operators (`lt`/`gte`/`lte`).
 */
export const effectiveFreshnessSql: SQL<Date> = sql<Date>`coalesce(${articles.frontmatterUpdatedAt}, ${articles.lastRefreshedAt}, ${articles.publishedAt}, ${articles.updatedAt})`;

/**
 * JS variant — operates on an already-loaded article row. Use when iterating in memory
 * over a small set of articles (e.g. during planning); for large scans, prefer the SQL
 * variant to push the COALESCE into the database.
 */
export function effectiveFreshness(article: {
  frontmatterUpdatedAt: Date | null;
  lastRefreshedAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
}): Date {
  return (
    article.frontmatterUpdatedAt ??
    article.lastRefreshedAt ??
    article.publishedAt ??
    article.updatedAt
  );
}

/**
 * Convenience: days elapsed since the effective freshness. Useful for planning ("is this
 * article stale enough to refresh?"). Returns a fractional number (days).
 */
export function effectiveFreshnessAgeDays(
  article: {
    frontmatterUpdatedAt: Date | null;
    lastRefreshedAt: Date | null;
    publishedAt: Date | null;
    updatedAt: Date;
  },
  now: Date = new Date()
): number {
  const ts = effectiveFreshness(article).getTime();
  return (now.getTime() - ts) / (24 * 60 * 60 * 1000);
}
