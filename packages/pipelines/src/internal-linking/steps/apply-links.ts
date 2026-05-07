import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { LinkSuggestionSchema } from "../types.ts";

const InputSchema = z.object({
  bodyMd: z.string(),
  suggestions: z.array(LinkSuggestionSchema),
  existingLinkSlugs: z.array(z.string()),
});

const OutputSchema = z.object({
  newBodyMd: z.string(),
  appliedSuggestions: z.array(LinkSuggestionSchema),
  rejectedSuggestions: z.array(
    z.object({
      suggestion: LinkSuggestionSchema,
      reason: z.string(),
    })
  ),
  linksAdded: z.number().int().min(0),
});

export class ApplyLinksStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "apply-links";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    type Edit = {
      start: number;
      end: number;
      replacement: string;
      suggestion: z.infer<typeof LinkSuggestionSchema>;
    };

    const edits: Edit[] = [];
    const rejectedSuggestions: Array<{
      suggestion: z.infer<typeof LinkSuggestionSchema>;
      reason: string;
    }> = [];
    const targetsAlreadyApplied = new Set(input.existingLinkSlugs);

    for (const suggestion of input.suggestions) {
      if (targetsAlreadyApplied.has(suggestion.targetSlug)) {
        rejectedSuggestions.push({
          suggestion,
          reason: `Target slug "${suggestion.targetSlug}" already linked from this article`,
        });
        continue;
      }

      const anchorIndices = findValidAnchorPositions(input.bodyMd, suggestion.anchorText);
      if (anchorIndices.length === 0) {
        rejectedSuggestions.push({
          suggestion,
          reason: `Anchor text "${suggestion.anchorText}" not found in body (or only in invalid positions)`,
        });
        continue;
      }

      const start = anchorIndices[0]!;
      const end = start + suggestion.anchorText.length;

      const overlapping = edits.find(
        (e) => (start >= e.start && start < e.end) || (end > e.start && end <= e.end)
      );
      if (overlapping) {
        rejectedSuggestions.push({
          suggestion,
          reason: "Overlaps with another link placement",
        });
        continue;
      }

      const replacement = `[${suggestion.anchorText}](/blog/${suggestion.targetSlug})`;
      edits.push({ start, end, replacement, suggestion });
      targetsAlreadyApplied.add(suggestion.targetSlug);
    }

    // Apply edits in reverse order so earlier offsets aren't invalidated
    edits.sort((a, b) => b.start - a.start);

    let newBody = input.bodyMd;
    for (const edit of edits) {
      newBody = newBody.slice(0, edit.start) + edit.replacement + newBody.slice(edit.end);
    }

    return {
      newBodyMd: newBody,
      appliedSuggestions: edits.map((e) => e.suggestion).reverse(),
      rejectedSuggestions,
      linksAdded: edits.length,
    };
  }
}

/**
 * Find positions where the anchor text appears as plain prose, not inside
 * existing markdown links, headings, or code blocks.
 */
export function findValidAnchorPositions(body: string, anchor: string): number[] {
  const positions: number[] = [];
  let from = 0;
  while (true) {
    const idx = body.indexOf(anchor, from);
    if (idx === -1) break;
    if (isValidAnchorPosition(body, idx, anchor.length)) {
      positions.push(idx);
    }
    from = idx + 1;
  }
  return positions;
}

export function isValidAnchorPosition(body: string, idx: number, length: number): boolean {
  // 1. Not inside an existing markdown link's anchor text
  const before = body.slice(Math.max(0, idx - 200), idx);
  const after = body.slice(idx + length, idx + length + 200);
  const lastOpenBracket = before.lastIndexOf("[");
  const lastCloseBracket = before.lastIndexOf("]");
  if (lastOpenBracket > lastCloseBracket && after.match(/^[^\[\]]*\]\(/)) {
    return false;
  }
  if (after.startsWith("](")) {
    return false;
  }

  // 2. Not on a heading line
  const lineStart = body.lastIndexOf("\n", idx) + 1;
  const lineUpToIdx = body.slice(lineStart, idx);
  if (/^#{1,6}\s/.test(lineUpToIdx)) return false;

  // 3. Not inside a fenced code block (odd number of ``` before idx = inside block)
  const fencesBefore = (body.slice(0, idx).match(/```/g) ?? []).length;
  if (fencesBefore % 2 === 1) return false;

  // 4. Not on an indented code block line
  if (/^( {4,}|\t)/.test(body.slice(lineStart, lineStart + 10))) return false;

  return true;
}
