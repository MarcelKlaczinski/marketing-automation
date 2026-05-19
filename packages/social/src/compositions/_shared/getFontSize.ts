/**
 * Discrete font-size buckets per slot type.
 *
 * NEVER use continuous scaling — sub-pixel rendering causes baseline drift
 * across fixtures and re-renders. See Spec 59.3.5 Section B for rationale.
 *
 * Bucket boundaries (maxChars on the last entry per slot type) MUST align with
 * the corresponding template's ContentBounds.max values. A unit test in
 * packages/social/test/bounds-bucket-alignment.test.ts enforces this.
 */
export type SlotType =
  | "cover-headline" // largest, 1-2 lines
  | "cover-snippet" // medium, 1 line
  | "slot-headline" // per-slide section title
  | "slot-body" // per-slide content text
  | "list-item" // pro/con/use-case item
  | "eyebrow" // small, all-caps label
  | "caption-cta" // end-slide CTA text
  | "footer"; // smallest, attribution

export interface Bucket {
  /** Upper bound on text.length — last entry acts as final fallback. */
  maxChars: number;
  /** Integer px only — no sub-pixel values. */
  fontSize: number;
  /** Explicit multiplier — never "normal". */
  lineHeight: number;
  /** Integer px only. */
  letterSpacing: number;
}

const BUCKETS: Record<SlotType, Bucket[]> = {
  "cover-headline": [
    { maxChars: 30, fontSize: 88, lineHeight: 1.05, letterSpacing: -2 },
    { maxChars: 60, fontSize: 72, lineHeight: 1.1, letterSpacing: -1 },
    { maxChars: 120, fontSize: 56, lineHeight: 1.15, letterSpacing: 0 },
  ],
  "cover-snippet": [
    { maxChars: 40, fontSize: 56, lineHeight: 1.2, letterSpacing: 0 },
    { maxChars: 80, fontSize: 44, lineHeight: 1.25, letterSpacing: 0 },
  ],
  "slot-headline": [
    { maxChars: 25, fontSize: 64, lineHeight: 1.1, letterSpacing: -1 },
    { maxChars: 50, fontSize: 48, lineHeight: 1.15, letterSpacing: 0 },
  ],
  "slot-body": [
    { maxChars: 80, fontSize: 40, lineHeight: 1.3, letterSpacing: 0 },
    { maxChars: 280, fontSize: 32, lineHeight: 1.35, letterSpacing: 0 },
  ],
  "list-item": [
    { maxChars: 40, fontSize: 36, lineHeight: 1.3, letterSpacing: 0 },
    { maxChars: 80, fontSize: 28, lineHeight: 1.35, letterSpacing: 0 },
  ],
  "eyebrow": [{ maxChars: 30, fontSize: 24, lineHeight: 1.2, letterSpacing: 4 }],
  "caption-cta": [{ maxChars: 40, fontSize: 40, lineHeight: 1.2, letterSpacing: 0 }],
  "footer": [{ maxChars: 60, fontSize: 18, lineHeight: 1.2, letterSpacing: 1 }],
};

/**
 * Returns the first bucket whose maxChars >= text.length.
 * Falls back to the largest (last) bucket if text exceeds all buckets —
 * truncation in the composition (WebkitLineClamp) will engage in that case.
 */
export function getFontSize(text: string, slotType: SlotType): Bucket {
  const buckets = BUCKETS[slotType];
  const len = text.length;
  for (const bucket of buckets) {
    if (len <= bucket.maxChars) return bucket;
  }
  return buckets[buckets.length - 1]!;
}

/** Exposed for use in unit tests that verify bound-bucket alignment. */
export const SLOT_TYPES = Object.keys(BUCKETS) as SlotType[];
export { BUCKETS };
