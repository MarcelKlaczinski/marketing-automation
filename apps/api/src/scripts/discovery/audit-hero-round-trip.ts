import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { db, articles, eq, and, sql } from "@marketing-auto/db";
import { sniffImageFormat } from "@marketing-auto/adapter-image-webp";

const PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";
const REPO = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu";

// 10 samples × 2 locales-ish covering all collections with heroes
const SAMPLES: Array<{ collection: string; locale: string; slug: string }> = [
  { collection: "tools", locale: "de", slug: "chatgpt" },
  { collection: "tools", locale: "en", slug: "chatgpt" },
  { collection: "blog", locale: "de", slug: "ki-hr-recruiting-mittelstand-2026" },
  { collection: "blog", locale: "en", slug: "ai-hr-recruiting-smb-2026" },
  { collection: "blog", locale: "de", slug: "claude-pro-fuer-lange-dokumente-2026-test" }, // older .webp /blog/ ref
  { collection: "comparisons", locale: "de", slug: "chatgpt-vs-claude-vs-gemini-2026-vergleich" },
  { collection: "ki-wissen", locale: "de", slug: "was-ist-ki" },
  { collection: "ki-wissen", locale: "en", slug: "what-is-ai" },
  { collection: "usecases", locale: "de", slug: "kundensupport-service" },
  { collection: "special-landings", locale: "de", slug: "chatgpt" },
];

async function findRepoFile(coll: string, loc: string, slug: string): Promise<string | null> {
  for (const ext of [".mdx", ".md"]) {
    const path = join(REPO, "src/content", coll, loc, slug + ext);
    try {
      await stat(path);
      return path;
    } catch {}
  }
  return null;
}

async function resolvePublicAsset(refPath: string): Promise<{ resolved: string; exists: boolean; size?: number; sniffed?: string } | null> {
  // refPath is a value like "/heroes/auto/foo.png" or "/tools/chatgpt-logo.webp" or "/authors/foo.webp"
  // Public-asset convention: <repo>/public<refPath>
  if (!refPath) return null;
  const cleanRef = refPath.startsWith("/") ? refPath : "/" + refPath;
  const fsPath = join(REPO, "public", cleanRef);
  try {
    const st = await stat(fsPath);
    const bytes = await readFile(fsPath);
    const sniffed = sniffImageFormat(new Uint8Array(bytes));
    return { resolved: fsPath, exists: true, size: st.size, sniffed };
  } catch {
    return { resolved: fsPath, exists: false };
  }
}

console.log("# Phase 6 — Round-trip validation (10 sample articles)\n");
console.log("| coll/loc/slug | DB hero_* | repo file | heroImage value | image value | resolved asset exists? | size (KB) | format |");
console.log("|---|---|---|---|---|---|---|---|");

