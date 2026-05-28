/**
 * Spec 65.8 — Pure helpers for Family B narrative templates.
 *
 * `resolveArticleUrl` is re-exported from family-a (single source of truth
 * for the multi-tenant URL composition rule — Pattern: never hardcode
 * `toolwiki.ai/${slug}`).
 *
 * `splitNarrativeByBeats` is the canonical helper for templates that take
 * a flat LLM narrative string and need to slice it per beat — the spec §1
 * mental-model shows "1 LLM-call full narrative, split by slide".
 */
import type { FamilyBHook } from "./types.ts";

export { resolveArticleUrl } from "../family-a/helpers.ts";

// ─── Hook context builder ─────────────────────────────────────────────────────

/**
 * Build a `FamilyBHook` from the raw `pickHook` + `renderHook` output. The
 * brief-generators (Spec 65.5) already store this shape in
 * `recurringMetadata.formatConfig.hookData`, so most callers can pass it
 * through unchanged — this helper is the explicit conversion site for
 * legacy non-recurring callers + tests.
 */
export function buildHookContext(args: {
  rendered: string;
  variables: Record<string, string>;
}): FamilyBHook {
  return { rendered: args.rendered, variables: args.variables };
}

// ─── Narrative splitting ──────────────────────────────────────────────────────

/**
 * Split a flat narrative string into per-beat sections using a marker
 * convention. The LLM is instructed to emit `## <beat-name>` headers between
 * sections; this helper parses them back into a map.
 *
 * Fault-tolerant: missing beats are silently absent from the result. Callers
 * fall back to gradient-only slides or default copy as appropriate.
 *
 * The spec §1 mental-model calls out "1 LLM-call full narrative, split by
 * slide" — this is that split. Each beat's prompt-instruction body uses
 * exactly the convention asserted here.
 *
 * V1.6.1 (Spec 65.4/65.8 followup) — Sonnet's tagged-block multi-field output
 * pattern emits `## beatName` blocks followed by `<CAPTION>...</CAPTION>` and
 * `<HASHTAGS>...</HASHTAGS>` blocks. The pre-fix greedy capture leaked those
 * tags into the LAST beat's text, which then rendered as visible text in the
 * slide. This helper now treats any line that starts with an `<UPPERCASE_TAG>`
 * opener as a terminator for the current beat — lowercase `<em>` / `<strong>`
 * are still legitimate inline content and pass through.
 */
const UPPERCASE_TAG_OPENER = /^<[A-Z][A-Z0-9_]*>/;

export function splitNarrativeByBeats(
  narrative: string,
  beatNames: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  if (narrative.trim().length === 0) return result;

  // Pattern: lines like `## setup` or `## conflict` (case-insensitive),
  // followed by free-text until the next `## ` header or an UPPERCASE tagged
  // block (e.g. `<CAPTION>` / `<HASHTAGS>`) or EOF. Anchored at line-start to
  // avoid matching `##` inside body markdown.
  const lines = narrative.split("\n");
  let currentBeat: string | null = null;
  let buffer: string[] = [];
  const knownBeats = new Set(beatNames.map((b) => b.toLowerCase()));

  const flush = (): void => {
    if (currentBeat) {
      const text = buffer.join("\n").trim();
      if (text.length > 0) result[currentBeat] = text;
    }
    buffer = [];
  };

  for (const line of lines) {
    // Stop the current beat when we hit a Sonnet-tagged metadata block opener.
    // The closing tag and everything in between is discarded.
    if (currentBeat && UPPERCASE_TAG_OPENER.test(line.trim())) {
      flush();
      currentBeat = null;
      continue;
    }
    const headerMatch = /^##\s+([\w-]+)\s*$/.exec(line);
    if (headerMatch) {
      const tag = headerMatch[1]?.toLowerCase();
      if (tag && knownBeats.has(tag)) {
        flush();
        currentBeat = tag;
        continue;
      }
    }
    if (currentBeat) buffer.push(line);
  }
  flush();

  return result;
}
