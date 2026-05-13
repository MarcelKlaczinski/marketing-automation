import type { ArticleType } from "./hookEngine.ts";

export type CloserPattern =
  | "verdict_recap"
  | "action_frame"
  | "identity_mirror"
  | "open_comment";

export interface CloserLine {
  leadText: string;
  highlightText: string;
  trailText: string;
}

export interface CloserHeadline {
  pattern: CloserPattern;
  line1: CloserLine;
  line2: CloserLine;
  fullText: string;
}

/**
 * Minimal tool shape consumed by the closer engine. Tokens come from the
 * tool-use-case-tokens enrichment step.
 */
export interface CloserToolContext {
  name: string;
  endSlideToken?: string;
  identityVerb?: string;
}

const CLOSER_PATTERN_MAP: Record<ArticleType, CloserPattern> = {
  comparison: "verdict_recap",
  review: "verdict_recap",
  list: "action_frame",
  guide: "action_frame",
  howto: "identity_mirror",
};

/**
 * Select a closer pattern from the article type, falling back to
 * `action_frame` whenever the pattern's data preconditions aren't met.
 */
export function selectCloserPattern(
  articleType: ArticleType,
  tools: CloserToolContext[],
): CloserPattern {
  const mapped = CLOSER_PATTERN_MAP[articleType] ?? "action_frame";

  if (mapped === "verdict_recap" && (tools.length !== 2 || tools.some((t) => !t.endSlideToken))) {
    return "action_frame";
  }
  if (mapped === "identity_mirror" && (tools.length !== 2 || tools.some((t) => !t.identityVerb))) {
    return "action_frame";
  }
  return mapped;
}

function buildVerdictRecap(tools: CloserToolContext[]): CloserHeadline {
  const [t1, t2] = tools;
  if (!t1 || !t2 || !t1.endSlideToken || !t2.endSlideToken) {
    throw new Error("buildVerdictRecap requires exactly 2 tools with endSlideToken");
  }
  return {
    pattern: "verdict_recap",
    line1: { leadText: `${t1.name} für`, highlightText: t1.endSlideToken, trailText: "." },
    line2: { leadText: `${t2.name} für`, highlightText: t2.endSlideToken, trailText: "." },
    fullText: `${t1.name} für ${t1.endSlideToken}. ${t2.name} für ${t2.endSlideToken}.`,
  };
}

function buildActionFrame(tools: CloserToolContext[]): CloserHeadline {
  return {
    pattern: "action_frame",
    line1: { leadText: `${tools.length} Tools`, highlightText: "getestet", trailText: "." },
    line2: { leadText: "Speichere für", highlightText: "später", trailText: "." },
    fullText: `${tools.length} Tools getestet. Speichere für später.`,
  };
}

function buildIdentityMirror(tools: CloserToolContext[]): CloserHeadline {
  const [t1, t2] = tools;
  if (!t1 || !t2 || !t1.identityVerb || !t2.identityVerb) {
    throw new Error("buildIdentityMirror requires exactly 2 tools with identityVerb");
  }
  return {
    pattern: "identity_mirror",
    line1: { leadText: `Du ${t1.identityVerb}?`, highlightText: t1.name, trailText: "." },
    line2: { leadText: `Du ${t2.identityVerb}?`, highlightText: t2.name, trailText: "." },
    fullText: `Du ${t1.identityVerb}? ${t1.name}. Du ${t2.identityVerb}? ${t2.name}.`,
  };
}

function buildOpenComment(): CloserHeadline {
  return {
    pattern: "open_comment",
    line1: { leadText: "Welches nutzt", highlightText: "du?", trailText: "" },
    line2: { leadText: "Schreib's in die", highlightText: "Kommentare", trailText: "." },
    fullText: "Welches nutzt du? Schreib's in die Kommentare.",
  };
}

/**
 * Build a deterministic closer headline from article type + tools.
 * No LLM calls — string concatenation lives only in fullText (caption + a11y).
 */
export function buildCloserHeadline(
  articleType: ArticleType,
  tools: CloserToolContext[],
): CloserHeadline {
  const pattern = selectCloserPattern(articleType, tools);
  switch (pattern) {
    case "verdict_recap":
      return buildVerdictRecap(tools);
    case "action_frame":
      return buildActionFrame(tools);
    case "identity_mirror":
      return buildIdentityMirror(tools);
    case "open_comment":
      return buildOpenComment();
  }
}
