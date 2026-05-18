import { z } from "zod";

export const qualityFindingsSchema = z.object({
  outdatedClaims: z.array(z.object({
    snippet: z.string().max(200).transform((s) => s.slice(0, 200)),
    reason:  z.string().max(500).transform((s) => s.slice(0, 500)),
  })).max(20),
  missingCoverage: z.array(z.string().max(200).transform((s) => s.slice(0, 200))).max(20),
  staleReferences: z.array(z.object({
    entity: z.string().max(100).transform((s) => s.slice(0, 100)),
    note:   z.string().max(300).transform((s) => s.slice(0, 300)),
  })).max(20),
  overallRecommendation: z.enum(["refresh-now", "refresh-soon", "no-action"]),
  confidence: z.enum(["high", "medium", "low"]),
});

export type QualityFindings = z.infer<typeof qualityFindingsSchema>;

export function buildReasoningString(findings: QualityFindings): string {
  if (findings.overallRecommendation === "no-action") {
    return `LLM: No refresh needed (${findings.confidence} confidence)`;
  }
  const parts: string[] = [];
  if (findings.outdatedClaims.length > 0) parts.push(`${findings.outdatedClaims.length} outdated claim(s)`);
  if (findings.missingCoverage.length > 0) parts.push(`${findings.missingCoverage.length} missing topic(s)`);
  if (findings.staleReferences.length > 0) parts.push(`${findings.staleReferences.length} stale reference(s)`);
  return `${findings.overallRecommendation} (${findings.confidence}): ${parts.join(", ")}`;
}
