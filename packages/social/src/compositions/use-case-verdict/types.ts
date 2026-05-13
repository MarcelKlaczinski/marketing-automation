import { z } from "zod";

export const useCaseVerdictToolSchema = z.object({
  slug: z.string(),
  name: z.string(),
  iconSvg: z.string().optional(),
  iconInitials: z.string().optional(),
  iconHue: z.number().optional(),
});

export type UseCaseVerdictTool = z.infer<typeof useCaseVerdictToolSchema>;

export const useCaseVerdictItemSchema = z.object({
  useCase: z.string(),
  winner: z.string(),
  reason: z.string(),
  score: z.number().optional(),
});

export type UseCaseVerdictItem = z.infer<typeof useCaseVerdictItemSchema>;

export const tallyEntrySchema = z.object({
  slug: z.string(),
  count: z.number().int(),
});

export type TallyEntry = z.infer<typeof tallyEntrySchema>;

export const useCaseVerdictInputSchema = z.object({
  theme: z.enum(["dark", "light"]).default("dark"),
  locale: z.enum(["de", "en"]).default("de"),
  slideIndex: z.number().int().default(0),
  websiteUrl: z.string().default("toolwiki.ai"),
  instagramHandle: z.string().default("@toolwiki.ai"),
  articleSlug: z.string().default(""),
  tools: z.array(useCaseVerdictToolSchema).min(2),
  verdicts: z.array(useCaseVerdictItemSchema).min(1),
});

export type UseCaseVerdictInput = z.infer<typeof useCaseVerdictInputSchema>;
