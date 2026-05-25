/**
 * Spec 65.1 — Engagement Resources
 *
 * PDFs, prompt-lists, link-resources used by the comment-to-get end-slide
 * pattern: end-user comments a `keyword` ("CLAUDE", "PROMPT", "FREE"), the
 * 65.13 ManyChat flow DMs the matching `file_url`.
 *
 * Project-scoped (Memory D5). The (project_id, keyword) UNIQUE constraint
 * enforces that each keyword maps to exactly one resource per tenant — Marcel
 * needs deterministic routing for the DM responder.
 *
 * `manychat_flow_id` is the forward-compat anchor for 65.13 auto-DM
 * integration; populated by the ManyChat sync helper, NULL until then.
 */
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.ts";

export type EngagementResourceType = "pdf" | "link" | "prompt-list";

export const engagementResources = pgTable(
  "engagement_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    title: text("title").notNull(),
    /** R2 storage key for PDF/prompt-list; absolute URL for resource_type='link'. */
    fileUrl: text("file_url").notNull(),
    /** Comment-trigger keyword (typically uppercase: "CLAUDE", "PROMPT", "FREE"). */
    keyword: text("keyword").notNull(),
    resourceType: text("resource_type").notNull().$type<EngagementResourceType>(),

    /** ManyChat flow ID for future auto-DM integration (65.13). NULL until synced. */
    manychatFlowId: text("manychat_flow_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keywordPerProjectUniq: uniqueIndex("uniq_engagement_resources_keyword_per_project").on(
      t.projectId,
      t.keyword
    ),
    projectTypeIdx: index("idx_engagement_resources_type").on(t.projectId, t.resourceType),
  })
);

export type EngagementResource = typeof engagementResources.$inferSelect;
export type NewEngagementResource = typeof engagementResources.$inferInsert;
