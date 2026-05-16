ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "tool_pricing" TEXT,
  ADD COLUMN IF NOT EXISTS "tool_price_from" NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "tool_rating" NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS "tool_votes" INTEGER,
  ADD COLUMN IF NOT EXISTS "tool_affiliate_slug" TEXT,
  ADD COLUMN IF NOT EXISTS "tool_website" TEXT;

CREATE INDEX IF NOT EXISTS "articles_tool_pricing_idx"
  ON "articles"("project_id", "tool_pricing")
  WHERE collection = 'tools';

CREATE INDEX IF NOT EXISTS "articles_tool_rating_idx"
  ON "articles"("project_id", "tool_rating" DESC NULLS LAST)
  WHERE collection = 'tools';

CREATE INDEX IF NOT EXISTS "articles_tool_price_from_idx"
  ON "articles"("project_id", "tool_price_from" NULLS LAST)
  WHERE collection = 'tools';
