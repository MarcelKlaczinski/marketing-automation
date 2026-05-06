import { db, pipelineRuns, projects } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { enqueuePipeline } from "../engine/queue.ts";

type TriggerResult = { runId: string; jobId: string };

async function getProjectSlug(projectId: string): Promise<string> {
  const [proj] = await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj) throw new Error(`Project not found: ${projectId}`);
  return proj.slug;
}

async function createQueuedRun(projectId: string, pipelineName: string, input: Record<string, unknown>): Promise<string> {
  const [run] = await db.insert(pipelineRuns).values({
    projectId,
    pipelineName,
    status: "queued",
    input,
  }).returning({ id: pipelineRuns.id });
  return run!.id;
}

export async function enqueueColdStartVoiceQuestions(input: { projectId: string }): Promise<TriggerResult> {
  const projectSlug = await getProjectSlug(input.projectId);
  const pipelineInput = { projectSlug, existingContextMd: "", projectId: input.projectId };
  const runId = await createQueuedRun(input.projectId, "cold-start:voice-refinement-questions", pipelineInput as Record<string, unknown>);
  const { jobId } = await enqueuePipeline({
    pipelineName: "cold-start:voice-refinement-questions",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: runId,
  });
  return { runId, jobId };
}

export async function enqueueColdStartVoiceSynthesize(input: {
  projectId: string;
  answers: { questionIndex: number; answer: string }[];
}): Promise<TriggerResult> {
  const projectSlug = await getProjectSlug(input.projectId);
  const answeredQuestionsMd = input.answers
    .map((a) => `**Q${a.questionIndex + 1}**: ${a.answer}`)
    .join("\n\n");
  const pipelineInput = {
    projectSlug,
    existingContextMd: "",
    answeredQuestionsMd,
    projectId: input.projectId,
  };
  const runId = await createQueuedRun(input.projectId, "cold-start:voice-synthesis", pipelineInput as Record<string, unknown>);
  const { jobId } = await enqueuePipeline({
    pipelineName: "cold-start:voice-synthesis",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: runId,
  });
  return { runId, jobId };
}

export async function enqueueColdStartCompetitorQuestions(input: { projectId: string }): Promise<TriggerResult> {
  const projectSlug = await getProjectSlug(input.projectId);
  const pipelineInput = { projectSlug, projectId: input.projectId };
  const runId = await createQueuedRun(input.projectId, "cold-start:competitor-questions", pipelineInput as Record<string, unknown>);
  const { jobId } = await enqueuePipeline({
    pipelineName: "cold-start:competitor-questions",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: runId,
  });
  return { runId, jobId };
}

export async function enqueueColdStartCompetitorAnalysis(input: {
  projectId: string;
  competitors: { domain: string; why_relevant: string; expected_strengths: string[] }[];
}): Promise<TriggerResult> {
  const projectSlug = await getProjectSlug(input.projectId);
  const pipelineInput = { projectSlug, competitors: input.competitors, projectId: input.projectId };
  const runId = await createQueuedRun(input.projectId, "cold-start:competitor-analysis", pipelineInput as Record<string, unknown>);
  const { jobId } = await enqueuePipeline({
    pipelineName: "cold-start:competitor-analysis",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: runId,
  });
  return { runId, jobId };
}

export async function enqueueColdStartClusterPropose(input: {
  projectId: string;
  contentGaps?: string[];
  topicsToAvoid?: string[];
}): Promise<TriggerResult> {
  const projectSlug = await getProjectSlug(input.projectId);
  const pipelineInput = {
    projectSlug,
    contentGaps: input.contentGaps ?? [],
    topicsToAvoid: input.topicsToAvoid ?? [],
    projectId: input.projectId,
  };
  const runId = await createQueuedRun(input.projectId, "cold-start:cluster-propose", pipelineInput as Record<string, unknown>);
  const { jobId } = await enqueuePipeline({
    pipelineName: "cold-start:cluster-propose",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: runId,
  });
  return { runId, jobId };
}

export async function enqueueColdStartCornerstoneList(input: {
  projectId: string;
  approvedClusters: {
    name: string;
    pillar: string;
    status: "proposed" | "approved" | "rejected";
    cornerstone_keyword: string;
    cornerstone_search_volume: number | null;
    cornerstone_difficulty: number | null;
    satellite_keywords: { keyword: string; search_volume: number | null; difficulty: number | null }[];
  }[];
}): Promise<TriggerResult> {
  const projectSlug = await getProjectSlug(input.projectId);
  const pipelineInput = {
    projectSlug,
    approvedClusters: input.approvedClusters,
    projectId: input.projectId,
  };
  const runId = await createQueuedRun(input.projectId, "cold-start:cornerstone-list", pipelineInput as Record<string, unknown>);
  const { jobId } = await enqueuePipeline({
    pipelineName: "cold-start:cornerstone-list",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: runId,
  });
  return { runId, jobId };
}

export async function enqueueColdStartGoLiveChecklist(input: { projectId: string }): Promise<TriggerResult> {
  const projectSlug = await getProjectSlug(input.projectId);
  const pipelineInput = { projectSlug, projectId: input.projectId };
  const runId = await createQueuedRun(input.projectId, "cold-start:go-live-checklist", pipelineInput as Record<string, unknown>);
  const { jobId } = await enqueuePipeline({
    pipelineName: "cold-start:go-live-checklist",
    projectId: input.projectId,
    input: pipelineInput,
    preRunId: runId,
  });
  return { runId, jobId };
}
