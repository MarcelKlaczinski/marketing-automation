-- Spec 51: Project Brand Assets + Brand Tokens
-- Enables social-image generation with per-project visual identity

CREATE TABLE "project_brand_assets" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id"   uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,

  "asset_type"   text NOT NULL,
  "asset_key"    text NOT NULL,

  "source"       text NOT NULL,
  "source_ref"   text,
  "inline_svg"   text,

  "display_name" text,
  "metadata"     jsonb NOT NULL DEFAULT '{}',

  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),

  UNIQUE("project_id", "asset_type", "asset_key")
);

CREATE INDEX "brand_assets_project_type_idx" ON "project_brand_assets"("project_id", "asset_type");

-- Brand tokens column on projects (OKLCH colors, typography, voice, social handles)
ALTER TABLE "projects" ADD COLUMN "brand_tokens" jsonb NOT NULL DEFAULT '{}';

-- Seed toolwiki brand tokens
UPDATE "projects" SET "brand_tokens" = '{
  "colors": {
    "primary":     "oklch(64% 0.16 248)",
    "primaryHue":  248,
    "accent":      "oklch(72% 0.15 168)",
    "surface":     "#ffffff",
    "surfaceDark": "oklch(16% 0.02 250)",
    "ink":         "oklch(20% 0.025 250)",
    "inkMuted":    "oklch(45% 0.025 250)",
    "wikiCream":   "#fef9ec"
  },
  "typography": {
    "fontFamily":            "Inter Variable",
    "headingWeight":         800,
    "bodyWeight":            400,
    "eyebrowLetterSpacing":  "0.08em"
  },
  "voice": {
    "locale":          "de-DE",
    "addressForm":     "du",
    "forbiddenWords":  ["innovativ", "revolutionär", "bahnbrechend"],
    "signaturePhrases": ["redaktionell verifiziert", "ohne hype", "ehrlich"]
  },
  "social": {
    "instagramHandle": "@toolwiki.ai",
    "websiteUrl":      "toolwiki.ai",
    "logoAssetKey":    "main"
  }
}'::jsonb
WHERE "slug" = 'toolwiki';
