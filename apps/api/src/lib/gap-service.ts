/**
 * Gap-service: LLM-backed suggestions for content gaps.
 *
 * Extracted from routes/projects.ts so that the route handler stays thin glue
 * and adapter calls (anthropic, dataforseo) are not made directly from route files.
 * (CLAUDE.md: "DO NOT call adapters directly from routes")
 */

import { anthropic } from "@marketing-auto/adapter-anthropic";
import { dataforseo } from "@marketing-auto/adapter-dataforseo";
import { COST_OPS } from "@marketing-auto/core";
import { clusters, db } from "@marketing-auto/db";
import { loadProjectContext } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import type { KeywordOverviewItem } from "@marketing-auto/adapter-dataforseo";

const log = createLogger("gap-service");

// Germany (de) and US (en) location/language codes for DataForSEO
const LOCALE_TO_DFS: Record<string, { locationCode: number; languageCode: string }> = {
  de: { locationCode: 2276, languageCode: "de" },
  en: { locationCode: 2840, languageCode: "en" },
};

export interface GapSuggestionInput {
  projectId: string;
  gap: {
    id: string;
    gapType: string;
    clusterId: string | null;
    intentType: string | null;
    locale: string | null;
    metadata: Record<string, unknown> | null;
  };
}

export interface GapSuggestion {
  title: string;
  slug: string;
  cornerstoneKeyword: string;
  metaDescription: string;
  heroImagePrompt: string;
}

/**
 * Format a KeywordOverviewItem into a compact hint line for the LLM prompt.
 * Example: "ki tools bildung — vol: 2,400/mo, difficulty: 32/100 (LOW)"
 */
function formatKeywordHint(item: KeywordOverviewItem): string {
  const vol = item.searchVolume != null
    ? `vol: ${item.searchVolume.toLocaleString("en")}/mo`
    : "vol: n/a";
  const diff = item.keywordDifficulty != null
    ? `difficulty: ${item.keywordDifficulty}/100${item.competitionLevel ? ` (${item.competitionLevel})` : ""}`
    : "";
  const intent = item.mainIntent ? ` [${item.mainIntent}]` : "";
  return `- "${item.keyword}" — ${[vol, diff].filter(Boolean).join(", ")}${intent}`;
}

/**
 * Call Claude Haiku to suggest title / slug / cornerstoneKeyword / metaDescription / heroImagePrompt
 * for a content gap.
 *
 * Context pipeline:
 * 1. Loads cluster.satelliteKeywords (Cold-Start Phase 3) — base keyword list
 * 2. Calls DataForSEO keywordOverview() to enrich with search volume + keyword difficulty
 *    so Haiku picks a rankable keyword, not just a plausible-sounding one
 * 3. Calls Claude Haiku with enriched context → ~€0.01 LLM + ~€0.002 DataForSEO
 *
 * DataForSEO errors are caught and fall back gracefully (suggestion still produced
 * without volume data).
 */
