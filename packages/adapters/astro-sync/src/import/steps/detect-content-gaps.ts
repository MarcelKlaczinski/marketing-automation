// Spec 49b: Content Gap Detection — zero-LLM, zero-cost. Safe to re-run (idempotent).
// Detects missing_hub, missing_translation, missing_spoke_type, cluster_too_small gaps
// and writes them to content_gaps table. Existing open gaps are re-stamped; resolved
// gaps (no longer applicable) are automatically closed.
// Spec 54.1: dual-writes a topic_briefs row for every open/restamped gap inside the
// same db.transaction(), keeping gap + brief creation atomic.

import { articles, clusters, contentGaps, db, projects, topicBriefs } from "@marketing-auto/db";
import { BaseStep, GapAnalysisTopicSource, type StepContext } from "@marketing-auto/pipelines";
import { createLogger } from "@marketing-auto/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

const log = createLogger("astro-import:detect-gaps");

// Intent types expected in a well-formed cluster that has a hub
const EXPECTED_SPOKE_INTENTS = ["comparison", "pricing", "alternatives", "use_case"] as const;

const InputSchema = z.object({
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  gapsCreated:   z.number(),
  gapsRestamped: z.number(),
  gapsResolved:  z.number(),
  totalOpen:     z.number(),
});

type GapInsert = typeof contentGaps.$inferInsert;

/** Stable fingerprint for dedup — mirrors the partial unique index */
function fingerprint(
  clusterId: string | null | undefined,
  gapType: string,
  locale: string | null | undefined,
  intentType: string | null | undefined,
  translationKey: string | null | undefined
): string {
  return [
    clusterId ?? "",
    gapType,
    locale ?? "",
    intentType ?? "",
    translationKey ?? "",
  ].join("|");
}

