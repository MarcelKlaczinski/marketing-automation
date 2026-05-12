import { zValidator } from "@hono/zod-validator";
import { db, magicLinkTokens, sessions, users } from "@marketing-auto/db";
import { createLogger, getEnv } from "@marketing-auto/shared";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { sendMagicLinkEmail } from "../lib/email.ts";
import { generateToken, hashToken } from "../lib/tokens.ts";

const log = createLogger("auth");

const SESSION_COOKIE = "ma_session";
const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_MIN = 15;

export const authRoutes = new Hono();

const emailSchema = z.object({ email: z.string().email().toLowerCase() });

/**
 * Issues a magic-link for the given email address.
 * Anti-enumeration: runs silently regardless of whether the address is registered.
 * Shared by /login (legacy) and /magic-link/request.
 */
async function issueMagicLink(emailAddress: string): Promise<void> {
  const env = getEnv();

  const user = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, emailAddress))
    .limit(1)
    .then((rows) => rows[0]);

  if (!user) {
    log.info({ email: emailAddress }, "Magic link requested for non-existent email");
    return;
  }

  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60_000);
  await db.insert(magicLinkTokens).values({ email: emailAddress, tokenHash, expiresAt });

  const verifyUrl = `${env.APP_BASE_URL}/auth/verify?token=${rawToken}`;
  const result = await sendMagicLinkEmail({
    to: emailAddress,
    verifyUrl,
    expiresInMinutes: MAGIC_LINK_TTL_MIN,
  });

  if (!result.delivered) {
    log.info(
      { email: emailAddress, verifyUrl },
      "Magic link generated (SMTP not configured — link in this log)"
    );
  } else {
    log.info({ email: emailAddress }, "Magic link sent");
  }
}

/**
 * POST /api/auth/login
 * Legacy endpoint name — kept for backward compatibility.
 */
authRoutes.post("/login", zValidator("json", emailSchema), async (c) => {
  const { email } = c.req.valid("json");
  await issueMagicLink(email);
  return c.json({ ok: true }, 202);
});

/**
 * POST /api/auth/magic-link/request
 * Body: { email: string }
 * Always returns 202 — anti-enumeration: same response whether email exists or not.
 */
authRoutes.post("/magic-link/request", zValidator("json", emailSchema), async (c) => {
  const { email } = c.req.valid("json");
  await issueMagicLink(email);
  return c.json({ ok: true }, 202);
});

/**
 * POST /api/auth/magic-link/verify
 * Body: { token: string }
 * Verifies the magic link token, creates a session, sets the httpOnly cookie,
 * and returns { ok, data: { user: { id, email } } }.
 */
authRoutes.post(
  "/magic-link/verify",
  zValidator("json", z.object({ token: z.string().min(1).max(512) })),
  async (c) => {
    const env = getEnv();
    const { token } = c.req.valid("json");
    const tokenHash = hashToken(token);

    const tokenRow = await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.tokenHash, tokenHash),
          isNull(magicLinkTokens.consumedAt),
          gt(magicLinkTokens.expiresAt, new Date())
        )
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!tokenRow) {
      log.warn({ tokenPrefix: token.slice(0, 8) }, "Invalid or expired magic link");
      return c.json({ ok: false, error: "Invalid or expired token" }, 401);
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, tokenRow.email))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      log.error({ email: tokenRow.email }, "Token valid but user gone (deleted?)");
      return c.json({ ok: false, error: "User not found" }, 404);
    }

    await db
      .update(magicLinkTokens)
      .set({ consumedAt: new Date() })
      .where(eq(magicLinkTokens.id, tokenRow.id));

    const sessionToken = generateToken(48);
    const sessionTokenHash = hashToken(sessionToken);
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000);

    const userAgent = c.req.header("user-agent") ?? null;
    const ipAddress =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null;

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: sessionTokenHash,
      expiresAt: sessionExpiresAt,
      userAgent,
      ipAddress,
    });

    await db
      .update(users)
      .set({ lastLoginAt: new Date(), emailVerified: true })
      .where(eq(users.id, user.id));

    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    log.info({ userId: user.id }, "Session created via magic-link/verify");
    return c.json({ ok: true, data: { user: { id: user.id, email: user.email } } });
  }
);

/**
 * GET /api/auth/verify?token=xxx
 * Legacy redirect-based flow. Validates token, creates session, redirects to /inbox.
 */
authRoutes.get(
  "/verify",
  zValidator("query", z.object({ token: z.string().min(32).max(128) })),
  async (c) => {
    const env = getEnv();
    const { token } = c.req.valid("query");
    const tokenHash = hashToken(token);

    const tokenRow = await db
      .select()
      .from(magicLinkTokens)
      .where(
        and(
          eq(magicLinkTokens.tokenHash, tokenHash),
          isNull(magicLinkTokens.consumedAt),
          gt(magicLinkTokens.expiresAt, new Date())
        )
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!tokenRow) {
      log.warn({ tokenPrefix: token.slice(0, 8) }, "Invalid or expired magic link");
      return c.redirect(`${env.APP_BASE_URL}/auth/login?error=invalid_link`, 302);
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, tokenRow.email))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      log.error({ email: tokenRow.email }, "Token valid but user gone (deleted?)");
      return c.redirect(`${env.APP_BASE_URL}/auth/login?error=user_not_found`, 302);
    }

    await db
      .update(magicLinkTokens)
      .set({ consumedAt: new Date() })
      .where(eq(magicLinkTokens.id, tokenRow.id));

    const sessionToken = generateToken(48);
    const sessionTokenHash = hashToken(sessionToken);
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000);

    const userAgent = c.req.header("user-agent") ?? null;
    const ipAddress =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? null;

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: sessionTokenHash,
      expiresAt: sessionExpiresAt,
      userAgent,
      ipAddress,
    });

    await db
      .update(users)
      .set({ lastLoginAt: new Date(), emailVerified: true })
      .where(eq(users.id, user.id));

    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });

    log.info({ userId: user.id }, "Session created via GET verify (redirect flow)");
    return c.redirect(`${env.APP_BASE_URL}/inbox`, 302);
  }
);

/**
 * POST /api/auth/logout
 * Deletes the session row and clears the cookie.
 */
authRoutes.post("/logout", async (c) => {
  const sessionToken = getCookie(c, SESSION_COOKIE);
  if (sessionToken) {
    const tokenHash = hashToken(sessionToken);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/**
 * GET /api/auth/me
 * Returns the current user from session, or 401 if not authenticated.
 * Relies on sessionLoader middleware having populated c.var.user.
 */
authRoutes.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ ok: false, error: "Unauthorized" }, 401);
  return c.json({
    ok: true,
    data: {
      id: user.id,
      email: user.email,
    },
  });
});
