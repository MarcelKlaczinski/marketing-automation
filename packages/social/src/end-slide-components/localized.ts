/**
 * Spec 65.9-followup — locale-aware end-slide config helpers.
 *
 * After migration 0124 every locale-binding config field is stored as
 * `{de: string, en: string}` instead of a plain string. Slide components
 * read the right locale via `pickLocalized(field, locale)`. The helpers are
 * deliberately defensive: if a frozen pipeline-input snapshot (planner
 * `recurringMetadata.formatConfig.selectedEndSlide.config`) was written
 * before the migration the field is still a plain string — fall back to it
 * so a single legacy snapshot doesn't crash the renderer.
 */

import type { EndSlideLocale, LocalizedString } from "./types.ts";

/**
 * Read the locale-aware string from a `{de, en}` object, with optional
 * back-compat fallback for legacy plain-string snapshots.
 */
export function pickLocalized(
  field: LocalizedString | string | undefined,
  locale: EndSlideLocale,
): string | undefined {
  if (field === undefined) return undefined;
  if (typeof field === "string") return field;
  return field[locale] ?? field.de ?? field.en;
}
