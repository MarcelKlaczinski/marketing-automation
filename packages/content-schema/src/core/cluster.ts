import { z } from "zod";

// ───── clusterCore (Bucket B per Phase-1 §3) ──────────────────────────────────
//
// Hub-Spoke topology fields. Universal across content domains because the
// Hub-Spoke SEO strategy is generic — Toolwiki uses it for AI-tools
// clusters, BK will use it for product-category clusters.

export const ClusterRoleSchema = z.enum(["hub", "spoke"]);
export type ClusterRole = z.infer<typeof ClusterRoleSchema>;

export const clusterCore = z.object({
  clusterKey: z.string().min(1).max(80).optional(),
  clusterRole: ClusterRoleSchema.optional(),
  parentSlug: z.string().min(1).max(80).optional(),
  /** Position within the cluster — 0-based; lower = earlier in nav. */
  clusterOrder: z.number().int().min(0).optional(),
});
export type ClusterCore = z.infer<typeof clusterCore>;
