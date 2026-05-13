import { anthropic } from "@marketing-auto/adapter-anthropic";
import { r2 } from "@marketing-auto/adapter-storage";
import { COST_OPS } from "@marketing-auto/core";
import {
  articles,
  db,
  projects,
  socialPosts,
} from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BaseStep, type StepContext } from "../../engine/step.ts";

const log = createLogger("pipelines:social-image");

// ─── Shared schemas ────────────────────────────────────────────────────────────

const resolvedToolSchema = z.object({
  slug: z.string(),
  rank: z.number().int(),
  name: z.string(),
  domain: z.string(),
  eyebrow: z.string(),
  tagline: z.string(),
  bestFor: z.string().max(40).optional(),
  strengths: z.array(z.string()),
  pricing: z.object({
    tier: z.enum(["free", "freemium", "paid"]),
    label: z.string(),
  }),
  iconSvg: z.string().optional(),   // inline SVG from resolution chain
  iconInitials: z.string().optional(),
  iconHue: z.number().optional(),
});

// ─── Step 1: LoadArticleStep ─────────────────────────────────────────────────

const LoadArticleInputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  theme: z.enum(["dark", "light"]).default("dark"),
  variant: z.enum(["editorial", "stunning"]).default("editorial"),
  preRunId: z.string().uuid().optional(),
});

const LoadArticleOutputSchema = z.object({
  articleId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectSlug: z.string(),
  theme: z.enum(["dark", "light"]),
  variant: z.enum(["editorial", "stunning"]),
  articleTitle: z.string(),
  articleSlug: z.string(),
  bodyMd: z.string(),
  articleUrl: z.string(),
  brandTokens: z.record(z.unknown()),
});

type LoadArticleInput = {
  articleId: string;
  projectId: string;
  theme: "dark" | "light";
  variant: "editorial" | "stunning";
  preRunId?: string;
};

export class LoadArticleStep extends BaseStep<
  LoadArticleInput,
  z.infer<typeof LoadArticleOutputSchema>
> {
  readonly name = "load-article";
  readonly inputSchema = LoadArticleInputSchema as z.ZodType<LoadArticleInput>;
  readonly outputSchema = LoadArticleOutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof LoadArticleInputSchema>, _ctx: StepContext) {
    const [article] = await db
      .select()
      .from(articles)
      .where(and(eq(articles.id, input.articleId), eq(articles.projectId, input.projectId)))
      .limit(1);
    if (!article) throw new Error(`Article ${input.articleId} not found`);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) throw new Error(`Project ${input.projectId} not found`);

    const cmsBase = (project.cmsConfig as { baseUrl?: string })?.baseUrl ?? `https://${project.domain ?? "example.com"}`;
    const articleUrl = `${cmsBase}/${article.slug}`;

    return {
      articleId: article.id,
      projectId: project.id,
      projectSlug: project.slug,
      theme: input.theme,
      variant: input.variant,
      articleTitle: article.title ?? article.slug,
      articleSlug: article.slug,
      bodyMd: article.bodyMd ?? "",
      articleUrl,
      brandTokens: (project.brandTokens as Record<string, unknown>) ?? {},
    };
  }
}

// ─── Step 2: ExtractToolsStep ────────────────────────────────────────────────

const ExtractToolsInputSchema = LoadArticleOutputSchema;

const extractedToolSchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  slug: z.string(),
  domain: z.string(),
  tagline: z.string(),
  bestFor: z.string().max(40).optional(),
  strengths: z.array(z.string()).min(1).max(4),
  pricing: z.object({ tier: z.enum(["free", "freemium", "paid"]), label: z.string() }),
  keyDifferentiator: z.string().max(60).optional(),
  starStrength: z.string().max(80).optional(),
});

const coverHookSchema = z.object({
  pattern: z.enum(["comparison", "number-promise", "insider-reveal", "problem-recognition", "save-promise"]),
  hookLead: z.string().max(80),
  hookTrail: z.string().max(50),
  hookEmphasisWord: z.string().max(30),
  saveTriggerIntensity: z.enum(["low", "medium", "high"]),
});

const endCloserSchema = z.object({
  pattern: z.enum(["question", "cta", "save-reminder"]),
  headlineLead: z.string().max(60),
  headlineTrail: z.string().max(60),
  headlineEmphasis: z.string().max(30).optional(),
});

