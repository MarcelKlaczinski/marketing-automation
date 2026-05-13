#!/usr/bin/env bun
/**
 * Spec 53c — Phase 2: Content-hook classification from filesystem.
 * Reads only DE MDX files from the Astro project, classifies via heuristics
 * (no LLM API), then mirrors results to the EN translation sibling.
 *
 * Run:
 *   bun --env-file /path/.env --cwd apps/api src/scripts/article-discovery-phase2.ts
 */

import { db } from "@marketing-auto/db";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ASTRO_CONTENT = "/Users/marcelklaczinski/WebstormProjects/ki-wissensraum-neu/src/content";
const CONTENT_COLLECTIONS = ["tools", "blog", "comparisons", "ki-wissen", "usecases", "special-landings", "tool-categories"];

// ─── Frontmatter parser (no deps needed — simple --- block split) ─────────────

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };
  const yamlBlock = match[1] ?? "";
  const body = match[2] ?? "";
  const fm: Record<string, unknown> = {};
  // Parse only the fields we need (flat key: value, arrays, multiline strings)
  // Simple line-by-line pass — enough for our known frontmatter shape
  let currentKey = "";
  let inArray = false;
  let arrayValues: string[] = [];
  for (const line of yamlBlock.split("\n")) {
    if (line.startsWith("  - ") && inArray) {
      arrayValues.push(line.slice(4).trim().replace(/^["']|["']$/g, ""));
      continue;
    }
    if (inArray) {
      fm[currentKey] = arrayValues;
      inArray = false;
      arrayValues = [];
    }
    const kvMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)?$/);
    if (!kvMatch) continue;
    currentKey = kvMatch[1]!;
    const val = (kvMatch[2] ?? "").trim();
    if (val === "" || val === "|" || val === ">") {
      inArray = false; // might be multiline — skip
      continue;
    }
    if (val === "[]") { fm[currentKey] = []; continue; }
    // Detect start of YAML array on next lines
    if (val === "") { inArray = true; arrayValues = []; continue; }
    // Inline array: [a, b, c]
    if (val.startsWith("[")) {
      fm[currentKey] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      continue;
    }
    // Boolean
    if (val === "true") { fm[currentKey] = true; continue; }
    if (val === "false") { fm[currentKey] = false; continue; }
    // Number
    if (/^-?\d+(\.\d+)?$/.test(val)) { fm[currentKey] = Number(val); continue; }
    // String (strip quotes)
    fm[currentKey] = val.replace(/^["']|["']$/g, "");
  }
  // Flush final array if file ended while in array mode
  if (inArray) fm[currentKey] = arrayValues;
  return { fm, body };
}

// ─── Content-hook heuristics ──────────────────────────────────────────────────

interface ContentHooks {
  has_verdict: boolean;
  has_step_sequence: boolean;
  has_numbered_list: boolean;
  has_pro_con_lists: boolean;
  has_use_case_examples: boolean;
  has_warnings: boolean;
  has_pricing_data: boolean;
  has_quotes_or_testimonial: boolean;
  has_technical_detail: boolean;
  has_visual_demo_refs: boolean;
  has_data_table: boolean;
  has_glossary_terms: boolean;
  has_news_angle: boolean;
}

function classifyHooks(fm: Record<string, unknown>, body: string, collection: string): ContentHooks {
  const b = body.toLowerCase();
  const rawBody = body;

  const has_verdict =
    Boolean(fm["verdict"]) ||
    Boolean(fm["winner"]) ||
    /\b(fazit|empfehlung|unser urteil|our verdict|bottom line|kurzfazit|tl;dr)\b/.test(b);

  const has_step_sequence =
    /schritt\s*\d|step\s*\d|\d\.\s+(so |how to|install|setup|configure|erstell|einricht)/i.test(rawBody) ||
    /^#{1,3}.*(schritt|step\s*\d|phase\s*\d)/im.test(rawBody);

  const has_numbered_list =
    /^\d+\.\s+\S/m.test(rawBody) &&
    (rawBody.match(/^\d+\.\s+/gm) ?? []).length >= 3;

  const has_pro_con_lists =
    Array.isArray(fm["pros"]) ||
    Array.isArray(fm["cons"]) ||
    /\b(pros|cons|vorteile|nachteile|stärken|schwächen|pro contra)\b/i.test(b);

  const has_use_case_examples =
    Array.isArray(fm["useCases"]) ||
    Array.isArray(fm["useCaseVerdicts"]) ||
    /\b(use.?case|anwendungsfall|beispiel|praxisbeispiel|einsatzszenario|in der praxis)\b/i.test(b);

  const has_warnings =
    /[⚠️🚨❗]|achtung:|warnung:|hinweis:|vorsicht:|wichtig:|attention:|warning:|note:|\[!warning\]|\[!caution\]/i.test(rawBody) ||
    /\b(nicht empfohlen|avoid|gefährlich|risiko|compliance|rechtlich problematisch)\b/i.test(b);

  const has_pricing_data =
    Boolean(fm["pricing"]) ||
    typeof fm["priceFrom"] === "number" ||
    typeof fm["offerPrice"] === "number" ||
    /(\d+\s*[€$£]|\$\s*\d+|kostenlos|free.?tier|free plan|pricing|tarif|abo|monat|monatlich|€\/monat|\d+\s*euro)/i.test(b);

  const has_quotes_or_testimonial =
    (rawBody.match(/^>\s+\S/gm) ?? []).length >= 1 ||
    /["„].*[""]/.test(rawBody) ||
    /\b(zitat|quote|testimonial|so sagt|laut|nach angaben)\b/i.test(b);

  const has_technical_detail =
    (rawBody.match(/^```/gm) ?? []).length >= 1 ||
    /\b(api|sdk|token|parameter|curl|bash|typescript|python|json|endpoint|webhook|oauth|http|rest|graphql)\b/i.test(b);

  const has_visual_demo_refs =
    /\!\[.*?\]\(.*?\)/.test(rawBody) ||
    /\b(screenshot|demo|video|gif|animation|live.?demo|interactive|visuali[sz]ierung)\b/i.test(b);

  const has_data_table =
    /^\|.+\|[\r\n]+\|[-| :]+\|/m.test(rawBody);

  const has_glossary_terms =
    collection === "ki-wissen" ||
    /\*\*[A-Za-zÄÖÜäöüß][^*]{2,40}\*\*\s*[—:–]/.test(rawBody) ||
    /\b(glossar|definition|was ist|bedeutet|erklärt|begriffe)\b/i.test(b);

  const has_news_angle =
    /\b(2025|2026)\b.*\b(neu|update|launch|release|angekündigt|eingeführt|jetzt|aktuell)\b/i.test(b) ||
    /\b(breaking|just released|neu erschienen|ab sofort|neu angekündigt)\b/i.test(b);

  return {
    has_verdict,
    has_step_sequence,
    has_numbered_list,
    has_pro_con_lists,
    has_use_case_examples,
    has_warnings,
    has_pricing_data,
    has_quotes_or_testimonial,
    has_technical_detail,
    has_visual_demo_refs,
    has_data_table,
    has_glossary_terms,
    has_news_angle,
  };
}

// ─── Template suggestions ─────────────────────────────────────────────────────

interface TemplateSuggestion {
  templateKey: string;
  confidence: number;
  primaryAngle: string;
  estimatedSlides: number;
}

function suggestTemplates(
  collection: string,
  fm: Record<string, unknown>,
  hooks: ContentHooks,
  containerFormHint: string,
  title: string
): TemplateSuggestion[] {
  const suggestions: TemplateSuggestion[] = [];

  // ── single-tool-deep-dive ──
  if (collection === "tools") {
    suggestions.push({
      templateKey: "single-tool-spotlight",
      confidence: 0.9,
      primaryAngle: `${title} — Kurzportrait: Stärken, Pricing, für wen geeignet`,
      estimatedSlides: 6,
    });
    if (hooks.has_pro_con_lists) {
      suggestions.push({
        templateKey: "pro-con-verdict",
        confidence: 0.85,
        primaryAngle: `${title} — Pros & Cons auf einen Blick`,
        estimatedSlides: 5,
      });
    }
    if (hooks.has_pricing_data) {
      suggestions.push({
        templateKey: "price-comparison",
        confidence: 0.7,
        primaryAngle: `${title} Pricing-Übersicht: Free vs. Pro`,
        estimatedSlides: 4,
      });
    }
    if (hooks.has_use_case_examples) {
      suggestions.push({
        templateKey: "use-case-application",
        confidence: 0.75,
        primaryAngle: `${title} in der Praxis: Top Use Cases`,
        estimatedSlides: 5,
      });
    }
  }

  // ── comparison-2 / comparison-list ──
  if (collection === "comparisons") {
    const tools = (fm["toolSlugs"] as string[] | undefined) ?? [];
    suggestions.push({
      templateKey: "comparison-cover",
      confidence: 0.95,
      primaryAngle: tools.slice(0, 3).join(" vs ") + " — Wer gewinnt?",
      estimatedSlides: tools.length <= 2 ? 5 : 7,
    });
    if (hooks.has_verdict && fm["winner"]) {
      suggestions.push({
        templateKey: "pro-con-verdict",
        confidence: 0.8,
        primaryAngle: `Klarer Gewinner: ${fm["winner"]} — so lautet unser Verdict`,
        estimatedSlides: 4,
      });
    }
    // One spotlight per compared tool
    for (const toolSlug of tools.slice(0, 3)) {
      suggestions.push({
        templateKey: "single-tool-spotlight",
        confidence: 0.6,
        primaryAngle: `${toolSlug} isoliert betrachtet — Stärken im Vergleich`,
        estimatedSlides: 5,
      });
    }
    if (hooks.has_pricing_data) {
      suggestions.push({
        templateKey: "price-comparison",
        confidence: 0.85,
        primaryAngle: `${tools.slice(0, 3).join(" vs ")} — Preisvergleich`,
        estimatedSlides: 4,
      });
    }
  }

  // ── concept-explainer (ki-wissen) ──
  if (collection === "ki-wissen") {
    suggestions.push({
      templateKey: "concept-explainer-deck",
      confidence: 0.9,
      primaryAngle: `${title} — einfach erklärt in ${hooks.has_numbered_list ? "Schritten" : "5 Folien"}`,
      estimatedSlides: 6,
    });
    if (hooks.has_glossary_terms) {
      suggestions.push({
        templateKey: "mythbuster",
        confidence: 0.65,
        primaryAngle: `3 Missverständnisse zu "${title}" — richtiggestellt`,
        estimatedSlides: 5,
      });
    }
    if (hooks.has_step_sequence || hooks.has_numbered_list) {
      suggestions.push({
        templateKey: "howto-step-sequence",
        confidence: 0.7,
        primaryAngle: `${title} — Schritt-für-Schritt`,
        estimatedSlides: 6,
      });
    }
  }

  // ── application-scenario (usecases) ──
  if (collection === "usecases") {
    suggestions.push({
      templateKey: "use-case-application",
      confidence: 0.9,
      primaryAngle: `KI für ${title} — konkrete Anwendungsszenarien`,
      estimatedSlides: 6,
    });
    const featTools = (fm["featuredToolSlugs"] as string[] | undefined) ?? [];
    for (const t of featTools.slice(0, 2)) {
      suggestions.push({
        templateKey: "single-tool-spotlight",
        confidence: 0.65,
        primaryAngle: `${t} für ${title} — so setzt du es ein`,
        estimatedSlides: 5,
      });
    }
    if (hooks.has_warnings) {
      suggestions.push({
        templateKey: "mythbuster",
        confidence: 0.6,
        primaryAngle: `KI in ${title}: Risiken und was du beachten musst`,
        estimatedSlides: 5,
      });
    }
  }

  // ── howto-guide (blog with step signals) ──
  if (collection === "blog" && containerFormHint === "howto-guide") {
    suggestions.push({
      templateKey: "howto-step-sequence",
      confidence: 0.9,
      primaryAngle: title,
      estimatedSlides: 7,
    });
    if (hooks.has_warnings) {
      suggestions.push({
        templateKey: "mythbuster",
        confidence: 0.6,
        primaryAngle: `${title}: Typische Fehler vermeiden`,
        estimatedSlides: 5,
      });
    }
  }

  // ── opinion-piece (blog non-howto) ──
  if (collection === "blog" && containerFormHint === "opinion-piece") {
    if (hooks.has_data_table || hooks.has_numbered_list) {
      suggestions.push({
        templateKey: "tool-recap-list",
        confidence: 0.75,
        primaryAngle: title,
        estimatedSlides: 6,
      });
    }
    if (hooks.has_news_angle) {
      suggestions.push({
        templateKey: "news-breaking",
        confidence: 0.7,
        primaryAngle: `Update: ${title}`,
        estimatedSlides: 4,
      });
    }
    if (hooks.has_step_sequence) {
      suggestions.push({
        templateKey: "howto-step-sequence",
        confidence: 0.65,
        primaryAngle: title,
        estimatedSlides: 6,
      });
    }
    if (suggestions.length === 0) {
      suggestions.push({
        templateKey: "concept-explainer-deck",
        confidence: 0.5,
        primaryAngle: title,
        estimatedSlides: 5,
      });
    }
  }

  // ── news-update ──
  if (containerFormHint === "news-update") {
    suggestions.push({
      templateKey: "news-breaking",
      confidence: 0.85,
      primaryAngle: title,
      estimatedSlides: 4,
    });
  }

  // ── category-hub ──
  if (collection === "tool-categories") {
    suggestions.push({
      templateKey: "tool-recap-list",
      confidence: 0.8,
      primaryAngle: `Die besten Tools für: ${title}`,
      estimatedSlides: 6,
    });
  }

  // ── landing-page ──
  if (collection === "special-landings") {
    suggestions.push({
      templateKey: "single-tool-spotlight",
      confidence: 0.85,
      primaryAngle: `${title} — vollständiger Guide`,
      estimatedSlides: 7,
    });
    if (hooks.has_pricing_data) {
      suggestions.push({
        templateKey: "price-comparison",
        confidence: 0.7,
        primaryAngle: `${title} Pricing — alle Tarife im Überblick`,
        estimatedSlides: 4,
      });
    }
    if (hooks.has_pro_con_lists) {
      suggestions.push({
        templateKey: "pro-con-verdict",
        confidence: 0.7,
        primaryAngle: `${title} — lohnt es sich?`,
        estimatedSlides: 5,
      });
    }
  }

  // Deduplicate by templateKey (keep highest confidence)
  const seen = new Map<string, TemplateSuggestion>();
  for (const s of suggestions) {
    const existing = seen.get(s.templateKey);
    if (!existing || s.confidence > existing.confidence) seen.set(s.templateKey, s);
  }
  return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
}

// ─── Narrative arc from headings ──────────────────────────────────────────────

function buildNarrativeArc(
  title: string,
  collection: string,
  fm: Record<string, unknown>,
  body: string
): string {
  const h2s = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim());
  const first3 = h2s.slice(0, 3).join(" → ");

  if (collection === "tools") {
    const rating = fm["rating"] ? ` (Rating: ${fm["rating"]})` : "";
    const pricing = fm["pricing"] ? `, Preismodell: ${fm["pricing"]}` : "";
    return `Tool-Profil${rating}${pricing}. Struktur: ${first3 || "Kurzbeschreibung + Pros/Cons + Pricing"}.`;
  }
  if (collection === "comparisons") {
    const tools = (fm["toolSlugs"] as string[] | undefined)?.join(" vs ") ?? "mehrere Tools";
    const winner = fm["winner"] ? ` Gewinner: ${fm["winner"]}.` : "";
    return `Head-to-Head-Vergleich: ${tools}.${winner} Struktur: ${first3 || "TL;DR → Vergleichstabelle → Verdict"}.`;
  }
  if (collection === "ki-wissen") {
    const level = fm["level"] ? ` Zielgruppe: ${fm["level"]}.` : "";
    return `Konzept-Erklärung: "${title}".${level} Struktur: ${first3 || "Definition → Funktionsweise → Praxisrelevanz"}.`;
  }
  if (collection === "usecases") {
    const industry = fm["industryFocus"] ? ` Branche: ${fm["industryFocus"]}.` : "";
    return `Branchen-Use-Case: "${title}".${industry} Struktur: ${first3 || "Überblick → Anwendungsfelder → Tool-Empfehlungen"}.`;
  }
  if (collection === "blog") {
    const cat = fm["category"] ? ` Kategorie: ${fm["category"]}.` : "";
    return `Blog-Artikel: "${title}".${cat} Struktur: ${first3 || h2s.slice(0, 2).join(" → ") || "Einleitung → Hauptteil → Fazit"}.`;
  }
  if (collection === "special-landings") {
    return `Spezial-Landing für "${title}". Struktur: ${first3 || "Übersicht → Features → Pricing → FAQ"}.`;
  }
  if (collection === "tool-categories") {
    return `Kategorie-Hub: "${title}". Struktur: ${first3 || "Marktübersicht → Tool-Liste → Empfehlung"}.`;
  }
  return `Artikel: "${title}". Struktur: ${first3}.`;
}

// ─── File walker ──────────────────────────────────────────────────────────────

interface ArticleFile {
  collection: string;
  slug: string;
  fm: Record<string, unknown>;
  body: string;
  translationKey: string;
}

function walkCollection(collection: string): ArticleFile[] {
  const deDir = join(ASTRO_CONTENT, collection, "de");
  let files: string[];
  try {
    files = readdirSync(deDir).filter((f) => extname(f) === ".mdx" || extname(f) === ".md");
  } catch {
    return [];
  }
  return files.flatMap((f) => {
    const full = join(deDir, f);
    if (!statSync(full).isFile()) return [];
    const raw = readFileSync(full, "utf-8");
    const { fm, body } = parseFrontmatter(raw);
    const slug = (fm["slug"] as string | undefined) ?? f.replace(/\.(mdx|md)$/, "");
    const translationKey = (fm["translationKey"] as string | undefined) ?? slug;
    return [{ collection, slug, fm, body, translationKey }];
  });
}

// ─── Load DB index: slug+collection+locale → { id, containerFormHint } ────────

const dbRows = await db.execute<{
  id: string;
  collection: string;
  locale: string;
  slug: string;
  translation_key: string | null;
  container_form_hint: string | null;
}>(sql`
  SELECT a.id, a.collection, a.locale, a.slug, a.translation_key,
         d.container_form_hint
  FROM articles a
  LEFT JOIN article_discovery d ON d.article_id = a.id
  WHERE a.source = 'imported' AND a.collection != 'authors'
`);

// Index by "collection:locale:slug"
const byKey = new Map(dbRows.map((r) => [`${r.collection}:${r.locale}:${r.slug}`, r]));
// Index by "collection:locale:translationKey"
const byTk = new Map(dbRows.map((r) => [`${r.collection}:${r.locale}:${r.translation_key}`, r]));

function findDeRow(collection: string, slug: string, translationKey: string) {
  return (
    byKey.get(`${collection}:de:${slug}`) ??
    byTk.get(`${collection}:de:${translationKey}`)
  );
}
function findEnRow(collection: string, translationKey: string, slug: string) {
  return (
    byTk.get(`${collection}:en:${translationKey}`) ??
    byKey.get(`${collection}:en:${slug}`)
  );
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let processed = 0;
let mirrored = 0;
let missed = 0;

for (const collection of CONTENT_COLLECTIONS) {
  const articles = walkCollection(collection);
  console.log(`[${collection}] ${articles.length} DE files`);

  for (const art of articles) {
    const deRow = findDeRow(collection, art.slug, art.translationKey);
    if (!deRow) {
      console.warn(`  MISS DE: ${collection}/de/${art.slug} (tk=${art.translationKey})`);
      missed++;
      continue;
    }

    const hooks = classifyHooks(art.fm, art.body, collection);
    const hint = deRow.container_form_hint ?? "unknown";
    const title = (art.fm["title"] as string | undefined) ?? art.slug;
    const templates = suggestTemplates(collection, art.fm, hooks, hint, title);
    const narrativeArc = buildNarrativeArc(title, collection, art.fm, art.body);
    const estimatedCarousels = templates.length;

    const hooksJson = JSON.stringify(hooks);
    const templatesJson = JSON.stringify(templates);

    // Update DE
    await db.execute(sql`
      UPDATE article_discovery SET
        content_hooks       = ${hooksJson}::jsonb,
        suggested_templates = ${templatesJson}::jsonb,
        narrative_arc       = ${narrativeArc},
        estimated_carousels = ${estimatedCarousels},
        enrichment_mode     = 'llm_enriched',
        enrichment_run_at   = now(),
        updated_at          = now()
      WHERE article_id = ${deRow.id}
    `);
    processed++;

    // Mirror to EN sibling
    const enRow = findEnRow(collection, art.translationKey, art.slug);
    if (enRow) {
      await db.execute(sql`
        UPDATE article_discovery SET
          content_hooks       = ${hooksJson}::jsonb,
          suggested_templates = ${templatesJson}::jsonb,
          narrative_arc       = ${narrativeArc},
          estimated_carousels = ${estimatedCarousels},
          enrichment_mode     = 'llm_enriched',
          enrichment_run_at   = now(),
          updated_at          = now()
        WHERE article_id = ${enRow.id}
      `);
      mirrored++;
    } else {
      console.warn(`  MISS EN mirror: ${collection}/en/${art.translationKey}`);
    }
  }
}

console.log(`\nDone. DE processed: ${processed}, EN mirrored: ${mirrored}, missed: ${missed}`);

// ─── Phase 2 distribution summary ────────────────────────────────────────────

console.log("\n── content hooks frequency ──");
const hookCols = [
  "has_verdict", "has_step_sequence", "has_numbered_list", "has_pro_con_lists",
  "has_use_case_examples", "has_warnings", "has_pricing_data",
  "has_quotes_or_testimonial", "has_technical_detail", "has_visual_demo_refs",
  "has_data_table", "has_glossary_terms", "has_news_angle",
];
for (const hook of hookCols) {
  const r = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM article_discovery
    WHERE (content_hooks->>${hook})::boolean = true
  `);
  const cnt = parseInt(r[0]?.cnt ?? "0");
  const bar = "█".repeat(Math.round(cnt / 4));
  console.log(`  ${hook.padEnd(30)} ${String(cnt).padStart(3)}  ${bar}`);
}

console.log("\n── suggested templates frequency ──");
const tmplFreq = await db.execute<{ tkey: string; cnt: string }>(sql`
  SELECT t->>'templateKey' as tkey, COUNT(*) as cnt
  FROM article_discovery,
       jsonb_array_elements(suggested_templates) AS t
  GROUP BY tkey
  ORDER BY cnt DESC
`);
for (const r of tmplFreq) {
  const bar = "█".repeat(Math.round(parseInt(r.cnt) / 4));
  console.log(`  ${(r.tkey ?? "?").padEnd(30)} ${String(r.cnt).padStart(3)}  ${bar}`);
}

console.log("\n── total estimated carousels ──");
const totals = await db.execute<{ total: string; avg: string; max: string }>(sql`
  SELECT SUM(estimated_carousels) as total,
         ROUND(AVG(estimated_carousels), 1) as avg,
         MAX(estimated_carousels) as max
  FROM article_discovery
  WHERE enrichment_mode = 'llm_enriched'
`);
console.log(`  total=${totals[0]?.total}  avg=${totals[0]?.avg}  max=${totals[0]?.max}`);

console.log("\n── top 20 articles by recycling potential ──");
const top20 = await db.execute<{
  title: string | null; collection: string; locale: string; slug: string; cnt: number;
}>(sql`
  SELECT a.title, a.collection, a.locale, a.slug, d.estimated_carousels as cnt
  FROM article_discovery d
  JOIN articles a ON a.id = d.article_id
  WHERE d.enrichment_mode = 'llm_enriched' AND a.locale = 'de'
  ORDER BY d.estimated_carousels DESC, d.completeness_score DESC
  LIMIT 20
`);
for (const r of top20) {
  console.log(`  [${r.collection}] ${r.slug}  →  ${r.cnt} templates`);
}

process.exit(0);
