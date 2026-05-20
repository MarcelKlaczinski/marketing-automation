import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core";
import { resolvePrompt } from "../../../engine/prompt-resolver.ts";
import type { StepContext } from "../../../engine/step.ts";

export interface ToolUseCaseTokens {
  endSlideToken: string;
  identityVerb: string;
}

export interface ToolTokenInput {
  slug: string;
  name: string;
  tagline: string;
  bestFor?: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

const ID_VERB_LEAD = /^(designst|machst|schreibst|baust|erstellst|generierst|nutzt|brauchst|willst|suchst|erzeugst)\b/i;

/**
 * Turn a du-form identityVerb (e.g. "designst Logos") into an infinitive
 * noun phrase (e.g. "Logos designen") so it reads naturally inside a
 * subordinate clause like "Perfekt für: Logos designen."
 *
 * Regular German verbs: drop -st, add -en. Handles the 10 verbs allowed by
 * the validator above.
 */
export function deriveInfinitiveUseCase(identityVerb: string): string | null {
  const trimmed = identityVerb.trim();
  const match = trimmed.match(/^(designst|machst|schreibst|baust|erstellst|generierst|nutzt|brauchst|willst|suchst|erzeugst)\s+(.+)$/i);
  if (!match) return null;
  const [, verb, object] = match;
  if (!verb || !object) return null;
  // -st → -en, except "nutzt" → "nutzen" (irregular: nutzt has no -st, replace -t)
  const lower = verb.toLowerCase();
  const infinitive = lower === "nutzt"
    ? "nutzen"
    : lower.replace(/st$/, "en");
  return `${object} ${infinitive}`;
}

const TECH_JARGON = [
  "vektor-export",
  "pipeline",
  "api",
  "integration",
  "output",
  "rendering",
];

export function validateUseCaseTokens(tokens: ToolUseCaseTokens): ValidationResult {
  const violations: string[] = [];

  const endTokenWords = tokens.endSlideToken.trim().split(/\s+/);
  if (endTokenWords.length > 2) violations.push("endSlideToken max 2 words");
  if (endTokenWords.length < 1 || !tokens.endSlideToken.trim()) violations.push("endSlideToken required");

  const idVerbWords = tokens.identityVerb.trim().split(/\s+/);
  if (idVerbWords.length > 4 || idVerbWords.length < 2) violations.push("identityVerb must be 2-4 words");
  if (!ID_VERB_LEAD.test(tokens.identityVerb)) {
    violations.push("identityVerb must start with verb in du-form");
  }

  const combined = `${tokens.endSlideToken} ${tokens.identityVerb}`.toLowerCase();
  for (const word of TECH_JARGON) {
    if (combined.includes(word)) violations.push(`contains tech jargon: ${word}`);
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Programmatic fallback that maps a tool's bestFor/tagline keyword to a safe
 * token pair. Used when the LLM fails or returns invalid tokens.
 */
export function fallbackTokensForTool(tool: ToolTokenInput): ToolUseCaseTokens {
  const text = `${tool.bestFor ?? ""} ${tool.tagline}`.toLowerCase();

  if (/\blogo/.test(text)) return { endSlideToken: "Logos", identityVerb: "designst Logos" };
  if (/\bposter|plakat/.test(text)) return { endSlideToken: "Poster", identityVerb: "machst Poster" };
  if (/\bbild|image|foto/.test(text)) return { endSlideToken: "Bilder", identityVerb: "erzeugst Bilder" };
  if (/\bvideo|clip/.test(text)) return { endSlideToken: "Videos", identityVerb: "machst Videos" };
  if (/\bcode|coding|entwicklung/.test(text)) return { endSlideToken: "Code", identityVerb: "schreibst Code" };
  if (/\btext|writing|copy/.test(text)) return { endSlideToken: "Texte", identityVerb: "schreibst Texte" };
  if (/\bavatar|portr[äa]t/.test(text)) return { endSlideToken: "Avatare", identityVerb: "erstellst Avatare" };
  if (/\bvoice|audio|sound|musik/.test(text)) return { endSlideToken: "Audio", identityVerb: "erzeugst Audio" };
  if (/\bpr[äa]senta/.test(text)) return { endSlideToken: "Slides", identityVerb: "baust Slides" };

  return { endSlideToken: "Content", identityVerb: "erstellst Content" };
}

const ENRICHMENT_PROMPT_SUFFIX = `Du generierst kurze Tokens für einen Instagram-Closer.
Für JEDES Tool gib zwei Felder zurück:
1. "endSlideToken": 1-2 Wort Substantiv das den Haupt-Use-Case in ALLTAGSSPRACHE beschreibt
   GUT: "Logos", "Poster", "Code", "Avatare", "Videos"
   SCHLECHT: "Vektor-Export", "Brand-Pipeline" (zu B2B-tech)
2. "identityVerb": 2-4 Wort Phrase die beschreibt WAS DER USER MACHT
   GUT: "designst Logos", "machst Poster", "schreibst Code"
   SCHLECHT: "produzierst Vektor-Output" (B2B-tech)

CONSTRAINTS:
- Alltagssprache, kein Jargon
- 1-2 Wörter für endSlideToken, 2-4 für identityVerb
- du-Form für identityVerb (designst/machst/schreibst/baust/erstellst/generierst/erzeugst/...)

Return ONLY JSON in this shape:
{ "tokens": [ { "slug": "tool-slug", "endSlideToken": "...", "identityVerb": "..." } ] }`;

interface LlmTokenItem {
  slug: string;
  endSlideToken: string;
  identityVerb: string;
}

/**
 * Generate use-case tokens for every tool in one Haiku call.
 * Each tool that fails validation receives a programmatic fallback.
 *
 * `stepName` is the calling step's name (used to key the edit-prompt resume override
 * per Spec 62.0a Section 4.4). Caller passes `this.name` so all LLM activity inside a
 * given step run shares the same override key.
 */
export async function enrichToolUseCaseTokens(
  tools: ToolTokenInput[],
  ctx: StepContext,
  stepName: string,
): Promise<Record<string, ToolUseCaseTokens>> {
  if (tools.length === 0) return {};

  const toolsBlock = tools
    .map((t) => `- slug: ${t.slug}\n  name: ${t.name}\n  tagline: ${t.tagline}${t.bestFor ? `\n  bestFor: ${t.bestFor}` : ""}`)
    .join("\n");

  const userMessage = `Tools:\n${toolsBlock}\n\n${ENRICHMENT_PROMPT_SUFFIX}`;

  const out: Record<string, ToolUseCaseTokens> = {};
  let parsed: { tokens?: LlmTokenItem[] } | null = null;

  try {
    const resp = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_EXTRACT,
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: resolvePrompt(
        ctx,
        stepName,
        () => "Generate alltagssprache use-case tokens for AI tools. Return valid JSON only."
      ),
      userMessage,
      maxTokens: 600,
      estimatedCostEur: 0.002,
      jsonMode: true,
    });
    const raw = resp.raw;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(raw.slice(start, end + 1)) as { tokens?: LlmTokenItem[] };
    }
  } catch (err) {
    ctx.log.warn({ err }, "Tool-use-case-tokens LLM call failed; using fallback for all tools");
  }

  const llmBySlug = new Map<string, LlmTokenItem>();
  for (const item of parsed?.tokens ?? []) {
    if (item && typeof item.slug === "string") llmBySlug.set(item.slug, item);
  }

  for (const tool of tools) {
    const llm = llmBySlug.get(tool.slug);
    if (llm) {
      const candidate: ToolUseCaseTokens = {
        endSlideToken: (llm.endSlideToken ?? "").trim(),
        identityVerb: (llm.identityVerb ?? "").trim(),
      };
      const validation = validateUseCaseTokens(candidate);
      if (validation.valid) {
        out[tool.slug] = candidate;
        continue;
      }
      ctx.log.warn({ slug: tool.slug, violations: validation.violations }, "Tool tokens invalid; using fallback");
    }
    out[tool.slug] = fallbackTokensForTool(tool);
  }

  return out;
}