export async function suggestGapTitle(input: GapSuggestionInput): Promise<GapSuggestion | null> {
  const { projectId, gap } = input;
  const meta = (gap.metadata ?? {}) as Record<string, string | number | string[] | undefined>;

  const clusterName = (meta.clusterName as string | undefined) ?? "unknown cluster";
  const intentType  = gap.intentType ?? null;
  const locale      = gap.locale ?? "de";
  const lang        = locale === "de" ? "German" : "English";
  const dfsLocale   = LOCALE_TO_DFS[locale] ?? LOCALE_TO_DFS["de"]!;

  // ── Step 1: load cluster keyword list from Cold-Start Phase 3 ────────────────
  let rawKeywords: string[] = [];
  if (gap.clusterId) {
    const [clusterRow] = await db
      .select({ satelliteKeywords: clusters.satelliteKeywords })
      .from(clusters)
      .where(eq(clusters.id, gap.clusterId))
      .limit(1);

    const entries = clusterRow?.satelliteKeywords ?? [];
    rawKeywords = entries
      .flatMap((e) => [
        e.cornerstoneKeyword,
        ...e.keywords.slice(0, 3).map((k) => k.keyword),
      ])
      .slice(0, 15); // DataForSEO keywordOverview handles up to 700; 15 is plenty
  }

  // ── Step 2: DataForSEO keyword overview — volume + difficulty per keyword ────
  let keywordHintLines: string[] = [];
  if (rawKeywords.length > 0) {
    try {
      const overview = await dataforseo.keywordOverview({
        projectId,
        operation:        COST_OPS.GAP_KEYWORD_OVERVIEW,
        estimatedCostEur: 0.01,
        keywords:         rawKeywords,
        locationCode:     dfsLocale.locationCode,
        languageCode:     dfsLocale.languageCode,
      });

      // Sort by best score: high volume + low difficulty → top of list
      const scored = overview.items
        .filter((item) => item.keyword)
        .map((item) => ({
          item,
          score: (item.searchVolume ?? 0) / Math.max(1, item.keywordDifficulty ?? 50),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);

      keywordHintLines = scored.map(({ item }) => formatKeywordHint(item));

      log.info(
        { gapId: gap.id, keywordCount: keywordHintLines.length },
        "DataForSEO keyword overview enriched gap suggestion"
      );
    } catch (err) {
      // DataForSEO is unavailable or not configured — fall back to raw keyword list
      log.warn({ gapId: gap.id, err }, "DataForSEO keyword overview failed, using raw keyword list");
      keywordHintLines = rawKeywords.map((k) => `- "${k}"`);
    }
  }

  const clusterKeywordHint = keywordHintLines.length > 0
    ? `\n\nCluster keywords with SEO data (volume/difficulty from DataForSEO — sorted best-first):\n${keywordHintLines.join("\n")}\n\nPick the keyword with the best balance of search volume and low difficulty (difficulty ≤ 50 preferred). This becomes the cornerstone keyword the title, slug, and meta must include naturally.`
    : "";

  // ── Step 3: Claude Haiku suggestion ─────────────────────────────────────────
  const gapDescriptions: Record<string, string> = {
    missing_hub:        `hub / pillar article for the cluster "${clusterName}"`,
    missing_spoke_type: `spoke article with intent "${intentType}" for the cluster "${clusterName}"`,
    cluster_too_small:  `additional spoke article for the cluster "${clusterName}" to grow the cluster`,
  };
  const gapDesc = gapDescriptions[gap.gapType] ?? `content gap for cluster "${clusterName}"`;

  const projectContext = await loadProjectContext(projectId);
  const contextSection = projectContext
    ? `\n\n<project_context>\n${projectContext}\n</project_context>`
    : "";

  const systemPrompt = `You are a content strategist and SEO specialist. Your job is to suggest metadata for a new article that will rank on Google.${contextSection}${clusterKeywordHint}

Respond ONLY with a JSON object — no prose, no markdown fences. Schema:
{
  "cornerstoneKeyword": string, // the primary search keyword (pick from the list above; must be exact match)
  "title": string,              // headline, 50–70 chars, ${lang}, naturally includes cornerstone keyword, hooks reader
  "slug": string,               // URL slug: lowercase, hyphens, max 60 chars, derived from keyword, no special chars
  "metaDescription": string,    // 140–160 chars, ${lang}, includes cornerstone keyword, action-oriented
  "heroImagePrompt": string     // Stable Diffusion / DALL-E prompt for hero image, vivid and specific, English
}`;

  const userMessage = `Suggest SEO-optimised metadata for a new ${lang} article that fills this content gap:

Gap type: ${gap.gapType}
Article needed: ${gapDesc}
Target locale: ${locale}
${intentType ? `Intent type: ${intentType}` : ""}

Choose the cornerstone keyword from the list above that has the best ranking opportunity (high volume, low-medium difficulty). Make sure the title sounds natural to a human reader while including the keyword.`;

  try {
    const result = await anthropic.messages({
      projectId,
      operation:        COST_OPS.GAP_TITLE_SUGGEST,
      model:            "claude-haiku-4-5",
      systemPrefix:     systemPrompt,
      systemSuffix:     "", // all instructions in systemPrefix for this cheap call
      userMessage,
      maxTokens:        500,
      jsonMode:         true,
      estimatedCostEur: 0.01,
    });

    const parsed = result.json as Partial<GapSuggestion>;
    if (!parsed.title || !parsed.slug || !parsed.metaDescription || !parsed.heroImagePrompt) {
      log.warn({ gapId: gap.id, parsed }, "Incomplete suggestion from LLM");
      return null;
    }

    return {
      title:              parsed.title,
      slug:               parsed.slug,
      cornerstoneKeyword: parsed.cornerstoneKeyword ?? parsed.slug,
      metaDescription:    parsed.metaDescription,
      heroImagePrompt:    parsed.heroImagePrompt,
    };
  } catch (err) {
    log.error({ gapId: gap.id, err }, "LLM suggestion failed");
    return null;
  }
}
