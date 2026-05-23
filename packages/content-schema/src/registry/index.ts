// Sprint 5 S5.2: Domain-Registry mechanism.
// `createDbBackedRegistry` is the production constructor; `forNicheStatic`
// is the test-only helper. The registry maps projectId → DomainContext,
// which exposes per-collection validators + per-tenant enum sets so
// consumers (RenderMdxStep boundary, DraftStep LLM-output validators,
// manual-brief gating) never hardcode Toolwiki values.
export * from "./types.ts";
export * from "./domain-registry.ts";
