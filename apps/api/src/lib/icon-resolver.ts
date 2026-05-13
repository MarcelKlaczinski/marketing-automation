/**
 * Tool icon resolution for API routes.
 * Re-exports the resolution function from the pipelines package so HTTP
 * endpoints can resolve icons without duplicating the chain logic.
 *
 * Resolution chain (in priority order):
 *   1. project_brand_assets DB cache (project-scoped)
 *   2. simple-icons  — 3000+ tech/SaaS brand logos (CC0)
 *   3. iconify logos — 1200+ icons via @iconify-json/logos
 *   4. lobe-icons    — AI-focused static PNGs
 *   5. Deterministic HSL avatar with initials (never emoji)
 *
 * Cache-bust: DELETE row in project_brand_assets, next call re-resolves.
 */
export { resolveToolIcon, type ResolvedIcon } from "@marketing-auto/pipelines";
