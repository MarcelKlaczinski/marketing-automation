/**
 * Spec multi-domain-evolution §3.1 / S1.2 — Boundary-Validator beim Astro-Write.
 *
 * Closes Lost-Update Risk L5 from docs/discovery/marketing-tool-datenmodell-synthese.md:
 * "Tool schreibt Feld, das Astro-Zod rejected → silent drop bei Build, kein
 *  Astro-Run-Error". Before this validator, the silent-drop in
 * `RenderMdxStep.buildFrontmatter()` line 226-232 + the warn-only check on
 * unpopulated required fields meant schema-drift between Tool and Repo
 * produced runtime 404s with no CI signal. Now: hard throw with a structured
 * payload that S1.3 routes into a critical notification.
 */

export type ValidationFailureReason =
  | "missing_required"
  | "type_mismatch"
  | "enum_mismatch";

export interface ValidationFailureDetail {
  /** Frontmatter field name. Top-level only — no dotted paths yet. */
  fieldPath: string;
  /** Human-readable shape descriptor: "string" / "string_array" / "one of ['a','b']" / "number" etc. */
  expected: string;
  /** Stringified actual value (truncated at 80 chars). Empty string for missing_required. */
  actual: string;
  reason: ValidationFailureReason;
}

/**
 * Thrown by `RenderMdxStep` when the assembled frontmatter does not satisfy
 * the Astro collection schema (currently the Spec-50 JSONB snapshot;
 * Sprint 5 will migrate to `@marketing-auto/content-schema` Domain-Registry).
 *
 * Caught by `ArticleSyncPipeline.afterError` (S1.3) to fire a critical
 * notification with severity 'critical' so Marcel sees the failure before
 * the article reaches Astro and silently 404s.
 */
export class AstroSyncValidationError extends Error {
  readonly articleId: string;
  readonly collection: string;
  readonly failures: ValidationFailureDetail[];

  constructor(args: {
    articleId: string;
    collection: string;
    failures: ValidationFailureDetail[];
  }) {
    const summary = args.failures
      .map((f) => `${f.fieldPath} (${f.reason})`)
      .join(", ");
    super(
      `Astro-Sync boundary validation failed for ${args.collection}/${args.articleId}: ${args.failures.length} field(s) invalid — ${summary}`,
    );
    this.name = "AstroSyncValidationError";
    this.articleId = args.articleId;
    this.collection = args.collection;
    this.failures = args.failures;
  }
}
