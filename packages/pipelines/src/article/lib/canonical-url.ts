/**
 * Shared canonical-URL builder for article schema.org JSON-LD.
 *
 * Spec 64.3 — single source of truth between:
 *   • assembly.ts        (DE hot path)
 *   • translation bridge (EN cold path)
 *
 * Mirrors Astro routing convention:
 *   https://{domain}/{locale}/{collection-astro-folder}/{slug}
 *
 * Callers may pass either the narrow `ArticleCollectionType` enum value
 * (e.g. `"comparison"`) or the wider `articles.collection` text-column value
 * (e.g. `"comparisons"`, the Astro folder name). The map below normalises
 * the narrow form; unknown values fall through as-is.
 */

import { astroFolderFor } from "@marketing-auto/content-schema/enums";
import type { Locale } from "../translation/lib/locale-strings.ts";

// Spec multi-domain-evolution S2.2: collection→Astro-folder lookup migrated
// to @marketing-auto/content-schema/enums (single source). `astroFolderFor`
// returns the input unchanged for unknown collections so forward-compat for
// future tenant collections is preserved.

export interface CanonicalUrlInput {
  projectDomain: string;
  locale: Locale;
  collection: string;
  slug: string;
}

export function buildCanonicalUrl(input: CanonicalUrlInput): string {
  return `https://${input.projectDomain}/${input.locale}/${astroFolderFor(input.collection)}/${input.slug}`;
}
