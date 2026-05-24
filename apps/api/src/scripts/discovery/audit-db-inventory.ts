import {
  db,
  articles,
  contentCategories,
  contentPillars,
  clusters,
  eq,
  and,
  sql,
} from "@marketing-auto/db";

const PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";

interface CollectionRow {
  collection: string;
  locale: string;
  source: string;
  count: number;
  slugs: string[];
}

const groups = await db
  .select({
    collection: articles.collection,
    locale: articles.locale,
    source: articles.source,
    count: sql<number>`count(*)::int`.as("count"),
    slugs: sql<string[]>`array_agg(${articles.slug} ORDER BY ${articles.slug})`.as("slugs"),
  })
  .from(articles)
  .where(eq(articles.projectId, PROJECT_ID))
  .groupBy(articles.collection, articles.locale, articles.source);

console.log("# DB Inventory (articles)\n");
console.log("| collection | locale | source | count |");
console.log("|---|---|---|---|");
const sorted = groups.sort((a, b) => {
  const k = (g: typeof a) => `${g.collection}|${g.locale}|${g.source}`;
  return k(a).localeCompare(k(b));
});
for (const g of sorted) {
  console.log(`| ${g.collection} | ${g.locale} | ${g.source} | ${g.count} |`);
}

// Persist slug sets per (collection,locale,source) for Phase 4 diff
const persistable: CollectionRow[] = sorted.map((g) => ({
  collection: g.collection,
  locale: g.locale,
  source: g.source,
  count: g.count,
  slugs: g.slugs,
}));

await Bun.write(
  "/Users/marcelklaczinski/WebstormProjects/marketing-automation/apps/api/src/scripts/discovery/db-inventory.json",
  JSON.stringify(persistable, null, 2),
);

// Coverage checks for blog
console.log("\n# Field-Coverage Checks per collection\n");

const collectionsToCheck = [
  "blog",
  "comparisons",
  "comparison",
  "tools",
  "ki-wissen",
  "usecases",
  "authors",
  "tool-categories",
  "special-landings",
];

for (const coll of collectionsToCheck) {
  const cov = await db
    .select({
      collection: articles.collection,
      locale: articles.locale,
      total: sql<number>`count(*)::int`,
      hasPublishedAt: sql<number>`count(*) FILTER (WHERE ${articles.publishedAt} IS NOT NULL)::int`,
      hasFrontmatterUpdated: sql<number>`count(*) FILTER (WHERE ${articles.frontmatterUpdatedAt} IS NOT NULL)::int`,
      hasCategory: sql<number>`count(*) FILTER (WHERE ${articles.category} IS NOT NULL)::int`,
      hasCluster: sql<number>`count(*) FILTER (WHERE ${articles.clusterKey} IS NOT NULL)::int`,
      hubCount: sql<number>`count(*) FILTER (WHERE ${articles.clusterRole} = 'hub')::int`,
      spokeCount: sql<number>`count(*) FILTER (WHERE ${articles.clusterRole} = 'spoke')::int`,
      hasAuthor: sql<number>`count(*) FILTER (WHERE ${articles.author} IS NOT NULL)::int`,
      noindexCount: sql<number>`count(*) FILTER (WHERE ${articles.noindex} = true)::int`,
      hasToolPricing: sql<number>`count(*) FILTER (WHERE ${articles.toolPricing} IS NOT NULL)::int`,
      hasToolRating: sql<number>`count(*) FILTER (WHERE ${articles.toolRating} IS NOT NULL)::int`,
      hasToolWebsite: sql<number>`count(*) FILTER (WHERE ${articles.toolWebsite} IS NOT NULL)::int`,
      hasToolAffiliate: sql<number>`count(*) FILTER (WHERE ${articles.toolAffiliateSlug} IS NOT NULL)::int`,
      hasDomainExtras: sql<number>`count(*) FILTER (WHERE ${articles.domainExtras} != '{}'::jsonb)::int`,
      hasSchemaJsonLd: sql<number>`count(*) FILTER (WHERE ${articles.schemaJsonLd} IS NOT NULL AND ${articles.schemaJsonLd} != '{}'::jsonb)::int`,
    })
    .from(articles)
    .where(and(eq(articles.projectId, PROJECT_ID), eq(articles.collection, coll)))
    .groupBy(articles.collection, articles.locale)
    .orderBy(articles.locale);

  if (cov.length === 0) continue;
  console.log(`\n## collection = ${coll}`);
  for (const row of cov) {
    console.log(`  ${row.locale}: total=${row.total} pubAt=${row.hasPublishedAt} fmUpdated=${row.hasFrontmatterUpdated} cat=${row.hasCategory} cluster=${row.hasCluster} hub=${row.hubCount} spoke=${row.spokeCount} author=${row.hasAuthor} noindex=${row.noindexCount} toolPricing=${row.hasToolPricing} toolRating=${row.hasToolRating} toolWebsite=${row.hasToolWebsite} toolAffiliate=${row.hasToolAffiliate} domainExtras=${row.hasDomainExtras} schemaJsonLd=${row.hasSchemaJsonLd}`);
  }
}

// Categories table
console.log("\n# content_categories\n");
const cats = await db
  .select({
    scope: contentCategories.scope,
    slug: contentCategories.slug,
  })
  .from(contentCategories)
  .where(eq(contentCategories.projectId, PROJECT_ID))
  .orderBy(contentCategories.scope, contentCategories.slug);

const byScope = cats.reduce(
  (acc, c) => {
    if (!acc[c.scope]) acc[c.scope] = [];
    acc[c.scope].push(c.slug);
    return acc;
  },
  {} as Record<string, string[]>,
);
for (const [scope, slugs] of Object.entries(byScope)) {
  console.log(`  ${scope}: ${slugs.length} → ${slugs.join(", ")}`);
}

// Clusters table
console.log("\n# clusters\n");
const cl = await db
  .select({
    name: clusters.name,
    primaryKeyword: clusters.primaryKeyword,
    status: clusters.status,
    pillarId: clusters.pillarId,
  })
  .from(clusters)
  .where(eq(clusters.projectId, PROJECT_ID))
  .orderBy(clusters.name);

console.log(`  total clusters: ${cl.length}`);
for (const c of cl.slice(0, 30)) {
  console.log(`    ${c.name}  pk=${c.primaryKeyword ?? ""}  status=${c.status}`);
}
if (cl.length > 30) console.log(`    ... ${cl.length - 30} more`);

// Content pillars table
console.log("\n# content_pillars\n");
const cp = await db
  .select({
    name: contentPillars.name,
    description: contentPillars.description,
  })
  .from(contentPillars)
  .where(eq(contentPillars.projectId, PROJECT_ID))
  .orderBy(contentPillars.name);
console.log(`  total pillars: ${cp.length}`);
for (const p of cp) {
  console.log(`    ${p.name}`);
}

process.exit(0);
