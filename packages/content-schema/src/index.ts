/**
 * @marketing-auto/content-schema
 *
 * Shared Zod schemas for Astro content collections, used by the Marketing-Tool
 * monorepo AND by tenant Astro repos. Layer 1 (Core: Bucket A+B from Phase-1
 * audit) lives in `./core`. Layer 2 (per-domain extras: Bucket C) lives in
 * `./domains/<domain>`. The Domain-Registry (`./registry`) maps a `projectId`
 * to its domain context. Validators (`./validators`) compose Core + Domain
 * extras and enforce the schema at LLM-output time AND at Astro-write time.
 *
 * Sprint 2 of multi-domain-evolution scaffolds the package skeleton. Subtasks
 * S2.2-S2.5 populate it: routing constants (S2.2), collection types (S2.3),
 * domain extras (S2.4), and `baseFrontmatter()` factory (S2.5).
 */
export * from "./enums/index.ts";
