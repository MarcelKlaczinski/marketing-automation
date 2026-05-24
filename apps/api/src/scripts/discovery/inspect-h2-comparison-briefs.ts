/**
 * Spec 64.18 / Phase C.1 — Discovery script (READ-ONLY).
 * Inspects stuck `comparison_discovery` briefs + existing cluster landscape
 * + the tool-article assignments for tools mentioned in those briefs.
 * Output drives the Mini-Discovery doc; not committed for re-use.
 */
import { db, eq, topicBriefs, clusters, articles, projects, sql, desc } from "@marketing-auto/db";

const toolwiki = await db
  .select({ id: projects.id, slug: projects.slug })
  .from(projects)
  .where(eq(projects.slug, "toolwiki"))
  .limit(1);
const projectId = toolwiki[0]?.id;
if (!projectId) {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.error("no toolwiki");
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("=== STUCK COMPARISON_DISCOVERY BRIEFS ===");
const stuckBriefs = await db
  .select({
    id: topicBriefs.id,
    topicTitle: topicBriefs.topicTitle,
    suggestedTitle: topicBriefs.suggestedTitle,
    primaryKeyword: topicBriefs.primaryKeyword,
    comparisonMetadata: topicBriefs.comparisonMetadata,
    clusterId: topicBriefs.clusterId,
    clusterAction: topicBriefs.clusterAction,
    approvalStatus: topicBriefs.approvalStatus,
    locale: topicBriefs.locale,
    createdAt: topicBriefs.createdAt,
  })
  .from(topicBriefs)
  .where(sql`${topicBriefs.projectId} = ${projectId} AND ${topicBriefs.source} = 'comparison_discovery'`)
  .orderBy(desc(topicBriefs.createdAt));

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("Total briefs:", stuckBriefs.length);
for (const b of stuckBriefs) {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(
    JSON.stringify(
      {
        id: b.id,
        suggestedTitle: b.suggestedTitle,
        topicTitle: b.topicTitle,
        primaryKeyword: b.primaryKeyword,
        toolA: b.comparisonMetadata?.toolASlug,
        toolB: b.comparisonMetadata?.toolBSlug,
        clusterId: b.clusterId,
        clusterAction: b.clusterAction,
        approvalStatus: b.approvalStatus,
        locale: b.locale,
        createdAt: b.createdAt,
      },
      null,
      2,
    ),
  );
}

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("\n=== CLUSTERS (top 25 by article count) ===");
const clusterRows = await db
  .select({
    id: clusters.id,
    name: clusters.name,
    pillar: clusters.pillar,
    primaryKeyword: clusters.primaryKeyword,
  })
  .from(clusters)
  .where(eq(clusters.projectId, projectId));
const counts = await db
  .select({
    clusterId: articles.clusterId,
    c: sql<number>`count(*)::int`,
  })
  .from(articles)
  .where(eq(articles.projectId, projectId))
  .groupBy(articles.clusterId);
const countMap = new Map<string | null, number>(counts.map((r) => [r.clusterId, r.c]));
const sorted = clusterRows
  .map((c) => ({ ...c, articleCount: countMap.get(c.id) ?? 0 }))
  .sort((a, b) => b.articleCount - a.articleCount);
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("Total clusters:", sorted.length);
for (const c of sorted.slice(0, 25)) {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(
    `  ${c.articleCount.toString().padStart(4)} | ${c.pillar?.padEnd(20) ?? "<no-pillar>".padEnd(20)} | ${c.name}`,
  );
}

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("\n=== CLUSTERS NAMED *comparison|vergleich|vs* ===");
for (const c of sorted.filter(
  (c) =>
    /comparison|vergleich|vs\b/i.test(c.name) ||
    /comparison|vergleich/i.test(c.pillar ?? "") ||
    /comparison|vergleich/i.test(c.primaryKeyword ?? ""),
)) {
  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(`  ${c.articleCount.toString().padStart(4)} | ${c.pillar?.padEnd(20) ?? "-".padEnd(20)} | ${c.name}`);
}

// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("\n=== TOOLS FROM STUCK BRIEFS — DO THEY HAVE ARTICLES + CLUSTERS? ===");
const toolSlugs = new Set<string>();
for (const b of stuckBriefs) {
  if (b.comparisonMetadata?.toolASlug) toolSlugs.add(b.comparisonMetadata.toolASlug);
  if (b.comparisonMetadata?.toolBSlug) toolSlugs.add(b.comparisonMetadata.toolBSlug);
}
// biome-ignore lint/suspicious/noConsoleLog: script output
console.log("Unique tool slugs:", [...toolSlugs]);
for (const slug of toolSlugs) {
  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      collection: articles.collection,
      clusterId: articles.clusterId,
      category: articles.category,
      subcategory: articles.subcategory,
      locale: articles.locale,
    })
    .from(articles)
    .where(sql`${articles.projectId} = ${projectId} AND ${articles.slug} = ${slug}`);
  for (const r of rows) {
    const cl = clusterRows.find((c) => c.id === r.clusterId);
    // biome-ignore lint/suspicious/noConsoleLog: script output
    console.log(
      `  ${slug.padEnd(35)} loc=${r.locale ?? "-"} coll=${r.collection.padEnd(12)} cluster=${cl?.name ?? "<none>"} cat=${r.category ?? "-"} sub=${r.subcategory ?? "-"}`,
    );
  }
}

process.exit(0);
