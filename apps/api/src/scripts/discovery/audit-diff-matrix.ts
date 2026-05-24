import { readFile } from "node:fs/promises";

interface RepoInv {
  collection: string;
  totalFiles: number;
  byLocale: Record<string, { count: number; slugs: string[] }>;
  noLocaleSplit?: { count: number; slugs: string[] };
}

interface DbRow {
  collection: string;
  locale: string;
  source: string;
  count: number;
  slugs: string[];
}

const repoInvJson = await readFile(
  "/Users/marcelklaczinski/WebstormProjects/marketing-automation/apps/api/src/scripts/discovery/repo-inventory.json",
  "utf-8",
);
const dbInvJson = await readFile(
  "/Users/marcelklaczinski/WebstormProjects/marketing-automation/apps/api/src/scripts/discovery/db-inventory.json",
  "utf-8",
);
const repoInv: RepoInv[] = JSON.parse(repoInvJson);
const dbInv: DbRow[] = JSON.parse(dbInvJson);

console.log("# Phase 4 — Diff matrix per collection\n");

const COLLECTIONS_WITH_LOCALE = ["blog", "comparisons", "tools", "ki-wissen", "usecases", "authors", "tool-categories", "special-landings"];
const COLLECTIONS_NO_LOCALE = ["categories"];

for (const coll of COLLECTIONS_WITH_LOCALE) {
  const repo = repoInv.find((r) => r.collection === coll);
  if (!repo) {
    console.log(`## ${coll}: NOT in repo inventory\n`);
    continue;
  }
  console.log(`## ${coll}`);
  for (const locale of ["de", "en"]) {
    const repoSlugs = new Set(repo.byLocale[locale]?.slugs ?? []);
    const dbRows = dbInv.filter((d) => d.collection === coll && d.locale === locale);
    const dbSlugs = new Set<string>();
    const dbSlugsBySource: Record<string, string[]> = {};
    for (const r of dbRows) {
      for (const s of r.slugs) dbSlugs.add(s);
      dbSlugsBySource[r.source] = r.slugs;
    }
    const onlyRepo = [...repoSlugs].filter((s) => !dbSlugs.has(s)).sort();
    const onlyDb = [...dbSlugs].filter((s) => !repoSlugs.has(s)).sort();
    const both = [...repoSlugs].filter((s) => dbSlugs.has(s)).length;

    console.log(`### ${coll}/${locale}`);
    console.log(`- repo files: ${repoSlugs.size}`);
    console.log(`- db rows: ${dbSlugs.size}`);
    console.log(`- both: ${both}`);
    console.log(`- only in repo (${onlyRepo.length}): ${onlyRepo.length === 0 ? "—" : onlyRepo.join(", ")}`);
    console.log(`- only in DB (${onlyDb.length}): ${onlyDb.length === 0 ? "—" : onlyDb.join(", ")}`);
    console.log("");
  }
}

for (const coll of COLLECTIONS_NO_LOCALE) {
  const repo = repoInv.find((r) => r.collection === coll);
  if (!repo) continue;
  const repoSlugs = new Set(repo.noLocaleSplit?.slugs ?? []);
  console.log(`## ${coll} (no locale split)`);
  console.log(`- repo files: ${repoSlugs.size}`);
  console.log(`  (DB has these in content_categories, scope/slug — see Phase 5 cross-reference)`);
  console.log(`  Sample repo slugs (first 10): ${[...repoSlugs].slice(0, 10).join(", ")}`);
  console.log("");
}

process.exit(0);
