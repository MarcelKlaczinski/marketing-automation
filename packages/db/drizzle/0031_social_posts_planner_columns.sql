-- Spec 54k: add templateKey + locale to social_posts for content planner queries
-- templateKey: which template produced this post (e.g. "single-tool-spotlight")
--              enables "article X + templateKey = already rendered" dedup check
-- locale: which locale was rendered ("de" | "en")

ALTER TABLE "social_posts"
  ADD COLUMN "template_key" text,
  ADD COLUMN "locale" text;

CREATE INDEX "social_posts_template_key_idx" ON "social_posts" ("project_id", "template_key");
CREATE INDEX "social_posts_article_template_idx" ON "social_posts" ("article_id", "template_key", "locale");
