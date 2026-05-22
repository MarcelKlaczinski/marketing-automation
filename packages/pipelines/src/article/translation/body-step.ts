/**
 * TranslationBodyStep: generates the target-locale article body.
 *
 * Works bidirectionally: DE→EN and EN→DE.
 *
 * literal path  — one Sonnet call that translates the source body directly
 * adaptive path — two Sonnet calls: target-locale outline first, then draft
 *
 * Both paths share the same COST_OPS: REFRESH_OUTLINE / REFRESH_DRAFT for adaptive,
 * TRANSLATE_DRAFT for literal.
 */
import { anthropic } from "@marketing-auto/adapter-anthropic";
import { COST_OPS } from "@marketing-auto/core/cost";
import { articles, db, eq } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { z } from "zod";
import { resolvePrompt } from "../../engine/prompt-resolver.ts";
import { BaseStep, type StepContext } from "../../engine/step.ts";
import type { VoiceReference } from "../voice-reference/loader.ts";
import { ArticlePipelineError } from "../types.ts";
import { countFaqItems, validateFaqPreservation, type FaqValidationResult } from "./lib/faq-validator.ts";

const log = createLogger("pipelines:translation-body");

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
  articleId:          z.string().uuid(),   // target article ID
  projectId:          z.string().uuid(),
  decision:           z.enum(["literal", "adaptive"]),
  sourceBodyMd:       z.string().min(100),
  sourceTitle:        z.string(),
  primaryKeyword:     z.string(),
  cornerstoneKeyword: z.string(),
  voiceReferences:    z.array(VoiceReferenceSchema),
  projectSlug:        z.string(),
  sourceLocale:       z.enum(["de", "en"]),
  targetLocale:       z.enum(["de", "en"]),
});

const FaqValidationSchema = z.object({
  valid:        z.boolean(),
  sourceCount:  z.number().int().min(0),
  targetCount:  z.number().int().min(0),
  delta:        z.number().int(),
  message:      z.string(),
});