const ExtractToolsOutputSchema = ExtractToolsInputSchema.extend({
  extractedTools: z.array(extractedToolSchema).min(1).max(10),
  coverEyebrow: z.string(),
  coverHeadlineLead: z.string(),
  coverHeadlineHighlight: z.string(),
  coverHeadlineTrail: z.string().optional(),
  coverSubhead: z.string().optional(),
  endHeadline: z.string(),
  endHeadlineHighlight: z.string(),
  // Stunning variant extras (populated when variant === 'stunning')
  coverHook: coverHookSchema.optional(),
  endCloser: endCloserSchema.optional(),
});

export class ExtractToolsStep extends BaseStep<
  z.infer<typeof ExtractToolsInputSchema>,
  z.infer<typeof ExtractToolsOutputSchema>
> {
  readonly name = "extract-tools";
  readonly inputSchema = ExtractToolsInputSchema;
  readonly outputSchema = ExtractToolsOutputSchema;

  override estimatedCostEur(): number { return 0.005; }

  async execute(input: z.infer<typeof ExtractToolsInputSchema>, ctx: StepContext) {
    const isStunning = input.variant === "stunning";
    // Pre-compute article type from title alone (tool count unknown before LLM parses)
    const titleType = /\bvs\.?\b|\bgegen\b/.test(input.articleTitle.toLowerCase()) ? "comparison" : "listicle";
    const stunningSuffix = isStunning ? `

STUNNING VARIANT — zusätzliche Felder pro Tool:
- "keyDifferentiator": 1-5 Wörter aus der Tagline die den Kern-Unterschied benennen (werden highlighted). Z.B. "produktionsreifem SVG-Vektor"
- "starStrength": die WICHTIGSTE der 4 Strengths (exakt aus dem strengths-Array, wird visuell hervorgehoben)

STUNNING VARIANT — Cover-Hook (cover_hook):
Du generierst einen scroll-stopping Hook für den Cover-Slide im toolwiki-Voice.

VOICE-CONSTRAINTS:
- Editorial, ehrlich, anti-hype
- "du"-Form (DE) oder you-form (EN)
- Keine ALL-CAPS außer Eyebrow
- Keine Sensation: kein "!!!", kein "BEST", kein "TÖTEN"
- Em-dash als Atemzeichen erlaubt

ARTICLE-TYPE: ${titleType}

HOOK-PATTERNS (wähle basierend auf ARTICLE-TYPE):
A — Comparison-Tension (ZWINGEND wenn ARTICLE-TYPE === 'comparison'): "<Tool A> oder <Tool B>? — Eines kann mehr."
B — Number-Promise (nur wenn ARTICLE-TYPE === 'listicle', konkretes Outcome): "Die {N} KI-Tools die deinen Workflow ersetzen."
C — Insider-Reveal: "Was Designer über Recraft nicht wussten."
D — Problem-Recognition: "Frustriert von schlechten Logo-Tools? — Diese 3 ändern das."
E — Save-Promise: "Speichere das: Die wichtigsten Bild-KIs 2026."

REGELN für Hook:
- hook_lead: max 8 Wörter (z.B. "Recraft oder Ideogram?" = 3 Wörter ✓)
- hook_trail: max 6 Wörter (z.B. "Eines kann mehr." = 3 Wörter ✓)
- hook_emphasis_word: 1-2 Wörter für Betonung
- Kein ALL-CAPS in Lead/Trail
- Kein Hype: kein "best", "killer", "ultimate", "mind-blowing", "game-changer"
- Fallback: Pattern B (Number-Promise) wenn keine andere Variante stark passt

STUNNING VARIANT — End-Closer (end_closer):
Generiere einen starken Closer für den End-Slide.
Pattern "question": Provokative Frage → triggert Kommentare
Pattern "cta": klarer Aufruf → "Folge uns für mehr ehrliche Vergleiche."
Pattern "save-reminder": "Speicher diesen Post als Cheat-Sheet."

Zusätzliche JSON-Felder für Stunning:
"cover_hook": {
  "pattern": "comparison|number-promise|insider-reveal|problem-recognition|save-promise",
  "hook_lead": "...",
  "hook_trail": "...",
  "hook_emphasis_word": "...",
  "save_trigger_intensity": "low|medium|high"
},
"end_closer": {
  "pattern": "question|cta|save-reminder",
  "headline_lead": "...",
  "headline_trail": "...",
  "headline_emphasis": "optional"
}` : "";

    const prompt = `You are a social-media content assistant. Extract structured data for an Instagram carousel from this article.

Article title: ${input.articleTitle}
Article URL: ${input.articleUrl}

Article body (markdown):
${input.bodyMd.slice(0, 6000)}

IMPORTANT for cover headlines: Base them on the ACTUAL tools you extract, not the article title.
- If you extract N tools: coverHeadlineLead = "Die {N} besten", coverHeadlineHighlight = the category (e.g. "KI-Bild-Generatoren")
- Do NOT use "X vs. Y" format even if the article title says so — a carousel shows a list, not a duel
- coverEyebrow should reflect the category/topic, not the article title
${stunningSuffix}

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "coverEyebrow": "string up to 40 chars, e.g. 'KI-BILDGENERATOREN 2026'",
  "coverHeadlineLead": "string up to 30 chars — MUST reflect tool count, e.g. 'Die 5 besten'",
  "coverHeadlineHighlight": "string up to 40 chars — the tool category, e.g. 'KI-Bild-Generatoren'",
  "coverHeadlineTrail": "optional string up to 20 chars, e.g. 'im Vergleich'",
  "coverSubhead": "optional string up to 80 chars",
  "endHeadline": "string up to 40 chars",
  "endHeadlineHighlight": "string up to 40 chars",
  "tools": [
    {
      "rank": 1,
      "name": "Tool Name",
      "slug": "tool-slug",
      "domain": "tool.com",
      "tagline": "one sentence, max 120 chars",
      "bestFor": "short use-case label, max 40 chars, e.g. 'Foto-Editing' or 'Code-Generierung'",
      "strengths": ["strength 1", "strength 2", "strength 3", "optional strength 4"],
      "pricing": { "tier": "free|freemium|paid", "label": "ab X€/Monat" }${isStunning ? `,
      "keyDifferentiator": "1-5 key words from tagline",
      "starStrength": "most important strength (copy from strengths array)"` : ""}
    }
  ]${isStunning ? `,
  "cover_hook": { ... },
  "end_closer": { ... }` : ""}
}

Extract 3-10 tools. Keep all text in GERMAN (same language as the article).`;

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_EXTRACT,
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "Extract structured tool data for Instagram carousel generation. Return valid JSON only.",
      userMessage: prompt,
      maxTokens: isStunning ? 3000 : 2048,
      estimatedCostEur: 0.005,
      jsonMode: true,
    });

    const rawText = response.raw;
    let parsed: {
      tools: Array<z.infer<typeof extractedToolSchema>>;
      coverEyebrow: string;
      coverHeadlineLead: string;
      coverHeadlineHighlight: string;
      coverHeadlineTrail?: string;
      coverSubhead?: string;
      endHeadline: string;
      endHeadlineHighlight: string;
      cover_hook?: {
        pattern: string;
        hook_lead: string;
        hook_trail: string;
        hook_emphasis_word: string;
        save_trigger_intensity: string;
      };
      end_closer?: {
        pattern: string;
        headline_lead: string;
        headline_trail: string;
        headline_emphasis?: string;
      };
    };

    const jsonStart = rawText.indexOf("{");
    const jsonEnd = rawText.lastIndexOf("}");
    const cleanText = jsonStart >= 0 && jsonEnd > jsonStart ? rawText.slice(jsonStart, jsonEnd + 1) : rawText;
    try {
      parsed = JSON.parse(cleanText);
    } catch {
      throw new Error(`ExtractToolsStep: LLM returned invalid JSON: ${rawText.slice(0, 200)}`);
    }

    const tools = z.array(extractedToolSchema).min(1).max(10).parse(parsed.tools);

    // If LLM still used "vs." pattern, override with count-based headline
    const leadHasVs = /\bvs\.?\b/i.test(parsed.coverHeadlineLead ?? "");
    const highlightHasVs = /\bvs\.?\b/i.test(parsed.coverHeadlineHighlight ?? "");
    const coverHeadlineLead = leadHasVs || highlightHasVs
      ? `Die ${tools.length} besten`
      : (parsed.coverHeadlineLead ?? `Die ${tools.length} besten`);

    // ─── Hook validation + fallback (stunning only) ────────────────────────────
    const articleType = detectArticleType(input.articleTitle, tools.length);

    let coverHook: z.infer<typeof coverHookSchema> | undefined;
    if (isStunning) {
      const rawHook = parsed.cover_hook;
      if (rawHook) {
        const hookValid = validateHook(rawHook.hook_lead ?? "", rawHook.hook_trail ?? "", log);
        if (hookValid) {
          const hookParsed = coverHookSchema.safeParse({
            pattern: rawHook.pattern,
            hookLead: rawHook.hook_lead,
            hookTrail: rawHook.hook_trail,
            hookEmphasisWord: rawHook.hook_emphasis_word,
            saveTriggerIntensity: rawHook.save_trigger_intensity,
          });
          if (hookParsed.success) {
            coverHook = hookParsed.data;
          }
        }
      }

      // Pattern-override: if article is a comparison but LLM returned number-promise, force Pattern A
      if (articleType === "comparison" && tools.length <= 3 && (!coverHook || coverHook.pattern === "number-promise")) {
        const toolA = tools[0]?.name ?? "Tool A";
        const toolB = tools[1]?.name ?? "Tool B";
        log.info({ articleTitle: input.articleTitle, toolA, toolB }, "Overriding to comparison hook (Pattern A)");
        coverHook = {
          pattern: "comparison",
          hookLead: `${toolA} oder ${toolB}?`,
          hookTrail: "Eines kann mehr.",
          hookEmphasisWord: "mehr",
          saveTriggerIntensity: "medium",
        };
      }

      // Fallback: build a hook programmatically, preserving category context
      if (!coverHook) {
        const category = parsed.coverHeadlineHighlight ?? `${tools[0]?.name ?? "KI"}-Tools`;
        log.warn({ articleTitle: input.articleTitle, articleType }, "Hook failed validation — using programmatic fallback");
        coverHook = {
          pattern: "number-promise",
          hookLead: `Die ${tools.length} besten`,
          hookTrail: `${category} im Test.`,
          hookEmphasisWord: String(tools.length),
          saveTriggerIntensity: "medium",
        };
      }
    }

    // ─── End-closer (stunning only) ────────────────────────────────────────────
    let endCloser: z.infer<typeof endCloserSchema> | undefined;
    if (isStunning && parsed.end_closer) {
      const closerParsed = endCloserSchema.safeParse({
        pattern: parsed.end_closer.pattern,
        headlineLead: parsed.end_closer.headline_lead,
        headlineTrail: parsed.end_closer.headline_trail,
        headlineEmphasis: parsed.end_closer.headline_emphasis,
      });
      if (closerParsed.success) {
        endCloser = closerParsed.data;
      }
    }
    if (isStunning && !endCloser) {
      endCloser = {
        pattern: "save-reminder",
        headlineLead: "Speicher diesen Post",
        headlineTrail: "als Cheat-Sheet.",
      };
    }

    return {
      ...input,
      extractedTools: tools,
      coverEyebrow: parsed.coverEyebrow ?? `${input.articleTitle.toUpperCase()}`,
      coverHeadlineLead,
      coverHeadlineHighlight: (leadHasVs || highlightHasVs)
        ? (parsed.coverHeadlineHighlight?.replace(/\s*vs\.?\s*/gi, " & ") ?? input.articleTitle)
        : (parsed.coverHeadlineHighlight ?? input.articleTitle),
      coverHeadlineTrail: parsed.coverHeadlineTrail,
      coverSubhead: parsed.coverSubhead,
      endHeadline: parsed.endHeadline ?? "Mehr Reviews,",
      endHeadlineHighlight: parsed.endHeadlineHighlight ?? "ehrlich getestet.",
      coverHook,
      endCloser,
    };
  }
}

