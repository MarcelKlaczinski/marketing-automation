-- Audit cleanup: Remove unused 'elevenlabs' value from cost_service enum.
-- No adapter-elevenlabs exists; no pipeline step ever calls ElevenLabs.

--> statement-breakpoint
ALTER TABLE "cost_logs" ALTER COLUMN "service" SET DATA TYPE text USING "service"::text;
--> statement-breakpoint
DROP TYPE "public"."cost_service";
--> statement-breakpoint
CREATE TYPE "public"."cost_service" AS ENUM (
  'anthropic',
  'replicate',
  'dataforseo',
  'smtp'
);
--> statement-breakpoint
ALTER TABLE "cost_logs" ALTER COLUMN "service" SET DATA TYPE "public"."cost_service" USING "service"::"public"."cost_service";
