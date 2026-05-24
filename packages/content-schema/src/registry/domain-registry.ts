/**
 * Spec multi-domain-evolution S5.2 — Domain-Registry implementation.
 *
 * Two constructors:
 *
 *   1. `createStaticRegistry(domains)` — synchronous, no DB. Use for tests
 *      and for the boot-time happy path when projectId→niche+domain is
 *      already known. Production wires it via the second constructor.
 *
 *   2. `createDbBackedRegistry(domains, projectLoader, categoryLoader)` —
 *      injects two DI seams so this package stays leaf (no Drizzle import).
 *      The first seam resolves `projectId → {niche, domain, locales}` from
 *      the live `projects` row; the second is the S3.3 `CategoryLookup`.
 *
 * The two constructors share the same `DomainContext` shape — switching
 * production from static to DB-backed is a single boot-time line.
 *
 * `DomainSpec` is the per-tenant module shape under `./domains/<niche>`.
 * Toolwiki currently ships a `DomainSpec` constructed via
 * `buildToolwikiDomainSpec(locales)` (see Sprint-5 follow-up); BK will
 * add `./domains/balkon-kraft-werk/index.ts` exporting the same shape.
 */
import type { z } from "zod";
import { baseFrontmatter, type LocaleSet } from "../core/index.ts";
import type { CategoryLookup, CategoryScope } from "../validators/categories.ts";
import type {
  CollectionContext,
  DomainContext,
  DomainSchemaRegistry,
} from "./types.ts";

/**
 * Per-collection registration. Domain modules under `./domains/<niche>`
 * produce this shape via small builders.
 */
export interface DomainCollectionSpec {
  /** Collection key — matches `articles.collection_type`. */
  readonly name: string;
  /** Bucket-C extras schema (e.g. `ComparisonExtrasSchema`). */
  readonly extrasSchema: z.ZodTypeAny;
  /**
   * Optional extras-validator callback. When present, `CollectionContext
   * .validateExtras()` calls this instead of a bare `extrasSchema.safeParse`.
   * Register this when the domain has cross-field rules that aren't
   * expressible in pure Zod (e.g. Toolwiki's
   * `winner="depends"⇒useCaseVerdicts non-empty` constraint on the
   * comparison collection). Default fallback (no callback) wraps
   * `extrasSchema.safeParse(raw)` with the same tagged-union shape so
   * downstream call sites are uniform.
   */
  readonly validateExtras?: (
    raw: unknown,
  ) => { ok: true; data: unknown } | { ok: false; error: string };
}

/**
 * Per-tenant registration. Each entry under `./domains/<niche>` exports
 * one of these from its `index.ts`.
 */
export interface DomainSpec {
  readonly niche: string;
  readonly domain: string;
  readonly locales: LocaleSet;
  readonly collections: ReadonlyArray<DomainCollectionSpec>;
  readonly intentTaxonomy: ReadonlyArray<string>;
  /**
   * Optional `collection_hint → default intent_type` map for the manual-brief
   * route. When absent, `DomainContext.getCollectionToIntentMap()` returns an
   * empty object and the call site falls back to its own hardcoded default
   * switch (preserves zero-regression for tenants that don't register one).
   * Keys may include planner pseudo-collections (`"cluster"`) alongside real
   * collection names — kept as a flat map (not derived from `collections`)
   * so pseudo-keys fit. Values must be elements of `intentTaxonomy`.
   */
  readonly collectionToIntentMap?: Readonly<Record<string, string>>;
}

/** Resolver: projectId → niche/domain/locales (DB-backed in production). */
export interface ProjectLookup {
  resolve(projectId: string): Promise<{
    niche: string;
    domain: string;
    locales: LocaleSet;
  } | null>;
}

function buildCollectionContext(
  collection: DomainCollectionSpec,
  locales: LocaleSet,
): CollectionContext {
  const core = baseFrontmatter(locales);
  // Composed = core + extras. `.merge()` works because both sides are ZodObjects.
  // The extras schema is typed as ZodTypeAny here to avoid a generic explosion
  // in DomainSpec; at the call site every concrete domain schema IS a ZodObject.
  const composed = (core as unknown as { merge(other: z.ZodTypeAny): z.ZodTypeAny }).merge(
    collection.extrasSchema,
  );
  return {
    name: collection.name,
    validate(frontmatter) {
      const result = composed.safeParse(frontmatter);
      if (result.success) return { ok: true, data: result.data };
      return { ok: false, error: result.error.message };
    },
    validateExtras(raw) {
      // Registered callback (with cross-field rules) wins; otherwise fall
      // back to a plain extrasSchema.safeParse with the same shape.
      if (collection.validateExtras) return collection.validateExtras(raw);
      const result = collection.extrasSchema.safeParse(raw);
      if (result.success) return { ok: true, data: result.data };
      return { ok: false, error: result.error.message };
    },
    getCoreSchema() {
      return core;
    },
    getExtrasSchema() {
      return collection.extrasSchema;
    },
  };
}

function buildDomainContextSync(
  spec: DomainSpec,
  domain: string,
  categoryLookup: CategoryLookup | null,
): DomainContext {
  const collectionByName = new Map<string, CollectionContext>();
  for (const c of spec.collections) {
    collectionByName.set(c.name, buildCollectionContext(c, spec.locales));
  }
  return {
    niche: spec.niche,
    domain,
    locales: spec.locales,
    forCollection(name) {
      return collectionByName.get(name) ?? null;
    },
    getAllowedCollections() {
      return [...collectionByName.keys()];
    },
    getIntentTaxonomy() {
      return spec.intentTaxonomy;
    },
    getCollectionToIntentMap() {
      return spec.collectionToIntentMap ?? {};
    },
    async getCategorySlugs(_scope: CategoryScope) {
      // Without a categoryLookup we can't enumerate slugs (the DI seam needs
      // a list-call, but content_categories has no list helper today —
      // Sprint-5 deferred). Return an empty array; consumers that need the
      // actual list should fall back to direct DB query for now.
      if (!categoryLookup) return [];
      // Future: extend CategoryLookup with `listForScope({projectId, scope})`.
      return [];
    },
  };
}

export function createStaticRegistry(
  domains: ReadonlyArray<DomainSpec>,
): DomainSchemaRegistry {
  const byNiche = new Map<string, DomainSpec>();
  for (const d of domains) byNiche.set(d.niche, d);

  return {
    async forProject(_projectId) {
      // Static registry doesn't know per-project mapping; callers must use
      // createDbBackedRegistry for production. The static path is for tests
      // that already know the niche directly via `forNicheStatic`.
      return null;
    },
  };
}

/**
 * Test-only helper: skip the DB and return the context for a given niche.
 */
export function forNicheStatic(
  domains: ReadonlyArray<DomainSpec>,
  niche: string,
  domain: string,
  categoryLookup: CategoryLookup | null = null,
): DomainContext | null {
  const spec = domains.find((d) => d.niche === niche);
  if (!spec) return null;
  return buildDomainContextSync(spec, domain, categoryLookup);
}

export function createDbBackedRegistry(
  domains: ReadonlyArray<DomainSpec>,
  projectLookup: ProjectLookup,
  categoryLookup: CategoryLookup | null = null,
): DomainSchemaRegistry {
  const byNiche = new Map<string, DomainSpec>();
  for (const d of domains) byNiche.set(d.niche, d);

  return {
    async forProject(projectId) {
      const project = await projectLookup.resolve(projectId);
      if (!project) return null;
      const spec = byNiche.get(project.niche);
      if (!spec) return null;
      return buildDomainContextSync(spec, project.domain, categoryLookup);
    },
  };
}
