import { z } from "zod";

// ───── i18nCore (Bucket A per Phase-1 §3) ─────────────────────────────────────
//
// Locale + translation-key fields. Locale set is per-domain, so this is a
// factory that takes the domain's supported locales. Toolwiki uses
// `['de', 'en']`; BK will likely use `['de']` initially.

export type LocaleSet = readonly [string, ...string[]];

export const makeLocaleEnum = <T extends LocaleSet>(locales: T) => z.enum(locales);

/**
 * Returns a Zod schema with `locale` (enum of the domain's supported codes)
 * and `translationKey` (slug-stable per article, used for hreflang
 * cross-references). The default locale is the first entry in `locales`.
 */
export const i18nCore = <T extends LocaleSet>(locales: T) =>
  z.object({
    locale: makeLocaleEnum(locales).default(locales[0]),
    translationKey: z.string().min(1).max(120).optional(),
  });
