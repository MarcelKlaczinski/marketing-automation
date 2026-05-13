import { anthropic } from "@marketing-auto/adapter-anthropic";
import type { Article } from "@marketing-auto/db";
import type { DeterministicFields } from "./deterministicEnrichment.ts";
import type { ArticleDiscoverySuggestedTemplates, ArticleDiscoveryContentHooks } from "@marketing-auto/db";

export interface LlmEnrichmentFields {
  contentHooks: ArticleDiscoveryContentHooks;
  suggestedTemplates: ArticleDiscoverySuggestedTemplates;
  narrativeArc: string;
  estimatedCarousels: number;
}

const TEMPLATE_DEFINITIONS = `
Available templates (use ONLY these keys):
- comparison-stunning           eligible: comparisons with toolSlugs >= 2 AND verdict
- use-case-verdict-per-tool     eligible: comparisons with useCaseVerdicts 3..8 (all have winner+reason)
- single-tool-spotlight         eligible: tools collection OR spotlight from comparison
- news-slide                    eligible: news-update container form (blog < 60 days old)
- concept-explainer-deck        eligible: ki-wissen collection OR concept-explainer container form
- pro-con-verdict               eligible: has_pro_con_lists AND has_verdict
- price-comparison              eligible: has_pricing_data AND referenced tools >= 2
`.trim();

const CONTENT_HOOKS_SPEC = `
Content hooks (strict — tag only if SIGNIFICANTLY present):
- has_verdict          explicit winner/verdict/fazit section or field
- has_step_sequence    numbered steps in H2/H3 headings or body
- has_numbered_list    >= 3 numbered list items in body
- has_pro_con_lists    explicit pros/cons section or frontmatter pros[]/cons[]
- has_use_case_examples >= 2 concrete use-case examples or useCaseVerdicts[]
- has_warnings         ⚠️/🚨 callouts or explicit risk notes
- has_pricing_data     actual price numbers or pricing table
- has_technical_detail code blocks OR API/SDK/curl/JSON mentions
- has_visual_demo_refs markdown images or screenshot/demo/video references
- has_data_table       actual markdown pipe table
- has_news_angle       dated update (2025/2026 + neu/launch/release keywords)
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
}

export async function runLlmEnrichment(
  article: Article,
  det: DeterministicFields,
  projectId: string,
): Promise<{ fields: LlmEnrichmentFields; costUsd: number }> {
  const body = article.bodyMd ?? "";
  const fx = (article.frontmatterExtras ?? {}) as Record<string, unknown>;

  const userMessage = `Classify this article for Instagram Carousel template routing.

ARTICLE METADATA:
- Slug: ${article.slug}
- Collection: ${article.collection ?? "unknown"}
- Locale: ${article.locale ?? "de"}
- Title: ${article.title ?? "(no title)"}
- Container-Form-Hint (deterministic): ${det.containerFormHint}
- Word-Count: ${det.wordCount}
- H2-Headings: ${det.headerSlugs.slice(0, 10).join(", ") || "(none)"}
- Referenced Tools: ${det.referencedTools.join(", ") || "(none)"}

BODY EXCERPT (first 2000 chars):
${body.slice(0, 2000)}

FRONTMATTER EXTRAS:
${JSON.stringify(fx, null, 2).slice(0, 1000)}

TASK:
1. Identify which contentHooks are SIGNIFICANTLY present (array of strings, strict).
2. Write narrativeArc (2-3 specific sentences about this article's story logic).
3. Suggest templates (only eligible ones, ordered by confidence desc).
4. Set estimatedCarousels = count of suggestedTemplates with confidence >= 0.6.

Return JSON:
{
  "contentHooks": ["has_verdict"],
  "narrativeArc": "...",
  "suggestedTemplates": [
    { "templateKey": "...", "confidence": 0.95, "primaryAngle": "...", "estimatedSlides": 5 }
  ],
  "estimatedCarousels": 1
}`;

  const result = await anthropic.messages({
    projectId,
    operation: "discovery-classify",
    model: "claude-haiku-4-5",
    systemPrefix: `You are a content classification system for a social-media carousel generator.\n\n${TEMPLATE_DEFINITIONS}\n\n${CONTENT_HOOKS_SPEC}\n\nBe STRICT about content hooks. Be SPECIFIC in narrativeArc — mention the actual topic and unique angle.`,
    systemSuffix: "",
    userMessage,
    jsonMode: true,
    estimatedCostEur: 0.006,
    maxTokens: 800,
  });

  const parsed = result.json as LLMClassification;
  if (!parsed || !Array.isArray(parsed.contentHooks)) {
    throw new Error(`Invalid LLM classification response for article ${article.id}`);
  }

  const contentHooks: ArticleDiscoveryContentHooks = Object.fromEntries(
    (parsed.contentHooks as string[]).map((k) => [k, true])
  );

  const suggestedTemplates: ArticleDiscoverySuggestedTemplates = (parsed.suggestedTemplates ?? []).map((s) => ({
    templateKey: s.templateKey,
    confidence: s.confidence,
  }));

  // estimatedCostEur drives the cost-tracker; outputTokens used here for result summary only
  const costUsd = (result.outputTokens / 1_000_000) * 4.00 + 0.004; // ~avg input cost

  return {
    fields: {
      contentHooks,
      suggestedTemplates,
      narrativeArc: parsed.narrativeArc ?? "",
      estimatedCarousels: parsed.estimatedCarousels ?? 0,
    },
    costUsd,
  };
}
