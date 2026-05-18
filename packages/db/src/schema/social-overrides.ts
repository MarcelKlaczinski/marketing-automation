import { index, jsonb, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { pgTable } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

export const projectTemplateOverrides = pgTable(
  "project_template_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    templateKey: varchar("template_key", { length: 64 }).notNull(),
    values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueProjectTemplate: uniqueIndex("project_template_overrides_project_template_key").on(
      t.projectId,
      t.templateKey,
    ),
    projectIdIdx: index("project_template_overrides_project_id_idx").on(t.projectId),
  }),
);

export type ProjectTemplateOverride = typeof projectTemplateOverrides.$inferSelect;
export type NewProjectTemplateOverride = typeof projectTemplateOverrides.$inferInsert;
