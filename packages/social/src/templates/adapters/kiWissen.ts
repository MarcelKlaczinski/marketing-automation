import type { Article } from "@marketing-auto/db";

export interface KiWissenContext {
  title: string;
  category?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  keyTakeaways: string[];
  relatedTools: string[];
}

interface KiWissenExtras {
  category?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";
  keyTakeaways?: string[];
  relatedTools?: string[];
}

export function getKiWissenContext(article: Article): KiWissenContext {
  if (article.collection !== "blog") {
    throw new Error(`Article "${article.slug}" is not in the blog collection`);
  }

  const extras = (article.domainExtras ?? {}) as KiWissenExtras;

  return {
    title: article.title ?? article.slug,
    keyTakeaways: extras.keyTakeaways ?? [],
    relatedTools: extras.relatedTools ?? [],
    ...(extras.category !== undefined && { category: extras.category }),
    ...(extras.difficulty !== undefined && { difficulty: extras.difficulty }),
  };
}
