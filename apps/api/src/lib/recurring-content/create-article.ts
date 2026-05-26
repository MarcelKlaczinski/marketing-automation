/**
 * Spec 65.V1.5a Bridge #4 — re-export shim.
 *
 * The canonical implementation moved to
 * `packages/pipelines/src/_lib/create-recurring-content-article.ts` so the
 * planner-executor (`packages/pipelines/src/execution/execute-plan.ts`) can
 * reuse it without breaking the packages → apps/api direction rule.
 *
 * This file stays as a thin re-export so existing apps/api callers
 * (`brief-service.ts`, the article-detail re-render endpoint, etc.) keep
 * working without an import sweep. Net: one file moved, one shim left
 * behind, no consumer churn.
 */
export {
  createRecurringContentArticle,
  CreateRecurringArticleError,
  type CreateRecurringContentArticleInput,
  type CreateRecurringContentArticleResult,
} from "@marketing-auto/pipelines";
