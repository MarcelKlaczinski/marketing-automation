import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { PagespeedError, PagespeedScoresSchema, CoreWebVitalsSchema } from "../types.ts";

const log = createLogger("pagespeed:lighthouse");

const InputSchema = z.object({
  serverUrl: z.string().url(),
  articleSlug: z.string(),
  workDir: z.string(),
});

const OutputSchema = z.object({
  scores: PagespeedScoresSchema,
  coreWebVitals: CoreWebVitalsSchema,
  reportPath: z.string(),
  testedUrl: z.string().url(),
});

export class LighthouseStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "lighthouse";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext): Promise<z.infer<typeof OutputSchema>> {
    const env = getEnv();
    const baseUrl = input.serverUrl.replace(/\/$/, "");
    const testedUrl = `${baseUrl}/blog/${input.articleSlug}`;

    log.info({ testedUrl }, "Running Lighthouse");

    // Dynamic imports — lighthouse is ESM-only and heavy
    const { default: lighthouse } = await import("lighthouse");
    const { computeExecutablePath, Browser } = await import("@puppeteer/browsers");
    const puppeteer = await import("puppeteer-core");

    const cacheDir = `${homedir()}/.cache/puppeteer`;

    let executablePath: string;
    try {
      executablePath = computeExecutablePath({
        cacheDir,
        browser: Browser.CHROME,
        buildId: "stable",
      });
    } catch (err) {
      throw new PagespeedError(
        `Chrome not found at ${cacheDir}. Run: bun --filter @marketing-auto/adapter-pagespeed install-chrome`,
        "lighthouse",
        err,
      );
    }

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    try {
      const wsEndpoint = browser.wsEndpoint();
      const port = Number(new URL(wsEndpoint).port);

      const timeoutMs = env.PAGESPEED_LIGHTHOUSE_TIMEOUT_MS;
      const result = await Promise.race([
        lighthouse(testedUrl, {
          port,
          output: "json",
          logLevel: "error",
          formFactor: "desktop",
          screenEmulation: {
            mobile: false,
            width: 1350,
            height: 940,
            deviceScaleFactor: 1,
            disabled: false,
          },
          throttling: {
            rttMs: 40,
            throughputKbps: 10240,
            cpuSlowdownMultiplier: 1,
            requestLatencyMs: 0,
            downloadThroughputKbps: 0,
            uploadThroughputKbps: 0,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new PagespeedError(`Lighthouse timed out after ${timeoutMs}ms`, "lighthouse")),
            timeoutMs,
          )
        ),
      ]);

      if (!result?.lhr) {
        throw new PagespeedError("Lighthouse returned no result", "lighthouse");
      }

      const lhr = result.lhr;

      // Lighthouse scores are 0-1; expose 0-100
      const scores = {
        performance: Math.round((lhr.categories["performance"]?.score ?? 0) * 100),
        accessibility: Math.round((lhr.categories["accessibility"]?.score ?? 0) * 100),
        bestPractices: Math.round((lhr.categories["best-practices"]?.score ?? 0) * 100),
        seo: Math.round((lhr.categories["seo"]?.score ?? 0) * 100),
      };

      const lcp = lhr.audits["largest-contentful-paint"]?.numericValue ?? 0;
      const cls = lhr.audits["cumulative-layout-shift"]?.numericValue ?? 0;
      const inpAudit = lhr.audits["interaction-to-next-paint"];
      const inp = inpAudit?.numericValue ?? null;

      const coreWebVitals = { lcp, cls, inp };

      await mkdir(input.workDir, { recursive: true });
      const reportPath = `${input.workDir}/lighthouse-report.json`;
      const reportContent = typeof result.report === "string"
        ? result.report
        : JSON.stringify(result.report);
      await writeFile(reportPath, reportContent, "utf-8");

      log.info({ scores, coreWebVitals, reportPath }, "Lighthouse complete");

      return { scores, coreWebVitals, reportPath, testedUrl };
    } finally {
      await browser.close();
    }
  }
}
