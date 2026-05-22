/**
 * Locale-aware string builders for the translation bridge.
 *
 * Spec 64.3 — extracted from legacy localize/pipeline.ts:426-428 so the
 * translation cold-path produces target-locale-native alt-text instead of
 * propagating the source-locale suffix verbatim.
 */

export type Locale = "de" | "en";

const HERO_ALT_SUFFIX: Record<Locale, string> = {
  de: "– Beitragsbild",
  en: "— Hero Image",
};

const BCP47_TAG: Record<Locale, string> = {
  de: "de-DE",
  en: "en-US",
};

/**
 * Build locale-native hero-image alt-text from target title + locale.
 * Unknown locales fall back to the English suffix.
 */
export function buildHeroAltText(targetTitle: string, targetLocale: Locale): string {
  const suffix = HERO_ALT_SUFFIX[targetLocale] ?? HERO_ALT_SUFFIX.en;
  return `${targetTitle} ${suffix}`;
}

/**
 * Map narrow `Locale` to schema.org / OG `inLanguage` BCP-47 tag.
 * Unknown locales fall back to the English tag.
 */
export function bcp47Tag(locale: Locale): string {
  return BCP47_TAG[locale] ?? BCP47_TAG.en;
}
