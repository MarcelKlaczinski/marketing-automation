/**
 * Spec 65.10 — Flip a recurring-content article's status after social-render
 * completion. No-op for non-recurring articles.
 *
 * The `article:social-image` pipeline enqueues social-render jobs and returns
 * immediately; the article stays `status='generating'` while Remotion runs.
 * When the social-render worker emits `completed` / `failed`, this helper
 * advances the article lifecycle:
 *
 * - `success` + `collection='recurring_content'` + `status='generating'`
 *     → `status='published'` (terminal — R2 files are ready for Marcel to download)
 * - `failed` + `collection='recurring_content'` + `status='generating'`
 *     → `status='failed'`
 *
 * The collection check is the load-bearing guard: ordinary tool articles
 * (Astro-imported, multiple social-posts per article) must NOT be flipped on
 * any single social-render outcome.
 *
 * Idempotent + side-effect-free on miss. Errors are swallowed by the caller
 * (the social-render worker uses `void` dispatch) — a status-sync failure
 * must never escalate into a BullMQ job retry.
 */
import { and, articles, db, eq } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("recurring-content:sync-article-status");

export type SocialRenderOutcome = "success" | "failed";

export interface SyncArticleStatusInput {
  articleId: string;
  outcome: SocialRenderOutcome;
}

export interface SyncArticleStatusResult {
  flipped: boolean;
  /** When flipped=true, the new article.status value. */
  newStatus?: "published" | "failed";
  /** Reason flipped=false: not a recurring article OR status was not 'generating'. */
  skipReason?: "not-recurring" | "not-generating" | "not-found";
}

export async function syncRecurringArticleStatus(
  input: SyncArticleStatusInput,
): Promise<SyncArticleStatusResult> {
  const [article] = await db
    .select({
      id: articles.id,
      collection: articles.collection,
      status: articles.status,
    })
    .from(articles)
    .where(eq(articles.id, input.articleId))
    .limit(1);

  if (!article) {
    return { flipped: false, skipReason: "not-found" };
  }
  if (article.collection !== "recurring_content") {
    return { flipped: false, skipReason: "not-recurring" };
  }
  if (article.status !== "generating") {
    return { flipped: false, skipReason: "not-generating" };
  }

  const newStatus: "published" | "failed" =
    input.outcome === "success" ? "published" : "failed";

  // CAS on status='generating' so a parallel social-render completion can't
  // double-flip (or downgrade) the row.
  const updated = await db
    .update(articles)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(
      and(
        eq(articles.id, input.articleId),
        eq(articles.status, "generating"),
      ),
    )
    .returning({ id: articles.id });

  if (updated.length === 0) {
    // Lost the race — another worker already flipped the status.
    return { flipped: false, skipReason: "not-generating" };
  }

  log.info(
    { articleId: input.articleId, outcome: input.outcome, newStatus },
    "recurring article status flipped",
  );
  return { flipped: true, newStatus };
}
