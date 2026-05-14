import type { HookPattern } from "./hookEngine.ts";

interface HookPartial {
  leadPhrase: string;
  highlightWord: string;
  trailPhrase: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: string[];
}

const FORBIDDEN_WORDS = [
  "innovativ",
  "revolutionär",
  "bahnbrechend",
  "einzigartig",
  "ultimativ",
  "erstaunlich",
  "unglaublich",
  "fantastisch",
  "genial",
];

export function validateHook(hook: HookPartial, pattern: HookPattern): ValidationResult {
  const violations: string[] = [];
  const fullText = `${hook.leadPhrase} ${hook.highlightWord} ${hook.trailPhrase}`.trim();

  const wordCount = fullText.split(/\s+/).length;
  if (wordCount > 7) violations.push(`fullText has ${wordCount} words, max 7`);
  if (wordCount < 3) violations.push(`fullText has ${wordCount} words, min 3`);

  const highlightWords = hook.highlightWord.trim().split(/\s+/).length;
  if (highlightWords > 2) violations.push(`highlightWord has ${highlightWords} words, max 2`);
  if (highlightWords < 1 || !hook.highlightWord.trim()) violations.push("highlightWord must not be empty");

  if (!/^[A-ZÄÖÜ]/.test(hook.leadPhrase)) violations.push("leadPhrase must start with capital letter");

  const lowercaseFull = fullText.toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(lowercaseFull)) {
      violations.push(`contains forbidden word: ${word}`);
    }
  }

  if (pattern === "superlative_question" && !fullText.includes("?")) {
    violations.push("superlative_question must contain a question mark");
  }

  if (
    pattern === "negative_frame" &&
    !/^(hör auf|stop|nicht|kein)/i.test(hook.leadPhrase.trim())
  ) {
    violations.push("negative_frame leadPhrase must start with negation (Hör auf, Stop, Nicht, Kein)");
  }

  return { valid: violations.length === 0, violations };
}
