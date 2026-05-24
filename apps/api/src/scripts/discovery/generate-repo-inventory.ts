/**
 * Spec 006 / F1.5: regenerate `repo-inventory.json` from a local Astro repo.
 *
 * Walks `<astroRepo>/src/content/<collection>/` for a fixed set of collections,
 * emits a per-collection inventory the [`forecast-re-import-state`](./forecast-re-import-state.ts)
 * script can diff against the live DB.
 *
 * **Slug-format contract (Spec 006 fix):** all emitted slugs are BARE — the
 * file basename without extension and without any subdirectory prefix. This
 * matches what `parseMdxContent()` in
 * [packages/adapters/astro-sync/src/import/parse-frontmatter.ts](../../../../../packages/adapters/astro-sync/src/import/parse-frontmatter.ts)
 * writes into `articles.slug`. The pre-fix generator preserved subdirectory
 * prefixes for `noLocaleSplit` collections (e.g. `blog/comparisons` for
 * `src/content/categories/blog/comparisons.md`), which broke the forecast
 * diff against bare-slug DB rows.
 *
 * **Scope field:** for `noLocaleSplit` collections where files live one
 * subdirectory deeper than the collection root, the subdirectory name is
 * emitted as `scopes[slug] = scope`. No matching logic consumes this today;
 * it's there for future disambiguation surfaces.
 *
 * Usage:
 *   bun --filter @marketing-auto/api regenerate-repo-inventory \
 *     [--astro-repo=<path>] [--out=<path>]
 *
 * Defaults: `--astro-repo` = `/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu`
 *           `--out`        = `apps/api/src/scripts/discovery/repo-inventory.json`
 *
 * Read-only against the Astro repo; writes one JSON file. Safe to re-run.
 */

import { readFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import matter from "gray-matter";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("generate-repo-inventory");

const DEFAULT_ASTRO_REPO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";
const DEFAULT_OUT = resolve(import.meta.dir, "repo-inventory.json");

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
] as const;

export interface CollectionInventory {
  collection: string;
  totalFiles: number;
  byLocale: Record<string, { count: number; slugs: string[] }>;
  noLocaleSplit?: {
    count: number;
    slugs: string[];
    /**
     * Spec 006 / F1.5: per-slug scope map for `noLocaleSplit` collections
     * that nest one subdirectory deeper than the collection root (e.g.
     * `categories/blog/<slug>.md` → `scopes[slug] = "blog"`). Pure metadata,
     * not consumed by `computeForecastDiff()` today.
     *
     * When multiple files share the same bare slug across different scopes
     * (Toolwiki has `blog/ethics-law.md` AND `knowledge/ethics-law.md`), the
     * last-seen scope wins. The full path-prefix → slug collision footgun is
     * tracked separately in `docs/backlog/post-cleanup-followups.md`.
     */
    scopes?: Record<string, string>;
  };
  frontmatterFieldSetExample?: string[];
}

async function listMdFiles(dir: string): Promise<string[]> {
  // Spec 64.10 / Pattern 120: Bun's `Dirent<NonSharedBuffer>` typedef is
  // incompatible with the documented `{withFileTypes: true}` overload. Use
  // plain `readdir` + per-entry `Bun.file().stat()` instead.
  const out: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = join(dir, name);
    const stat = await Bun.file(p).stat().catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      out.push(...(await listMdFiles(p)));
    } else if (stat.isFile() && (name.endsWith(".md") || name.endsWith(".mdx"))) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Pure helper: derive the bare slug from a file path. Public for unit tests.
 *
 * `src/content/categories/blog/comparisons.md` → `"comparisons"`
 * `src/content/blog/de/my-article.mdx`         → `"my-article"`
 */
export function bareSlugFromPath(filePath: string): string {
  return basename(filePath).replace(/\.(md|mdx)$/, "");
}

/**
 * Pure helper: derive the scope (subdirectory between collection root and
 * file) for a noLocaleSplit collection. Returns `null` if the file sits
 * directly under the collection root.
 *
 * Public for unit tests.
 */