// Classify article type from title + tool count so we can enforce the right hook pattern
// regardless of what the LLM chooses.
function detectArticleType(title: string, toolCount: number): "comparison" | "listicle" | "tutorial" | "reference" {
  const t = title.toLowerCase();
  // "X vs Y", "X gegen Y", "X oder Y" with 2-3 tools → comparison
  if (toolCount <= 3 && (/\bvs\.?\b|\bgegen\b/.test(t) || (/ oder /.test(t) && toolCount <= 2))) {
    return "comparison";
  }
  if (/^die\s+\d+\b|^top\s+\d+\b|\bbeste[nm]?\b.*\d+/.test(t) || toolCount >= 4) {
    return "listicle";
  }
  if (/anleitung|tutorial|so funktioniert|how to/.test(t)) {
    return "tutorial";
  }
  if (/vergleich|guide|überblick|cheat.?sheet/.test(t)) {
    return "reference";
  }
  return toolCount <= 2 ? "comparison" : "listicle";
}

// Anti-hype guard — returns false if hook contains forbidden words or ALL-CAPS sequences
// Uses word-boundary matching so "besten" (German superlative) does not trip "best".
// Non-word tokens like "!!!" fall back to plain includes().
const FORBIDDEN_HOOK_PATTERNS: RegExp[] = [
  /\bbest\b/i,         // English hype word — not "besten"
  /beste!/i,           // German hype with exclamation
  /!!!/,               // Multiple exclamation marks
  /\bkiller\b/i,
  /\bultimate\b/i,
  /\brevolutionary\b/i,
  /\brevolutionär\b/i,
  /mind-blowing/i,
  /game-changer/i,
  /\bsensation\b/i,
  /\bunbelievable\b/i,
  /must-have/i,
  /\babsolute\b/i,
  /\bcrazy\b/i,
  /\binsane\b/i,
];