const OutputSchema = z.object({
  bodyMd:               z.string().min(200),
  wordCount:            z.number().int().min(50),
  targetTitle:          z.string(),
  targetMetaDescription: z.string(),
  targetTags:           z.array(z.string()),
  // Spec 64.4 — surfaces FAQ-count mismatch to downstream review. Optional so
  // the field is only present for runs after this change shipped.
  faqValidation:        FaqValidationSchema.optional(),
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

function buildVoiceBlock(refs: VoiceReference[], targetLocale: "de" | "en"): string {
  if (refs.length === 0) {
    const localeName = targetLocale === "de" ? "German" : "English";
    return `(no existing ${localeName} articles available as voice reference)`;
  }
  return refs
    .map((r, i) => `--- Reference ${i + 1}: "${r.title}" ---\n${r.bodyMdExcerpt}`)
    .join("\n\n");
}

// Spec 64.4 — explicit FAQ-preservation requirement injected into every
// body-generation prompt (literal + adaptive draft). The 2026-05-22 audit
// found 9/157 EN siblings with lost or partial FAQs because the LLM dropped
// items under token pressure or when the FAQ sat late in the source body.
const FAQ_TRANSLATION_REQUIREMENT = `
**FAQ Translation Requirement (CRITICAL):**
If the source article contains a FAQ section (## FAQ, ## FAQs, ## Häufige Fragen, or ## Frequently Asked Questions),
you MUST translate ALL FAQ items 1:1. Never drop, skip, summarize, or merge FAQ questions. Each H3 question
in the source MUST have a corresponding H3 question in the translation. Translate the question AND its answer —
never just one without the other. Count the FAQ items before translating; verify the same count after.
`.trim();

// Spec 64.4 — Stronger retry guidance, injected only when the first attempt
// lost FAQ items. `{sourceCount}` is replaced at runtime.
const STRONGER_FAQ_GUIDANCE = `
**CRITICAL RETRY: Previous translation lost FAQ items.**
This article has {sourceCount} FAQ items. You MUST produce exactly {sourceCount} FAQ items in the translation.
Do not skip any. Each question must be translated, and each answer must follow its question.
List the FAQ items in your head before writing — ensure all are present.
`.trim();

const DE_STYLE_NOTES = `
**German-specific style:**
- Use "Sie" form for B2B audiences
- Convert "$" pricing to "€" with realistic German market pricing where appropriate
- Replace "GDPR" with "DSGVO"
- Replace US-only references (SSN, US ZIP code) with German equivalents or generalize
- German headlines: more descriptive, less clickbaity than English
- Output locale: de-DE
`.trim();

const EN_STYLE_NOTES = `
**English-specific style:**
- Convert "€" to "$" where pricing context is universal (SaaS subscriptions)
- Replace "DSGVO" with "GDPR"
- Generalize DACH-specific examples to "European" or international where natural
- Use active voice more aggressively than the German source
- Tighter sentences than typical German source
- Output locale: en-US
`.trim();

export class TranslationBodyStep extends BaseStep<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  readonly name = "translation-body";
  readonly inputSchema = InputSchema;
  readonly outputSchema = OutputSchema;
  override readonly llmBound = true;

  override estimatedCostEur(): number {
    return 0.22; // literal ~0.20, adaptive ~0.30 — use midpoint
  }

  async execute(input: z.infer<typeof InputSchema>, ctx: StepContext): Promise<z.infer<typeof OutputSchema>> {
    const voiceBlock = buildVoiceBlock(input.voiceReferences as VoiceReference[], input.targetLocale);

    if (input.decision === "literal") {
      return this.#runLiteralPath(input, ctx, voiceBlock);
    } else {
      return this.#runAdaptivePath(input, ctx, voiceBlock);
    }
  }

  /**
   * Spec 64.4 — runs an LLM body-translation attempt, validates FAQ
   * preservation, and retries 1× with STRONGER_FAQ_GUIDANCE when the first
   * attempt loses items. Does NOT throw on persistent asymmetry: Marcel
   * reviews EN siblings before publish, and the validation result is
   * surfaced in the step output for downstream visibility.
   */
  async #runWithFaqRetry(args: {
    articleId: string;
    sourceBodyMd: string;
    buildUserMessage: (faqRetrySuffix: string) => string;
    callBaseArgs: {
      operation: string;
      systemPrefix: string;
      systemSuffix: string;
      maxTokens: number;
      estimatedCostEur: number;
    };
    ctx: StepContext;
  }): Promise<{ raw: string; validation: FaqValidationResult }> {
    const { articleId, sourceBodyMd, buildUserMessage, callBaseArgs, ctx } = args;
    const sourceFaqCount = countFaqItems(sourceBodyMd);

    let attempt = 0;
    let lastRaw = "";
    let lastValidation: FaqValidationResult = {
      valid:       true,
      sourceCount: sourceFaqCount,
      targetCount: sourceFaqCount,
      delta:       0,
      message:     `FAQ count preserved: ${sourceFaqCount}`,
    };

    while (attempt < 2) {
      const faqRetrySuffix = attempt === 0
        ? ""
        : STRONGER_FAQ_GUIDANCE.replaceAll("{sourceCount}", String(sourceFaqCount));
      const userMessage = buildUserMessage(faqRetrySuffix);

      const result = await anthropic.messages({
        projectId:        ctx.projectId,
        pipelineRunId:    ctx.pipelineRunId,
        articleId:        articleId,
        operation:        callBaseArgs.operation,
        model:            "claude-sonnet-4-6",
        systemPrefix:     callBaseArgs.systemPrefix,
        systemSuffix:     callBaseArgs.systemSuffix,
        userMessage,
        maxTokens:        callBaseArgs.maxTokens,
        jsonMode:         false,
        estimatedCostEur: callBaseArgs.estimatedCostEur,
      });

      lastRaw = result.raw.trim();
      lastValidation = validateFaqPreservation(sourceBodyMd, lastRaw);

      if (lastValidation.valid) {
        if (attempt > 0) {
          log.info(
            { articleId, attempt, faqCount: lastValidation.sourceCount },
            "translation-body FAQ preservation recovered after retry"
          );
        }
        break;
      }

      log.warn(
        {
          articleId,
          attempt,
          sourceFaqCount: lastValidation.sourceCount,
          targetFaqCount: lastValidation.targetCount,
          delta:          lastValidation.delta,
        },
        lastValidation.message
      );

      attempt += 1;
    }

    if (!lastValidation.valid) {
      log.error(
        {
          articleId,
          sourceFaqCount: lastValidation.sourceCount,
          targetFaqCount: lastValidation.targetCount,
          delta:          lastValidation.delta,
        },
        "translation-body FAQ asymmetry persists after retry"
      );
    }

    return { raw: lastRaw, validation: lastValidation };
  }

  async #runLiteralPath(
    input: z.infer<typeof InputSchema>,
    ctx: StepContext,
    voiceBlock: string,
  ): Promise<z.infer<typeof OutputSchema>> {
    const sourceLocaleName = input.sourceLocale === "de" ? "German" : "English";
    const targetLocaleName = input.targetLocale === "de" ? "German" : "English";
    const targetAudience = input.targetLocale === "de"
      ? "a German-speaking DACH audience (Germany, Austria, Switzerland)"
      : "an international English-speaking audience";
    const styleNotes = input.targetLocale === "de" ? DE_STYLE_NOTES : EN_STYLE_NOTES;
    const tagLanguageNote = input.targetLocale === "de"
      ? "4-8 German kebab-case tags (no English words). Include the primary keyword and relevant DE tags."
      : "4-8 English-only kebab-case tags (no German words). Include the primary keyword and 3-7 relevant EN tags.";

    const buildUserMessage = (faqRetrySuffix: string): string => `You are translating a ${sourceLocaleName} blog article into idiomatic ${targetLocaleName} for ${targetAudience}.

VOICE REFERENCES (existing ${targetLocaleName} articles in the same content space — match their tone):
${voiceBlock}

---

${sourceLocaleName.toUpperCase()} ARTICLE TO TRANSLATE:
Title: ${input.sourceTitle}
Primary keyword: ${input.primaryKeyword}

${input.sourceBodyMd}

---

TRANSLATION REQUIREMENTS:
- Preserve the article's narrative structure exactly (keep all sections, headings, and subheadings in the same order)
- Use idiomatic ${targetLocaleName} — not literal word-for-word translation
- Match the voice and tone of the reference articles: concrete, anti-hype, pragmatic, direct
- Tool names stay in their canonical form (e.g. "ChatGPT", "Midjourney")
- Keep markdown formatting intact (headings, bold, lists, code blocks, links)
- Do NOT add any preamble, commentary, or "Here is the translation:" prefix

${FAQ_TRANSLATION_REQUIREMENT}

${styleNotes}
${faqRetrySuffix ? `\n${faqRetrySuffix}\n` : ""}
OUTPUT FORMAT:
First output the translated article body in markdown, then append these tagged blocks at the very end:

<TITLE>SEO-optimized ${targetLocaleName} article title (max 70 chars, include primary keyword)</TITLE>
<META_DESCRIPTION>${targetLocaleName} meta description (140-155 chars, include primary keyword, no clickbait)</META_DESCRIPTION>
<TAGS>tag-one,tag-two,tag-three</TAGS>

For TAGS: ${tagLanguageNote}`;

    // Spec 62.0a Section 4.4: edit-prompt resume override applies to all 3 LLM calls
    // in this step (one override per step; granular per-call overrides are out of 62.0a scope).
    const literalSystemPrefix = await resolvePrompt(
      ctx,
      this.name,
      () =>
        `You are an expert technical translator specializing in AI and software content. Your translations are idiomatic, accurate, and indistinguishable from native ${targetLocaleName} writing.`
    );
    const { raw, validation } = await this.#runWithFaqRetry({
      articleId:    input.articleId,
      sourceBodyMd: input.sourceBodyMd,
      buildUserMessage,
      callBaseArgs: {
        operation:        COST_OPS.TRANSLATE_DRAFT,
        systemPrefix:     literalSystemPrefix,
        systemSuffix:     "",
        maxTokens:        8192,
        estimatedCostEur: 0.20,
      },
      ctx,
    });

    const targetTitle = parseBlock(raw, "TITLE") ?? input.sourceTitle;
    const targetMetaDescription = parseBlock(raw, "META_DESCRIPTION") ?? "";
    const targetTags = parseTagsBlock(raw);
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
    return {
      bodyMd,
      wordCount: countWords(bodyMd),
      targetTitle,
      targetMetaDescription,
      targetTags,
      faqValidation: validation,
    };
  }

  async #runAdaptivePath(
    input: z.infer<typeof InputSchema>,
    ctx: StepContext,
    voiceBlock: string,
  ): Promise<z.infer<typeof OutputSchema>> {
    const sourceLocaleName = input.sourceLocale === "de" ? "German" : "English";
    const targetLocaleName = input.targetLocale === "de" ? "German" : "English";
    const targetAudience = input.targetLocale === "de"
      ? "a DACH German-speaking audience (Germany, Austria, Switzerland)"
      : "an international English-speaking audience (US/UK/global)";
    const styleNotes = input.targetLocale === "de" ? DE_STYLE_NOTES : EN_STYLE_NOTES;
    const tagLanguageNote = input.targetLocale === "de"
      ? "4-8 German kebab-case tags. Include the primary keyword and relevant DE tags."
      : "4-8 English-only kebab-case tags. Include the primary keyword and 3-7 relevant EN tags.";

    // Load the target article to check its intentType (needed for adaptive draft)
    const [targetArticle] = await db
      .select({ title: articles.title, intentType: articles.intentType })
      .from(articles)
      .where(eq(articles.id, input.articleId))
      .limit(1);

    // Step 1: Generate target-locale-specific outline
    const outlineUserMessage = `You are writing a new ${targetLocaleName} blog article outline. The original ${sourceLocaleName} article covered this topic, but the ${targetLocaleName} version needs to be framed for ${targetAudience}.

Original ${sourceLocaleName} article title: ${input.sourceTitle}
Primary keyword: ${input.primaryKeyword}

${sourceLocaleName} article body (for context — do NOT translate directly, re-frame for ${targetLocaleName} audience):
${input.sourceBodyMd.substring(0, 3000)}

VOICE REFERENCES (existing ${targetLocaleName} articles — match their structure and depth):
${voiceBlock}

---

Create a detailed ${targetLocaleName} article outline:
- Use the same overall topic but frame it for ${targetAudience}
- Replace locale-specific examples with examples relevant to the target audience
- Keep the same depth and section count as the source article

${styleNotes}

Output: A structured markdown outline with H2/H3 headings and brief section descriptions. No other text.`;

    const outlineSystemPrefix = await resolvePrompt(
      ctx,
      this.name,
      () => `You are a content strategist specializing in ${targetLocaleName} AI and software content.`
    );
    const outlineResult = await anthropic.messages({
      projectId:        ctx.projectId,
      pipelineRunId:    ctx.pipelineRunId,
      articleId:        input.articleId,
      operation:        COST_OPS.REFRESH_OUTLINE,
      model:            "claude-sonnet-4-6",
      systemPrefix:     outlineSystemPrefix,
      systemSuffix:     "",
      userMessage:      outlineUserMessage,
      maxTokens:        2000,
      jsonMode:         false,
      estimatedCostEur: 0.07,
    });

    const outline = outlineResult.raw.trim();

    // Step 2: Generate target-locale draft from target-locale outline
    const buildDraftUserMessage = (faqRetrySuffix: string): string => `You are writing a ${targetLocaleName} blog article for ${targetAudience}.

VOICE REFERENCES (match their tone — anti-hype, concrete, pragmatic):
${voiceBlock}

---

ARTICLE OUTLINE TO FOLLOW:
${outline}

---

Primary keyword: ${input.primaryKeyword}
Intent: ${targetArticle?.intentType ?? "general"}

REQUIREMENTS:
- Follow the outline structure exactly (same H2/H3 headings)
- Write for ${targetAudience}
- Match the tone of the voice references: direct, concrete, no fluff
- Include practical examples relevant to the target market
- Keep tool names in their canonical form
- Include the primary keyword naturally (not stuffed)

${FAQ_TRANSLATION_REQUIREMENT}

${styleNotes}
${faqRetrySuffix ? `\n${faqRetrySuffix}\n` : ""}
OUTPUT FORMAT:
Output the complete article body in markdown, then append at the very end:

<TITLE>SEO-optimized ${targetLocaleName} article title (max 70 chars, include primary keyword)</TITLE>
<META_DESCRIPTION>${targetLocaleName} meta description (140-155 chars, include primary keyword, no clickbait)</META_DESCRIPTION>
<TAGS>tag-one,tag-two,tag-three</TAGS>

For TAGS: ${tagLanguageNote}`;

    const draftSystemPrefix = await resolvePrompt(
      ctx,
      this.name,
      () =>
        `You are an expert AI content writer creating high-quality ${targetLocaleName} articles for ${targetAudience}.`
    );
    const { raw: rawDraft, validation } = await this.#runWithFaqRetry({
      articleId:    input.articleId,
      sourceBodyMd: input.sourceBodyMd,
      buildUserMessage: buildDraftUserMessage,
      callBaseArgs: {
        operation:        COST_OPS.REFRESH_DRAFT,
        systemPrefix:     draftSystemPrefix,
        systemSuffix:     "",
        maxTokens:        8192,
        estimatedCostEur: 0.22,
      },
      ctx,
    });

    const targetTitle = parseBlock(rawDraft, "TITLE") ?? input.sourceTitle;
    const targetMetaDescription = parseBlock(rawDraft, "META_DESCRIPTION") ?? "";
    const targetTags = parseTagsBlock(rawDraft);
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
    return {
      bodyMd,
      wordCount: countWords(bodyMd),
      targetTitle,
      targetMetaDescription,
      targetTags,
      faqValidation: validation,
    };
  }
}
