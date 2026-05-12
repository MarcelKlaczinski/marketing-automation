-- Spec 51: Extend social_posts for programmatic slide generation
-- Adds theme, total_slides, cost tracking, and generated_at timestamp

ALTER TABLE "social_posts"
  ADD COLUMN "theme"        text NOT NULL DEFAULT 'dark',
  ADD COLUMN "total_slides" integer,
  ADD COLUMN "cost_eur"     numeric(10, 4) NOT NULL DEFAULT 0,
  ADD COLUMN "generated_at" timestamptz;
