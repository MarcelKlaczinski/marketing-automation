import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "../client.ts";
import { articles } from "../schema/content.ts";

type Locale = "de" | "en";
type Article = typeof articles.$inferSelect;

export async function resolveToolBySlug(
  projectId: string,
  slug: string,
  locale: Locale,
): Promise<Article | null> {
  const result = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.slug, slug),
        eq(articles.locale, locale),
      ),
    )
    .limit(1);
  return result[0] ?? null;
}

export async function resolveAuthorBySlug(
  projectId: string,
  slug: string,
  locale: Locale,
): Promise<{
  slug: string;
  name: string;
  jobTitle: string | null;
  description: string | null;
  expertise: string[];
  image: string | null;
  yearsExperience: number | null;
} | null> {
  const result = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "authors"),
        eq(articles.slug, slug),
        eq(articles.locale, locale),
      ),
    )
    .limit(1);

  const row = result[0];
  if (!row) return null;

  const extras = (row.domainExtras ?? {}) as Record<string, unknown>;
  return {
    slug: row.slug,
    name: row.title ?? String(extras.name ?? ""),
    jobTitle: typeof extras.jobTitle === "string" ? extras.jobTitle : null,
    description: row.metaDescription,
    expertise: Array.isArray(extras.expertise)
      ? extras.expertise.filter((h): h is string => typeof h === "string")
      : [],
    image: typeof extras.image === "string" ? extras.image : null,
    yearsExperience: typeof extras.yearsExperience === "number" ? extras.yearsExperience : null,
  };
}

export async function getEntryByTranslationKey(
  projectId: string,
  collection: string,
  translationKey: string,
  locale: Locale,
): Promise<Article | null> {
  const result = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, collection),
        eq(articles.translationKey, translationKey),
        eq(articles.locale, locale),
      ),
    )
    .limit(1);
  return result[0] ?? null;
}

export async function listToolsByCategory(
  projectId: string,
  category: string,
  locale: Locale,
  options?: {
    pricing?: string;
    minRating?: number;
    orderBy?: "rating" | "votes" | "name";
  },
): Promise<Article[]> {
  const conditions = [
    eq(articles.projectId, projectId),
    eq(articles.collection, "tools"),
    eq(articles.category, category),
    eq(articles.locale, locale),
  ];

  if (options?.pricing != null) {
    conditions.push(eq(articles.toolPricing, options.pricing));
  }
  if (options?.minRating != null) {
    // toolRating is NUMERIC → returned as string; coerce minRating to string for comparison
    conditions.push(gte(articles.toolRating, String(options.minRating)));
  }

  const orderBy =
    options?.orderBy === "rating"
      ? desc(articles.toolRating)
      : options?.orderBy === "votes"
        ? desc(articles.toolVotes)
        : asc(articles.title);

  return await db
    .select()
    .from(articles)
    .where(and(...conditions))
    .orderBy(orderBy);
}

export async function listToolsByPricing(
  projectId: string,
  pricing: string,
  locale: Locale,
): Promise<Article[]> {
  return await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.toolPricing, pricing),
        eq(articles.locale, locale),
      ),
    )
    .orderBy(desc(articles.toolRating));
}

/**
 * List tool articles that belong to a specific cluster (by cluster_id UUID).
 * Ordered by tool rating descending so highest-rated tools appear first.
 * Used by Tool-Linker pre-generation to resolve cluster-matched tools.
 */
export async function listToolsByClusterId(
  projectId: string,
  clusterId: string,
  locale: Locale,
): Promise<Article[]> {
  return await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.clusterId, clusterId),
        eq(articles.locale, locale),
      ),
    )
    .orderBy(desc(articles.toolRating));
}

export interface AuthorProfileRow {
  slug: string;
  name: string;
  expertise: string[];
  expertiseEmbedding?: number[];
}

/**
 * List author profiles for a project+locale, including cached expertise embeddings.
 * Expertise and expertiseEmbedding are read from domainExtras.
 */
export async function listAuthorsByLocale(
  projectId: string,
  locale: Locale,
): Promise<AuthorProfileRow[]> {
  const rows = await db
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "authors"),
        eq(articles.locale, locale),
      ),
    );

  return rows.map((r) => {
    const extras = (r.domainExtras ?? {}) as Record<string, unknown>;
    const base = {
      slug: r.slug,
      name: r.title ?? String(extras.name ?? r.slug),
      expertise: Array.isArray(extras.expertise)
        ? (extras.expertise as unknown[]).filter((h): h is string => typeof h === "string")
        : [],
    };
    if (Array.isArray(extras.expertiseEmbedding)) {
      return { ...base, expertiseEmbedding: extras.expertiseEmbedding as number[] };
    }
    return base;
  });
}
