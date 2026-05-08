import { assertCostBudget, estimateCostEur } from "@marketing-auto/core/cost";
import { COST_OPS } from "@marketing-auto/core/cost";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { z } from "zod";
import { CoreWebVitalsSchema, PagespeedError, PagespeedScoresSchema } from "../types.ts";

const log = createLogger("pagespeed:psi-api");

const PSI_BASE_URL =
  "https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed";
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

const InputSchema = z.object({
  url: z.string().url(),
  articleId: z.string().uuid(),
});

const OutputSchema = z.object({
  scores: PagespeedScoresSchema,
  coreWebVitals: CoreWebVitalsSchema,
  testedUrl: z.string().url(),
  reportPath: z.null(),
});

type PsiApiInput = z.infer<typeof InputSchema>;
type PsiApiOutput = z.infer<typeof OutputSchema>;

// Minimal type for the PSI response fields we use
type PsiApiResponse = {
  lighthouseResult?: {
    categories?: {
      performance?: { score: number | null };
      accessibility?: { score: number | null };
      "best-practices"?: { score: number | null };
      seo?: { score: number | null };
    };
    audits?: Record<string, { numericValue?: number | null }>;
  };
};

export class PsiApiStep extends BaseStep<PsiApiInput, PsiApiOutput> {
  readonly name = "psi-api";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0;
  }

  async execute(input: PsiApiInput, ctx: StepContext): Promise<PsiApiOutput> {
    await assertCostBudget(
      ctx.projectId,
      "pagespeed",
      estimateCostEur("pagespeed", COST_OPS.PAGESPEED_PSI_API)
    );

    const env = getEnv();
    const apiKey = env.PAGESPEED_INSIGHTS_API_KEY ?? "";

    const params = new URLSearchParams();
    params.set("url", input.url);
    if (apiKey) params.set("key", apiKey);
    for (const cat of CATEGORIES) {
      params.append("category", cat);
    }
    params.set("strategy", "desktop");

    const requestUrl = `${PSI_BASE_URL}?${params.toString()}`;
    log.debug({ articleId: input.articleId, url: input.url }, "Calling PSI API");

    let response: Response;
    try {
      response = await fetch(requestUrl, { method: "GET" });
    } catch (e) {
      throw new PagespeedError(
        `PSI API fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        "lighthouse"
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new PagespeedError(
        `PSI API returned ${response.status}: ${body.slice(0, 500)}`,
        "lighthouse"
      );
    }

    const json = (await response.json()) as PsiApiResponse;
    const lhr = json.lighthouseResult;
    if (!lhr) {
      throw new PagespeedError("PSI API response missing lighthouseResult", "lighthouse");
    }

    const categories = lhr.categories ?? {};
    const scores = PagespeedScoresSchema.parse({
      performance: Math.round((categories.performance?.score ?? 0) * 100),
      accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
      bestPractices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
      seo: Math.round((categories.seo?.score ?? 0) * 100),
    });

    const audits = lhr.audits ?? {};
    const coreWebVitals = CoreWebVitalsSchema.parse({
      lcp: audits["largest-contentful-paint"]?.numericValue ?? null,
      inp: audits["interaction-to-next-paint"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
    });

    ctx.log.info(
      { articleId: input.articleId, url: input.url, scores },
      "PSI API scores received"
    );

    return {
      scores,
      coreWebVitals,
      testedUrl: input.url,
      reportPath: null,
    };
  }
}