export class DetectContentGapsStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "detect-content-gaps";
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

    // ── 1. Load clusters with member counts ───────────────────────────────────
    const clusterRows = await db
      .select({
        id:              clusters.id,
        name:            clusters.name,
        pillarArticleId: clusters.pillarArticleId,
        memberCount:     sql<number>`count(${articles.id})::int`,
      })
      .from(clusters)
      .leftJoin(articles, eq(articles.clusterId, clusters.id))
      .where(eq(clusters.projectId, projectId))
      .groupBy(clusters.id, clusters.name, clusters.pillarArticleId);

    // ── 2. Load all imported articles ─────────────────────────────────────────
    const articleRows = await db
      .select({
        id:             articles.id,
        clusterId:      articles.clusterId,
        clusterRole:    articles.clusterRole,
        intentType:     articles.intentType,
        locale:         articles.locale,
        translationKey: articles.translationKey,
        slug:           articles.slug,
      })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.source, "imported")
        )
      );

    // ── 3. Build gap candidates ───────────────────────────────────────────────
    const candidates: GapInsert[] = [];

    for (const cluster of clusterRows) {
      const members = articleRows.filter((a) => a.clusterId === cluster.id);
      const spokes  = members.filter((a) => a.clusterRole === "spoke");
      const hasHub  = cluster.pillarArticleId !== null;
      const count   = cluster.memberCount;

      // missing_hub: has spokes but no hub
      if (spokes.length > 0 && !hasHub) {
        candidates.push({
          projectId,
          clusterId:  cluster.id,
          gapType:    "missing_hub",
          priority:   count >= 5 ? 1 : 2,
          metadata: {
            clusterName:        cluster.name,
            clusterMemberCount: count,
          },
        });
      }

      // cluster_too_small: fewer than 3 total articles
      if (count < 3) {
        candidates.push({
          projectId,
          clusterId:  cluster.id,
          gapType:    "cluster_too_small",
          priority:   count <= 1 ? 2 : 3,
          metadata: {
            clusterName:        cluster.name,
            clusterMemberCount: count,
          },
        });
      }

      // missing_spoke_type: only if cluster already has a hub
      if (hasHub) {
        const presentIntents = new Set(
          members.map((a) => a.intentType).filter((i): i is string => !!i)
        );
        for (const intent of EXPECTED_SPOKE_INTENTS) {
          if (!presentIntents.has(intent)) {
            candidates.push({
              projectId,
              clusterId:  cluster.id,
              gapType:    "missing_spoke_type",
              intentType: intent,
              priority:   2,
              metadata: {
                clusterName:        cluster.name,
                clusterMemberCount: count,
                spokesPresent:      [...presentIntents],
              },
            });
          }
        }
      }
    }

    // missing_translation: group by translationKey, find unpaired locales
    const byKey = new Map<string, typeof articleRows>();
    for (const a of articleRows) {
      if (!a.translationKey) continue;
      const group = byKey.get(a.translationKey) ?? [];
      group.push(a);
      byKey.set(a.translationKey, group);
    }

    for (const [key, group] of byKey) {
      const locales = new Set(group.map((a) => a.locale));
      const isHub   = group.some((a) => a.clusterRole === "hub");

      for (const [existing, missing] of [["de", "en"], ["en", "de"]] as const) {
        if (locales.has(existing) && !locales.has(missing)) {
          const existingArticle = group.find((a) => a.locale === existing);
          const cluster = clusterRows.find((c) => c.id === existingArticle?.clusterId);
          const translationMeta: import("@marketing-auto/db").ContentGapMetadata = {
            clusterName:        cluster?.name ?? "unknown",
            clusterMemberCount: cluster?.memberCount ?? 0,
            existingLocale:     existing,
            ...(existingArticle?.slug ? { existingArticleSlug: existingArticle.slug } : {}),
          };
          candidates.push({
            projectId,
            clusterId:      existingArticle?.clusterId ?? null,
            gapType:        "missing_translation",
            locale:         missing,
            translationKey: key,
            priority:       isHub ? 1 : 2,
            metadata:       translationMeta,
          });
        }
      }
    }

    // ── 4. Load existing open gaps ────────────────────────────────────────────
    const statuses: Array<"open" | "in_progress"> = ["open", "in_progress"];
    const openGaps = await db
      .select({
        id:             contentGaps.id,
        clusterId:      contentGaps.clusterId,
        gapType:        contentGaps.gapType,
        locale:         contentGaps.locale,
        intentType:     contentGaps.intentType,
        translationKey: contentGaps.translationKey,
      })
      .from(contentGaps)
      .where(
        and(
          eq(contentGaps.projectId, projectId),
          inArray(contentGaps.status, statuses)
        )
      );

    // Build lookup of existing open gaps by fingerprint
    const existingByFp = new Map(
      openGaps.map((g) => [
        fingerprint(g.clusterId, g.gapType, g.locale, g.intentType, g.translationKey),
        g.id,
      ])
    );

    // ── 5 + 6 + 54.1: Insert/restamp gaps, resolve stale ones, dual-write briefs ─
    // All writes in a single transaction: gap row and its brief are created together
    // or not at all (spec 54.1 atomicity requirement).

    const validFingerprints = new Set(
      candidates.map((c) =>
        fingerprint(c.clusterId, c.gapType, c.locale ?? null, c.intentType ?? null, c.translationKey ?? null)
      )
    );

    const toResolveIds = openGaps
      .filter(
        (g) =>
          !validFingerprints.has(
            fingerprint(g.clusterId, g.gapType, g.locale, g.intentType, g.translationKey)
          )
      )
      .map((g) => g.id);

    const { gapsCreated, gapsRestamped, gapsResolved } = await db.transaction(async (tx) => {
      let created   = 0;
      let restamped = 0;

      // Collect full gap rows for brief emission
      const newGapRows:       import("@marketing-auto/db").ContentGap[] = [];
      const restampedGapIds:  string[] = [];

      for (const gap of candidates) {
        const fp = fingerprint(
          gap.clusterId,
          gap.gapType,
          gap.locale ?? null,
          gap.intentType ?? null,
          gap.translationKey ?? null
        );
        const existingId = existingByFp.get(fp);

        if (existingId) {
          await tx
            .update(contentGaps)
            .set({ detectedAt: new Date(), updatedAt: new Date() })
            .where(eq(contentGaps.id, existingId));
          restampedGapIds.push(existingId);
          restamped += 1;
        } else {
          const [row] = await tx
            .insert(contentGaps)
            .values({ ...gap, detectedAt: new Date() })
            .returning();
          if (row) newGapRows.push(row);
          created += 1;
        }
      }

      // Resolve stale gaps
      let resolved = 0;
      if (toResolveIds.length > 0) {
        const resolvedRows = await tx
          .update(contentGaps)
          .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(contentGaps.projectId, projectId),
              inArray(contentGaps.id, toResolveIds)
            )
          )
          .returning({ id: contentGaps.id });
        resolved = resolvedRows.length;
      }

      // ── 54.1: emit and upsert topic_briefs ───────────────────────────────────

      // Load full rows for restamped gaps so mapGapToBrief has all fields
      const restampedGapRows: import("@marketing-auto/db").ContentGap[] =
        restampedGapIds.length > 0
          ? await tx.select().from(contentGaps).where(inArray(contentGaps.id, restampedGapIds))
          : [];

      const source = new GapAnalysisTopicSource();
      const briefs = await source.emit(
        { gaps: [...newGapRows, ...restampedGapRows] },
        { projectId },
      );

      if (briefs.length > 0) {
        // Under exactOptionalPropertyTypes, TopicBriefInsert optional fields are 'T | undefined'
        // but Drizzle's insert type expects 'T | null'. mapGapToBrief never emits undefined
        // (all absent optional fields are set to null explicitly), so this strip is safe.
        const dbBriefs = briefs.map((b) =>
          Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined))
        ) as Array<typeof topicBriefs.$inferInsert>;

        await tx
          .insert(topicBriefs)
          .values(dbBriefs)
          .onConflictDoUpdate({
            target: topicBriefs.gapId,
            // targetWhere mirrors the partial unique index predicate
            targetWhere: sql`approval_status IN ('pending', 'approved', 'auto_approved', 'routed')`,
            set: {
              topicTitle:  sql`excluded.topic_title`,
              gapMetadata: sql`excluded.gap_metadata`,
              updatedAt:   sql`now()`,
            },
          });
      }

      // Mark superseded for resolved gaps
      if (toResolveIds.length > 0) {
        const activeStatuses: Array<"pending" | "approved" | "auto_approved"> = [
          "pending", "approved", "auto_approved",
        ];
        await tx
          .update(topicBriefs)
          .set({ approvalStatus: "superseded", updatedAt: new Date() })
          .where(
            and(
              inArray(topicBriefs.gapId, toResolveIds),
              inArray(topicBriefs.approvalStatus, activeStatuses),
            )
          );
      }

      return { gapsCreated: created, gapsRestamped: restamped, gapsResolved: resolved };
    });

    // ── 7. Count total open gaps after the run ────────────────────────────────
    const totalOpenResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentGaps)
      .where(
        and(
          eq(contentGaps.projectId, projectId),
          inArray(contentGaps.status, statuses)
        )
      );
    const totalOpen = totalOpenResult[0]?.count ?? 0;

    // ── 8. Update projects.gaps_last_detected_at ──────────────────────────────
    await db
      .update(projects)
      .set({ gapsLastDetectedAt: new Date() })
      .where(eq(projects.id, projectId));

    log.info(
      { gapsCreated, gapsRestamped, gapsResolved, totalOpen },
      "Content gap detection complete"
    );

    return { gapsCreated, gapsRestamped, gapsResolved, totalOpen };
  }
}
