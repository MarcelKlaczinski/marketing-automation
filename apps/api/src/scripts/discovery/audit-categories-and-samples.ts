import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { db, articles, contentCategories, eq, and } from "@marketing-auto/db";

const PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";
const REPO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";
const CONTENT = join(REPO, "src/content");

// ──────── 1. Categories cross-reference ────────
console.log("# Categories cross-reference\n");

const repoCatFiles = await readdir(join(CONTENT, "categories"), { recursive: true });
const repoCatEntries: { scope: string; slug: string }[] = [];
for (const f of repoCatFiles) {
  if (!f.endsWith(".md") && !f.endsWith(".mdx")) continue;
  const parts = f.split("/");
  if (parts.length < 2) continue;
  const scope = parts[0]!;
  const slug = parts.slice(1).join("/").replace(/\.(md|mdx)$/, "");
  repoCatEntries.push({ scope, slug });
}

const dbCats = await db
  .select({ scope: contentCategories.scope, slug: contentCategories.slug })
  .from(contentCategories)
  .where(eq(contentCategories.projectId, PROJECT_ID));

const repoSet = new Set(repoCatEntries.map((c) => `${c.scope}|${c.slug}`));
const dbSet = new Set(dbCats.map((c) => `${c.scope}|${c.slug}`));

const onlyRepoCats = [...repoSet].filter((k) => !dbSet.has(k)).sort();
const onlyDbCats = [...dbSet].filter((k) => !repoSet.has(k)).sort();
const matchedCats = [...repoSet].filter((k) => dbSet.has(k));

console.log(`- Repo: ${repoSet.size}  DB: ${dbSet.size}  matched: ${matchedCats.length}`);
console.log(`- only in repo (${onlyRepoCats.length}): ${onlyRepoCats.length === 0 ? "—" : onlyRepoCats.join(", ")}`);
console.log(`- only in DB   (${onlyDbCats.length}): ${onlyDbCats.length === 0 ? "—" : onlyDbCats.join(", ")}`);

const repoByScope: Record<string, string[]> = {};
for (const c of repoCatEntries) {
  if (!repoByScope[c.scope]) repoByScope[c.scope] = [];
  repoByScope[c.scope]!.push(c.slug);
}
console.log("\nRepo categories by scope:");
for (const [scope, slugs] of Object.entries(repoByScope)) {
  console.log(`  ${scope}: ${slugs.length} → ${slugs.sort().join(", ")}`);
}

// Inspect a sample category file to see frontmatter
const sampleCatFile = join(CONTENT, "categories", repoCatEntries[0]!.scope, repoCatEntries[0]!.slug + ".md");
try {
  const raw = await readFile(sampleCatFile, "utf-8");
  const { data } = matter(raw);
  console.log(`\nSample categories file (${repoCatEntries[0]!.scope}/${repoCatEntries[0]!.slug}) frontmatter:`);
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  console.log("Could not read sample category file");
}

// ──────── 2. Sample frontmatter-vs-row diff per collection ────────
console.log("\n\n# Sample Frontmatter-vs-Row diff\n");

const SAMPLES: { collection: string; locale: string; slug: string; ext?: "md" | "mdx" }[] = [
  // blog (4 in-sync DE)
  { collection: "blog", locale: "de", slug: "ki-hr-recruiting-mittelstand-2026" },
  { collection: "blog", locale: "en", slug: "ai-hr-recruiting-smb-2026" },
  // comparisons
  { collection: "comparisons", locale: "de", slug: "chatgpt-vs-claude-vs-gemini-2026-vergleich" },
  // tools
  { collection: "tools", locale: "de", slug: "chatgpt" },
  { collection: "tools", locale: "en", slug: "chatgpt" },
  // ki-wissen
  { collection: "ki-wissen", locale: "de", slug: "was-ist-ki" },
  { collection: "ki-wissen", locale: "de", slug: "neuronale-netze" }, // new pillar, expect: not in DB
  // usecases
  { collection: "usecases", locale: "de", slug: "customer-support" },
  // authors
  { collection: "authors", locale: "de", slug: "marcel-klaczinski" },
  // tool-categories
  { collection: "tool-categories", locale: "de", slug: "code-assistants" },
  // special-landings
  { collection: "special-landings", locale: "de", slug: "chatgpt-alternative" },
];

async function readRepoFile(coll: string, locale: string, slug: string): Promise<{ frontmatter: Record<string, unknown>; bodyChars: number } | null> {
  const dir = join(CONTENT, coll, locale);
  for (const ext of [".md", ".mdx"]) {
    try {
      const path = join(dir, slug + ext);
      const raw = await readFile(path, "utf-8");
      const { data, content } = matter(raw);
      return { frontmatter: data as Record<string, unknown>, bodyChars: content.length };
    } catch {
      // try next ext
    }
  }
  return null;
}

