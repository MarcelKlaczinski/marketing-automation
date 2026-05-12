#!/usr/bin/env bun
import { db, users } from "@marketing-auto/db";

const email = process.argv[2];
const name = process.argv[3] ?? null;
const rawRole = process.argv[4] ?? "owner";

if (!email) {
  console.error("Usage: bun src/scripts/add-user.ts <email> [name] [owner|editor]");
  process.exit(1);
}

if (rawRole !== "owner" && rawRole !== "editor") {
  console.error(`Invalid role "${rawRole}". Must be "owner" or "editor".`);
  process.exit(1);
}

const role = rawRole satisfies "owner" | "editor";

const [user] = await db
  .insert(users)
  .values({ email: email.toLowerCase(), name, role })
  .onConflictDoNothing()
  .returning();

if (user) {
  console.log(`Created user: ${user.email} (${user.role})`);
} else {
  console.log(`User ${email} already exists`);
}
process.exit(0);
