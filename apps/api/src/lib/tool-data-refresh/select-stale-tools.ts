/**
 * Spec 65.3 Part B — staleness scan helper.
 *
 * Returns up to `limit` tool-articles whose `last_refreshed_at` is older
 * than `staleThresholdDays` (or NULL = never refreshed). Scoped to the
 * project's PRIMARY locale so bilingual sibling DE/EN tool-articles aren't
 * double-refreshed.
 *
 * Ordering: NULL-first (never-refreshed tools get priority), then oldest
 * `last_refreshed_at` ASC. The tiebreaker is `articles.id` ASC so deterministic
 * across ticks — same canonical tiebreaker idiom as the 64.20 inventory-refresh
 * helper.
 */
import {
  and,
  articles,
  asc,
  db,
  eq,
  isNull,
  lt,
  or,
  sql,
  type Article,
} from "@marketing-auto/db";

export interface SelectStaleToolsInput {
  projectId: string;
  /** Locale to filter against. Defaults to "de" (primary for Toolwiki). */
  locale: string;
  staleThresholdDays: number;
  limit: number;
}

export type StaleToolRow = Pick<
  Article,
  "id" | "title" | "slug" | "toolWebsite" | "toolPriceFrom" | "toolPricing" | "lastRefreshedAt"
>;

export async function selectStaleTools(
  input: SelectStaleToolsInput
): Promise<StaleToolRow[]> {
  const cutoff = new Date(Date.now() - input.staleThresholdDays * 24 * 60 * 60 * 1000);

  return await db
    .select({
      id: articles.id,
      title: articles.title,
      slug: articles.slug,
      toolWebsite: articles.toolWebsite,
      toolPriceFrom: articles.toolPriceFrom,
      toolPricing: articles.toolPricing,
      lastRefreshedAt: articles.lastRefreshedAt,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, input.projectId),
        eq(articles.collection, "tools"),
        eq(articles.locale, input.locale),
        // NULL-first means "never refreshed", which is the highest priority.
        or(isNull(articles.lastRefreshedAt), lt(articles.lastRefreshedAt, cutoff))
      )
    )
    // NULLS FIRST is the canonical "never-refreshed beats stale-but-once-fresh"
    // ordering — PostgreSQL defaults to NULLS LAST for ASC, so an explicit
    // modifier is required. Tiebreaker by `id` ASC for deterministic ticks.
    .orderBy(sql`${articles.lastRefreshedAt} ASC NULLS FIRST`, asc(articles.id))
    .limit(input.limit);
}
