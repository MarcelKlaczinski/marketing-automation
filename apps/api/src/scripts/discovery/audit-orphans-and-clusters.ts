import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { db, articles, contentPillars, clusters, eq, and, sql, inArray } from "@marketing-auto/db";

const PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";
const REPO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";

// ──────── Orphaned blog rows ────────
console.log("# Orphaned blog rows (in DB but not in repo)\n");

const ORPHAN_SLUGS_DE = [
  "chatgpt-preise-2026",
  "code-assistenten",
  "dalle-4-vs-midjourney-v7-vs-flux-2026-vergleich",
  "elevenlabs-vs-murf-vs-play-ht-voice-cloning-test-2026",
  "system-prompts-role-prompting-2026-leitfaden",
];
const ORPHAN_SLUGS_EN = [
  "ai-code-assistants",
  "chatgpt-pricing-2026",
  "dall-e-4-vs-midjourney-v7-vs-flux-2026-comparison",
  "elevenlabs-vs-murf-vs-play-ht-voice-cloning-comparison-2026",
  "system-prompts-role-prompting-2026-guide",
];

const orphans = await db
  .select({
    slug: articles.slug,
    locale: articles.locale,
    collection: articles.collection,
    source: articles.source,
    status: articles.status,
    translationKey: articles.translationKey,
    category: articles.category,
    publishedAt: articles.publishedAt,
    fmUpdated: articles.frontmatterUpdatedAt,
    filePath: articles.filePath,
    lastImported: articles.lastImportedAt,
  })
  .from(articles)
  .where(
    and(
      eq(articles.projectId, PROJECT_ID),
      eq(articles.collection, "blog"),
      inArray(articles.slug, [...ORPHAN_SLUGS_DE, ...ORPHAN_SLUGS_EN]),
    ),
  )
  .orderBy(articles.slug);

for (const o of orphans) {
  console.log(
    `  ${o.slug} (${o.locale}): status=${o.status} cat=${o.category} pubAt=${o.publishedAt ? o.publishedAt.toString().slice(0, 10) : "—"} lastImported=${o.lastImported?.toString().slice(0, 16) ?? "—"} filePath=${o.filePath}`,
  );
}

// ──────── Cluster + pillar full state ────────
console.log("\n\n# Full clusters list\n");
const cl = await db
  .select({
    name: clusters.name,
    pillarId: clusters.pillarId,
    primaryKw: clusters.primaryKeyword,
    status: clusters.status,
    pillarArticleId: clusters.pillarArticleId,
  })
  .from(clusters)
  .where(eq(clusters.projectId, PROJECT_ID))
  .orderBy(clusters.name);
console.log(`  total clusters: ${cl.length}`);
for (const c of cl) {
  console.log(`    ${c.name}  pillarArticle=${c.pillarArticleId ? "yes" : "no"}`);
}

console.log("\n# Full content_pillars list\n");
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

// ──────── ClusterKey distinct values from articles ────────
console.log("\n\n# Distinct cluster_key values in articles\n");
const ck = await db
  .select({
    clusterKey: articles.clusterKey,
    count: sql<number>`count(*)::int`,
    hubCount: sql<number>`count(*) FILTER (WHERE ${articles.clusterRole} = 'hub')::int`,
    spokeCount: sql<number>`count(*) FILTER (WHERE ${articles.clusterRole} = 'spoke')::int`,
  })
  .from(articles)
  .where(and(eq(articles.projectId, PROJECT_ID), sql`${articles.clusterKey} IS NOT NULL`))
  .groupBy(articles.clusterKey)
  .orderBy(articles.clusterKey);
console.log(`  distinct cluster_key values in articles: ${ck.length}`);
for (const k of ck) {
  console.log(`    ${k.clusterKey}  total=${k.count} hubs=${k.hubCount} spokes=${k.spokeCount}`);
}

// ──────── Repo-side clusterKey scan ────────
console.log("\n\n# Repo-side cluster_key values (sampled)\n");
async function scanClusters(coll: string): Promise<Map<string, { hubs: number; spokes: number }>> {
  const map = new Map<string, { hubs: number; spokes: number }>();
  for (const loc of ["de", "en"]) {
    const dir = join(REPO, "src/content", coll, loc);
    const { readdir } = await import("node:fs/promises");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".md") && !f.endsWith(".mdx")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf-8");
        const { data } = matter(raw);
        const key = data.clusterKey as string | undefined;
        const role = data.clusterRole as "hub" | "spoke" | undefined;
        if (key) {
          const entry = map.get(key) ?? { hubs: 0, spokes: 0 };
          if (role === "hub") entry.hubs++;
          if (role === "spoke") entry.spokes++;
          map.set(key, entry);
        }
      } catch {}
    }
  }
  return map;
}

const repoClusters = new Map<string, { hubs: number; spokes: number }>();
for (const coll of ["blog", "comparisons", "tools", "ki-wissen", "usecases"]) {
  const m = await scanClusters(coll);
  for (const [k, v] of m) {
    const existing = repoClusters.get(k) ?? { hubs: 0, spokes: 0 };
    existing.hubs += v.hubs;
    existing.spokes += v.spokes;
    repoClusters.set(k, existing);
  }
}
const sortedRepoClusters = [...repoClusters.entries()].sort(([a], [b]) => a.localeCompare(b));
console.log(`  distinct cluster_key values in repo: ${sortedRepoClusters.length}`);
for (const [k, v] of sortedRepoClusters) {
  console.log(`    ${k}  hubs=${v.hubs} spokes=${v.spokes}`);
}

// Cluster diff
const dbClusterKeys = new Set(ck.map((k) => k.clusterKey).filter((s): s is string => !!s));
const repoClusterKeys = new Set(repoClusters.keys());
const repoOnly = [...repoClusterKeys].filter((k) => !dbClusterKeys.has(k)).sort();
const dbOnly = [...dbClusterKeys].filter((k) => !repoClusterKeys.has(k)).sort();
console.log(`\n  cluster_key diff:`);
console.log(`    repo-only: ${repoOnly.length === 0 ? "—" : repoOnly.join(", ")}`);
console.log(`    db-only:   ${dbOnly.length === 0 ? "—" : dbOnly.join(", ")}`);

process.exit(0);
