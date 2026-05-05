CREATE TYPE "public"."approval_action" AS ENUM('requested', 'approved', 'rejected', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM('planned', 'researching', 'drafting', 'in_review', 'approved', 'published', 'needs_refresh', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."cost_service" AS ENUM('anthropic', 'replicate', 'dataforseo', 'elevenlabs', 'resend');--> statement-breakpoint
CREATE TYPE "public"."credential_service" AS ENUM('google_analytics', 'google_search_console', 'google_adsense', 'instagram_graph', 'github_deploy', 'astro_deploy_webhook');--> statement-breakpoint
CREATE TYPE "public"."industry" AS ENUM('ai_education', 'automotive_dealer', 'renewable_affiliate', 'music_school', 'other');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_stage" AS ENUM('cold_start', 'pre_launch', 'launch', 'growth', 'mature');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pipeline_template" AS ENUM('educational', 'affiliate_review', 'local_business', 'programmatic_seo');--> statement-breakpoint
CREATE TYPE "public"."social_format" AS ENUM('carousel', 'reel', 'single_image', 'story');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('instagram', 'tiktok', 'linkedin', 'twitter');--> statement-breakpoint
CREATE TYPE "public"."social_status" AS ENUM('draft', 'in_review', 'approved', 'scheduled', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'editor');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"service" "credential_service" NOT NULL,
	"encrypted_payload" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_credentials_project_service_unique" UNIQUE("project_id","service")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" "industry" NOT NULL,
	"lifecycle_stage" "lifecycle_stage" DEFAULT 'cold_start' NOT NULL,
	"pipeline_template" "pipeline_template" NOT NULL,
	"brand_identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cms_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monetization_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pipeline_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_voices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"system_prompt" text NOT NULL,
	"example_paragraphs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"pillar_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_keyword" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"pillar_article_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_pillars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"draft_md" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"cluster_id" uuid,
	"status" "article_status" DEFAULT 'planned' NOT NULL,
	"topic" text NOT NULL,
	"primary_keyword" text,
	"secondary_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title" text,
	"slug" text,
	"meta_description" text,
	"draft_md" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hero_image_url" text,
	"hero_image_prompt" text,
	"research_data" jsonb,
	"generation_log" jsonb DEFAULT '{"steps":[]}'::jsonb NOT NULL,
	"published_url" text,
	"published_at" timestamp with time zone,
	"embedding" vector(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"article_id" uuid,
	"platform" "social_platform" NOT NULL,
	"format" "social_format" NOT NULL,
	"status" "social_status" DEFAULT 'draft' NOT NULL,
	"content" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_url" text,
	"metrics" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"article_id" uuid,
	"social_post_id" uuid,
	"action" "approval_action" NOT NULL,
	"comment" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "briefings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"briefing_md" text NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"service" "cost_service" NOT NULL,
	"operation" text NOT NULL,
	"cost_eur" numeric(10, 6) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pipeline_run_id" uuid,
	"article_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"pipeline_name" text NOT NULL,
	"step_name" text,
	"status" "pipeline_run_status" DEFAULT 'queued' NOT NULL,
	"job_id" text,
	"parent_run_id" uuid,
	"input" jsonb,
	"output" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "magic_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "user_role" DEFAULT 'editor' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_credentials" ADD CONSTRAINT "project_credentials_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "brand_voices" ADD CONSTRAINT "brand_voices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clusters" ADD CONSTRAINT "clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clusters" ADD CONSTRAINT "clusters_pillar_id_content_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."content_pillars"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "articles" ADD CONSTRAINT "articles_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approvals" ADD CONSTRAINT "approvals_social_post_id_social_posts_id_fk" FOREIGN KEY ("social_post_id") REFERENCES "public"."social_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "briefings" ADD CONSTRAINT "briefings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_logs" ADD CONSTRAINT "cost_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_credentials_project_idx" ON "project_credentials" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_slug_idx" ON "projects" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_voices_project_idx" ON "brand_voices" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_voices_active_idx" ON "brand_voices" USING btree ("project_id","is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clusters_project_idx" ON "clusters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clusters_pillar_idx" ON "clusters" USING btree ("pillar_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_pillars_project_idx" ON "content_pillars" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "article_versions_article_idx" ON "article_versions" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_project_idx" ON "articles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_status_idx" ON "articles" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_cluster_idx" ON "articles" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_slug_idx" ON "articles" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "articles_embedding_idx" ON "articles" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_project_idx" ON "social_posts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_status_idx" ON "social_posts" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_scheduled_idx" ON "social_posts" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "social_posts_article_idx" ON "social_posts" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_project_idx" ON "approvals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_article_idx" ON "approvals" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approvals_social_post_idx" ON "approvals" USING btree ("social_post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "briefings_project_date_idx" ON "briefings" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_logs_project_service_time_idx" ON "cost_logs" USING btree ("project_id","service","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_logs_project_time_idx" ON "cost_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_logs_pipeline_run_idx" ON "cost_logs" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_runs_project_idx" ON "pipeline_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_runs_status_idx" ON "pipeline_runs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pipeline_runs_pipeline_idx" ON "pipeline_runs" USING btree ("pipeline_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "magic_link_tokens_hash_idx" ON "magic_link_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "magic_link_tokens_expires_idx" ON "magic_link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");