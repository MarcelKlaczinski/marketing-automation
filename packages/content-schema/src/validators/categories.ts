/**
 * Spec multi-domain-evolution S3.3 — Category reference validator.
 *
 * Pure interface + factory: content-schema stays a leaf package (only `zod`
 * as dep). The DB lookup is injected by the caller via `CategoryLookup` so
 * the package never imports `@marketing-auto/db` or drizzle-orm. The
 * canonical wiring lives in `apps/api/src/lib/category-validator.ts` (S3.4)
 * but any consumer can supply their own lookup (e.g. tests inject an
 * in-memory Map).
 *
 * Consumers:
 *   - `RenderMdxStep` (S1.2 boundary validator) — extend the existing
 *     `validateFrontmatterAgainstSchema` to also check `category` references
 *     against the live taxonomy (S3.4 wires this).
 *   - `DraftStep` LLM-output validators — emit a soft warning when the LLM
 *     hallucinates a category that isn't seeded (S3.4 wires this).
 *   - Future Domain-Registry (Sprint 5 S5.2) — uses the same lookup
 *     interface under the hood.
 */

/**
 * Taxonomy bucket — matches the `scope` column on `content_categories`.
 * The seed migration (S3.2) uses `"tool"`, `"blog"`, `"knowledge"`. Future
 * domains may register additional scopes; the type stays open so the
 * package doesn't gate on Toolwiki-specific values.
 */
export type CategoryScope = string;

/**
 * Minimal contract the validator needs from a DB layer. Implementations:
 *   - apps/api wires the real Drizzle query (`packages/db` consumers)
 *   - Tests inject a Map-backed stub (see content-schema/test fixtures)
 */
export interface CategoryLookup {
  /** Returns true iff `(projectId, scope, slug)` exists in `content_categories`. */
  exists(args: { projectId: string; scope: CategoryScope; slug: string }): Promise<boolean>;
}

/**
 * Public validator API. Returns a tagged union — never throws (Pattern 111:
 * the call site owns error escalation, e.g. `RenderMdxStep` throws
 * `AstroSyncValidationError` on `{ok: false}`, `DraftStep` emits a soft
 * notification).
 */
export interface CategoryValidator {
  isValidReference(
    slug: string,
    scope: CategoryScope,
    projectId: string,
  ): Promise<{ ok: true } | { ok: false; reason: "missing"; slug: string; scope: CategoryScope }>;
}

/**
 * Factory: builds a `CategoryValidator` from a `CategoryLookup`. The factory
 * is the single seam the consumer wires up at boot — production passes a
 * Drizzle-backed lookup, tests pass an in-memory one.
 *
 * Empty/blank slug is treated as "no category set" and returns `ok: true`
 * (the field is optional on every collection per Phase-1 §1).
 */
export function createCategoryValidator(lookup: CategoryLookup): CategoryValidator {
  return {
    async isValidReference(slug, scope, projectId) {
      const trimmed = slug.trim();
      if (trimmed.length === 0) return { ok: true };
      const exists = await lookup.exists({ projectId, scope, slug: trimmed });
      return exists ? { ok: true } : { ok: false, reason: "missing", slug: trimmed, scope };
    },
  };
}

/**
 * Build an in-memory `CategoryLookup` from a flat list of seeded entries.
 * Used by tests + the Sprint-5 Domain-Registry fallback when the DB
 * connection is unavailable at boot. NOT a production path.
 */
export function createInMemoryCategoryLookup(
  entries: ReadonlyArray<{ projectId: string; scope: CategoryScope; slug: string }>,
): CategoryLookup {
  const key = (a: { projectId: string; scope: string; slug: string }) =>
    `${a.projectId}${a.scope}${a.slug}`;
  const set = new Set(entries.map(key));
  return {
    async exists(args) {
      return set.has(key(args));
    },
  };
}
