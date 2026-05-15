import { z } from "zod";

export const ClusterProposalSchema = z.object({
  cluster_name: z.string().min(2).max(100),
  primary_keyword: z.string().min(2).max(100),
  description: z.string().max(500),
  intent_taxonomy_override: z.array(z.string().min(1)).min(1).max(10).nullable(),

  pillar_title: z.string().min(10).max(200),
  pillar_slug: z.string().regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens only"),
  pillar_meta: z.string().min(50).max(160),
  pillar_outline: z.array(z.string().min(5).max(150)).min(5).max(10),

  spoke_intent_for_originating_brief: z.string().min(1),
  reasoning: z.string(),
});

export type ClusterProposal = z.infer<typeof ClusterProposalSchema>;