function validateHook(lead: string, trail: string, logger: ReturnType<typeof createLogger>): boolean {
  const combined = `${lead} ${trail}`;
  for (const pattern of FORBIDDEN_HOOK_PATTERNS) {
    if (pattern.test(combined)) {
      logger.warn({ lead, trail, pattern: pattern.source }, "Hook contains forbidden pattern");
      return false;
    }
  }
  if (/[A-Z]{4,}/.test(lead) || /[A-Z]{4,}/.test(trail)) {
    logger.warn({ lead, trail }, "Hook contains ALL-CAPS sequence");
    return false;
  }
  return true;
}

// ─── Step 3: ResolveAssetsStep ───────────────────────────────────────────────

const ResolveAssetsInputSchema = ExtractToolsOutputSchema;
const ResolveAssetsOutputSchema = ResolveAssetsInputSchema.extend({
  resolvedTools: z.array(resolvedToolSchema),
});

export class ResolveAssetsStep extends BaseStep<
  z.infer<typeof ResolveAssetsInputSchema>,
  z.infer<typeof ResolveAssetsOutputSchema>
> {
  readonly name = "resolve-assets";
  readonly inputSchema = ResolveAssetsInputSchema;
  readonly outputSchema = ResolveAssetsOutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof ResolveAssetsInputSchema>, _ctx: StepContext) {
    const { resolveToolIcon } = await import("../../_lib/resolve-tool-icon.ts");

    const resolvedTools = await Promise.all(
      input.extractedTools.map(async (tool) => {
        const icon = await resolveToolIcon(input.projectId, tool.slug, input.theme);
        return {
          ...tool,
          eyebrow: `${String(tool.rank).padStart(2, "0")} · ${tool.name.toUpperCase()}`,
          bestFor: tool.bestFor,
          // emoji field intentionally omitted — icons are resolved from brand asset library
          iconSvg: icon.type === "svg" ? icon.svg : undefined,
          iconInitials: icon.type === "avatar" ? icon.initials : undefined,
          iconHue: icon.type === "avatar" ? icon.hue : undefined,
        };
      })
    );

    return { ...input, resolvedTools };
  }
}

