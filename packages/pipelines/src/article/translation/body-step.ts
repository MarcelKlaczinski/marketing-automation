/**
 * TranslationBodyStep: generates the EN article body.
 *
 * literal path  — one Sonnet call that translates the DE body directly
 * adaptive path — two Sonnet calls: EN outline first, then EN draft
 *
 * Both paths share the same COST_OPS for outline (REFRESH_OUTLINE) and
 * draft (REFRESH_DRAFT) on the adaptive path, and TRANSLATE_DRAFT for literal.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db, eq } from "@marketing-auto/db";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { VoiceReference } from "../voice-reference/loader.ts";
import { ArticlePipelineError } from "../types.ts";

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:mdx?|markdown|html)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

const VoiceReferenceSchema = z.object({
  articleId:       z.string(),
  title:           z.string(),
  bodyMdExcerpt:   z.string(),
  intentType:      z.string().nullable(),
  selfReviewScore: z.number().nullable(),
});

const InputSchema = z.object({
  articleId:        z.string().uuid(),   // EN article ID
  projectId:        z.string().uuid(),
  decision:         z.enum(["literal", "adaptive"]),
  deBodyMd:         z.string().min(100),
  deTitle:          z.string(),
  primaryKeyword:   z.string(),
  cornerstoneKeyword: z.string(),
  voiceReferences:  z.array(VoiceReferenceSchema),
  projectSlug:      z.string(),
});

const OutputSchema = z.object({
  bodyMd:            z.string().min(200),
  wordCount:         z.number().int().min(50),
  enTitle:           z.string(),
  enMetaDescription: z.string(),
  enTags:            z.array(z.string()),
});

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function parseBlock(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  return text.match(re)?.[1]?.trim() ?? null;
}

function parseTagsBlock(text: string): string[] {
  const raw = parseBlock(text, "TAGS");
  if (!raw) return [];
  return raw.split(",").map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
}

function buildVoiceBlock(refs: VoiceReference[]): string {
  if (refs.length === 0) return "(no existing EN articles available as voice reference)";
  return refs
    .map((r, i) => `--- Reference ${i + 1}: "${r.title}" ---\n${r.bodyMdExcerpt}`)
    .join("\n\n");
}

export class TranslationBodyStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "translation-body";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;

  override estimatedCostEur(): number {
    return 0.22; // literal ~0.20, adaptive ~0.30 — use midpoint
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<z.infer<typeof OutputSchema>> {
    const voiceBlock = buildVoiceBlock(input.voiceReferences as VoiceReference[]);

    if (input.decision === "literal") {
      return this.#runLiteralPath(input, ctx, voiceBlock);
    } else {
      return this.#runAdaptivePath(input, ctx, voiceBlock);
    }
  }

  async #runLiteralPath(
    input: z.infer<typeof InputSchema>,
    ctx: StepContext,
    voiceBlock: string,
  ): Promise<z.infer<typeof OutputSchema>> {
    const userMessage = `You are translating a German blog article into idiomatic English for an international audience.

VOICE REFERENCES (existing English articles in the same content space — match their tone):
${voiceBlock}

---

GERMAN ARTICLE TO TRANSLATE:
Title: ${input.deTitle}
Primary keyword: ${input.primaryKeyword}

${input.deBodyMd}

---

TRANSLATION REQUIREMENTS:
- Preserve the article's narrative structure exactly (keep all sections, headings, and subheadings in the same order)
- Use idiomatic English — not literal word-for-word translation
- Match the voice and tone of the reference articles: concrete, anti-hype, pragmatic, direct
- Tool names stay in their canonical English form (e.g. "ChatGPT", "Midjourney")
- Adapt German-specific references for an international audience:
  - "wir Deutschen" / "in Deutschland" → "users" / "globally"
  - "DSGVO" → "GDPR"
  - EUR-only pricing → mention both EUR and USD where relevant
  - German regulatory context (BaFin, etc.) → generic equivalent or omit
- Avoid German sentence structure, loanwords, or overly formal phrasing
- Keep markdown formatting intact (headings, bold, lists, code blocks, links)
- Do NOT add any preamble, commentary, or "Here is the translation:" prefix

OUTPUT FORMAT:
First output the translated article body in markdown, then append these tagged blocks at the very end:

<TITLE>SEO-optimized English article title (max 70 chars, include primary keyword)</TITLE>
<META_DESCRIPTION>English meta description (140-155 chars, include primary keyword, no clickbait)</META_DESCRIPTION>
<TAGS>tag-one,tag-two,tag-three</TAGS>

For TAGS: 4-8 English-only kebab-case tags (no German words). Include the primary keyword and 3-7 relevant EN tags.

Output locale: en-US.`;

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
      estimatedCostEur: 0.20,
    });

    const raw = result.raw.trim();
    const enTitle = parseBlock(raw, "TITLE") ?? input.deTitle;
    const enMetaDescription = parseBlock(raw, "META_DESCRIPTION") ?? "";
    const enTags = parseTagsBlock(raw);
    // Strip the tagged blocks from the body, then strip any leading code fence
    const bodyMd = stripCodeFence(
      raw
        .replace(/<TITLE>[\s\S]*?<\/TITLE>/i, "")
        .replace(/<META_DESCRIPTION>[\s\S]*?<\/META_DESCRIPTION>/i, "")
        .replace(/<TAGS>[\s\S]*?<\/TAGS>/i, "")
        .trim()
    );
    if (!bodyMd || bodyMd.length < 200) {
      throw new ArticlePipelineError("Literal translation returned insufficient content", "translation-body");
    }
    return { bodyMd, wordCount: countWords(bodyMd), enTitle, enMetaDescription, enTags };
  }

  async #runAdaptivePath(
    input: z.infer<typeof InputSchema>,
    ctx: StepContext,
    voiceBlock: string,
  ): Promise<z.infer<typeof OutputSchema>> {
    // Load the EN article to check if it has a title yet (needed for adaptive draft)
    const [enArticle] = await db
      .select({ title: articles.title, intentType: articles.intentType })
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);

    // Step 1: Generate EN-specific outline
    const outlineUserMessage = `You are writing a new English blog article outline. The original German article covered this topic, but the EN version needs to be framed for an international English-speaking audience.

Original DE article title: ${input.deTitle}
Primary keyword: ${input.primaryKeyword} (EN-focused variant)

DE article body (for context — do NOT translate directly, re-frame for EN audience):
${input.deBodyMd.substring(0, 3000)}

VOICE REFERENCES (existing English articles — match their structure and depth):
${voiceBlock}

---

Create a detailed English article outline:
- Use the same overall topic but frame it for an international (primarily US/UK) audience
- Replace German-specific examples with international or US examples
- Replace EUR/DSGVO/BaFin references with USD/GDPR/generic regulatory context
- Keep the same depth and section count as the DE article
- Output locale: en-US

Output: A structured markdown outline with H2/H3 headings and brief section descriptions. No other text.`;

    const outlineResult = await anthropic.messages({
      projectId:        ctx.projectId,
      pipelineRunId:    ctx.pipelineRunId,
      articleId:        input.articleId,
      operation:        COST_OPS.REFRESH_OUTLINE,
      model:            "claude-sonnet-4-6",
      systemPrefix:     "You are a content strategist specializing in international AI and software content.",
      systemSuffix:     "",
      userMessage:      outlineUserMessage,
      maxTokens:        2000,
      jsonMode:         false,
      estimatedCostEur: 0.07,
    });

    const outline = outlineResult.raw.trim();

    // Step 2: Generate EN draft from EN outline
    const draftUserMessage = `You are writing an English blog article for an international audience.

VOICE REFERENCES (match their tone — anti-hype, concrete, pragmatic):
${voiceBlock}

---

ARTICLE OUTLINE TO FOLLOW:
${outline}

---

Primary keyword: ${input.primaryKeyword}
Intent: ${enArticle?.intentType ?? "general"}

REQUIREMENTS:
- Follow the outline structure exactly (same H2/H3 headings)
- Write for an international English-speaking audience (US/UK/global)
- Match the tone of the voice references: direct, concrete, no fluff
- Include practical examples relevant to US/international market
- Keep tool names in their canonical English form
- Include the primary keyword naturally (not stuffed)
- Do NOT mention Germany, German regulations, or DSGVO unless they are globally relevant
- Output locale: en-US

OUTPUT FORMAT:
Output the complete article body in markdown, then append at the very end:

<TITLE>SEO-optimized English article title (max 70 chars, include primary keyword)</TITLE>
<META_DESCRIPTION>English meta description (140-155 chars, include primary keyword, no clickbait)</META_DESCRIPTION>
<TAGS>tag-one,tag-two,tag-three</TAGS>

For TAGS: 4-8 English-only kebab-case tags (no German words). Include the primary keyword and 3-7 relevant EN tags.`;

    const draftResult = await anthropic.messages({
      projectId:        ctx.projectId,
      pipelineRunId:    ctx.pipelineRunId,
      articleId:        input.articleId,
      operation:        COST_OPS.REFRESH_DRAFT,
      model:            "claude-sonnet-4-6",
      systemPrefix:     "You are an expert AI content writer creating high-quality English articles for an international tech audience.",
      systemSuffix:     "",
      userMessage:      draftUserMessage,
      maxTokens:        8192,
      jsonMode:         false,
      estimatedCostEur: 0.22,
    });

    const rawDraft = draftResult.raw.trim();
    const enTitle = parseBlock(rawDraft, "TITLE") ?? input.deTitle;
    const enMetaDescription = parseBlock(rawDraft, "META_DESCRIPTION") ?? "";
    const enTags = parseTagsBlock(rawDraft);
    const bodyMd = stripCodeFence(
      rawDraft
        .replace(/<TITLE>[\s\S]*?<\/TITLE>/i, "")
        .replace(/<META_DESCRIPTION>[\s\S]*?<\/META_DESCRIPTION>/i, "")
        .replace(/<TAGS>[\s\S]*?<\/TAGS>/i, "")
        .trim()
    );
    if (!bodyMd || bodyMd.length < 200) {
      throw new ArticlePipelineError("Adaptive translation draft returned insufficient content", "translation-body");
    }
    return { bodyMd, wordCount: countWords(bodyMd), enTitle, enMetaDescription, enTags };
  }
}
