import { z } from "zod";
import type { ExternalSignal } from "@marketing-auto/db";

// ─── Re-export for callers that need the signal type ─────────────────────────
export type { ExternalSignal };

// ─── Synthesis output (mirrors Zod schema in synthesize.ts) ──────────────────

export const SynthesisTopicSchema = z.object({
  topic_title: z.string().min(5).max(300),
  primary_keyword: z.string().min(2).max(100),
  secondary_keywords: z.array(z.string()).min(0).max(10),
  intent_type: z.string(),
  generation_mode: z
    .enum(["evergreen", "timely", "pillar", "spoke", "refresh", "translation"])
    .default("timely"),
  suggested_title: z.string().min(10).max(200),
  suggested_slug: z.string().regex(/^[a-z0-9-]+$/).max(100),
  suggested_meta: z.string().min(50).max(300).transform((s) => s.slice(0, 160)),
  hero_image_prompt: z.string().min(80).max(800),
  related_signal_ids: z.array(z.string().uuid()).min(1).max(20),
  freshness_window: z.enum(["breaking", "rising", "stable"]),
  relevance_score: z.number().int().min(0).max(100),
});

export type SynthesisTopic = z.infer<typeof SynthesisTopicSchema>;

export const SynthesisOutputSchema = z.object({
  topics: z.array(SynthesisTopicSchema).min(0).max(15),
  unclustered_signal_ids: z.array(z.string().uuid()).default([]),
});

export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;

// ─── Score breakdown ──────────────────────────────────────────────────────────

export type ScoreBreakdown = {
  community_buzz: number;             // 0-100
  search_volume_growth: number;       // 0-100
  official_announcement: number;      // 0 or 100
  serp_volatility: number;            // 0-100
  source_diversity: number;           // 0, 50, or 100 (1 / 2 / 3+ distinct sources)
  existing_coverage_penalty: number;  // 0-100 (subtracted in total)
  total: number;                      // 0-100, clamped
};

// ─── Coverage check result ────────────────────────────────────────────────────

export type CoverageResult = {
  covered: boolean;
  similarity: number;
  matchedArticleId: string | null;
};

// ─── Cluster match result ─────────────────────────────────────────────────────

export type ClusterMatchResult =
  | { matched: true; clusterId: string; similarity: number }
  | { matched: false };

// ─── Well-known vendor domains for official announcement bonus ────────────────

export const MAJOR_VENDOR_DOMAINS = new Set([
  // OpenAI
  "openai.com",
  // Anthropic
  "anthropic.com",
  // Google / DeepMind
  "google.com",
  "ai.google",
  "deepmind.google",
  "blog.google",
  "ai.googleblog.com",
  "research.google",
  // Hugging Face
  "huggingface.co",
  // Mistral AI
  "mistral.ai",
  // GitHub / Microsoft
  "github.blog",
  "github.com",
  "microsoft.com",
  "devblogs.microsoft.com",
  "blogs.microsoft.com",
  // Cohere
  "cohere.com",
  // Stability AI
  "stability.ai",
  // Meta AI / FAIR
  "ai.meta.com",
  "ai.facebook.com",
  "meta.com",
  // Cursor
  "cursor.com",
  "cursor.sh",
  // Replicate
  "replicate.com",
  // Together AI
  "together.ai",
  // AWS
  "aws.amazon.com",
  // NVIDIA
  "blogs.nvidia.com",
  // Others
  "fireworks.ai",
  "perplexity.ai",
]);
