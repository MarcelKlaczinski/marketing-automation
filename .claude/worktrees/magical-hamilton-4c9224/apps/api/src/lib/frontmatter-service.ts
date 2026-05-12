/**
 * Spec 50: Frontmatter suggestion service.
 *
 * Uses Claude Haiku to analyze an article's title, meta description, and body
 * excerpt and suggest appropriate values for structured frontmatter fields
 * (category, intentType, tags, faq, etc.) based on the stored collection schema.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { type FrontmatterFieldDescriptor } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("api:frontmatter-service");

export type FrontmatterSuggestions = {
  /** Suggested values keyed by field name */
  values: Record<string, unknown>;
  /** Per-field reasoning shown as tooltip in the UI */
  reasoning: Record<string, string>;
  /** Available options for enum fields — keyed by field name */
  enumOptions: Record<string, string[]>;
};

/**
 * Analyzes article content and suggests values for structured frontmatter fields.
 * Only suggests fields defined in the schema (enum, object_array, string_array).
 * Existing values in `currentExtras` are kept; only missing fields are filled.
 * If `currentExtras` is empty, all fields are suggested.
 */
export async function suggestFrontmatterFields(opts: {
  projectId: string;
  pipelineRunId: string;
  title: string | null;
  metaDescription: string | null;
  bodyExcerpt: string | null; // first ~600 words
  schema: FrontmatterFieldDescriptor[];
  currentExtras: Record<string, unknown>;
}): Promise<FrontmatterSuggestions> {
  const { schema, currentExtras } = opts;

  // Determine which fields to suggest: missing ones (or all if currentExtras is empty)
  const isEmpty = Object.keys(currentExtras).length === 0;
  const fieldsToSuggest = schema.filter((f) => {
    const isSuggestabl = f.enumValues?.length || f.type === "object_array" || f.type === "string_array";
    const isMissing = !(f.name in currentExtras);
    return isSuggestabl && (isEmpty || isMissing);
  });

  if (!fieldsToSuggest.length) {
    return { values: {}, reasoning: {}, enumOptions: buildEnumOptions(schema) };
  }

  // Build field descriptions for the prompt
  const fieldDescs = fieldsToSuggest
    .map((f) => {
      if (f.enumValues?.length) {
        return `- ${f.name}: choose ONE from ${JSON.stringify(f.enumValues)}`;
      }
      if (f.type === "object_array" && f.objectShape) {
        return `- ${f.name}: array of ${f.objectShape} — suggest 3-5 items`;
      }
      if (f.type === "string_array") {
        return `- ${f.name}: array of strings — suggest 5-7 relevant values`;
      }
      return null;
    })
    .filter(Boolean)
    .join("\n");

  const articleContext = [
    opts.title ? `Title: ${opts.title}` : "",
    opts.metaDescription ? `Meta description: ${opts.metaDescription}` : "",
    opts.bodyExcerpt ? `Article excerpt:\n${opts.bodyExcerpt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const prompt = `You are a content metadata specialist. Based on the article below, suggest appropriate values for each frontmatter field.

Article:
${articleContext}

Suggest values for these fields:
${fieldDescs}

For each field, also provide a 1-sentence reasoning explaining why this value fits.

Respond with a JSON object with two keys:
- "values": { fieldName: value, ... }
- "reasoning": { fieldName: "one sentence why", ... }

Only include the fields listed above. Be concise and specific.`;

  try {
    const result = await anthropic.messages({
      projectId: opts.projectId,
      pipelineRunId: opts.pipelineRunId,
      operation: COST_OPS.FRONTMATTER_SUGGEST,
      model: "claude-haiku-4-5",
      systemPrefix: "You are a content metadata specialist. Respond only with valid JSON.",
      systemSuffix: "",
      userMessage: prompt,
      maxTokens: 1500,
      jsonMode: true,
      estimatedCostEur: 0.02,
    });

    const parsed = result.json as { values?: Record<string, unknown>; reasoning?: Record<string, string> };

    return {
      values: parsed.values ?? {},
      reasoning: parsed.reasoning ?? {},
      enumOptions: buildEnumOptions(schema),
    };
  } catch (err) {
    log.warn({ err }, "Frontmatter suggestion failed — returning empty suggestions");
    return { values: {}, reasoning: {}, enumOptions: buildEnumOptions(schema) };
  }
}

function buildEnumOptions(schema: FrontmatterFieldDescriptor[]): Record<string, string[]> {
  const opts: Record<string, string[]> = {};
  for (const f of schema) {
    if (f.enumValues?.length) {
      opts[f.name] = f.enumValues;
    }
  }
  return opts;
}
