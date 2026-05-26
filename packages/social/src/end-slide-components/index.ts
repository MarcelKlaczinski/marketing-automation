/**
 * Spec 65.9 — End-Slide System barrel.
 *
 * Public surface consumed by:
 *   - 65.7 carousel templates (`<HostSlide data={...} theme={...} locale={...} brandTokens={...} />`)
 *   - 65.5 brief-generators (`EndSlideData` type for the renderPayload.endSlide field)
 *   - 65.9 selector helper in `apps/api/src/lib/recurring-content/.../select-end-slide.ts`
 *     (`END_SLIDE_TYPES`, `END_SLIDE_CONFIG_SCHEMAS`)
 */
export { HostSlide } from "./HostSlide";
export { EndSlideBase } from "./shared/EndSlideBase";
export type { EndSlideBaseProps } from "./shared/EndSlideBase";

export { FollowCtaSlide } from "./FollowCtaSlide";
export { CommentToGetSlide } from "./CommentToGetSlide";
export { LinkInBioSlide } from "./LinkInBioSlide";
export { TagFriendSlide } from "./TagFriendSlide";
export { SaveShareSlide } from "./SaveShareSlide";
export { SwipeUpSlide } from "./SwipeUpSlide";
export { QuoteActionSlide } from "./QuoteActionSlide";

export {
  END_SLIDE_TYPES,
  END_SLIDE_CONFIG_SCHEMAS,
  endSlideDataSchema,
  followCtaConfigSchema,
  commentToGetConfigSchema,
  linkInBioConfigSchema,
  tagFriendConfigSchema,
  saveShareConfigSchema,
  swipeUpConfigSchema,
  quoteActionConfigSchema,
} from "./types";

export type {
  EndSlideType,
  EndSlideTheme,
  EndSlideLocale,
  EndSlideData,
  EndSlideProps,
  FollowCtaConfig,
  CommentToGetConfig,
  LinkInBioConfig,
  TagFriendConfig,
  SaveShareConfig,
  SwipeUpConfig,
  QuoteActionConfig,
} from "./types";
