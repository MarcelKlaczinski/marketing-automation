/**
 * Spec 65.2 follow-up — import a tool brand-asset from a remote SVG URL.
 *
 * Use case: tools that fall through the resolver chain (lobe-icons → simple-
 * icons → iconify → deterministic-avatar) and end up on the avatar fallback.
 * Marcel wants the real brand logo + colors but doesn't want to type-pick
 * 30+ rows in the UI. This script lets him batch-import from any public
 * source — Brandfetch is bot-blocked behind Cloudflare so we point at the
 * brand's own website CDN (Webflow, Squarespace, custom) instead.
 *
 * The values flow through the SAME `uploadCustomLogo` + `upsertBrandAsset`
 * helpers the UI uses, so `source='manual'` is set and Marcel-edits via the
 * UI later still survive a re-resolve. (Re-resolve preserves Marcel-curated
 * fields — Spec 65.2 Q2 design.)
 *
 * Usage:
 *   bun --filter @marketing-auto/api import-tool-brand-asset --project=<slug>
 *
 * No CLI args for the per-tool spec yet — edit BRAND_IMPORTS below for the
 * batch. Mirrors the inventory-seed.ts shape (hardcoded entries are explicit +
 * grep-friendly; Marcel can copy-paste for future imports).
 */
import { articles, db, eq, projects, sql } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { parseArgs } from "node:util";
import { upsertBrandAsset } from "@marketing-auto/db";
import { uploadCustomLogo } from "../lib/tool-brand-asset-service.ts";

const log = createLogger("import-tool-brand-asset");

interface BrandImport {
  /** `articles.slug` of the tool-article. Backfill targets the project's primary-locale row. */
  slug: string;
  /**
   * Source for the SVG content. Exactly one of:
   * - `logoUrl`: remote URL (brand's own website CDN — Brandfetch is Cloudflare-blocked).
   * - `logoFile`: absolute local filesystem path (e.g. `~/Downloads/<brand>.svg`). Use when
   *   the brand's hosted SVG is a different/worse variant than what they expose via their
   *   Brandfetch dossier — Marcel downloads the canonical asset there and points to disk.
   */
  logoUrl?: string;
  logoFile?: string;
  /** Primary brand color, 6-digit hex. Sample from the brand's website CSS or marketing page. */
  primaryColor: string;
  /** Secondary brand color, 6-digit hex. Typically the dark accent / headline color. */
  secondaryColor: string;
  /** Tertiary brand color, 6-digit hex. Typically the light tint / surface color. Optional. */
  tertiaryColor?: string;
  /** Canonical brand name (overrides `articles.title` if it differs from the SEO/SERP name). */
  brandNameCanonical: string;
}

// Brand colors below come from Brandfetch's official palette (Marcel-provided
// 2026-05-25). Pick the darkest/most-contrasting "support" color as secondary
// rather than the light background tint (Selago / Aqua Haze) — carousel
// templates want a high-contrast pair for the headline + accent surfaces, not
// a near-white that would render invisibly on light cards.
const BRAND_IMPORTS: BrandImport[] = [
  {
    slug: "beautiful-ai",
    // Marcel-supplied canonical SVG from the Beautiful.ai Brandfetch dossier
    // (2026-05-25). The Webflow-CDN logo we used initially was a different
    // variant that rendered poorly on the dark UI — this is the proper
    // wordmark with the `#168EF9` accent dot baked in.
    logoFile: "/Users/marcelklaczinski/Downloads/Beautiful-ai/Beautiful-ai_idghgO_QWM_1.svg",
    // Full Brandfetch palette: Dodger Blue + Black + Aqua Haze (light tint).
    primaryColor: "#168EF9",
    secondaryColor: "#000000",
    tertiaryColor: "#F2F5F8",
    brandNameCanonical: "Beautiful.ai",
  },
  {
    slug: "anyword",
    logoUrl:
      "https://cdn.prod.website-files.com/65a5365ee6f4219bc2d2f822/65ae548143e3b5eca08c4093_Logo.svg",
    // Full Brandfetch palette: Cornflower Blue + Cello + Selago (light tint).
    primaryColor: "#6093F4",
    secondaryColor: "#1C2E59",
    tertiaryColor: "#F5F8FE",
    brandNameCanonical: "Anyword",
  },
];