for (const s of SAMPLES) {
  console.log(`\n## ${s.collection}/${s.locale}/${s.slug}`);
  const repo = await readRepoFile(s.collection, s.locale, s.slug);
  if (!repo) {
    console.log(`  ⚠️ file not found in repo`);
    continue;
  }
  console.log(`  repo: ${Object.keys(repo.frontmatter).length} frontmatter fields, ${repo.bodyChars} body chars`);

  const rows = await db
    .select({
      id: articles.id,
      slug: articles.slug,
      title: articles.title,
      collection: articles.collection,
      locale: articles.locale,
      source: articles.source,
      status: articles.status,
      publishedAt: articles.publishedAt,
      frontmatterUpdatedAt: articles.frontmatterUpdatedAt,
      category: articles.category,
      subcategory: articles.subcategory,
      tags: articles.tags,
      author: articles.author,
      clusterKey: articles.clusterKey,
      clusterRole: articles.clusterRole,
      translationKey: articles.translationKey,
      toolPricing: articles.toolPricing,
      toolRating: articles.toolRating,
      toolWebsite: articles.toolWebsite,
      toolAffiliateSlug: articles.toolAffiliateSlug,
      domainExtras: articles.domainExtras,
      schemaJsonLd: articles.schemaJsonLd,
      bodyMdLen: articles.bodyMd,
      astroFrontmatter: articles.astroFrontmatter,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, PROJECT_ID),
        eq(articles.collection, s.collection),
        eq(articles.locale, s.locale),
        eq(articles.slug, s.slug),
      ),
    );

  if (rows.length === 0) {
    console.log(`  ❌ NOT in DB`);
    continue;
  }
  const row = rows[0]!;
  console.log(`  db: source=${row.source} status=${row.status} pubAt=${row.publishedAt ?? "NULL"} fmUpdated=${row.frontmatterUpdatedAt ?? "NULL"} cat=${row.category ?? "NULL"} sub=${row.subcategory ?? "NULL"} cluster=${row.clusterKey}/${row.clusterRole ?? "—"} author=${row.author ?? "NULL"}`);
  console.log(`  db.tags: ${JSON.stringify(row.tags)}`);
  console.log(`  db.toolPricing=${row.toolPricing ?? "NULL"} toolRating=${row.toolRating ?? "NULL"} toolWebsite=${row.toolWebsite ?? "NULL"} toolAffiliateSlug=${row.toolAffiliateSlug ?? "NULL"}`);
  console.log(`  db.bodyMd length: ${(row.bodyMdLen ?? "").length} chars`);
  console.log(`  db.astroFrontmatter keys: ${Object.keys((row.astroFrontmatter as Record<string,unknown>) ?? {}).sort().join(", ")}`);
  console.log(`  db.domainExtras keys: ${Object.keys((row.domainExtras as Record<string,unknown>) ?? {}).sort().join(", ")}`);
  console.log(`  db.schemaJsonLd: ${row.schemaJsonLd ? `len=${JSON.stringify(row.schemaJsonLd).length}` : "NULL"}`);

  // Field-by-field diff for promoted-column candidates
  const repoFm = repo.frontmatter;
  const checks: { field: string; repo: unknown; db: unknown }[] = [
    { field: "category", repo: repoFm.category, db: row.category },
    { field: "subcategory", repo: repoFm.subcategory, db: row.subcategory },
    { field: "publishedAt", repo: repoFm.publishedAt ?? repoFm.date, db: row.publishedAt ? new Date(row.publishedAt).toISOString().slice(0,10) : null },
    { field: "clusterKey", repo: repoFm.clusterKey, db: row.clusterKey },
    { field: "clusterRole", repo: repoFm.clusterRole, db: row.clusterRole },
    { field: "translationKey", repo: repoFm.translationKey, db: row.translationKey },
    { field: "author", repo: repoFm.author, db: row.author },
    { field: "tags", repo: repoFm.tags, db: row.tags },
  ];
  if (s.collection === "tools") {
    checks.push({ field: "pricing", repo: repoFm.pricing, db: row.toolPricing });
    checks.push({ field: "rating", repo: repoFm.rating, db: row.toolRating });
    checks.push({ field: "website", repo: repoFm.website, db: row.toolWebsite });
    checks.push({ field: "affiliateSlug", repo: repoFm.affiliateSlug, db: row.toolAffiliateSlug });
  }
  const drifts = checks.filter((c) => {
    const r = JSON.stringify(c.repo ?? null);
    const d = JSON.stringify(c.db ?? null);
    return r !== d;
  });
  if (drifts.length === 0) {
    console.log(`  ✅ all promoted fields match`);
  } else {
    console.log(`  ⚠️  ${drifts.length} promoted-field drift:`);
    for (const d of drifts) {
      const r = JSON.stringify(d.repo);
      const dv = JSON.stringify(d.db);
      console.log(`    ${d.field}: repo=${r}  db=${dv}`);
    }
  }
}

process.exit(0);
