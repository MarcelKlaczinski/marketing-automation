import { articles, db, eq } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { linkifyMarkdown } from "./post-generation.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  locale: z.enum(["de", "en"]),
  bodyMd: z.string(),
});

const OutputSchema = z.object({
  bodyMd: z.string(),
  linksAdded: z.number().int().min(0),
  linkedTools: z.array(z.string()),
});

/**
 * Pipeline step that linkifies tool name mentions in the draft body.
 * Inserts between DraftStep and SelfReviewStep in the blog pipeline.
 * Cost: $0 — pure string manipulation, no LLM or API calls.
 */
export class ToolLinkerStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "tool-linker";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const result = await linkifyMarkdown(input.bodyMd, input.projectId, input.locale);

    // Persist the linkified body back to the article row
    await db
      .update(articles)
      .set({ bodyMd: result.bodyMd, updatedAt: new Date() })
      .where(eq(articles.id, input.articleId));

    ctx.log.info(
      { articleId: input.articleId, linksAdded: result.linksAdded, linkedTools: result.linkedTools },
      "[tool-linker] linkification complete"
    );

    return {
      bodyMd: result.bodyMd,
      linksAdded: result.linksAdded,
      linkedTools: result.linkedTools,
    };
  }
}
