import type { TopicBrief } from "@marketing-auto/db";

export type { TopicBrief };

export interface AuthorCandidate {
  slug: string;
  name: string;
  score: number;
  reasoning: string;
}

export interface AuthorPickResult {
  authorSlug: string;
  authorName: string;
  matchStrategy: "historic_score" | "embedding_fallback" | "default_fallback";
  matchScore: number;
  candidates: AuthorCandidate[];
}

export interface HistoricScoreRow {
  slug: string;
  matchedOnCluster: number;
  matchedOnIntent: number;
  totalPosts: number;
  score: number;
}

export interface AuthorProfile {
  slug: string;
  name: string;
  expertise: string[];
  expertiseEmbedding?: number[];
}
