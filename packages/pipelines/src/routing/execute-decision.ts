import {
  and,
  eq,
  articles,
  cornerstoneSpecs,
  topicBriefs,
  type TopicBrief,
  type Transaction,
} from "@marketing-auto/db";
import type { RoutingDecision, RoutingResult } from "./types.ts";
import { RoutingNotImplementedError } from "./types.ts";

/**
 * Executes a routing decision inside a transaction.
 *
 * Atomicity invariant: the article/spec/translation INSERT and the brief update
 * to approval_status='routed' happen in the same transaction. If the pipeline
 * chain enqueue (caller's responsibility) fails afterward, the brief is still
 * marked routed — acceptable, the chain can be retried manually.
 *
 * The transaction is passed in by the caller so this function can join an outer
 * transaction (e.g. /automate wraps multiple steps).
 */
export async function executeDecision(
  decision: RoutingDecision,
  brief: TopicBrief,
  tx: Transaction,
): Promise<RoutingResult> {
  switch (decision.kind) {
    case "create_article": {
      const slug =
        brief.suggestedSlug ??
        `gap-${(brief.gapId ?? brief.id).slice(0, 8)}`;

      const baseInsert = {
        projectId: brief.projectId,
        clusterId: brief.clusterId ?? null,
        cornerstoneKeyword: brief.primaryKeyword ?? null,
        locale: (brief.locale ?? "de") as "de" | "en",
        source: "generated" as const,
        collection: "blog" as const,
        clusterRole: "spoke" as const,
        status: "proposed" as const,
        approvalMode: (brief.approvalRequired ? "manual" : "auto") as "manual" | "auto",
        slug,
        title: brief.suggestedTitle ?? null,
      };
      const articleInsert: typeof articles.$inferInsert = {
        ...baseInsert,
        intentType: decision.intentType,
      };

      const [article] = await tx
        .insert(articles)
        .values(articleInsert)
        .returning({ id: articles.id });
      if (!article) throw new Error("Failed to insert article");

      await markBriefRouted(tx, brief.id, { routedArticleId: article.id });
      return { kind: "article_created", articleId: article.id, briefId: brief.id };
    }

    case "create_cornerstone_spec": {
      const proposedSlug = brief.suggestedSlug ?? `pillar-${decision.clusterId.slice(0, 8)}`;
      const proposedTitle =
        brief.suggestedTitle ?? `Pillar for cluster ${decision.clusterId}`;

      const [spec] = await tx
        .insert(cornerstoneSpecs)
        .values({
          projectId: brief.projectId,
          clusterId: decision.clusterId,
          locale: (brief.locale ?? "de") as string,
          translationKey: brief.gapMetadata?.translationKey ?? crypto.randomUUID(),
          cornerstoneKeyword: brief.primaryKeyword ?? proposedSlug,
          proposedTitle,
          proposedSlug,
          metaDescription: brief.suggestedMeta ?? "",
          estimatedWordCount: 2000,
          h2Outline: [],
          status: "proposed",
        })
        .returning({ id: cornerstoneSpecs.id });
      if (!spec) throw new Error("Failed to insert cornerstone spec");

      await markBriefRouted(tx, brief.id, { routedCornerstoneSpecId: spec.id });
      return {
        kind: "cornerstone_spec_created",
        cornerstoneSpecId: spec.id,
        briefId: brief.id,
      };
    }

    case "create_translation": {
      const sourceLocale = decision.targetLocale === "de" ? "en" : "de";

      const [sourceArticle] = await tx
        .select()
        .from(articles)
        .where(
          and(
            eq(articles.projectId, brief.projectId),
            eq(articles.translationKey, decision.sourceTranslationKey),
            eq(articles.locale, sourceLocale),
          ),
        )
        .limit(1);

      if (!sourceArticle) {
        await markBriefRouted(tx, brief.id, { approvalStatus: "superseded" });
        return {
          kind: "skipped",
          reason: `Source article not found for translationKey=${decision.sourceTranslationKey} locale=${sourceLocale}`,
          briefId: brief.id,
        };
      }

      const slug =
        brief.suggestedSlug ??
        `${sourceArticle.slug}-${decision.targetLocale}`;

      const translationBase = {
        projectId: brief.projectId,
        clusterId: sourceArticle.clusterId ?? null,
        cornerstoneKeyword: sourceArticle.cornerstoneKeyword ?? null,
        locale: decision.targetLocale as string,
        translationKey: decision.sourceTranslationKey,
        source: "generated" as const,
        collection: sourceArticle.collection,
        clusterRole: sourceArticle.clusterRole ?? null,
        status: "proposed" as const,
        approvalMode: (brief.approvalRequired ? "manual" : "auto") as "manual" | "auto",
        slug,
        title: brief.suggestedTitle ?? null,
      };
      const translationInsert: typeof articles.$inferInsert = sourceArticle.intentType
        ? { ...translationBase, intentType: sourceArticle.intentType }
        : translationBase;

      const [translation] = await tx
        .insert(articles)
        .values(translationInsert)
        .returning({ id: articles.id });
      if (!translation) throw new Error("Failed to insert translation article");

      await markBriefRouted(tx, brief.id, { routedArticleId: translation.id });
      return {
        kind: "translation_created",
        articleId: translation.id,
        briefId: brief.id,
      };
    }

    case "refresh_article":
      throw new RoutingNotImplementedError(
        "refresh_article",
        "Refresh source is future spec",
      );

    case "create_cluster":
      throw new RoutingNotImplementedError(
        "create_cluster",
        "Cluster Creator is Spec 54.7",
      );

    case "skip":
      await markBriefRouted(tx, brief.id, { approvalStatus: "superseded" });
      return { kind: "skipped", reason: decision.reason, briefId: brief.id };
  }
}

type BriefPatch = {
  routedArticleId?: string;
  routedCornerstoneSpecId?: string;
  approvalStatus?: "routed" | "superseded";
};

async function markBriefRouted(
  tx: Transaction,
  briefId: string,
  patch: BriefPatch,
): Promise<void> {
  const approvalStatus = patch.approvalStatus ?? "routed";

  // Build set object conditionally to satisfy exactOptionalPropertyTypes
  const setValues = {
    approvalStatus,
    updatedAt: new Date(),
    ...(approvalStatus === "routed" ? { approvedAt: new Date() } : {}),
    ...(patch.routedArticleId !== undefined
      ? { routedArticleId: patch.routedArticleId }
      : {}),
    ...(patch.routedCornerstoneSpecId !== undefined
      ? { routedCornerstoneSpecId: patch.routedCornerstoneSpecId }
      : {}),
  };

  await tx
    .update(topicBriefs)
    .set(setValues)
    .where(eq(topicBriefs.id, briefId));
}
