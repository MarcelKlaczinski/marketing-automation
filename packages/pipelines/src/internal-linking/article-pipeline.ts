import { z } from "zod";
import { Pipeline } from "../engine/pipeline.ts";
import { LoadCandidatesStep } from "./steps/load-candidates.ts";
import { AnalyzeLinksStep } from "./steps/analyze-links.ts";
import { ApplyLinksStep } from "./steps/apply-links.ts";
import { PersistAndQueueResyncStep } from "./steps/persist-and-resync.ts";
import type { LinkSuggestion } from "./types.ts";

const InputSchema = z.object({
  articleId: z.string().uuid(),
  clusterId: z.string().uuid(),
  projectId: z.string().uuid(),
  triggerResync: z.boolean().default(true),
});

type ArticleLinkInput = {
  articleId: string;
  clusterId: string;
  projectId: string;
  triggerResync: boolean;
};

// Cast needed: .default() makes _input `boolean | undefined` but _output is `boolean`.
// Under strictFunctionTypes this fails the ZodType<ArticleLinkInput> assignability check.
const InputSchemaCast = InputSchema as z.ZodType<ArticleLinkInput>;

const OutputSchema = z.object({
  articleId: z.string().uuid(),
  linksAdded: z.number(),
  resyncJobId: z.string().nullable(),
});

export class ArticleLinkUpdatePipeline extends Pipeline<
  ArticleLinkInput,
  z.infer<typeof OutputSchema>
> {
  readonly name = "article:link-update";
  readonly inputSchema = InputSchemaCast;
  readonly outputSchema = OutputSchema;
  readonly steps = [
    new LoadCandidatesStep(),
    new AnalyzeLinksStep(),
    new ApplyLinksStep(),
    new PersistAndQueueResyncStep(),
  ] as const;

  override bridge(
    fromStep: { name: string },
    toStep: { name: string },
    output: unknown,
    pipelineInput: ArticleLinkInput,
    getStepOutput: <T = unknown>(name: string) => T | undefined,
  ): unknown {
    if (fromStep.name === "load-candidates" && toStep.name === "analyze-links") {
      return output;
    }
    if (fromStep.name === "analyze-links" && toStep.name === "apply-links") {
      const load = getStepOutput<{
        article: { bodyMd: string };
        existingLinkSlugs: string[];
      }>("load-candidates")!;
      const analyze = output as { suggestions: LinkSuggestion[] };
      return {
        bodyMd: load.article.bodyMd,
        suggestions: analyze.suggestions,
        existingLinkSlugs: load.existingLinkSlugs,
      };
    }
    if (fromStep.name === "apply-links" && toStep.name === "persist-and-resync") {
      const apply = output as {
        newBodyMd: string;
        linksAdded: number;
        appliedSuggestions: Array<{ targetSlug: string }>;
      };
      return {
        articleId: pipelineInput.articleId,
        projectId: pipelineInput.projectId,
        newBodyMd: apply.newBodyMd,
        linksAdded: apply.linksAdded,
        appliedTargets: apply.appliedSuggestions.map((s) => s.targetSlug),
        triggerResync: pipelineInput.triggerResync,
      };
    }
    return output;
  }
}