function resolvePrimaryLocale(targetLocales: string[] | null): string {
  const first = targetLocales?.[0];
  return first ? (first.split("-")[0] ?? "de") : "de";
}

async function importOne(entry: BrandImport, projectId: string, projectSlug: string, primaryLocale: string) {
  // Resolve the toolId for this slug in the project's primary locale.
  const [tool] = await db
    .select({ id: articles.id, title: articles.title })
    .from(articles)
    .where(
      sql`${articles.projectId} = ${projectId}
        AND ${articles.collection} = 'tools'
        AND ${articles.slug} = ${entry.slug}
        AND ${articles.locale} = ${primaryLocale}`,
    )
    .limit(1);

  if (!tool) {
    log.warn({ slug: entry.slug, projectSlug, primaryLocale }, "tool-article not found — skipping");
    return { slug: entry.slug, status: "missing" as const };
  }

  // Read the SVG — either from a local filesystem path (Marcel downloaded
  // the canonical asset) or from a remote URL (brand's own website CDN; cap
  // at the same 100KB the uploadCustomLogo helper enforces).
  if (!entry.logoUrl && !entry.logoFile) {
    log.warn({ slug: entry.slug }, "neither logoUrl nor logoFile provided");
    return { slug: entry.slug, status: "no_source" as const };
  }
  let svgContent: string;
  if (entry.logoFile) {
    const file = Bun.file(entry.logoFile);
    if (!(await file.exists())) {
      log.warn({ slug: entry.slug, path: entry.logoFile }, "local logo file not found");
      return { slug: entry.slug, status: "fetch_failed" as const };
    }
    svgContent = await file.text();
  } else {
    const res = await fetch(entry.logoUrl!);
    if (!res.ok) {
      log.warn({ slug: entry.slug, url: entry.logoUrl, status: res.status }, "logo fetch failed");
      return { slug: entry.slug, status: "fetch_failed" as const };
    }
    svgContent = await res.text();
  }
  if (!svgContent.trimStart().startsWith("<svg") && !svgContent.trimStart().startsWith("<?xml")) {
    log.warn({ slug: entry.slug, prefix: svgContent.slice(0, 80) }, "logo body is not SVG");
    return { slug: entry.slug, status: "not_svg" as const };
  }

  // Upload to R2 (or local dev fallback) via the shared helper, then upsert
  // the row through the same path the UI uses on PATCH save.
  const upload = await uploadCustomLogo({
    toolId: tool.id,
    projectSlug,
    svgContent,
  });

  const row = await upsertBrandAsset({
    toolId: tool.id,
    logoUrl: upload.logoUrl,
    primaryColor: entry.primaryColor,
    secondaryColor: entry.secondaryColor,
    tertiaryColor: entry.tertiaryColor ?? null,
    brandNameCanonical: entry.brandNameCanonical,
    source: "manual",
    needsReview: false,
    fetchedAt: new Date(),
  });

  log.info(
    {
      slug: entry.slug,
      toolId: tool.id,
      logoR2Key: upload.logoR2Key,
      bytes: svgContent.length,
      primaryColor: entry.primaryColor,
    },
    "imported brand asset",
  );
  return { slug: entry.slug, status: "imported" as const, brandAssetSource: row.source };
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { project: { type: "string" } },
  });
  if (!values.project) throw new Error("--project=<slug> is required");

  const [proj] = await db
    .select({ id: projects.id, slug: projects.slug, targetLocales: projects.targetLocales })
    .from(projects)
    .where(eq(projects.slug, values.project))
    .limit(1);
  if (!proj) throw new Error(`project not found: ${values.project}`);

  const primaryLocale = resolvePrimaryLocale(proj.targetLocales);
  log.info(
    { projectSlug: proj.slug, primaryLocale, batchSize: BRAND_IMPORTS.length },
    "importing brand assets",
  );

  const results = [];
  for (const entry of BRAND_IMPORTS) {
    try {
      results.push(await importOne(entry, proj.id, proj.slug, primaryLocale));
    } catch (err) {
      log.error({ slug: entry.slug, err }, "import failed");
      results.push({ slug: entry.slug, status: "error" as const });
    }
  }

  // biome-ignore lint/suspicious/noConsoleLog: script output
  console.log(JSON.stringify({ results }, null, 2));
  process.exit(0);
}

if (import.meta.main) {
  void main();
}
