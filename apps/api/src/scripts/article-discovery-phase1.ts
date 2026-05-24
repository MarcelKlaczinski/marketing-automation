#!/usr/bin/env bun
/**
 * Spec 53c — Phase 1: Deterministic enrichment of article_discovery.
 * Processes only imported articles (source = 'imported'), skips 'authors' collection.
 * Idempotent: re-runs only articles where enrichment_run_at < article.updated_at.
 *
 * Run:
 *   cd apps/api && bun --env-file ../../.env src/scripts/article-discovery-phase1.ts
 */

import { db } from "@marketing-auto/db";
import { sql } from "drizzle-orm";

// ─── Markdown body parsers ────────────────────────────────────────────────────

function countParagraphs(body: string): number {
  // Blank-line-separated blocks that are not headers/fences/tables/lists
  const lines = body.split("\n");
  let count = 0;
  let inFence = false;
  let prevBlank = true;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      prevBlank = false;
      continue;
    }
    if (inFence) { prevBlank = false; continue; }
    if (line === "") { prevBlank = true; continue; }
    if (
      prevBlank &&
      !line.startsWith("#") &&
      !line.startsWith("|") &&
      !line.startsWith(">") &&
      !/^[-*+] /.test(line) &&
      !/^\d+\. /.test(line) &&
      !line.startsWith("---") &&
      !line.startsWith("===")
    ) {
      count++;
    }
    prevBlank = false;
  }
  return count;
}

function countCodeBlocks(body: string): number {
  const fenceMatches = body.match(/^```[\s\S]*?^```/gm) ?? [];
  const tildeMatches = body.match(/^~~~[\s\S]*?^~~~/gm) ?? [];
  return fenceMatches.length + tildeMatches.length;
}

function countTables(body: string): number {
  // A table block starts with a pipe-delimited header row followed by a separator row
  const matches = body.match(/^\|.+\|[\r\n]+\|[-| :]+\|/gm) ?? [];
  return matches.length;
}

function countLists(body: string): { ul: number; ol: number } {
  const lines = body.split("\n");
  let ul = 0;
  let ol = 0;
  let prevUl = false;
  let prevOl = false;
  for (const line of lines) {
    const isUl = /^(\s{0,3})[-*+] /.test(line);
    const isOl = /^(\s{0,3})\d+\. /.test(line);
    if (isUl && !prevUl) ul++;
    if (isOl && !prevOl) ol++;
    prevUl = isUl;
    prevOl = isOl;
  }
  return { ul, ol };
}

function countExternalLinks(body: string): number {
  // Markdown links [text](http...) and bare URLs
  const mdLinks = [...body.matchAll(/\[.*?\]\((https?:\/\/[^)]+)\)/g)];
  const bareLinks = [...body.matchAll(/(?<!\()(https?:\/\/\S+)/g)];
  // Deduplicate by URL
  const urls = new Set([
    ...mdLinks.map((m) => m[1]),
    ...bareLinks.map((m) => m[1]),
  ]);
  return urls.size;
}

// ─── Container-form mapping ───────────────────────────────────────────────────

type Row = {
  id: string;
  collection: string;
  domain_extras: Record<string, unknown>;
  title: string | null;
  published_at: Date | null;
  header_count_h2: number;
};

function containerFormHint(row: Row): string {
  const { collection, domain_extras, title, published_at } = row;
  switch (collection) {
    case "tools":
      return "single-tool-deep-dive";
    case "comparisons": {
      const slugs = domain_extras["toolSlugs"];
      const n = Array.isArray(slugs) ? slugs.length : 0;
      return n <= 2 ? "comparison-2" : "comparison-list";
    }
    case "ki-wissen":
      return "concept-explainer";
    case "usecases":
      return "application-scenario";
    case "blog": {
      const daysOld = published_at
        ? (Date.now() - published_at.getTime()) / 86_400_000
        : Infinity;
      const t = (title ?? "").toLowerCase();
      if (daysOld < 60) return "news-update";
      if (/\b(how to|so |schritt|step|anleitung|guide)\b/.test(t)) return "howto-guide";
      return "opinion-piece";
    }
    case "tool-categories":
      return "category-hub";
    case "special-landings":
      return "landing-page";
    default:
      return "unknown";
  }
}

// ─── Completeness score ───────────────────────────────────────────────────────

