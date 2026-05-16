import { z } from "zod";
import type { Cluster, TopicBrief } from "@marketing-auto/db";

// ─── Input ────────────────────────────────────────────────────────────────────

export type ClusterPlanInput = {
  triggerBrief: TopicBrief;
  projectId: string;
  projectName: string;
  projectMarketingContextMd: string | null;
  existingPillars: { id: string; name: string }[];
  existingClusters: Pick<Cluster, "id" | "name">[];
};

// ─── LLM output schemas (what the model returns) ─────────────────────────────

export const ProposedSpokeSchema = z.object({
  proposedTitle: z.string().min(10).max(200),
  primaryKeyword: z.string().min(3).max(100),
  intentType: z.enum(["review", "comparison", "pricing", "tutorial", "use-cases", "features"]),
  estimatedWordCount: z.number().int().min(500).max(5000),
  rationale: z.string().min(10).max(500),
  position: z.number().int().min(0),
});

export const ProposedHubSchema = z.object({
  title: z.string().min(10).max(200),
  primaryKeyword: z.string().min(3).max(100),
  intentType: z.enum(["overview", "general"]),
  estimatedWordCount: z.number().int().min(800).max(5000),
  h2Outline: z.array(z.string().min(3).max(150)).min(4).max(10),
  metaDescription: z.string().max(160).optional(),
});

// Cast aliases — Zod .optional() on fields makes _input T | undefined, but _output is T.
// Under strictFunctionTypes this causes variance issues; casting here prevents them at the
// use-site without altering runtime behavior.
export const ProposedSpokeSchemaOut = ProposedSpokeSchema as z.ZodType<
  z.infer<typeof ProposedSpokeSchema>
>;
export const ProposedHubSchemaOut = ProposedHubSchema as z.ZodType<
  z.infer<typeof ProposedHubSchema>
>;

export const ClusterPlanOutputSchema = z.object({
  pillarId: z.string(), // existing pillar UUID or literal "new"
  pillarSuggestedName: z.string().min(2).max(100).nullable(),
  cluster: z.object({
    name: z.string().min(2).max(100),
    primaryKeyword: z.string().min(3).max(100),
  }),
  hub: ProposedHubSchema,
  spokes: z
    .array(ProposedSpokeSchema)
    .min(4, "LLM must propose at least 4 spokes")
    .max(6, "LLM must propose at most 6 spokes")
    .refine(
      (spokes) => new Set(spokes.map((s) => s.intentType)).size === spokes.length,
      "Each spoke must have a distinct intentType",
    ),
});

export type ClusterPlanOutput = z.infer<typeof ClusterPlanOutputSchema>;
export type ProposedSpokeParsed = z.infer<typeof ProposedSpokeSchema>;
export type ProposedHubParsed = z.infer<typeof ProposedHubSchema>;