for (const s of SAMPLES) {
  const rows = await db
    .select({
      heroImageR2Key: articles.heroImageR2Key,
      heroImagePublicUrl: articles.heroImagePublicUrl,
      heroImageAltText: articles.heroImageAltText,
      heroImageOriginalR2Key: articles.heroImageOriginalR2Key,
      heroImage: sql<string | null>`${articles.domainExtras}->>'heroImage'`,
      image: sql<string | null>`${articles.domainExtras}->>'image'`,
      heroImageAlt: sql<string | null>`${articles.domainExtras}->>'heroImageAlt'`,
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
  const row = rows[0];

  const repoPath = await findRepoFile(s.collection, s.locale, s.slug);

  const heroImage = row?.heroImage ?? null;
  const image = row?.image ?? null;

  // Resolve the hero source — prefer heroImage, fallback to image
  const refToResolve = heroImage ?? image ?? null;
  const resolved = refToResolve ? await resolvePublicAsset(refToResolve) : null;

  const dbHero = row
    ? [row.heroImageR2Key, row.heroImagePublicUrl, row.heroImageAltText].some((v) => v !== null)
      ? "populated"
      : "all NULL"
    : "row missing";

  const sizeKB = resolved?.size ? (resolved.size / 1024).toFixed(1) : "—";
  const exists = resolved ? (resolved.exists ? "✅" : "❌") : "n/a";
  const fmt = resolved?.sniffed ?? "—";

  console.log(
    `| ${s.collection}/${s.locale}/${s.slug} | ${dbHero} | ${repoPath ? "✅" : "❌"} | ${heroImage ?? "—"} | ${image ?? "—"} | ${exists} | ${sizeKB} | ${fmt} |`,
  );

  // Also read the frontmatter heroImage to confirm DB matches repo
  if (repoPath) {
    try {
      const raw = await readFile(repoPath, "utf-8");
      const { data } = matter(raw);
      const fmHero = (data as Record<string, unknown>).heroImage as string | undefined;
      const fmImage = (data as Record<string, unknown>).image as string | undefined;
      const fmAlt = (data as Record<string, unknown>).heroImageAlt as string | undefined;
      if ((fmHero ?? null) !== heroImage) {
        console.log(`    ⚠️ frontmatter heroImage drift: repo="${fmHero}" db="${heroImage}"`);
      }
      if ((fmImage ?? null) !== image) {
        console.log(`    ⚠️ frontmatter image drift: repo="${fmImage}" db="${image}"`);
      }
      if (fmAlt && fmAlt !== row?.heroImageAlt) {
        console.log(`    ℹ️ repo heroImageAlt: "${(fmAlt as string).slice(0, 80)}…"`);
      }
    } catch {}
  }
}

// ──────── Bonus: physical-file inventory under public/heroes + public/blog + public/comparisons + public/tools ────────
console.log("\n\n## Distinct-source-file count by directory (recursive)\n");

import { readdir } from "node:fs/promises";

async function countTopLevelFilesByExt(dir: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = e.name.split(".").pop() ?? "";
      out[ext] = (out[ext] ?? 0) + 1;
    }
  } catch {}
  return out;
}

const dirs = [
  "public/heroes",
  "public/heroes/auto",
  "public/blog",
  "public/comparisons",
  "public/tools",
  "public/authors",
  "public/gen",
  "public/social",
];
for (const d of dirs) {
  const counts = await countTopLevelFilesByExt(join(REPO, d));
  const fmt = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`  ${d}: ${fmt || "(empty)"}`);
}

// Distinct heroImage filename references vs file existence
console.log("\n\n## Existence-check: 100 distinct heroImage values resolve in repo?\n");
const refs = await db.execute(sql`
  SELECT DISTINCT (domain_extras->>'heroImage') AS ref
  FROM articles
  WHERE project_id = ${PROJECT_ID}::uuid
    AND source = 'imported'
    AND domain_extras ? 'heroImage'
`);
const refList = (refs as Array<Record<string, unknown>>).map((r) => r.ref as string);
let exists = 0;
let missing = 0;
const missingExamples: string[] = [];
for (const r of refList) {
  const res = await resolvePublicAsset(r);
  if (res?.exists) exists++;
  else {
    missing++;
    if (missingExamples.length < 10) missingExamples.push(r);
  }
}
console.log(`  Distinct heroImage refs: ${refList.length}`);
console.log(`  Resolvable in public/: ${exists}`);
console.log(`  Missing: ${missing}`);
if (missingExamples.length > 0) {
  console.log(`  First 10 missing:`);
  for (const m of missingExamples) console.log(`    ${m}`);
}

// Same for image field
const refsImg = await db.execute(sql`
  SELECT DISTINCT (domain_extras->>'image') AS ref
  FROM articles
  WHERE project_id = ${PROJECT_ID}::uuid
    AND source = 'imported'
    AND domain_extras ? 'image'
`);
const refsImgList = (refsImg as Array<Record<string, unknown>>).map((r) => r.ref as string);
let imgExists = 0;
let imgMissing = 0;
const imgMissingEx: string[] = [];
for (const r of refsImgList) {
  const res = await resolvePublicAsset(r);
  if (res?.exists) imgExists++;
  else {
    imgMissing++;
    if (imgMissingEx.length < 10) imgMissingEx.push(r);
  }
}
console.log(`\n  Distinct image refs (tools+authors): ${refsImgList.length}`);
console.log(`  Resolvable in public/: ${imgExists}`);
console.log(`  Missing: ${imgMissing}`);
if (imgMissingEx.length > 0) for (const m of imgMissingEx) console.log(`    ${m}`);

process.exit(0);
