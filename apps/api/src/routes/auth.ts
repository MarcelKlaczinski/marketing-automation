import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, isNull, gt } from "drizzle-orm";
import { db, users, magicLinkTokens, sessions } from "@marketing-auto/db";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { sendMagicLinkEmail } from "../lib/email.ts";
import { hashToken, generateToken } from "../lib/tokens.ts";

const log = createLogger("auth");

const SESSION_COOKIE = "ma_session";
const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_MIN = 15;

export const authRoutes = new Hono();

/**
 * POST /api/auth/login
 * Body: { email: string }
 * Always returns { ok: true } — anti-enumeration: same response whether email exists or not.
 */
authRoutes.post(
  "/login",
  zValidator("json", z.object({ email: z.string().email().toLowerCase() })),
  async (c) => {
    const env = getEnv();
    const { email } = c.req.valid("json");

    const user = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      log.info({ email }, "Login attempt for non-existent email");
      return c.json({ ok: true });
    }

    const rawToken = generateToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60_000);

    await db.insert(magicLinkTokens).values({ email, tokenHash, expiresAt });

    const verifyUrl = `${env.APP_BASE_URL}/api/auth/verify?token=${rawToken}`;

    await sendMagicLinkEmail({ to: email, verifyUrl, expiresInMinutes: MAGIC_LINK_TTL_MIN });

    log.info({ email }, "Magic link sent");
    return c.json({ ok: true });
  },
);

/**
 * GET /api/auth/verify?token=xxx
 * Validates magic link token, creates session, sets cookie, redirects to /inbox.
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
          gt(magicLinkTokens.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!tokenRow) {
      log.warn({ tokenPrefix: token.slice(0, 8) }, "Invalid or expired magic link");
      return c.redirect(`${env.APP_BASE_URL}/login?error=invalid_link`, 302);
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, tokenRow.email))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      log.error({ email: tokenRow.email }, "Token valid but user gone (deleted?)");
      return c.redirect(`${env.APP_BASE_URL}/login?error=user_not_found`, 302);
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
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      null;

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

    log.info({ userId: user.id }, "Session created");
    return c.redirect(`${env.APP_BASE_URL}/inbox`, 302);
  },
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
      name: user.name,
      role: user.role,
    },
  });
});
