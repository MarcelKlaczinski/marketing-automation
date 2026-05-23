import { z } from "zod";
import { clusterCore } from "./cluster.ts";
import { i18nCore, type LocaleSet } from "./i18n.ts";
import { imagePath, isoDate, seoCore } from "./seo.ts";

// ───── baseFrontmatter() — Layer 1 Core (Phase-1 §3) ──────────────────────────
//
// Universal frontmatter shared across every Astro content domain. Per-domain
// extras (Bucket C) extend this via `.merge(<ExtrasSchema>)`.
//
// Canonical timestamp pair (resolves Phase-1 E13 — Toolwiki today mixes
// `date`/`updated`/`updatedAt`/`comparedAt`/`publishedAt`):
//
//   - `publishedAt`: ISO YYYY-MM-DD of first publish (immutable after launch)
//   - `updatedAt`:   ISO YYYY-MM-DD of latest edit (Tool refresh updates this;
//                    manual MDX edit updates this; Astro-Import promotes
//                    `articles.last_refreshed_at` when present)
//
// Toolwiki migration: a back-compat shim in render-mdx will continue writing
// the legacy `date`/`updated` fields alongside `publishedAt`/`updatedAt` until
// Astro-Repo Sprint 3 completes. Tracked under Branch B (Toolwiki-Astro repo).

/**
 * Layer 1 Core schema. Pass the domain's supported locales as a non-empty
 * readonly tuple (`['de', 'en'] as const`); the first entry becomes the
 * default locale. Returns a `ZodObject` that downstream domains can extend
 * with `.merge(domainExtras)`.
 */
export function baseFrontmatter<T extends LocaleSet>(locales: T) {
  return z
    .object({
      title: z.string().min(2).max(180),
      description: z.string().max(400).optional(),
      excerpt: z.string().max(400).optional(),
      publishedAt: isoDate.optional(),
      updatedAt: isoDate.optional(),
      author: z.string().min(1).max(80).optional(),
      heroImage: imagePath.optional(),
      heroImageAlt: z.string().max(200).optional(),
      readingTime: z.string().max(40).optional(),
      tags: z.array(z.string().min(1).max(40)).max(20).default([]),
      /**
       * Category as a SOFT slug reference. Per-domain validation against
       * `content_categories` happens in S3.3 (Sprint 3) via a `superRefine`
       * applied at compose-time in S5.2 (Sprint 5).
       */
      category: z.string().min(1).max(80).optional(),
      subcategory: z.string().min(1).max(80).optional(),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false),
      contentType: z.enum(["article", "stub", "pillar", "hub"]).default("article"),
      /**
       * Generic cross-collection references. Per-domain narrower fields
       * (e.g. `featuredToolSlugs` on usecases) live in the Bucket-C extras
       * module and override the generic shape via `.merge()`.
       */
      relatedSlugs: z.array(z.string().min(1).max(80)).max(20).optional(),
    })
    .merge(seoCore)
    .merge(i18nCore(locales))
    .merge(clusterCore);
}

/**
 * Convenience type — the canonical Layer 1 shape for a given locale set.
 * Domain extras consumers usually want `z.infer<ReturnType<typeof baseFrontmatter<T>>>`;
 * this alias makes the call site readable.
 */
export type BaseFrontmatter<T extends LocaleSet> = z.infer<ReturnType<typeof baseFrontmatter<T>>>;
