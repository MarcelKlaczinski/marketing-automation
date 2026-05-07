import { z } from "zod";

export const PagespeedScoresSchema = z.object({
  performance: z.number().min(0).max(100),
  accessibility: z.number().min(0).max(100),
  bestPractices: z.number().min(0).max(100),
  seo: z.number().min(0).max(100),
});
export type PagespeedScores = z.infer<typeof PagespeedScoresSchema>;

export const CoreWebVitalsSchema = z.object({
  lcp: z.number().min(0),
  inp: z.number().min(0).nullable(),
  cls: z.number().min(0),
});
export type CoreWebVitals = z.infer<typeof CoreWebVitalsSchema>;

export type PagespeedOutcome = "pass" | "fail" | "error";

export class PagespeedError extends Error {
  constructor(
    message: string,
    public readonly stage: "clone" | "build" | "preview" | "lighthouse" | "evaluate" | "config",
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "PagespeedError";
  }
}
