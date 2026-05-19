import { z } from "zod";
import { brandTokensSchema } from "../list-carousel/types.ts";

export const proConVerdictInputSchema = z.object({
  slideIndex: z.number().int().min(0).default(0),
  theme: z.enum(["dark", "light"]).default("dark"),
  locale: z.enum(["de", "en"]).default("de"),
  brandTokens: brandTokensSchema.default({}),
  totalSlides: z.number().int().min(4).max(5).default(5),
  overrides: z.record(z.unknown()).optional(),
  tool: z.object({
    name: z.string().min(1),
    logoUrl: z.string().url().optional(),
  }),
  pros: z.array(z.string().min(5).max(120)).min(3).max(5),
  cons: z.array(z.string().min(5).max(120)).min(3).max(5),
  verdict: z.object({
    snippet: z.string().min(20).max(120),
    whenToUse: z.string().min(30).max(280),
    whenToSkip: z.string().min(30).max(280),
  }).nullable(),
});

export type ProConVerdictInput = z.infer<typeof proConVerdictInputSchema>;
