// One-off script: run SyncClustersFromFrontmatterStep for toolwiki (Section E of 49a-fix)
// This triggers orphan-deletion and cluster re-linking using the updated data from Section B.
import { projects, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { SyncClustersFromFrontmatterStep } from "../../../../packages/adapters/astro-sync/src/import/steps/sync-clusters-from-frontmatter.ts";

const [project] = await db
  .select({ id: projects.id })
  .from(projects)
  .where(eq(projects.slug, "toolwiki"))
  .limit(1);

if (!project) throw new Error("toolwiki project not found");

const stubCtx = {
  projectId: project.id,
  pipelineRunId: "00000000-0000-0000-0000-000000000000",
  stepRunId: "00000000-0000-0000-0000-000000000000",
  pipelineName: "manual-verify",
  log: {
    info: (obj: unknown, msg: string) => console.log(msg, obj),
    warn: (obj: unknown, msg: string) => console.warn(msg, obj),
    error: (obj: unknown, msg: string) => console.error(msg, obj),
    debug: () => {},
  },
  reportProgress: async () => {},
  getStepOutput: () => undefined,
} as never;

console.log("Running SyncClusters for toolwiki...");
const step = new SyncClustersFromFrontmatterStep();
const result = await step.execute({ projectId: project.id }, stubCtx);
console.log("Result:", result);