export function scopeFromPath(collectionRoot: string, filePath: string): string | null {
  const rootWithSlash = collectionRoot.endsWith("/") ? collectionRoot : collectionRoot + "/";
  const rel = filePath.startsWith(rootWithSlash) ? filePath.slice(rootWithSlash.length) : filePath;
  const parts = rel.split("/");
  // parts = ["blog", "comparisons.md"] → scope = "blog"
  // parts = ["comparisons.md"]          → no scope
  return parts.length >= 2 ? parts[0] ?? null : null;
}

async function inventoryCollection(
  astroRepo: string,
  coll: string,
): Promise<CollectionInventory> {
  const root = join(astroRepo, "src/content", coll);
  const out: CollectionInventory = {
    collection: coll,
    totalFiles: 0,
    byLocale: {},
  };
  const deDir = join(root, "de");
  const enDir = join(root, "en");
  const deExists = await readdir(deDir)
    .then(() => true)
    .catch(() => false);

  if (deExists) {
    for (const loc of ["de", "en"]) {
      const dir = loc === "de" ? deDir : enDir;
      const files = await listMdFiles(dir);
      const slugs = files.map((f) => bareSlugFromPath(f)).sort();
      out.byLocale[loc] = { count: files.length, slugs };
      out.totalFiles += files.length;
    }
  } else {
    const files = await listMdFiles(root);
    const slugs = files.map((f) => bareSlugFromPath(f)).sort();
    const scopes: Record<string, string> = {};
    for (const f of files) {
      const slug = bareSlugFromPath(f);
      const scope = scopeFromPath(root, f);
      if (scope !== null) scopes[slug] = scope;
    }
    out.noLocaleSplit = {
      count: files.length,
      slugs,
      ...(Object.keys(scopes).length > 0 ? { scopes } : {}),
    };
    out.totalFiles = files.length;
  }

  // Sample one frontmatter to keep the diagnostic field-set hint.
  const sampleFile = out.byLocale.de?.slugs[0]
    ? join(deDir, `${out.byLocale.de.slugs[0]}.md`)
    : out.noLocaleSplit?.slugs[0]
      ? await findFirstFile(root, out.noLocaleSplit.slugs[0])
      : null;
  if (sampleFile) {
    try {
      const raw = await readFile(sampleFile, "utf-8").catch(async () => {
        return await readFile(sampleFile.replace(/\.md$/, ".mdx"), "utf-8");
      });
      const parsed = matter(raw);
      if (parsed.data && typeof parsed.data === "object") {
        out.frontmatterFieldSetExample = Object.keys(parsed.data).sort();
      }
    } catch {
      // best-effort — skip if the file isn't readable
    }
  }
  return out;
}

/**
 * Walk the collection root looking for a file whose bare basename matches the
 * given slug. Returns the first match (or null). Used only for grabbing a
 * sample frontmatter — order doesn't matter.
 */
async function findFirstFile(root: string, slug: string): Promise<string | null> {
  const files = await listMdFiles(root);
  return files.find((f) => bareSlugFromPath(f) === slug) ?? null;
}

function parseArgs(argv: string[]): { astroRepo: string; out: string } {
  let astroRepo = DEFAULT_ASTRO_REPO;
  let out = DEFAULT_OUT;
  for (const arg of argv) {
    if (arg.startsWith("--astro-repo=")) astroRepo = arg.slice("--astro-repo=".length);
    else if (arg.startsWith("--out=")) out = arg.slice("--out=".length);
  }
  return { astroRepo, out };
}

export async function generateRepoInventory(astroRepo: string): Promise<CollectionInventory[]> {
  const inventories: CollectionInventory[] = [];
  for (const coll of COLLECTIONS) {
    inventories.push(await inventoryCollection(astroRepo, coll));
  }
  return inventories;
}

async function main(): Promise<void> {
  const { astroRepo, out } = parseArgs(process.argv.slice(2));
  log.info({ astroRepo, out }, "generate-repo-inventory: start");
  const inventories = await generateRepoInventory(astroRepo);
  await Bun.write(out, `${JSON.stringify(inventories, null, 2)}\n`);
  log.info(
    {
      out,
      collections: inventories.length,
      totalFiles: inventories.reduce((acc, inv) => acc + inv.totalFiles, 0),
    },
    "generate-repo-inventory: complete",
  );
}

if (import.meta.main) {
  main().catch((err) => {
    log.error({ err }, "generate-repo-inventory: fatal");
    process.exit(1);
  });
}
