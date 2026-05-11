ALTER TABLE "projects" ADD COLUMN "target_niche" text;

-- Set known niches for existing projects
UPDATE "projects" SET "target_niche" = 'ai-tool-wiki' WHERE "slug" = 'toolwiki';
