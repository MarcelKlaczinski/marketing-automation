import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

export const brandVoices = pgTable("brand_voices", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  exampleParagraphs: jsonb("example_paragraphs").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("brand_voices_project_idx").on(t.projectId),
  activeIdx: index("brand_voices_active_idx").on(t.projectId, t.isActive),
}));

export const contentPillars = pgTable("content_pillars", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("content_pillars_project_idx").on(t.projectId),
}));

// SatelliteKeywordEntry: maps one cornerstone keyword to its satellite keywords.
// Stored in clusters.satelliteKeywords as an array (one entry per cornerstone in the cluster).
export type SatelliteKeywordEntry = {
  cornerstoneKeyword: string;
  keywords: Array<{ keyword: string; searchVolume?: number | null; difficulty?: number | null }>;
};

export const clusters = pgTable("clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  pillarId: uuid("pillar_id").notNull().references(() => contentPillars.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  // Denormalized pillar name — allows TopicIntakeStep to read cluster context without a join
  pillar: text("pillar"),
  primaryKeyword: text("primary_keyword"),
  // Cornerstone keywords belonging to this cluster (from cold-start cluster-plan output)
  cornerstoneKeywords: jsonb("cornerstone_keywords").$type<string[]>().notNull().default([]),
  // Satellite keywords keyed by cornerstone — used by ResearchStep and OutlineStep
  satelliteKeywords: jsonb("satellite_keywords").$type<SatelliteKeywordEntry[]>().notNull().default([]),
  status: text("status").notNull().default("proposed"),
  pillarArticleId: uuid("pillar_article_id"),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  projectIdx: index("clusters_project_idx").on(t.projectId),
  pillarIdx: index("clusters_pillar_idx").on(t.pillarId),
  pillarPositionIdx: index("clusters_pillar_position_idx").on(t.pillarId, t.position),
}));
