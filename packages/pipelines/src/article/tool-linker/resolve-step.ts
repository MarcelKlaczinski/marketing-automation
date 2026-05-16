import { db, eq, topicBriefs } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSourceContextFragment } from "../source-context/index.ts";
import { buildToolsContextFragment, resolveRelevantTools } from "./pre-generation.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  briefId: z.string().uuid(),
});

const OutputSchema = z.object({
  sourceContext: z.string(),
  toolsContext: z.string(),
});

/**
 * Pipeline step: resolve source-context and tools-context strings for injection
 * into the Outline and Draft step user messages.
 * Cost: €0 — DB reads + pure string formatting, no LLM or embedding calls.
 */
export class ToolRelevanceStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "tool-relevance";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext) {
    const [brief] = await db
      .select()
      .from(topicBriefs)
      .where(eq(topicBriefs.id, input.briefId))
      .limit(1);

    if (!brief) {
      throw new Error(`TopicBrief ${input.briefId} not found`);
    }

    const localeRaw = brief.locale;
    const locale: "de" | "en" =
      localeRaw === "de" || localeRaw === "en" ? localeRaw : "de";

    const sourceContext = buildSourceContextFragment(brief);
    const tools = await resolveRelevantTools(input.projectId, brief, locale);

    const toolsContext = buildToolsContextFragment(tools);

    ctx.log.info(
      {
        articleId: input.articleId,
        primaryTools: tools.primary.map((t) => t.slug),
        secondaryTools: tools.secondary.map((t) => t.slug),
        hasSourceContext: sourceContext.length > 0,
      },
      "[tool-relevance] context resolved"
    );

    return { sourceContext, toolsContext };
  }
}
