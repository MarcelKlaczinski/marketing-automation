import { astroImportRuns, db, projects } from "@marketing-auto/db";
import { enqueuePipeline } from "@marketing-auto/pipelines/engine";
import { eq } from "drizzle-orm";

export async function enqueueRepoImport(input: {
  projectId: string;
  triggerSource: "manual" | "webhook" | "scheduled";
  forceAll?: boolean;
}): Promise<{ importRunId: string; jobId: string }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) throw new Error(`Project ${input.projectId} not found`);
  if (!project.astroRepo) {
    throw new Error(`Project ${input.projectId} has no astroRepo configured`);
  }

  const [run] = await db
    .insert(astroImportRuns)
    .values({
      projectId: input.projectId,
      status: "pending",
      triggerSource: input.triggerSource,
    })
    .returning();

  if (!run) throw new Error("Failed to create import run");

  const { jobId } = await enqueuePipeline({
    pipelineName: "astro:repo-import",
    projectId: input.projectId,
    input: {
      projectId: input.projectId,
      importRunId: run.id,
      astroRepo: project.astroRepo as Record<string, unknown>,
      forceAll: input.forceAll ?? false,
    },
    jobOptions: { jobId: `repo-import-${run.id}` },
  });

  return { importRunId: run.id, jobId };
}
