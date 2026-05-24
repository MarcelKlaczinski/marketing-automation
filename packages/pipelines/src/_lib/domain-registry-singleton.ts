/**
 * Spec multi-domain-evolution follow-up — production Domain-Registry singleton.
 *
 * The registry contract was shipped in S5.2 ([`packages/content-schema/src/
 * registry/`](../../../content-schema/src/registry/)); this file wires the
 * production constructor with a Drizzle-backed `ProjectLookup` so consumers
 * (RenderMdxStep boundary validator, DraftStep LLM-output validators,
 * manual-brief route) can call `getDomainRegistry()` once at module-load
 * time without bootstrapping per-call.
 *
 * Lifecycle:
 *   - Singleton constructed lazily on first call (no DB I/O at import time)
 *   - All `DomainSpec`s registered today (Toolwiki); new tenants extend
 *     `DOMAIN_SPECS` below — one tuple entry per tenant
 *   - The `ProjectLookup` reads `projects.targetNiche` + `projects.domain`
 *     + `projects.targetLocales` via a single SELECT per project resolution
 *
 * Consumers MUST handle `null` returns:
 *   - `forProject(projectId)` returns null when the project row is missing
 *     OR when its `targetNiche` doesn't match any registered DomainSpec
 *     (e.g. a project with `targetNiche='solar-energy'` before BK ships
 *     its `DomainSpec`)
 *   - On null, fall back to the legacy path (Spec-50 JSONB for boundary
 *     validation; inline validators for LLM-output checks)
 *
 * This file stays a leaf importable from any pipeline step. Avoid letting
 * production code construct its own registry — use the singleton.
 */
import {
  type DomainSchemaRegistry,
  type DomainSpec,
  type ProjectLookup,
  createDbBackedRegistry,
} from "@marketing-auto/content-schema/registry";
import { toolwikiDomain } from "@marketing-auto/content-schema/domains/toolwiki";
import { db, eq, projects } from "@marketing-auto/db";

/**
 * Registered DomainSpecs. To onboard a new tenant:
 *   1. Create `packages/content-schema/src/domains/<niche>/spec.ts`
 *      exporting a `<niche>Domain: DomainSpec` (mirror `toolwikiDomain`)
 *   2. Add it here
 *   3. The S5.2 contract handles the rest — no consumer-side change needed
 *
 * Order doesn't matter; the registry indexes by `DomainSpec.niche`.
 */
const DOMAIN_SPECS: ReadonlyArray<DomainSpec> = [toolwikiDomain];

const productionProjectLookup: ProjectLookup = {
  async resolve(projectId) {
    const [row] = await db
      .select({
        targetNiche: projects.targetNiche,
        domain: projects.domain,
        targetLocales: projects.targetLocales,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!row || !row.targetNiche || !row.domain) return null;
    const localesArr = row.targetLocales;
    // targetLocales is jsonb<string[]>. Map BCP-47 codes ("de-DE") down to
    // simple ISO ("de") to match DomainSpec.locales shape. Fall back to
    // ["de"] when the column is empty (shouldn't happen — Drizzle default).
    const localeKeys = (localesArr.length > 0 ? localesArr : ["de-DE"]).map((bcp) =>
      bcp.split("-")[0] ?? bcp,
    );
    const uniq = [...new Set(localeKeys)];
    if (uniq.length === 0) return null;
    // Cast justification: `LocaleSet` is `readonly [string, ...string[]]`
    // (non-empty tuple) but `Set` → `Array` collapses to plain `string[]`.
    // The non-empty check on the previous line guarantees the tuple
    // invariant at runtime; TypeScript can't track the narrowing through
    // the spread → Set → spread roundtrip, so an explicit cast is the
    // only path. `as unknown as` keeps the cast loud + grep-able.
    const locales = uniq as unknown as readonly [string, ...string[]];
    return {
      niche: row.targetNiche,
      domain: row.domain,
      locales,
    };
  },
};

let _registry: DomainSchemaRegistry | null = null;

/**
 * Returns the lazily-constructed production registry. Safe to call from
 * any pipeline step — the underlying `ProjectLookup` does one SELECT per
 * call (no internal cache today; add a 60s TTL if it ever shows up in
 * hot-path profiles).
 */
export function getDomainRegistry(): DomainSchemaRegistry {
  if (_registry) return _registry;
  _registry = createDbBackedRegistry(DOMAIN_SPECS, productionProjectLookup);
  return _registry;
}

/**
 * Test-only reset hook — clears the singleton so a test fixture can
 * inject a different registry (e.g. a BK-only one). NEVER call from
 * production code.
 */
export function resetDomainRegistryForTesting(): void {
  _registry = null;
}

/**
 * Test-only inject hook — replaces the singleton with a caller-supplied
 * registry. Used by `packages/adapters/astro-sync/test/render-mdx-boundary`
 * to swap in a stub `DomainSchemaRegistry` whose `forProject` resolves
 * synthetic projectIds to fixture DomainContexts without touching the DB.
 * NEVER call from production code.
 */
export function setDomainRegistryForTesting(registry: DomainSchemaRegistry): void {
  _registry = registry;
}