// ─── Step 4: RenderSlidesStep ────────────────────────────────────────────────

const RenderSlidesInputSchema = ResolveAssetsOutputSchema;
const RenderSlidesOutputSchema = RenderSlidesInputSchema.extend({
  slideBuffers: z.array(z.instanceof(Buffer)),
  totalSlides: z.number().int(),
});

export class RenderSlidesStep extends BaseStep<
  z.infer<typeof RenderSlidesInputSchema>,
  z.infer<typeof RenderSlidesOutputSchema>
> {
  readonly name = "render-slides";
  readonly inputSchema = RenderSlidesInputSchema;
  readonly outputSchema = RenderSlidesOutputSchema;

  override estimatedCostEur(): number { return 0.002; }

  async execute(input: z.infer<typeof RenderSlidesInputSchema>, ctx: StepContext) {
    ctx.log.info({ toolCount: input.resolvedTools.length }, "Rendering Remotion slides");

    // Dynamic import at runtime — social package is a workspace peer
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import avoids circular dep during build
    const socialModule = await import("../../../../social/render-server.ts") as any;
    const renderListCarousel = socialModule.renderListCarousel as (
      input: Record<string, unknown>
    ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;
    const renderListCarouselStunning = socialModule.renderListCarouselStunning as (
      input: Record<string, unknown>
    ) => Promise<{ slides: Buffer[]; sequenceCount: number }>;

    const toolRecap = input.resolvedTools.map((t) => t.slug);

    const carouselInput = {
      theme: input.theme,
      variant: input.variant,
      brandTokens: input.brandTokens,
      slideIndex: 0,
      cover: {
        eyebrow: input.coverEyebrow,
        headlineLead: input.coverHeadlineLead,
        headlineHighlight: input.coverHeadlineHighlight,
        headlineTrail: input.coverHeadlineTrail,
        subhead: input.coverSubhead,
        ...(input.coverHook && { hook: input.coverHook }),
      },
      tools: input.resolvedTools,
      end: {
        headline: input.endHeadline,
        headlineHighlight: input.endHeadlineHighlight,
        articleUrl: input.articleUrl,
        ...(input.endCloser && { closer: input.endCloser }),
        toolRecap,
      },
    };

    await ctx.reportProgress(10, "Bundling Remotion");
    const renderFn = input.variant === "stunning" ? renderListCarouselStunning : renderListCarousel;
    const { slides, sequenceCount } = await renderFn(carouselInput);
    await ctx.reportProgress(90, `Rendered ${sequenceCount} slides`);

    return { ...input, slideBuffers: slides, totalSlides: sequenceCount };
  }
}

// ─── Step 5: UploadSlidesStep ────────────────────────────────────────────────

const UploadSlidesInputSchema = RenderSlidesOutputSchema;
const UploadSlidesOutputSchema = UploadSlidesInputSchema.extend({
  slideUrls: z.array(z.string()),
});

export class UploadSlidesStep extends BaseStep<
  z.infer<typeof UploadSlidesInputSchema>,
  z.infer<typeof UploadSlidesOutputSchema>
> {
  readonly name = "upload-slides";
  readonly inputSchema = UploadSlidesInputSchema;
  readonly outputSchema = UploadSlidesOutputSchema;

  override estimatedCostEur(): number { return 0.0001; }

  async execute(input: z.infer<typeof UploadSlidesInputSchema>, ctx: StepContext) {
    const timestamp = Date.now();
    const slideUrls: string[] = [];

    for (let i = 0; i < input.slideBuffers.length; i++) {
      const key = `${input.projectSlug}/social/${input.articleSlug}-${timestamp}-slide-${i}.png`;
      const result = await r2.put({
        key,
        body: input.slideBuffers[i]!,
        contentType: "image/png",
      });
      slideUrls.push(result.publicUrl);
      await ctx.reportProgress(
        Math.round((i / input.slideBuffers.length) * 100),
        `Uploaded slide ${i + 1}/${input.slideBuffers.length}`
      );
    }

    log.info({ count: slideUrls.length }, "Slides uploaded to R2");
    return { ...input, slideUrls };
  }
}

// ─── Step 6: GenerateCaptionStep ─────────────────────────────────────────────

const GenerateCaptionInputSchema = UploadSlidesOutputSchema;
const GenerateCaptionOutputSchema = GenerateCaptionInputSchema.extend({
  caption: z.string(),
});

export class GenerateCaptionStep extends BaseStep<
  z.infer<typeof GenerateCaptionInputSchema>,
  z.infer<typeof GenerateCaptionOutputSchema>
> {
  readonly name = "generate-caption";
  readonly inputSchema = GenerateCaptionInputSchema;
  readonly outputSchema = GenerateCaptionOutputSchema;

  override estimatedCostEur(): number { return 0.015; }

  async execute(input: z.infer<typeof GenerateCaptionInputSchema>, ctx: StepContext) {
    const brandVoice = (input.brandTokens as { voice?: { signaturePhrases?: string[]; addressForm?: string } })?.voice;
    const signaturePhrases = brandVoice?.signaturePhrases?.join(", ") ?? "redaktionell verifiziert, ehrlich";
    const addressForm = brandVoice?.addressForm ?? "du";

    const captionPrompt = `Write an Instagram caption in GERMAN for a carousel post about: "${input.articleTitle}"

The post shows ${input.resolvedTools.length} AI tools in a visual list-carousel format.
Brand voice: ${signaturePhrases}. Use "${addressForm}" form. Max 300 characters. Use 1-2 fitting emojis.
End with: Link in Bio → ${input.articleUrl}

Return ONLY the caption text, no JSON.`;

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_CAPTION,
      model: "claude-sonnet-4-6",
      systemPrefix: "",
      systemSuffix: "You are an Instagram content writer. Return only the caption text.",
      userMessage: captionPrompt,
      maxTokens: 800,
      estimatedCostEur: 0.015,
    });

    const caption = response.raw.trim() || `${input.articleTitle} — ${input.articleUrl}`;

    return { ...input, caption };
  }
}

