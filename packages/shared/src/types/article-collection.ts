/**
 * Back-compat re-export. Canonical home since Spec multi-domain-evolution
 * S2.3 is `@marketing-auto/content-schema/enums`. Consumers can migrate
 * their imports at their own pace; the re-export will be dropped after
 * the BK launch (per spec §10 Q3 default: additive migration).
 */
export {
  ARTICLE_COLLECTION_TYPES,
  type ArticleCollectionType,
  isArticleCollectionType,
} from "@marketing-auto/content-schema/enums";
