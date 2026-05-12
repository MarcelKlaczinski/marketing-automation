/**
 * Spec 50: ExtractCollectionSchemasStep
 *
 * Fetches the Astro repo's content.config.ts from GitHub, parses ALL collection
 * schemas (not just blog), and persists the result to projects.astroCollectionSchemas.
 *
 * Runs as the first step of the import pipeline so subsequent steps and article
 * generation pipelines can rely on up-to-date schema information.
 */
import { db, projects } from "@marketing-auto/db";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { createLogger } from "@marketing-auto/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getInstallationOctokit } from "../../github-auth.ts";
import { parseAllCollectionSchemas } from "../../steps/resolve-schema.ts";
import { type AstroRepoConfig, AstroSyncError } from "../../types.ts";

const log = createLogger("astro-import:extract-schemas");

const InputSchema = z.object({
  projectId: z.string().uuid(),
  astroRepo: z.record(z.unknown()),
});

const OutputSchema = z.object({
  collectionNames: z.array(z.string()),
  totalFields: z.number().int(),
});

export class ExtractCollectionSchemasStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "extract-collection-schemas";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0; // GitHub API only — no LLM cost
  }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);

    // Try both Astro v4 (config inside contentRoot) and Astro v5 (content.config.ts in src/)
    const contentRootParent = repo.contentRoot.split("/").slice(0, -1).join("/") || ".";
    const configPaths = [
      `${repo.contentRoot}/config.ts`,
      `${repo.contentRoot}/config.mjs`,
      `${repo.contentRoot}/config.js`,
      // Astro v5: content.config.ts lives one level up from contentRoot (e.g. src/)
      `${contentRootParent}/content.config.ts`,
      `${contentRootParent}/content.config.mjs`,
      `${contentRootParent}/content.config.js`,
      // Fallback: repo root
      "content.config.ts",
      "content.config.mjs",
    ];

    let content: string | null = null;
    let foundPath: string | null = null;

    for (const path of configPaths) {
      try {
        const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: repo.owner,
          repo: repo.name,
          path,
          ref: repo.defaultBranch,
        });
        if (Array.isArray(res.data)) continue;
        const file = res.data as { type: string; content?: string };
        if (file.type !== "file" || !file.content) continue;
        content = Buffer.from(file.content, "base64").toString("utf-8");
        foundPath = path;
        break;
      } catch (e) {
        const err = e as { status?: number };
        if (err.status !== 404) {
          throw new AstroSyncError(`Failed to fetch ${path}`, "schema", e);
        }
      }
    }

    if (!content || !foundPath) {
      log.warn(
        { projectId: input.projectId },
        "Could not find Astro content config — skipping schema extraction"
      );
      return { collectionNames: [], totalFields: 0 };
    }

    log.debug({ foundPath, contentLength: content.length }, "Astro content config loaded");

    const schemas = parseAllCollectionSchemas(content);
    const collectionNames = Object.keys(schemas);
    const totalFields = Object.values(schemas).reduce((sum, fields) => sum + fields.length, 0);

    log.info(
      { projectId: input.projectId, collectionNames, totalFields },
      "Collection schemas extracted"
    );

    // Persist to DB — cast justified: adapter FrontmatterField is structurally identical
    // to db.FrontmatterFieldDescriptor; both packages define the same shape independently.
    await db
      .update(projects)
      .set({ astroCollectionSchemas: schemas as unknown as import("@marketing-auto/db").AstroCollectionSchemas })
      .where(eq(projects.id, input.projectId));

    return { collectionNames, totalFields };
  }
}
