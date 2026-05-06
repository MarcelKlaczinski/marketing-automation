import { z } from "zod";
import { BaseStep, type StepContext } from "@marketing-auto/pipelines/engine";
import { getInstallationOctokit } from "../github-auth.ts";
import {
  AstroSyncError,
  type AstroRepoConfig,
  type FrontmatterField,
} from "../types.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("astro-sync:schema");

const InputSchema = z.object({
  astroRepo: z.unknown(),
});

const OutputSchema = z.object({
  collectionInfo: z.object({
    collectionName: z.literal("blog"),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      hasDefault: z.boolean(),
    })),
  }),
  configFileSha: z.string(),
});

export class ResolveSchemaStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "resolve-schema";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof InputSchema>, _ctx: StepContext) {
    const repo = input.astroRepo as AstroRepoConfig;
    const octokit = await getInstallationOctokit(repo.installationId);

    const configPaths = [
      `${repo.contentRoot}/config.ts`,
      `${repo.contentRoot}/config.mjs`,
      `${repo.contentRoot}/config.js`,
    ];

    let content: string | null = null;
    let sha: string | null = null;
    let foundPath: string | null = null;

    for (const path of configPaths) {
      try {
        const res = await octokit.request(
          "GET /repos/{owner}/{repo}/contents/{path}",
          { owner: repo.owner, repo: repo.name, path, ref: repo.defaultBranch },
        );
        if (Array.isArray(res.data)) continue;
        if (res.data.type !== "file" || !res.data.content) continue;

        content = Buffer.from(res.data.content, "base64").toString("utf-8");
        sha = res.data.sha;
        foundPath = path;
        break;
      } catch (e) {
        const err = e as { status?: number };
        if (err.status !== 404) {
          throw new AstroSyncError(`Failed to fetch ${path}`, "schema", e);
        }
      }
    }

    if (!content || !sha || !foundPath) {
      throw new AstroSyncError(
        `Could not find Astro content config in ${repo.contentRoot}/. Tried: ${configPaths.join(", ")}`,
        "schema",
      );
    }

    log.debug({ foundPath, contentLength: content.length }, "Astro content config loaded");

    const fields = parseBlogSchema(content);

    return {
      collectionInfo: {
        collectionName: "blog" as const,
        fields,
      },
      configFileSha: sha,
    };
  }
}

/**
 * Conservative text parser for Astro content collection schemas.
 *
 * Looks for a blog collection using `defineCollection({ schema: z.object({ ... }) })`,
 * extracts top-level field names + types. Best-effort: returns [] on unparseable configs.
 *
 * Limitations (acceptable for Spec 21):
 * - Top-level fields only (no nested schemas)
 * - z.union / z.intersection classified as "unknown"
 * - Falls back to "unknown" for field shapes it can't classify
 */
export function parseBlogSchema(configSource: string): FrontmatterField[] {
  const schemaBody = extractBlogSchemaBody(configSource);

  if (!schemaBody) {
    log.warn("Could not parse blog schema; will use permissive frontmatter rendering");
    return [];
  }

  return extractFields(schemaBody);
}

function extractBlogSchemaBody(source: string): string | null {
  // Find the blog collection reference (any of the common patterns)
  const blogIdx = source.search(
    /(?:const|let|var)\s+blog\s*=|blog\s*:\s*defineCollection/,
  );
  const searchFrom = blogIdx >= 0 ? blogIdx : source.indexOf("blog");
  if (searchFrom < 0) return null;

  // From that reference, locate the first `z.object({` — handles both
  // `schema: z.object({` and `schema: ({ image }) => z.object({` patterns.
  const zObjPattern = /z\.object\s*\(\s*\{/;
  const relMatch = source.slice(searchFrom).match(zObjPattern);
  if (!relMatch?.index) return null;

  // Position of the opening `{` of z.object({
  const openBraceIdx =
    searchFrom + relMatch.index + relMatch[0].length - 1;

  // Walk forward counting braces to find the balanced closing `}`
  return bracketBalanced(source, openBraceIdx);
}

/**
 * Given the index of an opening `{` in source, returns the content between
 * that `{` and its balanced closing `}`, or null if unbalanced.
 */
function bracketBalanced(source: string, openBraceIdx: number): string | null {
  let depth = 0;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openBraceIdx + 1, i);
    }
  }
  return null;
}

function extractFields(schemaBody: string): FrontmatterField[] {
  const fields: FrontmatterField[] = [];

  // Match field definitions: `fieldName: z.type()...` or `fieldName: image()...`
  // Handles multi-line definitions and chained methods like `.optional()`, `.default(...)`.
  const fieldRegex = /(?:^|,)\s*([a-zA-Z_$][\w$]*)\s*:\s*([^,\n]+(?:\([^)]*\)[^,\n]*)*)/g;
  let m: RegExpExecArray | null;

  while ((m = fieldRegex.exec(schemaBody)) !== null) {
    const name = m[1];
    const definition = m[2];
    if (!name || !definition) continue;
    // Skip comment-looking fragments
    if (name.startsWith("//") || name.startsWith("*")) continue;
    fields.push(classifyField(name, definition));
  }

  return fields;
}

function classifyField(name: string, definition: string): FrontmatterField {
  const isOptional = /\.optional\(\)/.test(definition);
  const hasDefault = /\.default\(/.test(definition);
  const isNullable = /\.nullable\(\)/.test(definition);

  let type: FrontmatterField["type"] = "unknown";
  // string_array before string — z.array(z.string()) also contains z.string()
  if (/z\.array\s*\(\s*z\.string\(\)\s*\)/.test(definition)) type = "string_array";
  else if (/z\.string\(\)/.test(definition)) type = "string";
  else if (/z\.number\(\)/.test(definition)) type = "number";
  else if (/z\.boolean\(\)/.test(definition)) type = "boolean";
  else if (/z\.date\(\)/.test(definition)) type = "date";
  else if (/\bimage\s*\(\s*\)/.test(definition)) type = "image";
  else if (/z\.object\s*\(/.test(definition)) type = "object";

  return {
    name,
    type,
    required: !isOptional && !isNullable && !hasDefault,
    hasDefault,
  };
}
