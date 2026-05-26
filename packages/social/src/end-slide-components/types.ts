/**
 * Spec 65.9 — End-Slide System types.
 *
 * 7 v1 end-slide types pluggable as the last frame of any Theme 65 carousel.
 * The `type` discriminator is also the key in `end_slide_definitions.type`
 * and the value listed in `FORMAT_TYPES[<x>].defaultEndSlides`.
 *
 * Each type has a Zod schema for runtime validation of the jsonb `config`
 * column. Pipeline-side and brief-generator-side consumers SHOULD parse the
 * config through these schemas before passing to a component — never trust
 * the column shape.
 *
 * Spec 65.9-followup (migration 0124): locale-binding fields (resourceTitle,
 * description, prompt, message, quote, customMessage, attribution, context,
 * promptText) are stored as `{de, en}` jsonb so a single definition row
 * serves bilingual tenants. Locale-agnostic fields (handle, keyword, url,
 * destination, primaryAction) stay plain strings. The renderer picks the
 * right locale via `pickLocalized(field, locale)` in `localized.ts`.
 */
import { z } from "zod";

export const END_SLIDE_TYPES = [
  "follow-cta",
  "comment-to-get",
  "link-in-bio",
  "tag-friend",
  "save-share-cta",
  "swipe-up",
  "quote-action",
] as const;

export type EndSlideType = (typeof END_SLIDE_TYPES)[number];

// ── Localized text helper ────────────────────────────────────────────────

/**
 * Build a Zod schema for a `{de, en}` localized string with per-locale length
 * bounds. Both locales are required so a renderer never has to deal with a
 * partially-populated row — migration 0124 backfills `{de: existing, en:
 * existing}` for legacy rows; Marcel curates the EN copy later via the
 * Settings UI.
 */
export const localizedString = (min: number, max: number) =>
  z.object({
    de: z.string().min(min).max(max),
    en: z.string().min(min).max(max),
  });

export type LocalizedString = { de: string; en: string };

// ── Per-type config schemas ──────────────────────────────────────────────

export const followCtaConfigSchema = z.object({
  /** Account handle as it should appear on the slide (e.g. "@toolwiki.ai"). */
  handle: z.string().min(1).max(40),
  /** Override the default "Follow for more" headline. */
  customMessage: localizedString(1, 80).optional(),
});
export type FollowCtaConfig = z.infer<typeof followCtaConfigSchema>;

export const commentToGetConfigSchema = z.object({
  /** Single uppercase keyword viewer comments to trigger the resource DM. */
  keyword: z.string().min(2).max(20),
  /** Display title of the resource viewer receives ("Claude Prompts Pack"). */
  resourceTitle: localizedString(2, 80),
  /** Optional override for the "comment <KEYWORD>" instruction line. */
  promptText: localizedString(1, 80).optional(),
});
export type CommentToGetConfig = z.infer<typeof commentToGetConfigSchema>;

export const linkInBioConfigSchema = z.object({
  /** "Full comparison at toolwiki.ai" — the directive line. */
  description: localizedString(2, 120),
  /** Reference URL shown small (carousel links aren't clickable). */
  url: z.string().min(1).max(80).optional(),
});
export type LinkInBioConfig = z.infer<typeof linkInBioConfigSchema>;

export const tagFriendConfigSchema = z.object({
  /** Main prompt: "Wer braucht das?" / "Who needs this?". */
  prompt: localizedString(2, 80),
  /** Secondary hint line that frames who to tag. */
  context: localizedString(2, 120).optional(),
});
export type TagFriendConfig = z.infer<typeof tagFriendConfigSchema>;

export const saveShareConfigSchema = z.object({
  /** Which engagement to visually emphasize. */
  primaryAction: z.enum(["save", "share"]),
  /** Headline ("Save for later", "Share with your team"). */
  message: localizedString(2, 80),
});
export type SaveShareConfig = z.infer<typeof saveShareConfigSchema>;

export const swipeUpConfigSchema = z.object({
  /** Where the viewer is sent — usually the project domain. */
  destination: z.string().min(2).max(80),
  /** Override the default "Visit" headline. */
  customMessage: localizedString(1, 80).optional(),
});
export type SwipeUpConfig = z.infer<typeof swipeUpConfigSchema>;

export const quoteActionConfigSchema = z.object({
  /** Punchy action-verb quote ("Stop scrolling. Test it in 30 seconds."). */
  quote: localizedString(4, 160),
  /** Optional attribution ("— Marcel @ Toolwiki"). */
  attribution: localizedString(1, 60).optional(),
});
export type QuoteActionConfig = z.infer<typeof quoteActionConfigSchema>;

// ── Discriminated union ──────────────────────────────────────────────────

export type EndSlideData =
  | { type: "follow-cta"; config: FollowCtaConfig }
  | { type: "comment-to-get"; config: CommentToGetConfig }
  | { type: "link-in-bio"; config: LinkInBioConfig }
  | { type: "tag-friend"; config: TagFriendConfig }
  | { type: "save-share-cta"; config: SaveShareConfig }
  | { type: "swipe-up"; config: SwipeUpConfig }
  | { type: "quote-action"; config: QuoteActionConfig };

export const endSlideDataSchema: z.ZodType<EndSlideData> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("follow-cta"), config: followCtaConfigSchema }),
  z.object({ type: z.literal("comment-to-get"), config: commentToGetConfigSchema }),
  z.object({ type: z.literal("link-in-bio"), config: linkInBioConfigSchema }),
  z.object({ type: z.literal("tag-friend"), config: tagFriendConfigSchema }),
  z.object({ type: z.literal("save-share-cta"), config: saveShareConfigSchema }),
  z.object({ type: z.literal("swipe-up"), config: swipeUpConfigSchema }),
  z.object({ type: z.literal("quote-action"), config: quoteActionConfigSchema }),
]);

/**
 * Per-type config-schema lookup. Useful when validating a row from
 * `end_slide_definitions` whose `type` was already narrowed to a known value.
 */
export const END_SLIDE_CONFIG_SCHEMAS = {
  "follow-cta": followCtaConfigSchema,
  "comment-to-get": commentToGetConfigSchema,
  "link-in-bio": linkInBioConfigSchema,
  "tag-friend": tagFriendConfigSchema,
  "save-share-cta": saveShareConfigSchema,
  "swipe-up": swipeUpConfigSchema,
  "quote-action": quoteActionConfigSchema,
} as const satisfies Record<EndSlideType, z.ZodTypeAny>;

export type EndSlideLocale = "de" | "en";
export type EndSlideTheme = "dark" | "light";

/**
 * Shape passed from the carousel composition into each slide component.
 * Parents resolve and derive tokens once, then pass the typed `EndSlideData`
 * to `<HostSlide>` which dispatches to the right concrete component.
 */
export interface EndSlideProps<T extends EndSlideData = EndSlideData> {
  data: T;
  theme: EndSlideTheme;
  locale: EndSlideLocale;
  /** Loosely-typed brandTokens (resolved via `resolveBrandTokens` internally). */
  brandTokens?: unknown;
}
