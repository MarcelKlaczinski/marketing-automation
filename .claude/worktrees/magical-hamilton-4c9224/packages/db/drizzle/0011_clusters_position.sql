-- Spec 37: Add position column to clusters for ordering within a pillar
ALTER TABLE "clusters"
  ADD COLUMN "position" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Backfill: order existing clusters within each pillar by created_at
UPDATE "clusters" SET "position" = sub.row_num - 1
FROM (
  SELECT id, row_number() OVER (PARTITION BY pillar_id ORDER BY created_at) AS row_num
  FROM "clusters"
) sub
WHERE "clusters".id = sub.id;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "clusters_pillar_position_idx" ON "clusters" USING btree ("pillar_id", "position");
