import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

const REPO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";
const CONTENT = join(REPO, "src/content");

const COLLECTIONS = [
  "blog",
  "comparisons",
  "tools",
  "ki-wissen",
  "usecases",
  "categories",
  "authors",
  "tool-categories",
  "special-landings",
];

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listFiles(p)));
    } else if (ent.isFile() && (ent.name.endsWith(".md") || ent.name.endsWith(".mdx"))) {
      out.push(p);
    }
  }
  return out;
}

function slugFromPath(rootPrefix: string, path: string): string {
  const rel = path.replace(rootPrefix + "/", "");
  return rel.replace(/\.(md|mdx)$/, "");
}

interface CollectionInventory {
  collection: string;
  totalFiles: number;
  byLocale: Record<string, { count: number; slugs: string[] }>;
  noLocaleSplit?: { count: number; slugs: string[] };
  frontmatterFieldSetExample?: string[];
}

async function inventoryCollection(coll: string): Promise<CollectionInventory> {
  const root = join(CONTENT, coll);
  const out: CollectionInventory = {
    collection: coll,
    totalFiles: 0,
    byLocale: {},
  };
  const deDir = join(root, "de");
  const enDir = join(root, "en");
  const deExists = await readdir(deDir).then(() => true).catch(() => false);

  if (deExists) {
    for (const loc of ["de", "en"]) {
      const dir = join(root, loc);
      const files = await listFiles(dir);
      const slugs = files.map((f) => slugFromPath(dir, f)).sort();
      out.byLocale[loc] = { count: files.length, slugs };
      out.totalFiles += files.length;
    }
  } else {
    const files = await listFiles(root);
    const slugs = files.map((f) => slugFromPath(root, f)).sort();
    out.noLocaleSplit = { count: files.length, slugs };
    out.totalFiles = files.length;
  }

  // Sample one frontmatter to get the field set
  const sampleFile = out.byLocale["de"]?.slugs[0]
    ? join(root, "de", out.byLocale["de"].slugs[0] + ".md")
    : out.noLocaleSplit?.slugs[0]
      ? join(root, out.noLocaleSplit.slugs[0] + ".md")
      : null;

  if (sampleFile) {
    try {
      const raw = await readFile(sampleFile, "utf-8").catch(async () => {
        // Try .mdx
        return await readFile(sampleFile.replace(/\.md$/, ".mdx"), "utf-8");
      });
      const parsed = matter(raw);
      if (parsed.data && typeof parsed.data === "object") {
        out.frontmatterFieldSetExample = Object.keys(parsed.data).sort();
      }
    } catch (e) {
      // skip
    }
  }

  return out;
}

const inventories: CollectionInventory[] = [];
for (const coll of COLLECTIONS) {
  inventories.push(await inventoryCollection(coll));
}

console.log("# Repo-Side Inventory\n");
for (const inv of inventories) {
  console.log(`## ${inv.collection} (total=${inv.totalFiles})`);
  if (inv.noLocaleSplit) {
    console.log(`  no locale split: ${inv.noLocaleSplit.count} files`);
    console.log(`  first 5 slugs: ${inv.noLocaleSplit.slugs.slice(0, 5).join(", ")}`);
  } else {
    for (const [loc, data] of Object.entries(inv.byLocale)) {
      console.log(`  ${loc}: ${data.count} files`);
    }
  }
  if (inv.frontmatterFieldSetExample) {
    console.log(`  sample frontmatter fields: ${inv.frontmatterFieldSetExample.join(", ")}`);
  }
  console.log("");
}

// Write full slug-set JSON for Phase 4 diff
const outFile = "/Users/marcelklaczinski/WebstormProjects/marketing-automation/apps/api/src/scripts/discovery/repo-inventory.json";
await Bun.write(outFile, JSON.stringify(inventories, null, 2));
console.log(`\nFull inventory written to: ${outFile}`);

process.exit(0);
