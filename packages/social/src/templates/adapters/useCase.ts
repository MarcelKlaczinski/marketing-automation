import type { Article } from "@marketing-auto/db";
import type { UseCaseVerdict } from "./types.ts";

export interface UseCaseContext {
  title: string;
  verdicts: UseCaseVerdict[];
  summary?: string;
}

interface UseCaseExtras {
  verdicts?: UseCaseVerdict[];
  summary?: string;
}

export function getUseCaseContext(article: Article): UseCaseContext {
  if (article.collection !== "use-cases") {
    throw new Error(`Article "${article.slug}" is not in the use-cases collection`);
  }

  const extras = (article.frontmatterExtras ?? {}) as UseCaseExtras;

  return {
    title: article.title ?? article.slug,
    verdicts: extras.verdicts ?? [],
    ...(extras.summary !== undefined && { summary: extras.summary }),
  };
}
