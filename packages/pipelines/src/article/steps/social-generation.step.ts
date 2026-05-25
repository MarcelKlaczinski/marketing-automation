// Spec 60.7: optional step that auto-generates social renders after article persistence.
// Runs only when project.socialAutoRenderLocales is set.
// Writes to template_renders (canonical table per Pattern 104).
import { z } from "zod";
import { type Article, type ArticleDiscovery, articleDiscovery, articles, db, getTemplate, markArticleTemplateSnapshot, projects, templateRenders } from "@marketing-auto/db";
import { and, eq, inArray } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import { enqueueTemplateRenderFromStep } from "../../engine/template-render-queue.ts";

const log = createLogger("pipelines:social-generation-step");

// ─── resolveAutoTemplates (Pattern 103) ──────────────────────────────────────

export function resolveAutoTemplates(
  config: string[],
  suggestions: Array<{ templateKey: string; confidence: number }>,
): string[] {
  if (config.length === 0) {
    const top1 = suggestions
      .filter((s) => s.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence)[0];
    return top1 ? [top1.templateKey] : [];
  }

  if (config.includes("__suggested__")) {
    return suggestions
      .filter((s) => s.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence)
      .map((s) => s.templateKey);
  }

  // Explicit list — eligibility checked at enqueue time
  return config;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

// Input includes PersistArticleStep pass-through fields so the pipeline output
// (BlogPipelineOutputSchema) remains satisfied after SocialGenerationStep becomes
// the last step.
const SocialGenerationInputSchema = z.object({
  articleId: z.string().uuid(),
  wordCount: z.number(),
  selfReviewScore: z.number(),
});

const SocialGenerationOutputSchema = z.object({
  articleId: z.string().uuid(),
  wordCount: z.number(),
  selfReviewScore: z.number(),
  socialRenderJobIds: z.array(z.string()),
});

export type SocialGenerationInput  = z.infer<typeof SocialGenerationInputSchema>;
export type SocialGenerationOutput = z.infer<typeof SocialGenerationOutputSchema>;

// ─── SocialGenerationStep (Pattern 102) ──────────────────────────────────────

export class SocialGenerationStep extends BaseStep<SocialGenerationInput, SocialGenerationOutput> {
  readonly name = "social-generation";
  readonly inputSchema  = SocialGenerationInputSchema  as z.ZodType<SocialGenerationInput>;
  readonly outputSchema = SocialGenerationOutputSchema as z.ZodType<SocialGenerationOutput>;

  override skipOutput(input: SocialGenerationInput): SocialGenerationOutput {
    return { ...input, socialRenderJobIds: [] };
  }

  override async shouldRun(ctx: StepContext): Promise<boolean> {
    const [project] = await db
      .select({ socialAutoRenderLocales: projects.socialAutoRenderLocales })
      .from(projects)
      .where(eq(projects.id, ctx.projectId))
      .limit(1);
    return !!project?.socialAutoRenderLocales;
  }

  async execute(input: SocialGenerationInput, ctx: StepContext): Promise<SocialGenerationOutput> {
    const base = { articleId: input.articleId, wordCount: input.wordCount, selfReviewScore: input.selfReviewScore };

    const [project] = await db
      .select({
        socialAutoRenderLocales: projects.socialAutoRenderLocales,
        socialAutoTemplates:     projects.socialAutoTemplates,
        targetLocales:           projects.targetLocales,
      })
      .from(projects)
      .where(eq(projects.id, ctx.projectId))
      .limit(1);

    if (!project?.socialAutoRenderLocales) {
      return { ...base, socialRenderJobIds: [] };
    }

    const [article] = await db
      .select()
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);
    if (!article) return { ...base, socialRenderJobIds: [] };

    const [discovery] = await db
      .select()
      .from(articleDiscovery)
      .where(eq(articleDiscovery.articleId, input.articleId))
      .limit(1);

    const suggestions = discovery?.suggestedTemplates ?? [];
    const templateKeys = resolveAutoTemplates(project.socialAutoTemplates, suggestions);

    if (templateKeys.length === 0) {
      log.info({ articleId: input.articleId }, "[social-generation] no templates resolved");
      return { ...base, socialRenderJobIds: [] };
    }

    // Fail fast if discovery data is missing — eligibility checks require it
    if (!discovery) {
      log.info({ articleId: input.articleId }, "[social-generation] no discovery data — all templates skipped");
      return { ...base, socialRenderJobIds: [] };
    }

    // Determine BCP-47 locales to render
    const articleBcp47 = article.locale === "en" ? "en-US" : "de-DE";
    const renderLocales: string[] = project.socialAutoRenderLocales === "all"
      ? (project.targetLocales ?? ["de-DE"])
      : [articleBcp47];

    const { templateRegistry } = await import("../../../../social/src/templates/index.ts") as typeof import("../../../../social/src/templates/index.ts");

    const jobIds: string[] = [];

    for (const templateKey of templateKeys) {
      let template: ReturnType<typeof templateRegistry.getById> | null = null;
      try {
        template = templateRegistry.getById(templateKey as Parameters<typeof templateRegistry.getById>[0]);
      } catch {
        log.warn({ templateKey, articleId: input.articleId }, "[social-generation] unknown template key — skipped");
        continue;
      }

      for (const bcp47Locale of renderLocales) {
        const localeShort = (bcp47Locale.split("-")[0] ?? "de") as string;

        // Load locale-appropriate content article (sibling lookup when locale differs)
        let contentArticle = article as typeof article;
        if (localeShort !== article.locale && article.translationKey) {
          const [sibling] = await db
            .select()
            .from(articles)
            .where(
              and(
                eq(articles.projectId, article.projectId),
                eq(articles.translationKey, article.translationKey),
                eq(articles.locale, localeShort),
              )
            )
            .limit(1);
          if (!sibling) {
            log.info({ articleId: input.articleId, locale: bcp47Locale, templateKey }, "[social-generation] sibling not found — locale skipped");
            continue;
          }
          contentArticle = sibling;
        }

        const eligibility = template.eligibility(contentArticle as Article, discovery as ArticleDiscovery);
        if (!eligibility.eligible) {
          log.info({ articleId: input.articleId, templateKey, reason: eligibility.reason }, "[social-generation] ineligible — skipped");
          continue;
        }

        let renderInput: Record<string, unknown>;
        try {
          renderInput = (await template.buildInput(
            contentArticle as Article,
            discovery as ArticleDiscovery,
          )) as Record<string, unknown>;
        } catch (err) {
          log.warn({ err, articleId: input.articleId, templateKey }, "[social-generation] buildInput failed — skipped");
          continue;
        }

        const suggestion = suggestions.find((s) => s.templateKey === templateKey);

        // Supersede any active rows so the unique partial index allows the new INSERT
        await db
          .update(templateRenders)
          .set({ status: "superseded" })
          .where(
            and(
              eq(templateRenders.articleId, input.articleId),
              eq(templateRenders.templateKey, templateKey),
              eq(templateRenders.locale, bcp47Locale),
              eq(templateRenders.theme, "dark"),
              inArray(templateRenders.status, ["pending", "rendering", "ready"] as Array<"pending" | "rendering" | "ready">),
            )
          );

        const insertValues: typeof templateRenders.$inferInsert = {
          articleId: input.articleId,
          templateKey,
          locale: bcp47Locale,
          theme: "dark",
          status: "pending",
          renderInput,
          userOverride: false,
        };
        if (suggestion) {
          insertValues.suggestedTemplate   = suggestion.templateKey;
          insertValues.suggestionConfidence = String(suggestion.confidence);
        }

        const [insertedRow] = await db
          .insert(templateRenders)
          .values(insertValues)
          .returning({ id: templateRenders.id });

        if (!insertedRow) {
          log.warn({ articleId: input.articleId, templateKey, bcp47Locale }, "[social-generation] DB insert failed — skipped");
          continue;
        }

        // Spec 65.0 Day 6 — stamp the article with the rendering template's
        // current file_hash so `articles.template_key/template_version`
        // reflect the latest render (Marcel-Decision §8 "current wins").
        // Best-effort: failure here must not break the render flow.
        try {
          const tplRow = await getTemplate({ projectId: ctx.projectId, templateKey });
          if (tplRow) {
            await markArticleTemplateSnapshot({
              articleId: input.articleId,
              templateKey,
              templateVersion: tplRow.fileHash,
            });
          }
        } catch (err) {
          log.warn({ err, articleId: input.articleId, templateKey }, "[social-generation] template snapshot write failed");
        }

        try {
          const { jobId } = await enqueueTemplateRenderFromStep(insertedRow.id);
          jobIds.push(jobId);
          log.info({ articleId: input.articleId, templateKey, locale: bcp47Locale, renderId: insertedRow.id, jobId }, "[social-generation] render job enqueued");
        } catch (err) {
          log.warn({ err, renderId: insertedRow.id, templateKey }, "[social-generation] enqueue failed — render row persisted, no job");
        }
      }
    }

    return { ...base, socialRenderJobIds: jobIds };
  }
}
