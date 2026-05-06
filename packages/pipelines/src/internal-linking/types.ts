import { z } from "zod";

export const LinkSuggestionSchema = z.object({
  targetSlug: z.string().regex(/^[a-z0-9-]+$/),
  anchorText: z.string().min(3).max(150),
  sectionHint: z.string().max(200),
  reasoning: z.string().max(300),
});
export type LinkSuggestion = z.infer<typeof LinkSuggestionSchema>;

export const AnalyzeLinksOutputSchema = z.object({
  suggestions: z.array(LinkSuggestionSchema).max(10),
  overallNotes: z.string().max(500),
});
export type AnalyzeLinksOutput = z.infer<typeof AnalyzeLinksOutputSchema>;

// Cast alias for use as BaseStep outputSchema (Zod .default() variance workaround)
export const AnalyzeLinksOutputSchemaOutput = AnalyzeLinksOutputSchema as z.ZodType<AnalyzeLinksOutput>;

export class InternalLinkingError extends Error {
  constructor(
    message: string,
    public readonly stage: "load" | "budget" | "analyze" | "apply" | "persist",
    public readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = "InternalLinkingError";
  }
}
