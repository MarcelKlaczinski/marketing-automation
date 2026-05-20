// Spec 62.0a-followup Issue 1: per-article auto-translation skip gate.
//
// Consumer for the `articles.skip_auto_translation_until` column (added in
// migration 0067 for Spec 62.0a). When the column is non-null and in the future,
// `BlogPipeline.afterComplete` and `RefreshPipeline.afterComplete` must NOT enqueue
// the translation pipeline. Lets Marcel pause translation for one specific article
// without disabling the project-wide `translationAutoTrigger` flag.

/**
 * Pure decision helper. Returns `true` when auto-translation should be skipped
 * for the article (i.e. the skip flag is set and the timestamp is in the future).
 *
 * - `null` → skip gate is inactive (do not skip)
 * - past timestamp → skip window has expired (do not skip)
 * - future timestamp → skip
 *
 * Compares against `now = new Date()` by default; tests can inject a fixed clock.
 */
export function shouldSkipAutoTranslation(
  skipAutoTranslationUntil: Date | null,
  now: Date = new Date(),
): boolean {
  if (skipAutoTranslationUntil === null) return false;
  return skipAutoTranslationUntil.getTime() > now.getTime();
}
