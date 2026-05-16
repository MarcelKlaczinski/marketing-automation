import { articles, and, db, eq } from "@marketing-auto/db";
import type { LinkifyResult } from "./types.ts";

interface ToolEntry {
  slug: string;
  name: string;
}

// ─── Markdown section splitter ────────────────────────────────────────────────

/**
 * Split markdown into H2-delimited sections, keeping each `## heading` attached
 * to its content. The first element is everything before the first H2 (intro).
 */
function splitByH2(body: string): string[] {
  // Split on lines that start with exactly "## " (H2, not H3+)
  const parts = body.split(/(?=^## )/m);
  return parts.filter((p) => p.length > 0);
}

// ─── Code-block / existing-link guard ────────────────────────────────────────

/**
 * Returns true if position `idx` in `text` is inside a code fence (```) or
 * inline code (` ... `). Uses a simple line-scan for fences plus a regex for
 * inline code. Conservative: prefers false negatives over false positives
 * (skip linkification rather than double-link).
 */
function isInsideCodeOrLink(text: string, idx: number, nameLength: number): boolean {
  // ── 1. Code fence tracking (line-level) ──────────────────────────────────────
  const textBefore = text.slice(0, idx);
  const linesBeforeMatch = textBefore.split("\n");
  let insideFence = false;
  for (const line of linesBeforeMatch) {
    if (line.trimStart().startsWith("```")) {
      insideFence = !insideFence;
    }
  }
  if (insideFence) return true;

  // ── 2. Inline code check ─────────────────────────────────────────────────────
  // Count backticks before idx; odd count = we are inside inline code
  let backtickCount = 0;
  for (let i = 0; i < idx; i++) {
    if (text[i] === "`") backtickCount++;
  }
  if (backtickCount % 2 !== 0) return true;

  // ── 3. Existing markdown link check ──────────────────────────────────────────
  // Simplified: look back up to 300 chars for an unmatched `[`; if the text
  // after the match starts with `](` the name is inside a link URL target.
  const after = text.slice(idx + nameLength, idx + nameLength + 200);
  if (after.startsWith("](")) return true; // URL part of an existing link

  const before = text.slice(Math.max(0, idx - 300), idx);
  const lastOpen = before.lastIndexOf("[");
  const lastClose = before.lastIndexOf("]");
  if (lastOpen > lastClose && after.match(/^[^\[\]]*\]\(/)) return true;

  return false;
}

// ─── Word-boundary check ──────────────────────────────────────────────────────

const WORD_BOUNDARY_CHARS = /[\w]/;

function hasWordBoundary(text: string, idx: number, nameLength: number): boolean {
  const charBefore = idx > 0 ? text[idx - 1] : " ";
  const charAfter = idx + nameLength < text.length ? text[idx + nameLength] : " ";
  const beforeOk = !WORD_BOUNDARY_CHARS.test(charBefore ?? "");
  const afterOk = !WORD_BOUNDARY_CHARS.test(charAfter ?? "");
  return beforeOk && afterOk;
}

// ─── Section processor ────────────────────────────────────────────────────────

function processSection(
  section: string,
  sortedTools: ToolEntry[],
  locale: "de" | "en",
  linkedInSection: Set<string>,
): { text: string; newLinks: string[] } {
  let result = section;
  const newLinks: string[] = [];

  for (const tool of sortedTools) {
    if (linkedInSection.has(tool.slug)) continue;

    // Case-sensitive search for the tool name
    let searchFrom = 0;
    let foundAt = -1;

    while (searchFrom < result.length) {
      const idx = result.indexOf(tool.name, searchFrom);
      if (idx === -1) break;

      if (
        hasWordBoundary(result, idx, tool.name.length) &&
        !isInsideCodeOrLink(result, idx, tool.name.length)
      ) {
        foundAt = idx;
        break;
      }
      searchFrom = idx + 1;
    }

    if (foundAt === -1) continue;

    const url = `/${locale}/tools/${tool.slug}`;
    const replacement = `[${tool.name}](${url})`;
    result =
      result.slice(0, foundAt) +
      replacement +
      result.slice(foundAt + tool.name.length);

    linkedInSection.add(tool.slug);
    newLinks.push(tool.slug);
  }

  return { text: result, newLinks };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Post-draft linkification: replace the first occurrence of each known tool name
 * per H2 section with a markdown link to the tool's page.
 *
 * Rules enforced:
 * - Case-sensitive matching (no "claude" → /tools/claude)
 * - Word-boundary check (avoids partial-word matches)
 * - Skip occurrences inside code fences, inline code, or existing markdown links
 * - First-occurrence-per-H2-section only (SEO best practice; avoids over-linking)
 * - Longer tool names matched before shorter (GitHub Copilot before GitHub)
 * - URL format: /<locale>/tools/<slug>
 *
 * Queries ALL tools for the project+locale (not just cluster-matched) so that
 * any tool the LLM happened to mention gets linked.
 *
 * Cost: $0 — pure string manipulation, no LLM.
 */
export async function linkifyMarkdown(
  bodyMd: string,
  projectId: string,
  locale: "de" | "en",
): Promise<LinkifyResult> {
  // Fetch all tools for this project + locale
  const toolRows = await db
    .select({
      slug: articles.slug,
      title: articles.title,
    })
    .from(articles)
    .where(
      and(
        eq(articles.projectId, projectId),
        eq(articles.collection, "tools"),
        eq(articles.locale, locale),
      ),
    );

  if (toolRows.length === 0) {
    return { bodyMd, linksAdded: 0, linkedTools: [] };
  }

  // Build tool entry list, sort by name length DESC so longer names match first
  const tools: ToolEntry[] = toolRows
    .filter((r) => r.title)
    .map((r) => ({ slug: r.slug, name: r.title! }))
    .sort((a, b) => b.name.length - a.name.length);

  // Split markdown into H2 sections and process each
  const sections = splitByH2(bodyMd);
  const allLinkedSlugs = new Set<string>();
  let totalLinksAdded = 0;

  const processedSections = sections.map((section) => {
    const linkedInSection = new Set<string>();
    const { text, newLinks } = processSection(section, tools, locale, linkedInSection);
    newLinks.forEach((slug) => allLinkedSlugs.add(slug));
    totalLinksAdded += newLinks.length;
    return text;
  });

  return {
    bodyMd: processedSections.join(""),
    linksAdded: totalLinksAdded,
    linkedTools: Array.from(allLinkedSlugs),
  };
}
