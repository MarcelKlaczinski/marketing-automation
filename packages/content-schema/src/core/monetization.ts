import { z } from "zod";

// ───── monetizationCore (Bucket B per Phase-1 §3) ─────────────────────────────
//
// Monetization toggles factored as a factory because defaults vary per
// content type — blog posts default to AdSense + affiliate links, ki-wissen
// knowledge articles default to neither, comparison articles to affiliate
// links only. Each Astro collection in the consumer repo calls this with
// its own defaults.

export const AdsenseSlotSchema = z.enum(["top", "mid", "bottom"]);
export type AdsenseSlot = z.infer<typeof AdsenseSlotSchema>;

export type AdsenseSlotsValue = false | AdsenseSlot[];

/**
 * Composable monetization schema. `defaultSlots` controls the column-default
 * for `adsenseSlots`; `defaultAffiliate` does the same for `hasAffiliateLinks`.
 */
export const monetizationCore = (
  defaultSlots: AdsenseSlotsValue,
  defaultAffiliate: boolean,
) =>
  z.object({
    adsenseSlots: z
      .union([z.literal(false), z.array(AdsenseSlotSchema)])
      .default(defaultSlots),
    hasAffiliateLinks: z.boolean().default(defaultAffiliate),
  });
