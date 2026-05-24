import { db, articles, eq, and, sql } from "@marketing-auto/db";

const PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";

const rows = await db
  .select({
    slug: articles.slug,
    locale: articles.locale,
    hasHowTo: sql<boolean>`${articles.domainExtras} ? 'howTo'`,
    schemaIsArrayNonEmpty: sql<boolean>`(${articles.schemaJsonLd} IS NOT NULL AND jsonb_typeof(${articles.schemaJsonLd}) = 'array' AND jsonb_array_length(${articles.schemaJsonLd}) > 0)`,
  })
  .from(articles)
  .where(and(eq(articles.projectId, PROJECT_ID), eq(articles.collection, "ki-wissen")))
  .orderBy(articles.slug, articles.locale);

const withHowTo = rows.filter((r) => r.hasHowTo).length;
const withSchema = rows.filter((r) => r.schemaIsArrayNonEmpty).length;
console.log(`ki-wissen rows in DB: ${rows.length}`);
console.log(`  with howTo in domainExtras: ${withHowTo}`);
console.log(`  with non-empty schemaJsonLd: ${withSchema}`);

// Also check all projects
const allColl = await db
  .select({
    collection: articles.collection,
    total: sql<number>`count(*)::int`,
    withHowTo: sql<number>`count(*) FILTER (WHERE ${articles.domainExtras} ? 'howTo')::int`,
    withSchemaArrayNonEmpty: sql<number>`count(*) FILTER (WHERE jsonb_typeof(${articles.schemaJsonLd}) = 'array' AND jsonb_array_length(${articles.schemaJsonLd}) > 0)::int`,
  })
  .from(articles)
  .where(eq(articles.projectId, PROJECT_ID))
  .groupBy(articles.collection);

console.log(`\nProject-wide howTo + schemaJsonLd by collection:`);
for (const r of allColl) {
  console.log(`  ${r.collection}: total=${r.total} hasHowTo=${r.withHowTo} hasNonEmptySchema=${r.withSchemaArrayNonEmpty}`);
}

// Also: check astroFrontmatter and importMetadata
console.log(`\nastroFrontmatter populated:`);
const astFm = await db
  .select({
    collection: articles.collection,
    total: sql<number>`count(*)::int`,
    populated: sql<number>`count(*) FILTER (WHERE ${articles.astroFrontmatter} IS NOT NULL AND ${articles.astroFrontmatter} != '{}'::jsonb)::int`,
  })
  .from(articles)
  .where(eq(articles.projectId, PROJECT_ID))
  .groupBy(articles.collection);
for (const r of astFm) {
  console.log(`  ${r.collection}: total=${r.total} astroFrontmatter populated=${r.populated}`);
}

process.exit(0);
