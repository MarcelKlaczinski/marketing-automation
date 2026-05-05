import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { eq, and, gt } from "drizzle-orm";
import { db, sessions, users } from "@marketing-auto/db";
import { hashToken } from "../lib/tokens.ts";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("auth-mw");

const SESSION_COOKIE = "ma_session";

type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "editor";
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthenticatedUser | null;
    sessionId: string | null;
  }
}

/**
 * Populates c.var.user if a valid session cookie is present.
 * Does NOT enforce — use requireAuth for that. Cheap when no cookie is present.
 */
export const sessionLoader: MiddlewareHandler = async (c, next) => {
  const sessionToken = getCookie(c, SESSION_COOKIE);
  if (!sessionToken) {
    c.set("user", null);
    c.set("sessionId", null);
    return next();
  }

  const tokenHash = hashToken(sessionToken);
  const row = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (!row) {
    log.debug("Session cookie present but no valid session row");
    c.set("user", null);
    c.set("sessionId", null);
    return next();
  }

  c.set("user", {
    id: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
  });
  c.set("sessionId", row.sessionId);
  return next();
};

/**
 * Enforces authentication. Returns 401 if not logged in.
 * Must be used after sessionLoader.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ ok: false, error: "Unauthorized" }, 401);
  return next();
};
