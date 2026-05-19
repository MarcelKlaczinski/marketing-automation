#!/usr/bin/env bun
/**
 * Spec 54b — Discovery Backfill with real LLM classification.
 *
 * Processes ALL non-author articles (replaces previous heuristic Phase 2 data):
 *   Phase 1  — deterministic structural metrics (word_count, headers, etc.)
 *   Phase 2  — Haiku LLM classification (contentHooks array, suggestedTemplates,
 *              narrativeArc) using Spec 54a template keys
 *
 * Idempotent via content_hash: articles whose body_md + frontmatter haven't
 * changed since the last llm_enriched run are skipped unless --force is passed.
 *
 * Run:
 *   cd apps/api && bun --env-file ../../.env src/scripts/article-discovery-llm-backfill.ts
 *   # force re-classify all:
 *   cd apps/api && bun --env-file ../../.env src/scripts/article-discovery-llm-backfill.ts --force
 *
 * Generates: /tmp/discovery-backfill-report.md
 */

import { anthropic } from "@marketing-auto/adapter-anthropic";
import { db } from "@marketing-auto/db";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";

const TOOLWIKI_PROJECT_ID = "3fad7929-b06d-47ce-b6a1-8ac134362c42";
const BATCH_SIZE = 10;
const FORCE = process.argv.includes("--force");

// ─── Phase 1: Deterministic helpers ──────────────────────────────────────────