function completenessScore(params: {
  wordCount: number;
  imageCount: number;
  h2Count: number;
  hasFaq: boolean;
  hasAffiliate: boolean;
  collection: string;
}): number {
  let score = 0;
  // word count tiers
  if (params.wordCount > 2000) score += 0.3;
  else if (params.wordCount > 1000) score += 0.2;
  else if (params.wordCount > 500) score += 0.1;
  // structure
  if (params.h2Count >= 3) score += 0.2;
  else if (params.h2Count >= 1) score += 0.1;
  // media
  if (params.imageCount >= 2) score += 0.2;
  else if (params.imageCount >= 1) score += 0.1;
  // collection-specific bonuses
  if (params.hasFaq) score += 0.2;
  if (params.hasAffiliate && params.collection === "tools") score += 0.1;
  return Math.min(1, Math.round(score * 1000) / 1000);
}

// ─── Referenced tools normaliser ─────────────────────────────────────────────

function referencedTools(
  collection: string,
  fx: Record<string, unknown>
): string[] {
  if (collection === "comparisons") {
    return Array.isArray(fx["toolSlugs"]) ? (fx["toolSlugs"] as string[]) : [];
  }
  if (collection === "usecases") {
    const feats = Array.isArray(fx["featuredToolSlugs"])
      ? (fx["featuredToolSlugs"] as string[])
      : [];
    const primary =
      typeof fx["primaryTool"] === "string" ? [fx["primaryTool"]] : [];
    return [...new Set([...primary, ...feats])];
  }
  if (collection === "blog") {
    const primary =
      typeof fx["primaryTool"] === "string" ? [fx["primaryTool"]] : [];
    return primary;
  }
  if (collection === "tools") {
    // The tool itself — try to derive slug from frontmatter or leave empty
    // (slug is on the article row itself, not passed here)
    return [];
  }
  return [];
}

// ─── PG array helper ─────────────────────────────────────────────────────────

