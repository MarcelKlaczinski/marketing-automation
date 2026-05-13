export type HookPattern =
  | "superlative_question"
  | "number_promise"
  | "negative_frame"
  | "identity_frame"
  | "curiosity_gap";

export interface PromiseBlock {
  line1: string;
  line2: string;
}

/**
 * Hook structure with phrase-based wrap (3 visual lines).
 *
 * Visual layout:
 *   Line 1: leadPhrase    — base color
 *   Line 2: highlightWord — brand color highlight
 *   Line 3: trailPhrase   — base color
 */
export interface HookOutput {
  pattern: HookPattern;
  leadPhrase: string;
  highlightWord: string;
  trailPhrase: string;
  fullText: string;
  promiseBlock: PromiseBlock;
}

/**
 * Minimal article context needed by the hook engine (not the full DB Article row).
 */
export interface HookArticleContext {
  id: string;
  title: string;
  toolCount: number;
  primaryKeyword?: string;
  toolNames: string[];
}

type ArticleType = "comparison" | "list" | "howto" | "guide" | "review";

const PATTERN_MAP: Record<ArticleType, HookPattern[]> = {
  comparison: ["superlative_question"],
  list:       ["superlative_question", "number_promise"],
  howto:      ["negative_frame", "identity_frame"],
  guide:      ["curiosity_gap", "identity_frame"],
  review:     ["superlative_question", "curiosity_gap"],
};

interface HookContext {
  toolCount: number;
  primaryKeyword: string;
}

const PROMISE_TEMPLATES: Record<HookPattern, (ctx: HookContext) => PromiseBlock> = {
  superlative_question: (_ctx) => ({
    line1: "Wir haben beide getestet.",
    line2: "Eine gewinnt klar.",
  }),
  number_promise: (ctx) => ({
    line1: `Alle ${ctx.toolCount} in der Praxis getestet.`,
    line2: "Ehrlich verglichen.",
  }),
  negative_frame: (_ctx) => ({
    line1: "Es gibt einen besseren Weg.",
    line2: "Wir zeigen welchen.",
  }),
  identity_frame: (_ctx) => ({
    line1: "Speziell für deinen Use-Case.",
    line2: "Redaktionell verifiziert.",
  }),
  curiosity_gap: (_ctx) => ({
    line1: "Das übersehen 9 von 10.",
    line2: "Hier ist der Grund.",
  }),
};

export function inferArticleType(title: string, toolCount: number): ArticleType {
  const lower = title.toLowerCase();
  if (/\bvs\.?\b|\bgegen\b|\boder\b.*\?/.test(lower) && toolCount <= 3) return "comparison";
  if (/\bwie\b.*\bman\b|\banleitung\b|\bschritt\b/.test(lower)) return "howto";
  if (/\bguide\b|\bleitfaden\b|\b\d+.*schritt\b/.test(lower)) return "guide";
  if (/\btest\b|\bim test\b|\bgetestet\b|\breview\b/.test(lower)) return "review";
  return "list";
}

/** Stable integer hash on a string — same input always produces same output. */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Deterministically select a pattern for a given article.
 * Same article.id always yields the same pattern (no render flicker).
 */
export function selectPattern(articleId: string, articleType: ArticleType): HookPattern {
  const candidates = PATTERN_MAP[articleType] ?? ["superlative_question"];
  return candidates[simpleHash(articleId) % candidates.length]!;
}

export function buildPromiseBlock(pattern: HookPattern, ctx: HookContext): PromiseBlock {
  return PROMISE_TEMPLATES[pattern](ctx);
}

/**
 * Programmatic fallback hook used when LLM validation fails after all retries.
 * Deterministic — always produces a clean, spec-compliant hook.
 */
export function programmaticFallbackHook(
  article: HookArticleContext,
  pattern: HookPattern,
): HookOutput {
  const ctx: HookContext = {
    toolCount: article.toolCount,
    primaryKeyword: article.primaryKeyword ?? "KI-Tools",
  };
  const promiseBlock = buildPromiseBlock(pattern, ctx);

  switch (pattern) {
    case "superlative_question":
      return {
        pattern,
        leadPhrase: "Welche KI macht",
        highlightWord: "die besten",
        trailPhrase: `${ctx.primaryKeyword}?`,
        fullText: `Welche KI macht die besten ${ctx.primaryKeyword}?`,
        promiseBlock,
      };
    case "number_promise": {
      const n = article.toolCount;
      return {
        pattern,
        leadPhrase: `${n} KI-Tools`,
        highlightWord: "im Vergleich",
        trailPhrase: "— ehrlich getestet.",
        fullText: `${n} KI-Tools im Vergleich — ehrlich getestet.`,
        promiseBlock,
      };
    }
    case "negative_frame":
      return {
        pattern,
        leadPhrase: "Hör auf,",
        highlightWord: "falsche Tools",
        trailPhrase: "zu nutzen.",
        fullText: "Hör auf, falsche Tools zu nutzen.",
        promiseBlock,
      };
    case "identity_frame":
      return {
        pattern,
        leadPhrase: "Du brauchst",
        highlightWord: "diese Tools",
        trailPhrase: "wirklich.",
        fullText: "Du brauchst diese Tools wirklich.",
        promiseBlock,
      };
    case "curiosity_gap":
      return {
        pattern,
        leadPhrase: "Niemand spricht",
        highlightWord: "über dieses Tool",
        trailPhrase: "für dich.",
        fullText: "Niemand spricht über dieses Tool für dich.",
        promiseBlock,
      };
  }
}