function countParagraphs(body: string): number {
  const lines = body.split("\n");
  let count = 0;
  let inFence = false;
  let prevBlank = true;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```") || line.startsWith("~~~")) { inFence = !inFence; prevBlank = false; continue; }
    if (inFence) { prevBlank = false; continue; }
    if (line === "") { prevBlank = true; continue; }
    if (prevBlank && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith(">") &&
        !/^[-*+] /.test(line) && !/^\d+\. /.test(line) &&
        !line.startsWith("---") && !line.startsWith("===")) {
      count++;
    }
    prevBlank = false;
  }
  return count;
}

function countCodeBlocks(body: string): number {
  return (body.match(/^```[\s\S]*?^```/gm) ?? []).length +
         (body.match(/^~~~[\s\S]*?^~~~/gm) ?? []).length;
}

function countTables(body: string): number {
  return (body.match(/^\|.+\|[\r\n]+\|[-| :]+\|/gm) ?? []).length;
}

function countLists(body: string): { ul: number; ol: number } {
  const lines = body.split("\n");
  let ul = 0; let ol = 0; let prevUl = false; let prevOl = false;
  for (const line of lines) {
    const isUl = /^(\s{0,3})[-*+] /.test(line);
    const isOl = /^(\s{0,3})\d+\. /.test(line);
    if (isUl && !prevUl) ul++;
    if (isOl && !prevOl) ol++;
    prevUl = isUl; prevOl = isOl;
  }
  return { ul, ol };
}

function countExternalLinks(body: string): number {
  const mdLinks = [...body.matchAll(/\[.*?\]\((https?:\/\/[^)]+)\)/g)];
  const bareLinks = [...body.matchAll(/(?<!\()(https?:\/\/\S+)/g)];
  const urls = new Set<string>([
    ...mdLinks.flatMap((m) => m[1] ? [m[1]] : []),
    ...bareLinks.flatMap((m) => m[1] ? [m[1]] : []),
  ]);
  return urls.size;
}

function containerFormHint(
  collection: string,
  fx: Record<string, unknown>,
  title: string | null,
  publishedAt: Date | null,
): string {
  switch (collection) {
    case "tools": return "single-tool-deep-dive";
    case "comparisons": {
      const n = Array.isArray(fx["toolSlugs"]) ? (fx["toolSlugs"] as string[]).length : 0;
      return n <= 2 ? "comparison-2" : "comparison-list";
    }
    case "ki-wissen": return "concept-explainer";
    case "usecases": return "application-scenario";
    case "blog": {
      const daysOld = publishedAt ? (Date.now() - publishedAt.getTime()) / 86_400_000 : Infinity;
      const t = (title ?? "").toLowerCase();
      if (daysOld < 60) return "news-update";
      if (/\b(how to|so |schritt|step|anleitung|guide)\b/.test(t)) return "howto-guide";
      return "opinion-piece";
    }
    case "tool-categories": return "category-hub";
    case "special-landings": return "landing-page";
    default: return "unknown";
  }
}

function referencedTools(collection: string, fx: Record<string, unknown>): string[] {
  if (collection === "comparisons") return Array.isArray(fx["toolSlugs"]) ? (fx["toolSlugs"] as string[]) : [];
  if (collection === "usecases") {
    const feats = Array.isArray(fx["featuredToolSlugs"]) ? (fx["featuredToolSlugs"] as string[]) : [];
    const primary = typeof fx["primaryTool"] === "string" ? [fx["primaryTool"]] : [];
    return [...new Set([...primary, ...feats])];
  }
  if (collection === "blog") return typeof fx["primaryTool"] === "string" ? [fx["primaryTool"]] : [];
  return [];
}

function completenessScore(wordCount: number, imageCount: number, h2Count: number,
    hasFaq: boolean, hasAffiliate: boolean, collection: string): number {
  let score = 0;
  if (wordCount > 2000) score += 0.3;
  else if (wordCount > 1000) score += 0.2;
  else if (wordCount > 500) score += 0.1;
  if (h2Count >= 3) score += 0.2; else if (h2Count >= 1) score += 0.1;
  if (imageCount >= 2) score += 0.2; else if (imageCount >= 1) score += 0.1;
  if (hasFaq) score += 0.2;
  if (hasAffiliate && collection === "tools") score += 0.1;
  return Math.min(1, Math.round(score * 1000) / 1000);
}

function pgArr(arr: string[]): string {
  return `{${arr.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

function contentHash(bodyMd: string, frontmatterExtras: unknown): string {
  const input = bodyMd + JSON.stringify(frontmatterExtras ?? {});
  return createHash("md5").update(input).digest("hex");
}

// ─── Phase 2: LLM prompt ─────────────────────────────────────────────────────

const TEMPLATE_DEFINITIONS = `
Available templates (Spec 54a — use ONLY these keys):
- comparison-grid-4             eligible: comparisons with toolSlugs == 2 AND verdict
- comparison-grid-3             eligible: comparisons with toolSlugs == 3 AND verdict
- verdict-per-use-case          eligible: comparisons with useCaseVerdicts 3..8 (all have winner+reason)
- single-tool-spotlight         eligible: tools collection OR spotlight from comparison
- news-slide                    eligible: news-update container form (blog < 60 days old)
- listicle-carousel             eligible: numbered lists or best-of-list patterns with >= 5 items
- concept-explainer-deck        eligible: ki-wissen collection OR concept-explainer container form
- mythbuster                    eligible: has_warnings AND has_use_case_examples
- pro-con-verdict               eligible: has_pro_con_lists AND has_verdict
- price-comparison              eligible: has_pricing_data AND referenced tools >= 2
- howto-step-sequence           eligible: has_step_sequence AND wordCount >= 1000
`.trim();

const CONTENT_HOOKS_SPEC = `
Content hooks (strict — tag only if SIGNIFICANTLY present, not a passing mention):
- has_verdict          explicit winner/verdict/fazit section or field
- has_step_sequence    numbered steps in H2/H3 headings or body (e.g. "Schritt 1", "Step 1:")
- has_numbered_list    >= 3 numbered list items in body text
- has_pro_con_lists    explicit pros/cons section or frontmatter pros[]/cons[] field
- has_use_case_examples >= 2 concrete use-case examples or useCaseVerdicts[] frontmatter
- has_warnings         ⚠️/🚨 callouts, [!WARNING] blocks, or explicit risk/compliance notes
- has_pricing_data     actual price numbers (€/$ amounts) or pricing table in body/frontmatter
- has_quotes_or_testimonial blockquote (> syntax) or "Zitat:"/"quote:" pattern
- has_technical_detail code blocks OR API/SDK/curl/JSON mentions in context of technical usage
- has_visual_demo_refs markdown images (![...]) or explicit screenshot/demo/video references
- has_data_table       actual markdown pipe table (| col | col |\\n|---|---|)
- has_glossary_terms   bold-term–definition pattern (**Term**: ...) or explicit glossary section
- has_news_angle       dated update (2025/2026 + neu/launch/release keywords) or breaking-news framing
`.trim();

interface LLMClassification {
  contentHooks: string[];
  narrativeArc: string;
  suggestedTemplates: Array<{
    templateKey: string;
    confidence: number;
    primaryAngle: string;
    estimatedSlides: number;
  }>;
  estimatedCarousels: number;
  templateGap: { pattern: string; description: string } | null;
}

async function classifyWithLLM(article: {
  slug: string;
  collection: string;
  locale: string;
  title: string | null;
  containerFormHint: string;
  wordCount: number;
  headerSlugs: string[];
  referencedTools: string[];
  bodyExcerpt: string;
  frontmatterExtras: Record<string, unknown>;
}): Promise<LLMClassification> {
  const userMessage = `Classify this article for Instagram Carousel template routing.

ARTICLE METADATA:
- Slug: ${article.slug}
- Collection: ${article.collection}
- Locale: ${article.locale}
- Title: ${article.title ?? "(no title)"}
- Container-Form-Hint (deterministic): ${article.containerFormHint}
- Word-Count: ${article.wordCount}
- H2-Headings: ${article.headerSlugs.slice(0, 10).join(", ") || "(none)"}
- Referenced Tools: ${article.referencedTools.join(", ") || "(none)"}

BODY EXCERPT (first 2000 chars):
${article.bodyExcerpt}

FRONTMATTER EXTRAS:
${JSON.stringify(article.frontmatterExtras, null, 2).slice(0, 1000)}

TASK:
1. Identify which contentHooks are SIGNIFICANTLY present (array of strings, strict).
2. Write narrativeArc (2-3 specific sentences about this article's story logic — no generic phrases).
3. Suggest templates from the list (only eligible ones, ordered by confidence desc).
4. If the article has a pattern that no existing template covers, set templateGap.
5. Set estimatedCarousels = count of suggestedTemplates with confidence >= 0.6.

Return JSON:
{
  "contentHooks": ["has_verdict", "has_pricing_data"],
  "narrativeArc": "...",
  "suggestedTemplates": [
    { "templateKey": "...", "confidence": 0.95, "primaryAngle": "...", "estimatedSlides": 5 }
  ],
  "estimatedCarousels": 2,
  "templateGap": null
}`;

  const result = await anthropic.messages({
    projectId: TOOLWIKI_PROJECT_ID,
    operation: "discovery-backfill-classify",
    model: "claude-haiku-4-5",
    systemPrefix: `You are a content classification system for a social-media carousel generator.

${TEMPLATE_DEFINITIONS}

${CONTENT_HOOKS_SPEC}

Be STRICT about content hooks — only tag when the signal is clearly and significantly present in the content.
Be SPECIFIC in narrativeArc — mention the actual topic, structure, and unique angle of THIS article.`,
    systemSuffix: "",
    userMessage,
    jsonMode: true,
    estimatedCostEur: 0.006,
    maxTokens: 800,
  });

  const parsed = result.json as LLMClassification;
  if (!parsed || !Array.isArray(parsed.contentHooks)) {
    throw new Error(`Invalid LLM response for ${article.slug}: ${result.raw.slice(0, 200)}`);
  }
  return parsed;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type ArticleRow = {
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
    headings?: Array<{ level: number; text: string; id?: string }>;
    internalLinks?: string[];
    hasAffiliateLinks?: boolean;
  };
  frontmatter_extras: Record<string, unknown>;
  published_at: Date | null;
  existing_content_hash: string | null;
  existing_mode: string | null;
};

const CONTENT_COLLECTIONS = ["tools", "blog", "comparisons", "ki-wissen", "usecases", "special-landings", "tool-categories"];

console.log("=== Discovery Backfill (Spec 54b) ===");
console.log(`Force mode: ${FORCE}`);

const articles = await db.execute<ArticleRow>(sql`
  SELECT
    a.id, a.collection, a.locale, a.slug, a.title,
    a.body_md, a.word_count, a.import_metadata, a.frontmatter_extras, a.published_at,
    d.content_hash AS existing_content_hash,
    d.enrichment_mode AS existing_mode
  FROM articles a
  LEFT JOIN article_discovery d ON d.article_id = a.id
  WHERE a.collection = ANY(ARRAY[${sql.join(CONTENT_COLLECTIONS.map(c => sql`${c}`), sql`, `)}])
  ORDER BY a.collection, a.locale, a.slug
`);

// Compute which articles need processing
const toProcess: ArticleRow[] = [];
let skipped = 0;
for (const art of articles) {
  const hash = contentHash(art.body_md ?? "", art.frontmatter_extras);
  const alreadyDone = art.existing_mode === "llm_enriched" && art.existing_content_hash === hash;
  if (!FORCE && alreadyDone) { skipped++; }
  else { toProcess.push(art); }
}

console.log(`\nTotal non-author articles: ${articles.length}`);
console.log(`Already up-to-date (same content_hash): ${skipped}`);
console.log(`Need processing: ${toProcess.length}`);
console.log(`\nEstimated cost: ${toProcess.length} × ~$0.006 = ~$${(toProcess.length * 0.006).toFixed(2)} USD`);
console.log(`Estimated time: ~${Math.ceil(toProcess.length / BATCH_SIZE) * 30}s at 30s/batch\n`);

if (toProcess.length === 0) {
  console.log("Nothing to do — all articles are up-to-date. Use --force to re-classify.");
  process.exit(0);
}

// ─── Processing loop ──────────────────────────────────────────────────────────

let processed = 0;
let errors = 0;
const templateGaps: Array<{ slug: string; gap: { pattern: string; description: string } }> = [];
const errorLog: Array<{ slug: string; error: string }> = [];

for (let batchStart = 0; batchStart < toProcess.length; batchStart += BATCH_SIZE) {
  const batch = toProcess.slice(batchStart, batchStart + BATCH_SIZE);
  console.log(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(toProcess.length / BATCH_SIZE)}: articles ${batchStart + 1}..${batchStart + batch.length}`);

  for (const article of batch) {
    try {
      const body = article.body_md ?? "";
      const im = article.import_metadata ?? {};
      const fx = article.frontmatter_extras ?? {};

      // ── Phase 1: deterministic ────────────────────────────────────────────
      const wordCount = im.wordCount ?? article.word_count ?? 0;
      const headings = im.headings ?? [];
      const h2s = headings.filter((h) => h.level === 2);
      const h3s = headings.filter((h) => h.level === 3);
      const headerCountH2 = h2s.length;
      const headerCountH3 = h3s.length;
      const headerSlugs = headings.map((h) =>
        h.id ?? h.text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").trim()
      );
      const imageCount = im.imageCount ?? 0;
      const linkCountInternal = (im.internalLinks ?? []).length;
      const linkCountExternal = body ? countExternalLinks(body) : 0;
      const paragraphCount = body ? countParagraphs(body) : 0;
      const codeBlockCount = body ? countCodeBlocks(body) : 0;
      const tableCount = body ? countTables(body) : 0;
      const listCounts = body ? countLists(body) : { ul: 0, ol: 0 };
      const hasAffiliateLinks = im.hasAffiliateLinks ?? false;
      const tools = referencedTools(article.collection, fx);
      const hint = containerFormHint(
        article.collection, fx, article.title,
        article.published_at ? new Date(article.published_at) : null,
      );
      const estimatedAngles = headerCountH2;
      const score = completenessScore(wordCount, imageCount, headerCountH2,
        Boolean(fx["faq"]), hasAffiliateLinks, article.collection);
      const hash = contentHash(body, fx);

      // ── Phase 2: LLM ─────────────────────────────────────────────────────
      const llm = await classifyWithLLM({
        slug: article.slug,
        collection: article.collection,
        locale: article.locale,
        title: article.title,
        containerFormHint: hint,
        wordCount,
        headerSlugs,
        referencedTools: tools,
        bodyExcerpt: body.slice(0, 2000),
        frontmatterExtras: fx,
      });

      if (llm.templateGap) {
        templateGaps.push({ slug: article.slug, gap: llm.templateGap });
      }

      // ── Upsert ───────────────────────────────────────────────────────────
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
          content_hooks,
          suggested_templates,
          narrative_arc,
          estimated_carousels,
          content_hash,
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
          ${JSON.stringify(llm.contentHooks)}::jsonb,
          ${JSON.stringify(llm.suggestedTemplates)}::jsonb,
          ${llm.narrativeArc},
          ${llm.estimatedCarousels},
          ${hash},
          now(),
          'llm_enriched',
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
          content_hooks         = EXCLUDED.content_hooks,
          suggested_templates   = EXCLUDED.suggested_templates,
          narrative_arc         = EXCLUDED.narrative_arc,
          estimated_carousels   = EXCLUDED.estimated_carousels,
          content_hash          = EXCLUDED.content_hash,
          enrichment_run_at     = EXCLUDED.enrichment_run_at,
          enrichment_mode       = EXCLUDED.enrichment_mode,
          updated_at            = EXCLUDED.updated_at
      `);

      processed++;
      process.stdout.write(`  ✓ [${article.locale}] ${article.collection}/${article.slug}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ [${article.locale}] ${article.slug}: ${msg}`);
      errorLog.push({ slug: article.slug, error: msg });
      errors++;
    }
  }

  // Small pause between batches to avoid rate-limit pressure
  if (batchStart + BATCH_SIZE < toProcess.length) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ─── Template eligibility summary ─────────────────────────────────────────────

const eligibilityRows = await db.execute<{ tkey: string; cnt: string; high: string }>(sql`
  SELECT
    t->>'templateKey' AS tkey,
    COUNT(*) AS cnt,
    COUNT(*) FILTER (WHERE (t->>'confidence')::numeric >= 0.85) AS high
  FROM article_discovery,
       jsonb_array_elements(suggested_templates) AS t
  GROUP BY tkey
  ORDER BY cnt DESC
`);

// ─── Content-hook distribution ────────────────────────────────────────────────

const hookRows = await db.execute<{ hook: string; cnt: string }>(sql`
  SELECT hook, COUNT(*) AS cnt
  FROM article_discovery,
       jsonb_array_elements_text(content_hooks) AS hook
  WHERE enrichment_mode = 'llm_enriched'
  GROUP BY hook
  ORDER BY cnt DESC
`);

// ─── Generate report ──────────────────────────────────────────────────────────

const report = [
  "# Discovery-Backfill Report",
  `Generated: ${new Date().toISOString()}`,
  "",
  "## Run Stats",
  `- Articles processed (this run): ${processed}`,
  `- Already up-to-date (skipped): ${skipped}`,
  `- Errors / failed: ${errors}`,
  `- Total non-author articles in DB: ${articles.length}`,
  "",
  "## Content-Hook Distribution (LLM-classified)",
  "",
  "| Hook | Count | % of total |",
  "|------|------:|----------:|",
  ...hookRows.map((r) =>
    `| ${r.hook} | ${r.cnt} | ${((parseInt(r.cnt) / articles.length) * 100).toFixed(0)}% |`
  ),
  "",
  "## Template-Eligibility Summary",
  "",
  "| Template | Eligible Articles | High-Confidence (≥0.85) |",
  "|----------|------------------:|------------------------:|",
  ...eligibilityRows.map((r) => `| ${r.tkey} | ${r.cnt} | ${r.high} |`),
  "",
  "## Template Gaps Found",
  "",
  templateGaps.length === 0
    ? "No template gaps identified."
    : [
        `Found ${templateGaps.length} potential template gaps:`,
        "",
        ...templateGaps.map(({ slug, gap }) => [
          `### ${gap.pattern}`,
          `- Article: ${slug}`,
          `- Description: ${gap.description}`,
          "",
        ].join("\n")),
      ].join("\n"),
  "",
  "## Errors",
  "",
  errorLog.length === 0
    ? "No errors."
    : errorLog.map((e) => `- **${e.slug}**: ${e.error}`).join("\n"),
].join("\n");

const reportPath = "/tmp/discovery-backfill-report.md";
writeFileSync(reportPath, report, "utf-8");

// ─── Console summary ─────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════");
console.log("Discovery Backfill Complete");
console.log("═══════════════════════════════════════");
console.log(`Processed: ${processed} | Skipped: ${skipped} | Errors: ${errors}`);
console.log(`\nTemplate-Eligibility Summary:`);
for (const r of eligibilityRows) {
  console.log(`  ${(r.tkey ?? "?").padEnd(32)} eligible=${r.cnt}  high-conf=${r.high}`);
}
console.log(`\nContent-Hook Frequencies (top 5):`);
for (const r of hookRows.slice(0, 5)) {
  console.log(`  ${r.hook.padEnd(32)} ${r.cnt}`);
}
if (templateGaps.length > 0) {
  console.log(`\nTemplate Gaps: ${templateGaps.length} (see report)`);
}
console.log(`\nReport: ${reportPath}`);

process.exit(errors > 0 ? 1 : 0);
