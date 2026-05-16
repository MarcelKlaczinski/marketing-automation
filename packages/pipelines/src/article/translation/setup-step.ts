import { articles, db, eq, topicBriefs, projects } from "@marketing-auto/db";
import { and } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { loadVoiceReferences, type VoiceReference } from "../voice-reference/loader.ts";
import { ArticlePipelineError } from "../types.ts";

const VoiceReferenceSchema = z.object({
  articleId:       z.string(),
  title:           z.string(),
  bodyMdExcerpt:   z.string(),
  intentType:      z.string().nullable(),
  selfReviewScore: z.number().nullable(),
});

const InputSchema = z.object({
  sourceArticleId: z.string().uuid(),           // DE article
  targetArticleId: z.string().uuid().optional(), // EN article (refresh_propagation only)
  projectId:       z.string().uuid(),
  mode:            z.enum(["fresh_translation", "refresh_propagation"]),
});

const OutputSchema = z.object({
  enArticleId:      z.string().uuid(),
  deBodyMd:         z.string(),
  deTitle:          z.string(),
  deBodyExcerpt:    z.string(),  // first 2000 chars for decision step
  primaryKeyword:   z.string(),
  intentType:       z.string().nullable(),
  briefSource:      z.string(),  // source from the DE article's brief
  voiceReferences:  z.array(VoiceReferenceSchema),
  projectSlug:      z.string(),
  cornerstoneKeyword: z.string(),
  translationKey:   z.string(),
});

export type TranslationSetupOutput = z.infer<typeof OutputSchema>;

function generateTranslationKey(): string {
  return crypto.randomUUID();
}

export class TranslationSetupStep extends BaseStep<
  z.infer<typeof InputSchema>,
  TranslationSetupOutput
> {
  readonly name = "translation-setup";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<TranslationSetupOutput> {
    // Load DE article
    const [deArticle] = await db
      .select()
      .from(articles)
      .where(and(
        eq(articles.id, input.sourceArticleId),
        eq(articles.projectId, input.projectId),
      ))
      .limit(1);
    if (!deArticle) throw new ArticlePipelineError(`Source article ${input.sourceArticleId} not found`, "translation-setup");
    if (!deArticle.bodyMd) throw new ArticlePipelineError("Source article has no body — cannot translate", "translation-setup");

    // Resolve translationKey — generate + back-apply to DE if missing
    let translationKey = deArticle.translationKey;
    if (!translationKey) {
      translationKey = generateTranslationKey();
      await db.update(articles)
        .set({ translationKey })
        .where(eq(articles.id, deArticle.id));
      ctx.log.info({ articleId: deArticle.id, translationKey }, "[translation-setup] generated new translationKey for DE article");
    }

    let enArticleId: string;

    if (input.mode === "fresh_translation") {
      // Idempotent: if an EN sibling already exists (re-run after downstream failure), reuse it
      const [existing] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(and(
          eq(articles.projectId, input.projectId),
          eq(articles.translationKey, translationKey),
          eq(articles.locale, "en"),
        ))
        .limit(1);

      if (existing) {
        enArticleId = existing.id;
        ctx.log.info({ enArticleId, translationKey }, "[translation-setup] reusing existing EN article (idempotent re-run)");
      } else {
        // Create EN article stub — slug is placeholder, will be updated after body generation
        const enSlug = `${deArticle.slug}-en`;
        const [enArticle] = await db.insert(articles).values({
          projectId:          input.projectId,
          clusterId:          deArticle.clusterId,
          source:             "generated",
          collection:         deArticle.collection,
          locale:             "en",
          translationKey,
          slug:               enSlug,
          cornerstoneKeyword: deArticle.cornerstoneKeyword ?? "",
          intentType:         deArticle.intentType,
          author:             deArticle.author,
          status:             "proposed",
          approvalMode:       deArticle.approvalMode,
        }).returning({ id: articles.id });
        if (!enArticle) throw new ArticlePipelineError("Failed to create EN article stub", "translation-setup");
        enArticleId = enArticle.id;
        ctx.log.info({ enArticleId, translationKey }, "[translation-setup] EN article stub created");
      }
    } else {
      // refresh_propagation: EN article already exists
      if (!input.targetArticleId) throw new ArticlePipelineError("targetArticleId required for refresh_propagation", "translation-setup");
      enArticleId = input.targetArticleId;
    }

    // Find the DE article's brief for briefSource (used by decision step)
    let briefSource = "unknown";
    try {
      const [brief] = await db
        .select({ source: topicBriefs.source })
        .from(topicBriefs)
        .where(eq(topicBriefs.routedArticleId, deArticle.id))
        .limit(1);
      if (brief) briefSource = brief.source;
    } catch {
      ctx.log.warn({ articleId: deArticle.id }, "[translation-setup] could not find brief for DE article — using 'unknown'");
    }

    // Load EN voice references from same cluster
    const voiceRefs = await loadVoiceReferences({
      projectId:         input.projectId,
      clusterId:         deArticle.clusterId,
      locale:            "en",
      excludeArticleId:  input.mode === "refresh_propagation" ? enArticleId : null,
      limit:             3,
    });

    // Get projectSlug for prompt builder
    const [proj] = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    const projectSlug = proj?.slug ?? input.projectId;

    const deBodyMd = deArticle.bodyMd ?? "";

    return {
      enArticleId,
      deBodyMd,
      deTitle:           deArticle.title ?? "",
      deBodyExcerpt:     deBodyMd.substring(0, 2000),
      primaryKeyword:    deArticle.cornerstoneKeyword ?? "",
      intentType:        deArticle.intentType,
      briefSource,
      voiceReferences:   voiceRefs as VoiceReference[],
      projectSlug,
      cornerstoneKeyword: deArticle.cornerstoneKeyword ?? "",
      translationKey,
    };
  }
}
