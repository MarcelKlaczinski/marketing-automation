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
  suggested_meta: z.string().min(50).max(160),
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
  community_buzz: number;         // 0-100
  search_volume_growth: number;   // 0-100
  official_announcement: number;  // 0 or 100
  serp_volatility: number;        // 0-100
  existing_coverage_penalty: number;  // 0-100 (subtracted in total)
  total: number;                  // 0-100, clamped
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
  "openai.com",
  "anthropic.com",
  "google.com",
  "ai.google",
  "deepmind.google",
  "blog.google",
  "huggingface.co",
  "mistral.ai",
  "meta.com",
  "ai.meta.com",
  "stability.ai",
  "cohere.com",
  "together.ai",
  "fireworks.ai",
  "perplexity.ai",
]);
