import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { isNull } from "drizzle-orm";
import { users } from "./auth.ts";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnreadIdx: index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt)
      .where(isNull(t.readAt)),
    userCreatedIdx: index("notifications_user_created_idx").on(t.userId, t.createdAt),
  })
);
