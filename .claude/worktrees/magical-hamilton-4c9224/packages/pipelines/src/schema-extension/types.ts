import { z } from "zod";

export const FaqQuestionSchema = z.object({
  question: z.string().min(5).max(300),
  answer: z.string().min(10).max(2000),
});
export type FaqQuestion = z.infer<typeof FaqQuestionSchema>;

export const HowToStepSchema = z.object({
  name: z.string().min(3).max(200),
  text: z.string().min(10).max(1000),
});
export type HowToStep = z.infer<typeof HowToStepSchema>;

export const DetectionResultSchema = z.object({
  hasFaq: z.boolean(),
  hasHowTo: z.boolean(),
  faqQuestions: z.array(FaqQuestionSchema).default([]),
  howToSteps: z.array(HowToStepSchema).default([]),
  howToName: z.string().nullable().default(null),
  howToTotalTime: z.string().nullable().default(null),
});
export type DetectionResult = z.infer<typeof DetectionResultSchema>;

export class SchemaExtensionError extends Error {
  constructor(
    message: string,
    public readonly stage: "load" | "detect" | "build" | "persist",
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "SchemaExtensionError";
  }
}
