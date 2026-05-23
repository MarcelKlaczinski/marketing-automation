// Layer 1 Core schemas (Bucket A + B per Phase-1 §3). Universal across
// every Astro content domain; per-domain extras (Bucket C) extend these
// via `.merge()`. S2.5 lands the full set.
export * from "./base.ts";
export * from "./cluster.ts";
export * from "./i18n.ts";
export * from "./monetization.ts";
export * from "./seo.ts";
