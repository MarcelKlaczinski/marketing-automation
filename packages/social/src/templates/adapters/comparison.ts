import type { Article } from "@marketing-auto/db";
import type { PricingRow, ToolReference, UseCaseVerdict } from "./types.ts";

export interface ComparisonContext {
  tools: ToolReference[];
  verdict: string;
  winner?: string;
  testMethodology?: string;
  useCaseVerdicts: UseCaseVerdict[];
  pricingTable?: PricingRow[];
}

interface ComparisonExtras {
  toolSlugs?: string[];
  verdict?: string;
  winner?: string;
  testMethodology?: string;
  useCaseVerdicts?: UseCaseVerdict[];
  pricingTable?: PricingRow[];
}

export function getComparisonContext(
  article: Article,
  toolLookup: Map<string, ToolReference>,
): ComparisonContext {
  if (article.collection !== "comparisons") {
    throw new Error(`Article "${article.slug}" is not in the comparisons collection`);
  }

  const extras = (article.domainExtras ?? {}) as ComparisonExtras;
  const tools = (extras.toolSlugs ?? [])
    .map((slug) => toolLookup.get(slug))
    .filter((t): t is ToolReference => t != null);

  return {
    tools,
    verdict: extras.verdict ?? "",
    ...(extras.winner !== undefined && { winner: extras.winner }),
    ...(extras.testMethodology !== undefined && { testMethodology: extras.testMethodology }),
    useCaseVerdicts: extras.useCaseVerdicts ?? [],
    ...(extras.pricingTable !== undefined && { pricingTable: extras.pricingTable }),
  };
}
