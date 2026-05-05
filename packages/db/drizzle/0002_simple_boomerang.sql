ALTER TABLE "public"."cost_logs" ALTER COLUMN "service" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."cost_service";--> statement-breakpoint
CREATE TYPE "public"."cost_service" AS ENUM('anthropic', 'replicate', 'dataforseo', 'elevenlabs', 'smtp');--> statement-breakpoint
ALTER TABLE "public"."cost_logs" ALTER COLUMN "service" SET DATA TYPE "public"."cost_service" USING "service"::"public"."cost_service";