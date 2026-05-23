-- Spec multi-domain-evolution S4.2: aufweichen articles.collection_type from
-- pgEnum to text. Per-tenant validation moves to the Domain-Registry (Sprint
-- 5); the Drizzle `.$type<ArticleCollectionType>()` narrowing keeps TS
-- safety at write sites for Toolwiki.
--
-- The pgEnum type `article_collection_type` is NOT dropped. Other code
-- paths may still reference its values via `articleCollectionTypeEnum.
-- enumValues`. Keeping the type costs nothing and is reversible if a
-- future spec wants to re-tighten the constraint.
--
-- Sequence (D124 + db/CLAUDE.md "DO NOT drop a PostgreSQL enum directly
-- if the column has a DEFAULT"):
--   1. DROP DEFAULT   ← unbinds the enum type from the column default
--   2. SET DATA TYPE text USING …::text  ← cast values to text
--   3. SET DEFAULT 'blog'  ← restore the default with the new type
--   4. (enum type stays — other modules may reference enumValues)

ALTER TABLE "articles" ALTER COLUMN "collection_type" DROP DEFAULT;
ALTER TABLE "articles"
  ALTER COLUMN "collection_type" SET DATA TYPE text
  USING "collection_type"::text;
ALTER TABLE "articles" ALTER COLUMN "collection_type" SET DEFAULT 'blog';

COMMENT ON COLUMN "articles"."collection_type" IS
  'Spec multi-domain-evolution S4.2: text (was pgEnum article_collection_type). Drizzle .$type<ArticleCollectionType>() narrowing preserves TS safety at write sites for Toolwiki; per-tenant value set widens via Domain-Registry in Sprint 5. The pgEnum type is preserved for back-compat (other code may reference enumValues).';
