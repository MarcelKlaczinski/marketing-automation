-- Spec 52b: Brand-Asset Management UI
-- 1. Add r2_key column for custom uploads to project_brand_assets
-- 2. Add 'replaced' value to social_status enum for re-render audit trail

ALTER TABLE "project_brand_assets"
  ADD COLUMN "r2_key" TEXT;

-- PostgreSQL requires adding enum values in a separate ALTER TYPE statement
ALTER TYPE "social_status" ADD VALUE IF NOT EXISTS 'replaced';
