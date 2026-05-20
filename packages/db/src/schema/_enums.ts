import { pgEnum } from "drizzle-orm/pg-core";

export const lifecycleStageEnum = pgEnum("lifecycle_stage", [
  "cold_start",
  "pre_launch",
  "launch",
  "growth",
  "mature",
]);

export const pipelineTemplateEnum = pgEnum("pipeline_template", [
  "educational",
  "affiliate_review",
  "local_business",
  "programmatic_seo",
]);

export const industryEnum = pgEnum("industry", [
  "ai_education",
  "automotive_dealer",
  "renewable_affiliate",
  "music_school",
  "other",
]);

export const articleStatusEnum = pgEnum("article_status", [
  "proposed",
  "approved",
  "generating",
  "outline_review",
  "drafting",
  "final_review",
  "schema_extending",
  "ready_to_publish",
  "validating",
  "published",
  "blocked_by_pagespeed",
  "failed",
  "rejected",
]);

export const socialPlatformEnum = pgEnum("social_platform", [
  "instagram",
  "tiktok",
  "linkedin",
  "twitter",
]);

export const socialFormatEnum = pgEnum("social_format", [
  "carousel",
  "reel",
  "single_image",
  "story",
]);

export const socialStatusEnum = pgEnum("social_status", [
  "draft",
  "in_review",
  "approved",
  "scheduled",
  "published",
  "failed",
  "replaced",  // Spec 52b: old post superseded by re-render
]);

export const socialRenderStatusEnum = pgEnum("social_render_status", [
  "pending",
  "rendering",
  "rendered",
  "failed",
]);

export const credentialServiceEnum = pgEnum("credential_service", [
  "google_analytics",
  "google_search_console",
  "google_adsense",
  "instagram_graph",
  "github_deploy",
  "astro_deploy_webhook",
]);

export const costServiceEnum = pgEnum("cost_service", [
  "anthropic",
  "replicate",
  "dataforseo",
  "smtp",
  "voyage",
]);

export const pipelineRunStatusEnum = pgEnum("pipeline_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const approvalActionEnum = pgEnum("approval_action", [
  "requested",
  "approved",
  "rejected",
  "changes_requested",
]);

export const userRoleEnum = pgEnum("user_role", ["owner", "editor"]);

export const articleSourceEnum = pgEnum("article_source", ["generated", "imported"]);

export const cornerstoneSpecStatusEnum = pgEnum("cornerstone_spec_status", [
  "proposed",
  "approved",
  "in_generation",
  "article_done",
  "rejected",
]);

export const refreshSuggestionSourceEnum = pgEnum("refresh_suggestion_source", [
  "time",
  "quality",
]);

export const articleCollectionTypeEnum = pgEnum("article_collection_type", [
  "blog",
  "comparison",
  "ki-wissen",
  "tools",
  "usecases",
]);
