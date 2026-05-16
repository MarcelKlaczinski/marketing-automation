import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { VoiceReference } from "../voice-reference/loader.ts";

const InputSchema = z.object({
  articleId:   z.string().uuid(),
  projectId:   z.string().uuid(),
  pipelineRunId: z.string().uuid(),
  deBodyMd:    z.string().min(100),
  voiceReferences: z.array(z.object({
    articleId:      z.string(),
    title:          z.string(),
    bodyMdExcerpt:  z.string(),
    intentType:     z.string().nullable(),
    selfReviewScore: z.number().nullable(),
  })),
});

const OutputSchema = z.object({
  bodyMd:    z.string().min(200),
  wordCount: z.number().int().min(100),
});

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildVoiceBlock(refs: VoiceReference[]): string {
  if (refs.length === 0) return "(no existing EN articles available as voice reference)";
  return refs
    .map((r, i) => `--- Reference ${i + 1}: "${r.title}" ---\n${r.bodyMdExcerpt}`)
    .join("\n\n");
}

export class TranslateDraftStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "translate-draft";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0.20;
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<z.infer<typeof OutputSchema>> {
    const voiceBlock = buildVoiceBlock(input.voiceReferences as VoiceReference[]);

    const userMessage = `You are translating a German blog article into idiomatic English for an international audience.

VOICE REFERENCES (existing English articles in the same content space — match their tone):
${voiceBlock}

---

GERMAN ARTICLE TO TRANSLATE:
${input.deBodyMd}

---

TRANSLATION REQUIREMENTS:
- Preserve the article's narrative structure exactly (keep all sections, headings, and subheadings in the same order)
- Use idiomatic English — not literal word-for-word translation
- Match the voice and tone of the reference articles above: concrete, anti-hype, pragmatic, direct
- Tool names stay in their canonical English form (e.g. "ChatGPT" stays "ChatGPT", "Midjourney" stays "Midjourney")
- German-specific references become generic or international where natural:
  - "wir Deutschen" → "users" or "teams"
  - "DSGVO" → "GDPR"
  - "Datenschutz" → "data privacy"
  - German currency (€ only) → use $ or mention both where relevant
- Avoid German sentence structure, loanwords, or overly formal phrasing
- Keep markdown formatting intact (headings, bold, lists, code blocks, links)
- Do NOT add any preamble, commentary, or "Here is the translation:" prefix

Output: the translated article body in markdown only.`;

    let raw: string;
    try {
      const result = await anthropic.messages({
        projectId:        ctx.projectId,
        pipelineRunId:    ctx.pipelineRunId,
        articleId:        input.articleId,
        operation:        COST_OPS.TRANSLATE_DRAFT,
        model:            "claude-sonnet-4-6",
        systemPrefix:     "You are an expert technical translator specializing in AI and software content. Your translations are idiomatic, accurate, and indistinguishable from native English writing.",
        systemSuffix:     "",
        userMessage,
        maxTokens:        8192,
        jsonMode:         false,
        estimatedCostEur: this.estimatedCostEur(),
      });
      raw = result.raw;
    } catch (err) {
      ctx.log.error({ err }, "TranslateDraftStep: LLM call failed");
      throw err;
    }

    if (!raw || raw.trim().length < 200) {
      throw new Error("TranslateDraftStep: LLM returned insufficient content");
    }

    const bodyMd = raw.trim();
    return { bodyMd, wordCount: countWords(bodyMd) };
  }
}
