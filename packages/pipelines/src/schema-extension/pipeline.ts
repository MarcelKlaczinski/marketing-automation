import { z } from "zod";
import { Pipeline } from "../engine/pipeline.ts";
import { LoadArticleStep } from "./steps/load-article.ts";
import { DetectRichTypesStep } from "./steps/detect-rich-types.ts";
import { BuildJsonLdStep } from "./steps/build-jsonld.ts";
import { PersistSchemaStep } from "./steps/persist-schema.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
});

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  schemaCount: z.number(),
  schemaExtensionRunId: z.string().uuid(),
});

type LoadArticleOutput = {
  article: { id: string; bodyMd: string; title: string };
  project: { slug: string; name: string; domain: string };
  cluster: { name: string; pillar: string } | null;
};

type DetectionOutput = {
  hasFaq: boolean;
  hasHowTo: boolean;
  faqQuestions: Array<{ question: string; answer: string }>;
  howToSteps: Array<{ name: string; text: string }>;
  howToName: string | null;
  howToTotalTime: string | null;
};

type BuildOutput = {
  schemaJsonLd: Array<Record<string, unknown>>;
  addedTypes: string[];
};

export class SchemaExtensionPipeline extends Pipeline<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "article:schema-extension";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadArticleStep(),
    new DetectRichTypesStep(),
    new BuildJsonLdStep(),
    new PersistSchemaStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: z.infer<typeof InputSchema>,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "load-article" && toStep.name === "detect-rich-types") {
      const out = output as LoadArticleOutput;
      return {
        bodyMd: out.article.bodyMd,
        title: out.article.title,
        projectSlug: out.project.slug,
      };
    }

    if (fromStep.name === "detect-rich-types" && toStep.name === "build-jsonld") {
      const load = getStepOutput<LoadArticleOutput>("load-article")!;
      return {
        article: load.article,
        project: load.project,
        cluster: load.cluster,
        detection: output,
      };
    }

    if (fromStep.name === "build-jsonld" && toStep.name === "persist-schema") {
      const load = getStepOutput<LoadArticleOutput>("load-article")!;
      const detection = getStepOutput<DetectionOutput>("detect-rich-types")!;
      const built = output as BuildOutput;
      return {
        articleId: load.article.id,
        projectId: pipelineInput.projectId,
        schemaJsonLd: built.schemaJsonLd,
        addedTypes: built.addedTypes,
        detection: {
          hasFaq: detection.hasFaq,
          hasHowTo: detection.hasHowTo,
          faqQuestions: detection.faqQuestions,
          howToSteps: detection.howToSteps,
        },
      };
    }

    return output;
  }

  /**
   * On failure: revert article status from schema_extending back to final_review so Marcel
   * can still sync. Graceful degradation — article gets published without rich types this round.
   */
  override async afterError(_error: unknown, pipelineInput: z.infer<typeof InputSchema>): Promise<void> {
    try {
      const { db, articles } = await import("@marketing-auto/db");
      const { eq } = await import("drizzle-orm");
      await db.update(articles).set({
        status: "final_review",
        updatedAt: new Date(),
      }).where(eq(articles.id, pipelineInput.articleId));
    } catch {
      // Cleanup failure must not affect BullMQ retry behavior (Spec 20 lesson #6)
    }
  }
}
