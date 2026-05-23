import { z } from "zod";

// ───── seoCore (Bucket A+B per Phase-1 §3) ────────────────────────────────────
//
// Universal SEO fields shared across every Astro content collection. Matches
// the live Toolwiki Astro schema's `seoBase` plus the Phase-1 recommended
// `imagePath` regex.

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const imagePath = z
  .string()
  .regex(/^(https?:\/\/|\/)/i, "image must start with '/' or 'https://'");

export const FaqItemSchema = z.object({
  question: z.string().min(2),
  answer: z.string().min(5),
});

export const seoCore = z.object({
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(180).optional(),
  canonical: z.string().url().optional(),
  noindex: z.boolean().default(false),
  preconnect: z.array(z.string().url()).optional(),
  imagePrompt: z.string().optional(),
  speakable: z.boolean().default(false),
  faq: z.array(FaqItemSchema).max(15).optional(),
});
export type SeoCore = z.infer<typeof seoCore>;
