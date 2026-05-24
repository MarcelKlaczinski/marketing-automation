import type { QualityFindings } from "./schema.ts";

export function buildQualityAnalysisPrompt(input: {
  title: string;
  body: string;
  domainExtras: Record<string, unknown>;
  locale: string;
  daysSinceRefresh: number | "unknown";
}): string {
  const cluster = typeof input.domainExtras.cluster === "string"
    ? input.domainExtras.cluster
    : "n/a";

  return `You are reviewing a published article to identify if it needs refreshing. Analyze for outdated claims, missing coverage, and stale references based on your general knowledge.

ARTICLE METADATA:
- Title: ${input.title}
- Locale: ${input.locale}
- Days since last refresh: ${input.daysSinceRefresh}
- Cluster/category: ${cluster}

ARTICLE BODY:
"""
${input.body.slice(0, 8000)}${input.body.length > 8000 ? "\n[... article truncated for analysis ...]" : ""}
"""

ANALYSIS INSTRUCTIONS:
1. Identify outdated claims: factual statements that may have changed (pricing, features, market position, version numbers).
2. Identify missing coverage: topics, tools, or developments the article should cover but doesn't.
3. Identify stale references: mentions of tools, products, or companies that may have evolved.
4. Recommend an overall action: "refresh-now" (clearly outdated), "refresh-soon" (some staleness), or "no-action" (still accurate).
5. State your confidence: high (clear evidence), medium (some uncertainty), low (you're guessing).

IMPORTANT CONSTRAINTS:
- Only flag concrete issues. "Article is old" alone is NOT a finding — there must be specific outdated content.
- If the article is evergreen content (historical, conceptual, mathematical), recommend "no-action".
- Do not invent issues. If the article looks current, say so.
- Limit each finding's snippet to ~100 chars of relevant article text.

Respond with only a valid JSON object. No markdown, no explanation.

{
  "outdatedClaims": [{ "snippet": "...", "reason": "..." }],
  "missingCoverage": ["...", "..."],
  "staleReferences": [{ "entity": "...", "note": "..." }],
  "overallRecommendation": "refresh-now" | "refresh-soon" | "no-action",
  "confidence": "high" | "medium" | "low"
}`;
}

export function parseJsonFromRaw(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in LLM response");
  return JSON.parse(raw.slice(start, end + 1));
}

export function totalFindingsCount(findings: QualityFindings): number {
  return findings.outdatedClaims.length + findings.missingCoverage.length + findings.staleReferences.length;
}
