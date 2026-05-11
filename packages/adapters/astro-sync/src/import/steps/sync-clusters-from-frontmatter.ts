// Spec 49a: Auto-sync contentPillars + clusters + article links from frontmatter clusterKey.
// Zero-LLM, zero-cost — pure data structuring. Safe to re-run (idempotent).

import { articles, clusters, contentPillars, db } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";

const log = createLogger("astro-import:sync-clusters");

const InputSchema = z.object({
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  pillarsCreated: z.number(),
  pillarsUpdated: z.number(),
  clustersCreated: z.number(),
  clustersUpdated: z.number(),
  articlesLinked: z.number(),
  uncategorizedCount: z.number(),
  orphansDeleted: z.number(),
});

export class SyncClustersFromFrontmatterStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "sync-clusters-from-frontmatter";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema as z.ZodType<z.infer<typeof OutputSchema>>;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(
    input: z.infer<typeof InputSchema>,
    _ctx: StepContext
  ): Promise<z.infer<typeof OutputSchema>> {
    const { projectId } = input;

    // Step 1: distinct (clusterKey, category) groups for this project's imported articles
    const groupRows = await db
      .select({
        clusterKey: articles.clusterKey,
        category: articles.category,
      })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.source, "imported"),
          isNotNull(articles.clusterKey)
        )
      )
      .groupBy(articles.clusterKey, articles.category);

    log.info({ groups: groupRows.length }, "Distinct cluster groups found in frontmatter");

    // Step 2: materialize contentPillars from distinct categories
    const distinctCategories = [
      ...new Set(groupRows.map((g) => g.category).filter((c): c is string => !!c)),
    ];

    let pillarsCreated = 0;
    let pillarsUpdated = 0;
    const pillarByName = new Map<string, string>();

    // Load existing pillars first to avoid duplicates
    const existingPillars = await db
      .select({ id: contentPillars.id, name: contentPillars.name })
      .from(contentPillars)
      .where(eq(contentPillars.projectId, projectId));
    for (const p of existingPillars) {
      pillarByName.set(p.name, p.id);
    }

    let nextPosition = existingPillars.length;
    for (const cat of distinctCategories) {
      if (pillarByName.has(cat)) {
        pillarsUpdated += 1;
        continue;
      }
      const inserted = await db
        .insert(contentPillars)
        .values({
          projectId,
          name: cat,
          description: "Auto-imported from Astro repo frontmatter",
          position: nextPosition++,
        })
        .returning({ id: contentPillars.id });
      const pillar = inserted[0];
      if (pillar) {
        pillarByName.set(cat, pillar.id);
        pillarsCreated += 1;
      }
    }

    // Ensure an "Uncategorized" pillar exists for clusters without a category
    if (!pillarByName.has("Uncategorized")) {
      const inserted = await db
        .insert(contentPillars)
        .values({
          projectId,
          name: "Uncategorized",
          description: "Clusters without a frontmatter category",
          position: nextPosition++,
        })
        .returning({ id: contentPillars.id });
      const pillar = inserted[0];
      if (pillar) {
        pillarByName.set("Uncategorized", pillar.id);
        pillarsCreated += 1;
      }
    }
    // Guaranteed non-null: the block above always inserts "Uncategorized" when absent.
    // If the DB insert failed silently (returned empty rows), we surface a clear error
    // rather than letting a downstream FK violation produce a cryptic message.
    const uncategorizedPillarId = pillarByName.get("Uncategorized");
    if (!uncategorizedPillarId) {
      throw new Error("Failed to create or find Uncategorized pillar — cannot proceed with cluster sync");
    }

    // Step 3: for each distinct clusterKey, upsert a cluster row
    const distinctClusterKeys = [
      ...new Set(groupRows.map((g) => g.clusterKey).filter((k): k is string => !!k)),
    ];

    let clustersCreated = 0;
    let clustersUpdated = 0;
    let articlesLinked = 0;

    for (const clusterKey of distinctClusterKeys) {
      // Load all member articles for this cluster (across all locales)
      const members = await db
        .select({
          id: articles.id,
          clusterRole: articles.clusterRole,
          category: articles.category,
          cornerstoneKeyword: articles.cornerstoneKeyword,
          locale: articles.locale,
        })
        .from(articles)
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.clusterKey, clusterKey)
          )
        );

      if (members.length === 0) continue;

      // Pick category from first member that has one
      const memberCategory = members.find((m) => m.category)?.category ?? null;
      const pillarId = memberCategory
        ? (pillarByName.get(memberCategory) ?? uncategorizedPillarId)
        : uncategorizedPillarId;

      // Find hub article — prefer DE locale, fall back to first hub
      const cornerstones = members.filter((m) => m.clusterRole === "hub");
      const cornerstone =
        cornerstones.find((c) => c.locale === "de") ?? cornerstones[0] ?? null;

      // Collect unique cornerstone keywords from all cornerstone-role articles
      const cornerstoneKeywords = [
        ...new Set(
          cornerstones
            .map((c) => c.cornerstoneKeyword)
            .filter((k): k is string => !!k && k.length > 0)
        ),
      ];

      // Upsert: check existence by (projectId, name=clusterKey) — our natural key
      const existing = await db
        .select({ id: clusters.id })
        .from(clusters)
        .where(and(eq(clusters.projectId, projectId), eq(clusters.name, clusterKey)))
        .limit(1);

      let clusterId: string;
      if (existing.length > 0) {
        clusterId = existing[0]!.id;
        await db
          .update(clusters)
          .set({
            pillarId,
            pillar: memberCategory,
            primaryKeyword: cornerstone?.cornerstoneKeyword ?? null,
            cornerstoneKeywords,
            pillarArticleId: cornerstone?.id ?? null,
            status: "approved",
          })
          .where(eq(clusters.id, clusterId));
        clustersUpdated += 1;
      } else {
        const inserted = await db
          .insert(clusters)
          .values({
            projectId,
            pillarId,
            name: clusterKey,
            pillar: memberCategory,
            primaryKeyword: cornerstone?.cornerstoneKeyword ?? null,
            cornerstoneKeywords,
            satelliteKeywords: [],
            status: "approved",
            pillarArticleId: cornerstone?.id ?? null,
          })
          .returning({ id: clusters.id });
        const cluster = inserted[0];
        if (!cluster) continue;
        clusterId = cluster.id;
        clustersCreated += 1;
      }

      // Link all members to this cluster
      const linked = await db
        .update(articles)
        .set({ clusterId })
        .where(
          and(
            eq(articles.projectId, projectId),
            eq(articles.clusterKey, clusterKey)
          )
        )
        .returning({ id: articles.id });
      articlesLinked += linked.length;
    }

    // Step 4: count articles that remain uncategorized (no clusterKey)
    const uncatResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.source, "imported"),
          sql`${articles.clusterKey} IS NULL`
        )
      );
    const uncategorizedCount = uncatResult[0]?.count ?? 0;

    // Step 5: delete cluster rows no longer referenced by any article (orphans after key rename)
    let orphansDeleted = 0;
    if (distinctClusterKeys.length > 0) {
      const orphaned = await db
        .delete(clusters)
        .where(
          and(
            eq(clusters.projectId, projectId),
            notInArray(clusters.name, distinctClusterKeys)
          )
        )
        .returning({ id: clusters.id, name: clusters.name });

      orphansDeleted = orphaned.length;

      if (orphansDeleted > 0) {
        log.info(
          { count: orphansDeleted, names: orphaned.map((o) => o.name) },
          "Deleted orphaned cluster rows (no articles reference them)"
        );
      }
    }

    log.info(
      { pillarsCreated, pillarsUpdated, clustersCreated, clustersUpdated, articlesLinked, uncategorizedCount, orphansDeleted },
      "Cluster sync complete"
    );

    return { pillarsCreated, pillarsUpdated, clustersCreated, clustersUpdated, articlesLinked, uncategorizedCount, orphansDeleted };
  }
}
