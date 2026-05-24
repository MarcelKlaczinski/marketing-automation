/**
 * Spec multi-domain-evolution S5.2 — Domain-Registry types.
 *
 * The registry maps a `projectId` to its domain context. The context exposes
 * per-collection schemas + per-domain enum sets so consumers (RenderMdxStep
 * boundary validator, LLM-output validators in pipelines, manual-brief route
 * gating) can query "what's allowed for this tenant" without hardcoding
 * Toolwiki-specific values.
 *
 * Three layers:
 *   1. `DomainSchemaRegistry` — top-level lookup, indexed by projectId
 *   2. `DomainContext` — per-tenant config: allowed collections, intent
 *      taxonomy, category scope listing
 *   3. `CollectionContext` — per-collection validators: Core + Extras
 *      composed into one schema, plus accessors so consumers can pick
 *      either layer
 *
 * The registry is constructed once at boot per project. Production wires
 * via a small async factory that resolves the project's targetNiche +
 * known collections + extras schemas from the per-domain modules under
 * `./domains/<niche>`. Tests use the synchronous `createStaticRegistry`
 * builder to avoid DB round-trips.
 */
import type { z } from "zod";
import type { CategoryScope } from "../validators/categories.ts";

export interface CollectionContext {
  /** Stable collection key — matches `articles.collection_type`. */
  readonly name: string;
  /**
   * Composed Zod schema = baseFrontmatter(locales) + domain extras +
   * any per-tenant overrides. Always returns a SafeParse-style result.
   */
  validate(frontmatter: unknown): { ok: true; data: unknown } | { ok: false; error: string };
  /**
   * Extras-only validation — runs ONLY the Bucket-C extras schema (NOT
   * the composed base+extras) plus any registered cross-field rules.
   * Consumed by `DraftStep` to validate the LLM-emitted DOMAIN_EXTRAS
   * block, which is the extras-only object (Layer 1 frontmatter fields
   * like title/date/heroImage aren't present in that block — they're
   * assembled later by PersistArticleStep).
   *
   * When the registering DomainSpec attaches a `validateExtras` callback
   * (e.g. Toolwiki's `validateComparisonExtras` carrying the
   * `winner="depends"⇒useCaseVerdicts non-empty` cross-field rule), it
   * runs through that callback. Otherwise falls back to a plain
   * `extrasSchema.safeParse(raw)` so per-tenant DomainSpecs that only
   * register a schema still produce sensible errors.
   */
  validateExtras(raw: unknown): { ok: true; data: unknown } | { ok: false; error: string };
  /** Just the Core (Layer 1) schema — useful for partial validation. */
  getCoreSchema(): z.ZodTypeAny;
  /** Just the Extras (Layer 2 / Bucket C) schema. */
  getExtrasSchema(): z.ZodTypeAny;
}

export interface DomainContext {
  /** Stable tenant identifier — matches `projects.targetNiche`. */
  readonly niche: string;
  /** Project domain (e.g. "toolwiki.ai"). Used by URL builders. */
  readonly domain: string;
  /** Locale tuple — first entry is the default. */
  readonly locales: ReadonlyArray<string>;
  /** Returns the per-collection context, or null when unknown. */
  forCollection(name: string): CollectionContext | null;
  /** All collection keys this domain supports. */
  getAllowedCollections(): ReadonlyArray<string>;
  /** Intent taxonomy used by article-output classification. */
  getIntentTaxonomy(): ReadonlyArray<string>;
  /**
   * Per-tenant `collection_hint → default intent_type` mapping consumed by
   * the manual-brief route's `deriveIntentFromCollection()` helper when the
   * user submits a brief without explicit `intentType`. Keys include both
   * real collection names (e.g. `"blog"`, `"comparison"`, `"ki-wissen"`)
   * AND planner pseudo-collections (e.g. `"cluster"` — Spec 62.4) — keeping
   * the map flat (not derived from `DomainSpec.collections`) so pseudo-keys
   * fit naturally. Returns an empty object for domains that don't register
   * a map; the call site falls back to its own hardcoded default switch.
   */
  getCollectionToIntentMap(): Readonly<Record<string, string>>;
  /**
   * Category slugs registered for a given scope (`tool`/`blog`/`knowledge`/
   * `usecase`). Returns the live set from `content_categories` when a DB
   * lookup is wired; static registries return a frozen seed.
   */
  getCategorySlugs(scope: CategoryScope): Promise<ReadonlyArray<string>>;
}

export interface DomainSchemaRegistry {
  /** Returns the per-project context, or null when the project is unknown. */
  forProject(projectId: string): Promise<DomainContext | null>;
}
