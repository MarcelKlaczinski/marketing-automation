/**
 * Spec multi-domain-evolution S3.4 — Soft validation of LLM-emitted
 * `category` against the per-tenant content_categories table. Fires a
 * severity=info notification on mismatch; never throws (additive phase,
 * preserves zero-regression contract).
 *
 * Wired into DraftStep AFTER the FRONTMATTER_EXTRAS parse, fire-and-forget:
 * a category-validation failure must NEVER fail the pipeline (Pattern 111
 * + additive-migration rule). The notification gives Marcel a signal to
 * audit + extend the taxonomy if the LLM hallucinated a sensible new
 * category.
 *
 * S3.5 will use the accumulated notifications as input for the manual
 * consolidation script that maps unknown values back to seeded slugs.
 */
import { createNotification } from "@marketing-auto/core/notifications";
import { and, contentCategories, db, eq, users } from "@marketing-auto/db";
import {
  type CategoryLookup,
  type CategoryScope,
  createCategoryValidator,
} from "@marketing-auto/content-schema/validators";
import type { ArticleCollectionType } from "@marketing-auto/shared";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("pipelines:category-validation");

/**
 * Maps the article `collectionType` (Drizzle enum) to the `scope` column on
 * content_categories. Returns null when the collection has no category
 * taxonomy today (e.g. `comparison` articles don't carry a category field
 * in the live Toolwiki schema). Lives here — not in content-schema — because
 * the mapping is a pipeline-side concern that depends on which collections
 * the pipeline supports.
 */
export function collectionTypeToScope(
  collectionType: ArticleCollectionType,
): CategoryScope | null {
  switch (collectionType) {
    case "tools":
      return "tool";
    case "blog":
      return "blog";
    case "ki-wissen":
      return "knowledge";
    case "usecases":
      return "usecase";
    case "comparison":
      // Comparison articles don't carry a category in the live Toolwiki
      // schema (Phase-1 audit §1 comparisons inventar — all 22 articles
      // have no `category` field). If a future spec changes this, add a
      // scope mapping here.
      return null;
    default:
      return null;
  }
}

/**
 * Drizzle-backed `CategoryLookup`. Lazy module-level singleton so the
 * factory is constructed once per worker process. Avoids per-call object
 * allocation when the same DraftStep fires repeatedly.
 */
let _lookupCache: CategoryLookup | null = null;
function getProductionLookup(): CategoryLookup {
  if (_lookupCache) return _lookupCache;
  _lookupCache = {
    async exists({ projectId, scope, slug }) {
      const rows = await db
        .select({ id: contentCategories.id })
        .from(contentCategories)
        .where(
          and(
            eq(contentCategories.projectId, projectId),
            eq(contentCategories.scope, scope),
            eq(contentCategories.slug, slug),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
  return _lookupCache;
}

export interface ValidateCategoryArgs {
  projectId: string;
  collectionType: ArticleCollectionType;
  /** Raw value from FRONTMATTER_EXTRAS — may be unknown shape. */
  category: unknown;
  articleId?: string;
  /** Inject lookup for tests. Production omits and uses the Drizzle backed singleton. */
  lookup?: CategoryLookup;
}

/**
 * Soft-validate the LLM-emitted category and fire a severity=info
 * notification on mismatch. Never throws (additive phase per spec §3.3).
 *
 * Behavior:
 *   - Non-string category → log warn, no notification (LLM shape bug,
 *     not a taxonomy-drift signal)
 *   - Empty/null category → no-op (category is optional on every collection)
 *   - Unknown scope (comparison) → no-op (no taxonomy for this collection)
 *   - Known slug ⇒ no-op
 *   - Unknown slug ⇒ severity=info notification fan-out to all `owner`
 *     users + a structured warn log (so the data is available for S3.5
 *     manual consolidation even when Web Push isn't configured)
 */
export async function validateCategoryAndNotify(args: ValidateCategoryArgs): Promise<void> {
  const scope = collectionTypeToScope(args.collectionType);
  if (scope === null) return;
  if (args.category === null || args.category === undefined || args.category === "") return;
  if (typeof args.category !== "string") {
    log.warn(
      { articleId: args.articleId, collectionType: args.collectionType, category: args.category },
      "[category-validation] non-string category emitted — skipping soft-check",
    );
    return;
  }

  const lookup = args.lookup ?? getProductionLookup();
  const validator = createCategoryValidator(lookup);
  const result = await validator.isValidReference(args.category, scope, args.projectId);
  if (result.ok) return;

  // Mismatch: fan out severity=info notification + structured warn log.
  log.warn(
    {
      articleId: args.articleId,
      projectId: args.projectId,
      collectionType: args.collectionType,
      scope,
      category: result.slug,
    },
    "[category-validation] LLM emitted unknown category slug — soft warning",
  );

  try {
    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"));
    for (const owner of owners) {
      void createNotification({
        userId: owner.id,
        type: "category_drift",
        severity: "info",
        title: `Unknown category: ${result.scope}/${result.slug}`,
        message: `The draft for article ${args.articleId ?? "(unknown)"} emitted category "${result.slug}" which is not in the ${scope} taxonomy. Either add it to content_categories or fix the article.`,
        ...(args.articleId ? { link: `/articles/${args.articleId}` } : {}),
        metadata: {
          articleId: args.articleId ?? null,
          projectId: args.projectId,
          collectionType: args.collectionType,
          scope: result.scope,
          slug: result.slug,
        },
      });
    }
  } catch (e) {
    log.warn({ err: e }, "[category-validation] notification fan-out failed — skipped");
  }
}
