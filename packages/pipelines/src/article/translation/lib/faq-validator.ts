/**
 * FAQ preservation validator for translation pipeline (Spec 64.4).
 *
 * The 2026-05-22 LANG_INDEPENDENT_EXTRAS audit found 9/157 EN siblings
 * with lost or partial FAQs — LLM-driven body translation silently drops
 * FAQ items under token pressure or when the FAQ section sits late in the
 * source body.
 *
 * Counting heuristic: H3 question headers (`### …`) inside a recognised
 * FAQ H2 section. Recognised section headings (case-insensitive):
 *   - `## FAQ`        — English short
 *   - `## FAQs`       — English plural
 *   - `## Häufige Fragen`
 *   - `## Frequently Asked Questions`
 *
 * Returns 0 when no FAQ section is recognised; the validator treats this
 * as "no FAQ present" and reports `valid=true`. We deliberately do not
 * try to parse exotic markdown shapes (Q/A markers, definition lists) —
 * Toolwiki articles consistently use the H2+H3 pattern.
 */

const FAQ_SECTION_RE = /^##\s+(FAQs?|Häufige\s+Fragen|Frequently\s+Asked\s+Questions)\s*$/im;
const NEXT_H2_RE = /^##\s+/m;
const H3_RE = /^###\s+/gm;

/**
 * Counts FAQ items (H3 headers) inside the first recognised FAQ H2 section.
 * Returns 0 when no FAQ section is found.
 */
export function countFaqItems(body: string): number {
  const sectionMatch = body.match(FAQ_SECTION_RE);
  if (!sectionMatch || sectionMatch.index === undefined) return 0;

  const sectionStart = sectionMatch.index;
  // Skip past the FAQ heading line itself before looking for the next H2,
  // otherwise the FAQ heading matches NEXT_H2_RE at offset 0.
  const afterHeading = sectionStart + sectionMatch[0].length;
  const remainder = body.slice(afterHeading);
  const nextH2 = remainder.match(NEXT_H2_RE);
  const sectionEnd = nextH2?.index !== undefined ? afterHeading + nextH2.index : body.length;

  const faqSection = body.slice(sectionStart, sectionEnd);
  const h3Matches = faqSection.match(H3_RE);
  return h3Matches?.length ?? 0;
}

export interface FaqValidationResult {
  valid: boolean;
  sourceCount: number;
  targetCount: number;
  /** Positive = items lost in translation; negative = LLM added items. */
  delta: number;
  message: string;
}

/**
 * Compares FAQ item counts between source and target bodies.
 * Valid iff counts match exactly (no items lost AND no items hallucinated).
 */
export function validateFaqPreservation(
  sourceBody: string,
  targetBody: string,
): FaqValidationResult {
  const sourceCount = countFaqItems(sourceBody);
  const targetCount = countFaqItems(targetBody);
  const delta = sourceCount - targetCount;

  if (delta === 0) {
    return {
      valid: true,
      sourceCount,
      targetCount,
      delta,
      message: `FAQ count preserved: ${sourceCount}`,
    };
  }

  const message = delta > 0
    ? `FAQ asymmetry: source has ${sourceCount}, target has ${targetCount} (lost ${delta})`
    : `FAQ asymmetry: source has ${sourceCount}, target has ${targetCount} (added ${-delta})`;

  return { valid: false, sourceCount, targetCount, delta, message };
}
