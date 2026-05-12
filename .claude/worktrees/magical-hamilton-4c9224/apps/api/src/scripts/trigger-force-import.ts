// One-off script: trigger forceAll re-import for toolwiki (Section E of 49a-fix)
import { projects, db } from "@marketing-auto/db";
import { eq } from "drizzle-orm";
import { enqueueRepoImport } from "../../../../packages/adapters/astro-sync/src/import/trigger.ts";

const [project] = await db
  .select({ id: projects.id })
  .from(projects)
  .where(eq(projects.slug, "toolwiki"))
  .limit(1);

if (!project) throw new Error("toolwiki project not found");

console.log("Triggering forceAll re-import for toolwiki...");
const result = await enqueueRepoImport({
  projectId: project.id,
  triggerSource: "manual",
  forceAll: true,
});
console.log("Enqueued:", result);
console.log("importRunId:", result.importRunId);
