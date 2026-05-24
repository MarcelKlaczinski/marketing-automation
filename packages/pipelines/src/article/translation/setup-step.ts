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
  sourceArticleId: z.string().uuid(),
  targetArticleId: z.string().uuid().optional(),
  projectId:       z.string().uuid(),
  mode:            z.enum(["fresh_translation", "refresh_propagation", "manual_resync"]),
});

const OutputSchema = z.object({
  targetArticleId:      z.string().uuid(),
  sourceBodyMd:         z.string(),
  sourceTitle:          z.string(),
  sourceMetaDescription: z.string().nullable(),
  sourceBodyExcerpt:    z.string(),   // first 2000 chars for decision step
  primaryKeyword:       z.string(),
  intentType:           z.string().nullable(),
  briefSource:          z.string(),
  voiceReferences:      z.array(VoiceReferenceSchema),
  projectSlug:          z.string(),
  cornerstoneKeyword:   z.string(),
  translationKey:       z.string(),
  sourceLocale:         z.enum(["de", "en"]),
  targetLocale:         z.enum(["de", "en"]),
  // Hero image fields — target article shares the same hero as source
  sourceHeroR2Key:      z.string().nullable(),
  sourceHeroPublicUrl:  z.string().nullable(),
  sourceHeroAltText:    z.string().nullable(),
  // Base schema from source article carried forward
  sourceSchemaJsonLd:   z.array(z.record(z.unknown())),
  // Taxonomy — category/subcategory are language-specific, not forwarded
  sourceCategory:       z.string().nullable(),
  sourceSubcategory:    z.string().nullable(),
  sourceFrontmatterExtras: z.record(z.unknown()).nullable(),
  // Spec 64.3 — surfaced for the bridge so it can build target-locale canonical URLs
  // synchronously (Pipeline.bridge() cannot do async DB reads).
  projectDomain:        z.string(),
  sourceCollection:     z.string(),
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
    // Load source article
    const [sourceArticle] = await db
      .select()
      .from(articles)
      .where(and(
        eq(articles.id, input.sourceArticleId),
        eq(articles.projectId, input.projectId),
      ))
      .limit(1);
    if (!sourceArticle) throw new ArticlePipelineError(`Source article ${input.sourceArticleId} not found`, "translation-setup");
    if (!sourceArticle.bodyMd) throw new ArticlePipelineError("Source article has no body — cannot translate", "translation-setup");

    const sourceLocale = (sourceArticle.locale ?? "de") as "de" | "en";
    const targetLocale: "de" | "en" = sourceLocale === "de" ? "en" : "de";

    // Resolve translationKey — generate + back-apply to source if missing
    let translationKey = sourceArticle.translationKey;
    if (!translationKey) {
      translationKey = generateTranslationKey();
      await db.update(articles)
        .set({ translationKey })
        .where(eq(articles.id, sourceArticle.id));
      ctx.log.info({ articleId: sourceArticle.id, translationKey, sourceLocale }, "[translation-setup] generated new translationKey for source article");
    }

    let targetArticleId: string;

    if (input.mode === "fresh_translation") {
      // Idempotent: if a target sibling already exists (re-run after downstream failure), reuse it
      const [existing] = await db
        .select({ id: articles.id })
        .from(articles)
        .where(and(
          eq(articles.projectId, input.projectId),
          eq(articles.translationKey, translationKey),
          eq(articles.locale, targetLocale),
        ))
        .limit(1);

      if (existing) {
        targetArticleId = existing.id;
        ctx.log.info({ targetArticleId, targetLocale, translationKey }, "[translation-setup] reusing existing target article (idempotent re-run)");
      } else {
        // Create target article stub — slug is placeholder, updated after body generation
        const targetSlug = `${sourceArticle.slug}-${targetLocale}`;
        const [targetArticle] = await db.insert(articles).values({
          projectId:          input.projectId,
          clusterId:          sourceArticle.clusterId,
          source:             "generated",
          collection:         sourceArticle.collection,
          locale:             targetLocale,
          translationKey,
          slug:               targetSlug,
          cornerstoneKeyword: sourceArticle.cornerstoneKeyword ?? "",
          intentType:         sourceArticle.intentType,
          author:             sourceArticle.author,
          status:             "proposed",
          approvalMode:       sourceArticle.approvalMode,
        }).returning({ id: articles.id });
        if (!targetArticle) throw new ArticlePipelineError(`Failed to create ${targetLocale} article stub`, "translation-setup");
        targetArticleId = targetArticle.id;
        ctx.log.info({ targetArticleId, targetLocale, translationKey }, "[translation-setup] target article stub created");
      }
    } else {
      // refresh_propagation / manual_resync: target article already exists
      if (!input.targetArticleId) throw new ArticlePipelineError(`targetArticleId required for ${input.mode}`, "translation-setup");
      targetArticleId = input.targetArticleId;
    }

    // Find the source article's brief for briefSource (used by decision step)
    let briefSource = "unknown";
    try {
      const [brief] = await db
        .select({ source: topicBriefs.source })
        .from(topicBriefs)
        .where(eq(topicBriefs.routedArticleId, sourceArticle.id))
        .limit(1);
      if (brief) briefSource = brief.source;
    } catch {
      ctx.log.warn({ articleId: sourceArticle.id }, "[translation-setup] could not find brief for source article — using 'unknown'");
    }

    // Load voice references in TARGET locale from same cluster
    const voiceRefs = await loadVoiceReferences({
      projectId:        input.projectId,
      clusterId:        sourceArticle.clusterId,
      locale:           targetLocale,
      excludeArticleId: input.mode !== "fresh_translation" ? targetArticleId : null,
      limit:            3,
    });

    // Get projectSlug for prompt builder + projectDomain for canonical-URL builder (Spec 64.3)
    const [proj] = await db
      .select({ slug: projects.slug, domain: projects.domain })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    const projectSlug = proj?.slug ?? input.projectId;
    const projectDomain = proj?.domain ?? `${projectSlug}.example.com`;

    const sourceBodyMd = sourceArticle.bodyMd ?? "";

    return {
      targetArticleId,
      sourceBodyMd,
      sourceTitle:            sourceArticle.title ?? "",
      sourceMetaDescription:  sourceArticle.metaDescription ?? null,
      sourceBodyExcerpt:      sourceBodyMd.substring(0, 2000),
      primaryKeyword:         sourceArticle.cornerstoneKeyword ?? "",
      intentType:             sourceArticle.intentType,
      briefSource,
      voiceReferences:        voiceRefs as VoiceReference[],
      projectSlug,
      cornerstoneKeyword:     sourceArticle.cornerstoneKeyword ?? "",
      translationKey,
      sourceLocale,
      targetLocale,
      sourceHeroR2Key:        sourceArticle.heroImageR2Key ?? null,
      sourceHeroPublicUrl:    sourceArticle.heroImagePublicUrl ?? null,
      sourceHeroAltText:      sourceArticle.heroImageAltText ?? null,
      sourceSchemaJsonLd:     (sourceArticle.schemaJsonLd as Array<Record<string, unknown>>) ?? [],
      sourceCategory:         sourceArticle.category ?? null,
      sourceSubcategory:      sourceArticle.subcategory ?? null,
      sourceFrontmatterExtras: (sourceArticle.domainExtras as Record<string, unknown> | null) ?? null,
      projectDomain,
      sourceCollection:        sourceArticle.collection,
    };
  }
}
