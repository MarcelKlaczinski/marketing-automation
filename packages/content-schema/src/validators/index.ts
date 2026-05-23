// Validators barrel. S3.3 lands `categories` (pure interface + DI factory).
// Sprint 5 will add `compose.ts` (schema composition helpers) and
// `boundary.ts` (hoisted from packages/adapters/astro-sync/src/lib/) once
// the Domain-Registry is in place.
export * from "./categories.ts";