// ─── Step 7: ResearchHashtagsStep ────────────────────────────────────────────

const ResearchHashtagsInputSchema = GenerateCaptionOutputSchema;
const ResearchHashtagsOutputSchema = ResearchHashtagsInputSchema.extend({
  hashtags: z.array(z.string()),
});

export class ResearchHashtagsStep extends BaseStep<
  z.infer<typeof ResearchHashtagsInputSchema>,
  z.infer<typeof ResearchHashtagsOutputSchema>
> {
  readonly name = "research-hashtags";
  readonly inputSchema = ResearchHashtagsInputSchema;
  readonly outputSchema = ResearchHashtagsOutputSchema;

  override estimatedCostEur(): number { return 0.005; }

  async execute(input: z.infer<typeof ResearchHashtagsInputSchema>, ctx: StepContext) {
    const toolNames = input.resolvedTools.map((t) => t.name).join(", ");

    const response = await anthropic.messages({
      projectId: ctx.projectId,
      pipelineRunId: ctx.pipelineRunId,
      operation: COST_OPS.SOCIAL_IMAGE_HASHTAGS,
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: "Return only a JSON array of hashtag strings.",
      userMessage: `Generate 15-20 Instagram hashtags in German and English for a carousel about: "${input.articleTitle}".\nTools featured: ${toolNames}.\nReturn ONLY a JSON array of strings, e.g. ["#KITools","#ArtificialIntelligence"]`,
      maxTokens: 300,
      estimatedCostEur: 0.005,
      jsonMode: true,
    });

    const rawText = response.raw;
    let hashtags: string[] = [];
    try {
      const match = rawText.match(/\[[\s\S]*\]/);
      hashtags = match ? JSON.parse(match[0]) : [];
    } catch {
      hashtags = ["#KITools", "#ArtificialIntelligence", "#Technologie"];
    }

    return { ...input, hashtags: hashtags.slice(0, 20) };
  }
}

