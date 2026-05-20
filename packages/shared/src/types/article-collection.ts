export const ARTICLE_COLLECTION_TYPES = [
  "blog",
  "comparison",
  "ki-wissen",
  "tools",
  "usecases",
] as const;

export type ArticleCollectionType = (typeof ARTICLE_COLLECTION_TYPES)[number];

export function isArticleCollectionType(v: unknown): v is ArticleCollectionType {
  return ARTICLE_COLLECTION_TYPES.includes(v as ArticleCollectionType);
}
