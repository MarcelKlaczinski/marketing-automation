import { articles, db, topicBriefs } from "@marketing-auto/db";
import { eq } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { buildSourceContextFragment } from "../source-context/index.ts";
import { loadVoiceReferences, formatVoiceReferences } from "../voice-reference/loader.ts";
import { persistVersion } from "./persist-version.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  briefId:   z.string().uuid(),
});

export const RefreshIntakeOutputSchema = z.object({
  articleId:          z.string().uuid(),
  projectId:          z.string().uuid(),
  briefId:            z.string().uuid(),
  versionNumber:      z.number(),
  locale:             z.enum(["de", "en"]),
  cornerstoneKeyword: z.string(),
  articleSlug:        z.string(),
  articleTitle:       z.string().nullable(),
  clusterId:          z.string().uuid().nullable(),
  translationKey:     z.string().nullable(),
  voiceContext:       z.string(),   // pre-formatted voice references string for prompt injection
  sourceContext:      z.string(),   // refresh-specific source framing
});

export type RefreshIntakeOutput = z.infer<typeof RefreshIntakeOutputSchema>;

export class RefreshIntakeStep extends BaseStep<
  z.infer<typeof InputSchema>,
  RefreshIntakeOutput
> {
  readonly name = "refresh-intake";
  readonly inputSchema = InputSchema;
  readonly outputSchema = RefreshIntakeOutputSchema;

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<RefreshIntakeOutput> {
    const [article] = await db.select().from(articles).where(eq(articles.id, input.articleId)).limit(1);
    if (!article) throw new Error(`Article ${input.articleId} not found`);

    const [brief] = await db.select().from(topicBriefs).where(eq(topicBriefs.id, input.briefId)).limit(1);
    if (!brief) throw new Error(`Brief ${input.briefId} not found`);

    // Persist BEFORE regeneration — defensive ordering (Spec 54.10 Decision 14)
    const versionNumber = await persistVersion(article);

    ctx.log.info({ articleId: article.id, versionNumber }, "[refresh-intake] Version persisted before regeneration");

    const locale = (article.locale ?? "de") as "de" | "en";

    const voiceRefs = await loadVoiceReferences({
      projectId: article.projectId,
      clusterId: article.clusterId,
      locale,
      excludeArticleId: article.id,
      limit: 3,
    });

    // Prepend original body as the primary voice reference so LLM can match the voice
    const originalExcerpt = article.bodyMd
      ? `--- Original Article Body (match this voice and narrative arc) ---\n${article.bodyMd.substring(0, 2000)}${article.bodyMd.length > 2000 ? "\n[...excerpt truncated]" : ""}`
      : "";

    const peerRefs = formatVoiceReferences(voiceRefs);
    const voiceContext = [originalExcerpt, peerRefs].filter(Boolean).join("\n\n");
    const sourceContext = buildSourceContextFragment(brief);

    return {
      articleId:          input.articleId,
      projectId:          input.projectId,
      briefId:            input.briefId,
      versionNumber,
      locale,
      cornerstoneKeyword: article.cornerstoneKeyword ?? "",
      articleSlug:        article.slug ?? "",
      articleTitle:       article.title,
      clusterId:          article.clusterId,
      translationKey:     article.translationKey,
      voiceContext,
      sourceContext,
    };
  }
}