// ─── Step 8: PersistSocialPostStep ───────────────────────────────────────────

const PersistInputSchema = ResearchHashtagsOutputSchema;
const PersistOutputSchema = z.object({
  socialPostId: z.string().uuid(),
  slideUrls: z.array(z.string()),
  caption: z.string(),
  hashtags: z.array(z.string()),
  totalSlides: z.number().int(),
});

export class PersistSocialPostStep extends BaseStep<
  z.infer<typeof PersistInputSchema>,
  z.infer<typeof PersistOutputSchema>
> {
  readonly name = "persist-social-post";
  readonly inputSchema = PersistInputSchema;
  readonly outputSchema = PersistOutputSchema;

  override estimatedCostEur(): number { return 0; }

  async execute(input: z.infer<typeof PersistInputSchema>, _ctx: StepContext) {
    const [post] = await db
      .insert(socialPosts)
      .values({
        projectId: input.projectId,
        articleId: input.articleId,
        platform: "instagram",
        format: "carousel",
        status: "draft",
        theme: input.theme,
        totalSlides: input.totalSlides,
        content: {
          kind: "carousel",
          slides: input.slideUrls.map((url) => ({ imageUrl: url })),
          caption: input.caption,
          hashtags: input.hashtags,
        },
        generatedAt: new Date(),
      })
      .returning({ id: socialPosts.id });

    if (!post) throw new Error("Failed to insert social post");

    return {
      socialPostId: post.id,
      slideUrls: input.slideUrls,
      caption: input.caption,
      hashtags: input.hashtags,
      totalSlides: input.totalSlides,
    };
  }
}
