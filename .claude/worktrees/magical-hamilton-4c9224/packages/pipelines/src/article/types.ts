import { z } from "zod";

// ───── Outline ────────────────────────────────────────────────────────────────

export const ArticleOutlineSchema = z.object({
  title: z.string().min(20).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(100),
  metaDescription: z.string().min(80).max(180),

  /** Opening angle — ~150 words of intro guidance for the draft step. */
  introAngle: z.string().min(100).max(2000),

  /** H2 sections in writing order. */
  sections: z
    .array(
      z.object({
        h2: z.string().min(5).max(150),
        intent: z.string().min(20).max(500),
        keyPoints: z.array(z.string().min(10)).min(2).max(10),
        estimatedWords: z.number().int().min(100).max(800),
        // .default([]) makes _input optional; LLM may omit when no satellites apply.
        targetKeywords: z.array(z.string()).default([]),
      })
    )
    .min(4)
    .max(12),

  /** Hero image direction for Flux 1.1 Pro. */
  heroImagePrompt: z.string().min(30).max(1000),
  heroImageStyle: z.enum(["photorealistic", "illustrated", "3d_render", "minimalist"]),

  /** Estimated total word count (sum of section estimates + intro/outro buffer). */
  estimatedTotalWords: z.number().int().min(800).max(5000),
});

export type ArticleOutline = z.infer<typeof ArticleOutlineSchema>;

// Safe cast: .default([]) on targetKeywords makes _input optional (string[] | undefined)
// while _output is string[]. ZodType<ArticleOutline> checks _input against _output, which
// causes a variance error under strictFunctionTypes. The cast is safe because .parse()
// always produces ArticleOutline (the default fills in any missing field at parse time).
export const ArticleOutlineSchemaOutput = ArticleOutlineSchema as z.ZodType<ArticleOutline>;

// ───── Self-Review ────────────────────────────────────────────────────────────

export const SelfReviewIssueSchema = z.object({
  severity: z.enum(["critical", "warning", "suggestion"]),
  category: z.enum([
    "voice_drift",
    "factual_concern",
    "weak_intro",
    "weak_conclusion",
    "section_imbalance",
    "keyword_stuffing",
    "missing_examples",
    "verbose",
    "other",
  ]),
  location: z.string(),
  description: z.string(),
  suggestion: z.string().optional(),
});

export type SelfReviewIssue = z.infer<typeof SelfReviewIssueSchema>;

// ───── Research ───────────────────────────────────────────────────────────────

export const ResearchResultSchema = z.object({
  serp: z.object({
    keyword: z.string(),
    organicResults: z.array(
      z.object({
        position: z.number(),
        url: z.string(),
        title: z.string(),
        snippet: z.string(),
        domain: z.string(),
      })
    ),
    peopleAlsoAsk: z.array(z.string()),
    relatedSearches: z.array(z.string()),
    serpFeatures: z.array(z.string()),
  }),
  /**
   * Synthesis of what the top ranking pages cover.
   * Fed into outline generation.
   */
  competitorSynthesis: z.string().min(200),
});

export type ResearchResult = z.infer<typeof ResearchResultSchema>;

// ───── Errors ─────────────────────────────────────────────────────────────────

export class ArticlePipelineError extends Error {
  constructor(
    message: string,
    public readonly stage:
      | "topic_intake"
      | "research"
      | "outline"
      | "draft"
      | "review"
      | "image"
      | "assembly"
      | "localize",
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "ArticlePipelineError";
  }
}