function pgArr(arr: string[]): string {
  // Serialise to PostgreSQL array literal: {"a","b",...}
  return `{${arr.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const CONTENT_COLLECTIONS = [
  "tools", "blog", "comparisons", "ki-wissen",
  "usecases", "special-landings", "tool-categories",
];

const articles = await db.execute<{
  id: string;
  collection: string;
  locale: string;
  slug: string;
  title: string | null;
  body_md: string;
  word_count: number | null;
  import_metadata: {
    wordCount?: number;
    imageCount?: number;
    readingTimeMinutes?: number;
    headings?: Array<{ level: number; text: string; id?: string }>;
    internalLinks?: string[];
    hasAffiliateLinks?: boolean;
  };
  domain_extras: Record<string, unknown>;
  published_at: Date | null;
  updated_at: Date;
}>(sql`
  SELECT
    a.id,
    a.collection,
    a.locale,
    a.slug,
    a.title,
    a.body_md,
    a.word_count,
    a.import_metadata,
    a.domain_extras,
    a.published_at,
    a.updated_at
  FROM articles a
  LEFT JOIN article_discovery d ON d.article_id = a.id
  WHERE
    a.source = 'imported'
    AND a.collection = ANY(ARRAY[${sql.join(CONTENT_COLLECTIONS.map(c => sql`${c}`), sql`, `)}])
    AND (
      d.article_id IS NULL
      OR d.enrichment_run_at < a.updated_at
    )
  ORDER BY a.collection, a.locale, a.slug
`);

console.log(`Processing ${articles.length} articles...`);

let processed = 0;
let errors = 0;

for (const article of articles) {
  try {
    const body = article.body_md ?? "";
    const im = article.import_metadata ?? {};
    const fx = article.domain_extras ?? {};

    // Word count: prefer import_metadata, fall back to articles.word_count
    const wordCount = im.wordCount ?? article.word_count ?? 0;

    // Headings from import_metadata (already parsed by Astro import)
    const headings = im.headings ?? [];
    const h2s = headings.filter((h) => h.level === 2);
    const h3s = headings.filter((h) => h.level === 3);
    const headerCountH2 = h2s.length;
    const headerCountH3 = h3s.length;
    const headerSlugs = headings.map((h) => {
      return (h.id ?? h.text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").trim());
    });

    // Image count from import_metadata
    const imageCount = im.imageCount ?? 0;

    // Link counts
    const linkCountInternal = (im.internalLinks ?? []).length;
    const linkCountExternal = body ? countExternalLinks(body) : 0;

    // Body-parsed metrics (only when body is present)
    const paragraphCount = body ? countParagraphs(body) : 0;
    const codeBlockCount = body ? countCodeBlocks(body) : 0;
    const tableCount = body ? countTables(body) : 0;
    const listCounts = body ? countLists(body) : { ul: 0, ol: 0 };

    // Has affiliate links
    const hasAffiliateLinks = im.hasAffiliateLinks ?? false;

    // Normalised tools
    const tools = referencedTools(article.collection, fx);

    // Container form hint
    const hint = containerFormHint({
      id: article.id,
      collection: article.collection,
      domain_extras: fx,
      title: article.title,
      published_at: article.published_at ? new Date(article.published_at) : null,
      header_count_h2: headerCountH2,
    });

    // Estimated angles = number of H2s (each H2 = a distinct addressable topic)
    const estimatedAngles = headerCountH2;

    // Completeness score
    const score = completenessScore({
      wordCount,
      imageCount,
      h2Count: headerCountH2,
      hasFaq: Boolean(fx["faq"]),
      hasAffiliate: hasAffiliateLinks,
      collection: article.collection,
    });

    // Upsert
    await db.execute(sql`
      INSERT INTO article_discovery (
        article_id,
        word_count, image_count,
        header_count_h2, header_count_h3, header_slugs,
        paragraph_count,
        link_count_internal, link_count_external,
        code_block_count, table_count,
        list_count_ul, list_count_ol,
        has_affiliate_links,
        referenced_tools,
        container_form_hint,
        completeness_score,
        estimated_angles,
        enrichment_run_at,
        enrichment_mode,
        updated_at
      ) VALUES (
        ${article.id},
        ${wordCount}, ${imageCount},
        ${headerCountH2}, ${headerCountH3}, ${pgArr(headerSlugs)}::text[],
        ${paragraphCount},
        ${linkCountInternal}, ${linkCountExternal},
        ${codeBlockCount}, ${tableCount},
        ${listCounts.ul}, ${listCounts.ol},
        ${hasAffiliateLinks},
        ${pgArr(tools)}::text[],
        ${hint},
        ${score},
        ${estimatedAngles},
        now(),
        'deterministic',
        now()
      )
      ON CONFLICT (article_id) DO UPDATE SET
        word_count            = EXCLUDED.word_count,
        image_count           = EXCLUDED.image_count,
        header_count_h2       = EXCLUDED.header_count_h2,
        header_count_h3       = EXCLUDED.header_count_h3,
        header_slugs          = EXCLUDED.header_slugs,
        paragraph_count       = EXCLUDED.paragraph_count,
        link_count_internal   = EXCLUDED.link_count_internal,
        link_count_external   = EXCLUDED.link_count_external,
        code_block_count      = EXCLUDED.code_block_count,
        table_count           = EXCLUDED.table_count,
        list_count_ul         = EXCLUDED.list_count_ul,
        list_count_ol         = EXCLUDED.list_count_ol,
        has_affiliate_links   = EXCLUDED.has_affiliate_links,
        referenced_tools      = EXCLUDED.referenced_tools,
        container_form_hint   = EXCLUDED.container_form_hint,
        completeness_score    = EXCLUDED.completeness_score,
        estimated_angles      = EXCLUDED.estimated_angles,
        enrichment_run_at     = EXCLUDED.enrichment_run_at,
        enrichment_mode       = EXCLUDED.enrichment_mode,
        updated_at            = EXCLUDED.updated_at
    `);

    processed++;
    if (processed % 20 === 0) process.stdout.write(`  ${processed}/${articles.length}\n`);
  } catch (err) {
    console.error(`ERROR on article ${article.id} (${article.slug}):`, err);
    errors++;
  }
}

console.log(`\nDone. Processed: ${processed}, Errors: ${errors}`);

// ─── Quick distribution report ────────────────────────────────────────────────

console.log("\n── container_form_hint distribution ──");
const dist = await db.execute(sql`
  SELECT
    d.container_form_hint,
    COUNT(*) as cnt,
    ROUND(AVG(d.word_count)) as avg_words,
    ROUND(AVG(d.completeness_score)::numeric, 3) as avg_completeness,
    ROUND(AVG(d.estimated_angles)) as avg_angles
  FROM article_discovery d
  JOIN articles a ON a.id = d.article_id
  WHERE a.collection != 'authors'
  GROUP BY d.container_form_hint
  ORDER BY cnt DESC
`);
for (const r of dist) {
  console.log(
    `  ${String(r.container_form_hint).padEnd(25)} | n=${String(r.cnt).padStart(3)} | avg_words=${String(r.avg_words ?? "-").padStart(5)} | completeness=${r.avg_completeness} | angles=${r.avg_angles}`
  );
}

console.log("\n── locale distribution ──");
const localeDist = await db.execute(sql`
  SELECT a.locale, d.container_form_hint, COUNT(*) as cnt
  FROM article_discovery d
  JOIN articles a ON a.id = d.article_id
  GROUP BY a.locale, d.container_form_hint
  ORDER BY a.locale, cnt DESC
`);
for (const r of localeDist) {
  console.log(`  [${r.locale}] ${r.container_form_hint}: ${r.cnt}`);
}

process.exit(0);
