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
