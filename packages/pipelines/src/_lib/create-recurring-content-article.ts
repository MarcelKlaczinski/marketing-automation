/**
 * Spec 65.10 — Create an `articles` row for a `source='recurring'` brief so
 * the existing `article:social-image` pipeline can render against it.
 *
 * Why this exists: Spec 65.5 produces recurring briefs that the planner
 * routes to `article:social-image`, but that pipeline strictly requires
 * `articleId` (UUID-validated, throws "Article not found" in LoadArticleStep).
 * No code today creates `articles` rows with `collection='recurring_content'`,
 * so the brief→render path is structurally broken without this helper.
 *
 * The article is a stable identity row carrying the frozen
 * `recurringMetadata.formatConfig` snapshot under `domainExtras` so downstream
 * templates can read `selectedTemplateKey`, `selectedEndSlide`, `toolIds`, etc.
 * without re-querying the brief. `bodyMd` falls back to `suggestedMeta` (the
 * 280-char truncated brief text) — templates have their own `generateContent()`
 * for cover + verdict, so the body is informational only.
 *
 * Idempotent: if the brief already has `routedArticleId`, returns it unchanged
 * and flips that article to `status='generating'` (mirrors the
 * `createBlogArticleFromBrief` re-entry path).
 *
 * Spec 65.V1.5a Bridge #4 — moved from `apps/api/src/lib/recurring-content/`
 * to `packages/pipelines/src/_lib/` so the planner-executor (`execute-plan.ts`,
 * also in pipelines) can reuse it inline. The previous home in apps/api would
 * have required pipelines → apps/api dep (direction violation). Slugify
 * imported as intra-package now.
 */
import {
  type Transaction,
  and,
  articles,
  eq,
  topicBriefs,
} from "@marketing-auto/db";
import type { TopicBrief } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { slugify } from "../article/trigger.ts";

const log = createLogger("recurring-content:create-article");

export class CreateRecurringArticleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateRecurringArticleError";
  }
}

export interface CreateRecurringContentArticleInput {
  brief: TopicBrief;
  tx: Transaction;
}

export interface CreateRecurringContentArticleResult {
  articleId: string;
  /** True when this call inserted a new row; false on re-entry (brief.routedArticleId set). */
  created: boolean;
  /** Resolved slug — useful for logging + tests. */
  slug: string;
}

export async function createRecurringContentArticle(
  input: CreateRecurringContentArticleInput,
): Promise<CreateRecurringContentArticleResult> {
  const { brief, tx } = input;

  if (brief.source !== "recurring") {
    throw new CreateRecurringArticleError(
      `createRecurringContentArticle: brief.source must be 'recurring', got '${brief.source}'`,
    );
  }
  if (!brief.recurringMetadata) {
    throw new CreateRecurringArticleError(
      `createRecurringContentArticle: brief ${brief.id} has source='recurring' but recurringMetadata is null (Spec 65.5 superRefine invariant violated)`,
    );
  }

  // Re-entry: brief already has an article. Flip to 'generating' so a
  // re-trigger from the UI restarts cleanly.
  if (brief.routedArticleId) {
    const [existing] = await tx
      .update(articles)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(articles.id, brief.routedArticleId))
      .returning({ id: articles.id, slug: articles.slug });
    if (!existing) {
      throw new CreateRecurringArticleError(
        `brief ${brief.id} has routedArticleId=${brief.routedArticleId} but the article row is gone`,
      );
    }
    log.info(
      { briefId: brief.id, articleId: existing.id },
      "recurring article re-entry — flipped to generating",
    );
    return { articleId: existing.id, created: false, slug: existing.slug };
  }

  const locale: "de" | "en" = brief.locale === "en" ? "en" : "de";
  const baseSlug = slugify(brief.topicTitle) || `recurring-${brief.id.slice(0, 8)}`;
  const slug = await resolveUniqueSlug(tx, brief.projectId, locale, baseSlug);

  const [inserted] = await tx
    .insert(articles)
    .values({
      projectId: brief.projectId,
      clusterId: null,
      slug,
      title: brief.topicTitle,
      metaDescription: brief.suggestedMeta ?? null,
      bodyMd: brief.suggestedMeta ?? null,
      cornerstoneKeyword: null,
      locale,
      source: "generated",
      collection: "recurring_content",
      status: "generating",
      intentType: null,
      approvalMode: "manual",
      domainExtras: {
        recurring: {
          sourceBriefId: brief.id,
          definitionId: brief.recurringMetadata.definitionId,
          runNumber: brief.recurringMetadata.runNumber,
          formatType: brief.recurringMetadata.formatType,
          formatConfig: brief.recurringMetadata.formatConfig,
        },
      },
    })
    .returning({ id: articles.id, slug: articles.slug });

  if (!inserted) {
    throw new CreateRecurringArticleError("INSERT returned no row");
  }

  await tx
    .update(topicBriefs)
    .set({ routedArticleId: inserted.id, updatedAt: new Date() })
    .where(eq(topicBriefs.id, brief.id));

  log.info(
    { briefId: brief.id, articleId: inserted.id, slug: inserted.slug },
    "recurring article created from brief",
  );
  return { articleId: inserted.id, created: true, slug: inserted.slug };
}

/**
 * Find a slug that does not collide with the active partial unique index
 * `(project_id, source, collection, locale, slug) WHERE status != 'superseded'`.
 * Appends `-2`, `-3`, … on conflict. Bounded to 50 attempts to fail loud if
 * something is structurally wrong rather than spinning forever.
 */
async function resolveUniqueSlug(
  tx: Transaction,
  projectId: string,
  locale: "de" | "en",
  baseSlug: string,
): Promise<string> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const [conflict] = await tx
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.projectId, projectId),
          eq(articles.source, "generated"),
          eq(articles.collection, "recurring_content"),
          eq(articles.locale, locale),
          eq(articles.slug, candidate),
        ),
      )
      .limit(1);
    if (!conflict) return candidate;
  }
  throw new CreateRecurringArticleError(
    `resolveUniqueSlug: 50 attempts exhausted for base="${baseSlug}" (project=${projectId}, locale=${locale})`,
  );
}
