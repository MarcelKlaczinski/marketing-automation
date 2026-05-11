/**
 * Gap-service: LLM-backed suggestions for content gaps.
 *
 * Extracted from routes/projects.ts so that the route handler stays thin glue
 * and adapter calls (anthropic) are not made directly from route files.
 * (CLAUDE.md: "DO NOT call adapters directly from routes")
 */

import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core";
import { clusters, db } from "@marketing-auto/db";
import { loadProjectContext } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";

const log = createLogger("gap-service");

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
  metaDescription: string;
  heroImagePrompt: string;
}

/**
 * Call Claude Haiku to suggest title / slug / metaDescription / heroImagePrompt
 * for a content gap (~€0.01).
 *
 * Also loads cluster.satelliteKeywords so the LLM can anchor the title to real
 * search keywords from Cold-Start Phase 3 keyword research.
 */
export async function suggestGapTitle(input: GapSuggestionInput): Promise<GapSuggestion | null> {
  const { projectId, gap } = input;
  const meta = (gap.metadata ?? {}) as Record<string, string | number | string[] | undefined>;

  const clusterName = (meta.clusterName as string | undefined) ?? "unknown cluster";
  const intentType  = gap.intentType ?? null;
  const locale      = gap.locale ?? "de";
  const lang        = locale === "de" ? "German" : "English";

  // Load cluster keyword data (populated by Cold-Start Phase 3) so Claude can anchor
  // the title to real search terms rather than guessing from the cluster name alone.
  let clusterKeywordHint = "";
  if (gap.clusterId) {
    const [clusterRow] = await db
      .select({ satelliteKeywords: clusters.satelliteKeywords })
      .from(clusters)
      .where(eq(clusters.id, gap.clusterId))
      .limit(1);

    const entries = clusterRow?.satelliteKeywords ?? [];
    const topKeywords = entries
      .flatMap((e) => [
        e.cornerstoneKeyword,
        ...e.keywords.slice(0, 3).map((k) => k.keyword),
      ])
      .slice(0, 8);

    if (topKeywords.length > 0) {
      clusterKeywordHint = `\n\nCluster keywords (from keyword research — use the most relevant as the cornerstone keyword for this article):\n${topKeywords.map((k) => `- ${k}`).join("\n")}`;
    }
  }

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

  const systemPrompt = `You are a content strategist. Your job is to suggest SEO-optimised article metadata.${contextSection}${clusterKeywordHint}

Respond ONLY with a JSON object — no prose, no markdown fences. Schema:
{
  "title": string,              // headline, 50–70 chars, ${lang}, hooks reader attention
  "slug": string,               // URL slug: lowercase, hyphens, max 60 chars, no special chars
  "cornerstoneKeyword": string, // the primary search keyword this article targets (use one from the cluster list above if available)
  "metaDescription": string,    // 140–160 chars, ${lang}, includes cornerstone keyword
  "heroImagePrompt": string     // Stable Diffusion / DALL-E prompt for the hero image, vivid and specific, English
}`;

  const userMessage = `Suggest metadata for a new ${lang} article that fills this content gap:

Gap type: ${gap.gapType}
Article needed: ${gapDesc}
Target locale: ${locale}
${intentType ? `Intent type: ${intentType}` : ""}

The article must match the brand voice and cover the cluster topic of "${clusterName}". Pick the most strategic cornerstone keyword from the cluster list.`;

  try {
    const result = await anthropic.messages({
      projectId,
      operation:        COST_OPS.GAP_TITLE_SUGGEST,
      model:            "claude-haiku-4-5",
      systemPrefix:     systemPrompt,
      systemSuffix:     "", // all instructions are in systemPrefix for this cheap call
      userMessage,
      maxTokens:        500,
      jsonMode:         true,
      estimatedCostEur: 0.01,
    });

    const parsed = result.json as Partial<GapSuggestion & { cornerstoneKeyword?: string }>;
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
    } as GapSuggestion & { cornerstoneKeyword: string };
  } catch (err) {
    log.error({ gapId: gap.id, err }, "LLM suggestion failed");
    return null;
  }
}
