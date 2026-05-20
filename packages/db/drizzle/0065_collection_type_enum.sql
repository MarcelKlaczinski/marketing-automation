-- Migration 0065: Replace articles.collection_type text column with proper PostgreSQL enum.
-- Spec 61.1 — Collection Type Foundation
--
-- Strategy: add new enum column alongside the old text column, backfill from existing
-- data, drop old column, rename new one. This avoids altering a live column in-place.

CREATE TYPE article_collection_type AS ENUM (
  'blog',
  'comparison',
  'ki-wissen',
  'tools',
  'usecases'
);

-- Add new typed column (defaults to 'blog' for all existing rows)
ALTER TABLE articles
  ADD COLUMN collection_type_enum article_collection_type NOT NULL DEFAULT 'blog';

-- Backfill rows whose existing text value maps to the new enum
UPDATE articles
  SET collection_type_enum = collection_type::article_collection_type
  WHERE collection_type IN ('blog', 'comparison', 'ki-wissen', 'tools', 'usecases');

-- Drop old text column, rename new enum column to take its place
ALTER TABLE articles DROP COLUMN collection_type;
ALTER TABLE articles RENAME COLUMN collection_type_enum TO collection_type;
