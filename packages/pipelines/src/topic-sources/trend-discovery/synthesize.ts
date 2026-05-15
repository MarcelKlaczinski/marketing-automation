import { createLogger } from "@marketing-auto/shared";
import { anthropic } from "@marketing-auto/adapter-anthropic";
import type { ExternalSignal } from "@marketing-auto/db";
import { buildSystemPrompt } from "../../prompts/builder.ts";
import { resolveMasterPrompt } from "../../config/resolve-master-prompt.ts";
import { loadActiveConfig } from "../../config/load-active-config.ts";
import { buildTrendSynthesisDefaultPrompt } from "./prompts.ts";
import { SynthesisOutputSchema, type SynthesisOutput } from "./types.ts";

const log = createLogger("trend-discovery:synthesize");

// ─── User-message builder ─────────────────────────────────────────────────────

export function buildUserMessage(signals: ExternalSignal[]): string {
  const lines: string[] = [
    `Here are ${signals.length} external signals from the last 14 days.`,
    `Each signal has a UUID — use these exact UUIDs in related_signal_ids and unclustered_signal_ids.`,
    "",
  ];

  for (const s of signals) {
    lines.push(`## Signal ${s.id}`);
    lines.push(`Source: ${s.source}`);
    lines.push(`Title: ${s.title}`);
    if (s.summary) lines.push(`Summary: ${s.summary.slice(0, 800)}`);
    lines.push(`Published: ${s.publishedAt?.toISOString().slice(0, 10) ?? "unknown"}`);
    if (s.url) lines.push(`URL: ${s.url}`);
    const metricEntries = Object.entries(s.metrics).filter(([, v]) => v > 0);
    if (metricEntries.length > 0) {
      lines.push(`Metrics: ${metricEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    }
    lines.push("");
  }

  lines.push("Now produce the clustered topics. Output JSON only — no prose preamble, no markdown fences.");
  return lines.join("\n");
}

// ─── Main: synthesizeTopics ───────────────────────────────────────────────────

export async function synthesizeTopics(
  projectId: string,
  signals: ExternalSignal[],
  pipelineRunId?: string,
): Promise<SynthesisOutput> {
  if (signals.length === 0) {
    throw new Error("synthesizeTopics called with empty signal pool — caller must guard");
  }

  const config = await loadActiveConfig(projectId);
  const scope = config.topicScope;
  const defaultPrompt = buildTrendSynthesisDefaultPrompt(scope);

  const stepInstructions = await resolveMasterPrompt({
    projectId,
    promptKey: "trend.synthesis",
    fallback: defaultPrompt,
  });

  const systemPrompt = await buildSystemPrompt({
    skills: ["ai-seo", "content-strategy", "marketing-ideas"],
    projectIdOrSlug: projectId,
    stepInstructions,
  });

  const userMessage = buildUserMessage(signals);

  log.debug({ projectId, signalCount: signals.length }, "calling Opus for trend synthesis");

  const result = await anthropic.messages({
    projectId,
    operation: "trend-synthesis",
    model: "claude-opus-4-7",
    systemPrefix: systemPrompt.cacheablePrefix,
    systemSuffix: systemPrompt.variableSuffix,
    userMessage,
    maxTokens: 8000,
    jsonMode: true,
    estimatedCostEur: 0.40,
    ...(pipelineRunId !== undefined && { pipelineRunId }),
  });

  const parsed = SynthesisOutputSchema.safeParse(result.json);
  if (!parsed.success) {
    log.error(
      { projectId, issues: parsed.error.issues, raw: JSON.stringify(result.json).slice(0, 500) },
      "synthesis output failed Zod validation — throwing for BullMQ retry",
    );
    throw new Error(`Synthesis output validation failed: ${parsed.error.message}`);
  }

  log.info(
    { projectId, topicCount: parsed.data.topics.length, unclusteredCount: parsed.data.unclustered_signal_ids.length },
    "synthesis complete",
  );

  return parsed.data;
}
