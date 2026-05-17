-- Spec 57.1 Part B: make social_posts.locale NOT NULL with default 'de-DE',
-- backfill existing rows, and add lookup index for (article_id, locale, status).

-- Step 1: backfill NULLs so the NOT NULL constraint can be applied
UPDATE social_posts SET locale = 'de-DE' WHERE locale IS NULL;

-- Step 2: enforce NOT NULL + default
ALTER TABLE social_posts
  ALTER COLUMN locale SET NOT NULL,
  ALTER COLUMN locale SET DEFAULT 'de-DE';

-- Step 3: index for efficient per-article per-locale queries
CREATE INDEX IF NOT EXISTS social_posts_article_locale_status_idx
  ON social_posts (article_id, locale, status);
