import { index, jsonb, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

export const projectBrandAssets = pgTable(
  "project_brand_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    assetType: text("asset_type").notNull(), // 'logo' | 'tool_icon' | 'background_pattern'
    assetKey: text("asset_key").notNull(),   // for tool_icon: tool-slug; for logo: 'main' | 'wordmark' | 'submark'

    source: text("source").notNull(),       // 'lobe-icons' | 'r2' | 'inline-svg' | 'deterministic-avatar'
    sourceRef: text("source_ref"),          // for lobe-icons: 'midjourney-color'; for r2: 'brand-assets/toolwiki/logo.svg'
    inlineSvg: text("inline_svg"),          // raw SVG string for source='inline-svg'

    displayName: text("display_name"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    projectTypeUnique: unique("project_brand_assets_unique").on(t.projectId, t.assetType, t.assetKey),
    projectTypeIdx: index("brand_assets_project_type_idx").on(t.projectId, t.assetType),
  })
);

export type ProjectBrandAsset = typeof projectBrandAssets.$inferSelect;
export type NewProjectBrandAsset = typeof projectBrandAssets.$inferInsert;
