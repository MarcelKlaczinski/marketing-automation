/**
 * Word-drift cap validator for translation pipeline (Spec 64.5).
 *
 * The 2026-05-22 LANG_INDEPENDENT_EXTRAS audit found monotone +30-130% word
 * inflation in 17/17 audited EN siblings — the translation LLM tends to
 * "improve" the output with verbose phrasing, hedges, and unsolicited
 * clarifications. SEO-harmful (EEAT) and inconsistent vs DE source.
 *
 * Counting heuristic strips markdown structures that should not contribute
 * to the comparable word count:
 *   - fenced code blocks (``` … ```) and inline code (`x`)
 *   - YAML front-matter (--- … ---)
 *   - HTML / JSX tags (inner text kept)
 *   - Markdown link URLs (link text kept)
 *   - Markdown images (dropped entirely)
 *   - Markdown syntax markers (#, *, _, ~, `, >, |, -)
 *
 * No lower bound — short translations are always valid (e.g. EN drops
 * German Modalpartikel "halt", "doch", "ja", or removed boilerplate).
 */

/**
 * Counts words in a markdown body after stripping non-comparable structures.
 * Returns 0 for empty/whitespace-only input.
 */
export function countBodyWords(body: string): number {
  let normalized = body;

  normalized = normalized.replace(/```[\s\S]*?```/g, "");
  normalized = normalized.replace(/`[^`]+`/g, "");

  normalized = normalized.replace(/^---[\s\S]*?---\s*\n/m, "");

  normalized = normalized.replace(/<[^>]+>/g, " ");

  normalized = normalized.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  normalized = normalized.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  normalized = normalized.replace(/[#*_~`>|-]+/g, " ");

  return normalized
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .length;
}

export interface WordDriftValidationResult {
  valid: boolean;
  sourceWords: number;
  targetWords: number;
  /** Positive = target inflated; negative = target contracted. Rounded to integer percent. */
  driftPct: number;
  capPct: number;
  message: string;
}

/**
 * Validates that target word count is within ±capPct% of source.
 * Default cap 25% — target must be ≤ source × 1.25 to pass.
 * Lower bound is unbounded.
 *
 * Empty source returns valid=true and skips the check (no divide-by-zero).
 */
export function validateWordDriftCap(
  sourceBody: string,
  targetBody: string,
  capPct: number = 25,
): WordDriftValidationResult {
  const sourceWords = countBodyWords(sourceBody);
  const targetWords = countBodyWords(targetBody);

  if (sourceWords === 0) {
    return {
      valid: true,
      sourceWords: 0,
      targetWords,
      driftPct: 0,
      capPct,
      message: "Source has no words — drift check skipped",
    };
  }

  const driftPct = Math.round(((targetWords - sourceWords) / sourceWords) * 100);
  const valid = driftPct <= capPct;

  const message = valid
    ? `Word drift OK: ${sourceWords}→${targetWords} (${driftPct > 0 ? "+" : ""}${driftPct}%, cap ${capPct}%)`
    : `Word drift exceeded: ${sourceWords}→${targetWords} (+${driftPct}%, cap ${capPct}%)`;

  return { valid, sourceWords, targetWords, driftPct, capPct, message };
}

/**
 * Computes the maximum allowed target word count for a given source.
 * Mirrors the cap inequality `target ≤ source × (1 + cap/100)` floored.
 */
export function maxTargetWordsFor(sourceWords: number, capPct: number = 25): number {
  return Math.floor(sourceWords * (1 + capPct / 100));
}
