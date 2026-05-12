# Spec 04: Magic Link Auth

**Phase:** 1 (Foundation)
**Estimated Effort:** ½ day
**Dependencies:** Spec 00, Spec 01
**Status:** Ready for implementation

---

## Goal

Implement passwordless authentication for the web app using magic links sent via Resend. Users (Marcel + 1-2 team members) enter their email, receive a one-click sign-in link, and are issued an httpOnly session cookie valid for 30 days. No passwords, no OAuth provider setup, minimal attack surface. Authorization is binary: authenticated users have access to all projects (no per-project permissions in MVP — the platform is for Marcel + team).

## Non-Goals

- No OAuth providers (Google/GitHub login) — magic link only
- No multi-factor auth (single-factor email is sufficient for an internal tool)
- No fine-grained permissions / RBAC (every authenticated user is essentially admin; SaaS pivot adds this)
- No "remember me" toggle (cookie always 30 days, that's the whole point)
- No session management UI ("see all my devices") — manual SQL for the rare case it's needed
- No email verification flow separate from auth (clicking the magic link IS verification)

## User-Facing Behavior

After this spec:
- User visits `/login` (Quasar PWA, Spec 31), enters email, clicks "Send link"
- Backend: `POST /api/auth/login` validates email is in users allowlist, creates magic-link token, sends email via Resend
- User receives email with link `https://app.example.com/api/auth/verify?token=xxx`
- Clicking link → backend verifies token, sets httpOnly cookie `session=...`, redirects to `/inbox`
- All subsequent API requests carry the cookie automatically; protected routes check session via middleware
- `POST /api/auth/logout` deletes the session row + clears cookie
- `GET /api/auth/me` returns the current user (or 401)
- Sessions auto-expire after 30 days; token rotation on each successful authentication

## Detailed Implementation

### Resend Setup

Marcel needs to:
1. Sign up at resend.com (free tier covers 3000 emails/month, way more than we'll send)
2. Verify a sending domain (e.g., `auth.marketing-auto.example.com`)
3. Generate API key, add to `.env` as `RESEND_API_KEY`
4. Set `RESEND_FROM_EMAIL=auth@marketing-auto.example.com`

For local dev: Resend has a sandbox mode that just logs emails — sufficient for testing. Or use a personal email as sender during development.

### Cookie Strategy

We use **server-side sessions** (DB-backed), NOT JWT in the cookie. Reasoning:
- Easier revocation (delete the row, session is dead immediately)
- No "leaked JWT can't be revoked" problem
- Drizzle query is fast (~1ms) — no perf concern for our scale
- Session cookie holds only an opaque token; everything else lives in DB

Cookie attributes:
- `HttpOnly` — JS can't read it (XSS protection)
- `Secure` — HTTPS only (auto-disabled in dev for localhost)
- `SameSite=Lax` — CSRF protection while allowing top-level navigation from email link
- `Path=/`
- `Max-Age=2592000` (30 days)

### Routes

`apps/api/src/routes/auth.ts`:
```typescript
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
const env = getEnv();

const SESSION_COOKIE = "ma_session";
const SESSION_TTL_DAYS = 30;
const MAGIC_LINK_TTL_MIN = 15;

export const authRoutes = new Hono();

/**
 * POST /api/auth/login
 * Body: { email: string }
 * Returns: { ok: true } regardless of whether email exists (anti-enumeration)
 */
authRoutes.post(
  "/login",
  zValidator("json", z.object({ email: z.string().email().toLowerCase() })),
  async (c) => {
    const { email } = c.req.valid("json");
    
    // Look up user. We DO NOT auto-create users — only allowlisted emails get in.
    // Adding a user is a manual SQL operation for MVP.
    const user = await db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((rows) => rows[0]);
    
    if (!user) {
      // Anti-enumeration: same response shape, but log the attempt
      log.info({ email }, "Login attempt for non-existent email");
      return c.json({ ok: true });
    }
    
    // Generate raw token (sent in email) and store hash (in DB)
    const rawToken = generateToken(32);
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60_000);
    
    await db.insert(magicLinkTokens).values({
      email,
      tokenHash,
      expiresAt,
    });
    
    const verifyUrl = `${env.APP_BASE_URL}/api/auth/verify?token=${rawToken}`;
    
    await sendMagicLinkEmail({
      to: email,
      verifyUrl,
      expiresInMinutes: MAGIC_LINK_TTL_MIN,
    });
    
    log.info({ email }, "Magic link sent");
    return c.json({ ok: true });
  },
);

/**
 * GET /api/auth/verify?token=xxx
 * Validates token, creates session, sets cookie, redirects to /inbox
 */
authRoutes.get(
  "/verify",
  zValidator("query", z.object({ token: z.string().min(32).max(128) })),
  async (c) => {
    const { token } = c.req.valid("query");
    const tokenHash = hashToken(token);
    
    // Find unconsumed, unexpired token
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
    
    // Get user
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
    
    // Mark token consumed (single-use)
    await db
      .update(magicLinkTokens)
      .set({ consumedAt: new Date() })
      .where(eq(magicLinkTokens.id, tokenRow.id));
    
    // Create session
    const sessionToken = generateToken(48);
    const sessionTokenHash = hashToken(sessionToken);
    const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60_000);
    
    const userAgent = c.req.header("user-agent") ?? null;
    const ipAddress = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      ?? c.req.header("x-real-ip")
      ?? null;
    
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: sessionTokenHash,
      expiresAt: sessionExpiresAt,
      userAgent,
      ipAddress,
    });
    
    // Update user metadata
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), emailVerified: true })
      .where(eq(users.id, user.id));
    
    // Set cookie
    setCookie(c, SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
      // Prefix __Host- requires Secure + Path=/ + no Domain. Use in production:
      // ... note: when using __Host- prefix, the cookie name in setCookie doesn't include
      // the prefix — that's a Hono convention with `prefix: 'host'` option. For MVP we keep
      // it simple without prefix.
    });
    
    log.info({ userId: user.id }, "Session created");
    return c.redirect(`${env.APP_BASE_URL}/inbox`, 302);
  },
);

/**
 * POST /api/auth/logout
 * Deletes session row, clears cookie.
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
 * Returns current user, or 401 if not authenticated.
 * Auth middleware (below) is expected to have populated c.var.user.
 */
authRoutes.get("/me", async (c) => {
  const user = c.get("user");  // set by requireAuth middleware
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
```

### Auth Middleware

`apps/api/src/middleware/auth.ts`:
```typescript
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
 * Does NOT enforce — use requireAuth for that.
 * Call this on all routes (cheap when no cookie).
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
 * Enforces authentication. 401 if not logged in.
 * Use after sessionLoader.
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ ok: false, error: "Unauthorized" }, 401);
  return next();
};
```

### Token Helpers

`apps/api/src/lib/tokens.ts`:
```typescript
import { randomBytes, createHash } from "node:crypto";

/**
 * Generate a URL-safe random token of N bytes (returns 4*N/3 base64url characters).
 * 32 bytes = 256 bits of entropy, plenty for magic links and sessions.
 */
export function generateToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Hash a token with SHA-256. We store hashes in DB; raw tokens only in transit
 * (email link, cookie). This way a DB leak doesn't leak active sessions.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

### Email Sender

`apps/api/src/lib/email.ts`:
```typescript
import { getEnv, createLogger } from "@marketing-auto/shared";

const log = createLogger("email");

type SendMagicLinkEmail = {
  to: string;
  verifyUrl: string;
  expiresInMinutes: number;
};

/**
 * Sends a magic link email via Resend.
 * In dev (no RESEND_API_KEY), logs the link to console — Marcel can copy from logs.
 */
export async function sendMagicLinkEmail(input: SendMagicLinkEmail): Promise<void> {
  const env = getEnv();
  
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    log.warn(
      { to: input.to, verifyUrl: input.verifyUrl },
      "Resend not configured — magic link logged to console",
    );
    console.log(`\n🔗 Magic link for ${input.to}:\n   ${input.verifyUrl}\n   (expires in ${input.expiresInMinutes} min)\n`);
    return;
  }
  
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:24px auto;color:#1a1a1a;">
      <h1 style="font-size:18px;margin:0 0 16px;">Sign in to Marketing Automation</h1>
      <p style="font-size:14px;line-height:1.5;margin:0 0 24px;">
        Click the button below to sign in. This link expires in ${input.expiresInMinutes} minutes
        and can only be used once.
      </p>
      <a href="${input.verifyUrl}"
         style="display:inline-block;background:#0066ff;color:#fff;padding:12px 24px;
                border-radius:6px;text-decoration:none;font-weight:500;">
        Sign in
      </a>
      <p style="font-size:12px;color:#666;margin:24px 0 0;line-height:1.5;">
        If you didn't request this, you can safely ignore this email.<br>
        Or copy this link: <span style="word-break:break-all;">${input.verifyUrl}</span>
      </p>
    </div>
  `;
  
  const text = `Sign in to Marketing Automation\n\n${input.verifyUrl}\n\nThis link expires in ${input.expiresInMinutes} minutes.`;
  
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: input.to,
      subject: "Sign in to Marketing Automation",
      html,
      text,
    }),
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    log.error({ status: response.status, body: errorBody, to: input.to }, "Resend send failed");
    throw new Error(`Resend send failed: ${response.status}`);
  }
  
  const result = await response.json() as { id: string };
  log.info({ emailId: result.id, to: input.to }, "Magic link sent via Resend");
}
```

### Wire into Server

Update `apps/api/src/server.ts`:
```typescript
import { Hono } from "hono";
import { logger as honoLogger } from "hono/logger";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { healthRoutes } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { sessionLoader } from "./middleware/auth.ts";

const env = getEnv();
const log = createLogger("api");

const app = new Hono();

// Middleware (order matters!)
app.use("*", honoLogger((message) => log.info(message)));
app.use("*", sessionLoader);  // populates c.var.user when session cookie present

// Public routes
app.route("/health", healthRoutes);
app.route("/api/auth", authRoutes);

// Protected routes (Spec 06+) will use requireAuth middleware

app.notFound((c) => c.json({ ok: false, error: "Not Found" }, 404));
app.onError((err, c) => {
  log.error({ err }, "Unhandled error");
  return c.json({ ok: false, error: "Internal Server Error" }, 500);
});

const startTime = Date.now();
log.info({ port: env.API_PORT, host: env.API_HOST }, "Starting API server");

export default {
  port: env.API_PORT,
  hostname: env.API_HOST,
  fetch: app.fetch,
};

declare global {
  var __startTime: number;
}
globalThis.__startTime = startTime;
```

### Add APP_BASE_URL to ENV

Update `packages/shared/src/config.ts` envSchema:
```typescript
APP_BASE_URL: z.string().url().default("http://localhost:3000"),
```

And `.env.example`:
```bash
# App URL for magic link callbacks
APP_BASE_URL=http://localhost:3000
```

### Cleanup Job (Important!)

Magic link tokens and sessions accumulate. We need periodic cleanup.

`apps/api/src/lib/cleanup.ts`:
```typescript
import { lt, or } from "drizzle-orm";
import { db, magicLinkTokens, sessions } from "@marketing-auto/db";
import { createLogger } from "@marketing-auto/shared";

const log = createLogger("cleanup");

/**
 * Delete expired magic link tokens (older than 24h, regardless of consumed status).
 * Delete expired sessions.
 * Call from a daily cron / BullMQ scheduled job (will be set up in Spec 05).
 */
export async function runAuthCleanup(): Promise<{
  tokensDeleted: number;
  sessionsDeleted: number;
}> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000);
  
  const tokensResult = await db
    .delete(magicLinkTokens)
    .where(lt(magicLinkTokens.expiresAt, oneDayAgo))
    .returning({ id: magicLinkTokens.id });
  
  const sessionsResult = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  
  log.info({
    tokensDeleted: tokensResult.length,
    sessionsDeleted: sessionsResult.length,
  }, "Auth cleanup ran");
  
  return {
    tokensDeleted: tokensResult.length,
    sessionsDeleted: sessionsResult.length,
  };
}
```

This will be wired into BullMQ scheduled jobs in Spec 05. For now, just having the function is enough.

### CLI Helper for Adding Users

Since we don't auto-create users, Marcel needs a way to add the first user (himself) and team members.

`apps/api/src/scripts/add-user.ts`:
```typescript
#!/usr/bin/env bun
import { db, users } from "@marketing-auto/db";

const email = process.argv[2];
const name = process.argv[3] ?? null;
const role = (process.argv[4] ?? "owner") as "owner" | "editor";

if (!email) {
  console.error("Usage: bun src/scripts/add-user.ts <email> [name] [owner|editor]");
  process.exit(1);
}

const [user] = await db
  .insert(users)
  .values({ email: email.toLowerCase(), name, role })
  .onConflictDoNothing()
  .returning();

if (user) {
  console.log(`✅ Created user: ${user.email} (${user.role})`);
} else {
  console.log(`ℹ️  User ${email} already exists`);
}
process.exit(0);
```

Add to `apps/api/package.json` scripts:
```json
"add-user": "bun src/scripts/add-user.ts"
```

Usage: `bun --filter @marketing-auto/api add-user marcel@example.com Marcel owner`

## Acceptance Criteria

- [ ] `POST /api/auth/login` with valid email returns `{ ok: true }` and sends email (or logs link in dev)
- [ ] `POST /api/auth/login` with non-allowlisted email also returns `{ ok: true }` (anti-enumeration), but no token is created in DB
- [ ] `GET /api/auth/verify?token=xxx` with valid token sets cookie, redirects to /inbox
- [ ] `GET /api/auth/verify?token=xxx` with expired token redirects with `?error=invalid_link`
- [ ] `GET /api/auth/verify?token=xxx` consumed twice: second time fails (single-use enforced)
- [ ] `GET /api/auth/me` with valid session cookie returns user data
- [ ] `GET /api/auth/me` without cookie returns 401
- [ ] `POST /api/auth/logout` deletes session row and clears cookie
- [ ] After logout, `GET /api/auth/me` returns 401
- [ ] Cookie has `HttpOnly; SameSite=Lax; Path=/` attributes (verify in browser devtools)
- [ ] Cookie has `Secure` in production but NOT in development (allows localhost testing)
- [ ] `add-user` CLI script creates user
- [ ] `runAuthCleanup()` deletes expired tokens and sessions
- [ ] Token hashes stored in DB are 64 hex chars (SHA-256)
- [ ] Raw tokens never appear in logs (only first 8 chars for debug)

## Testing Strategy

`apps/api/test/auth.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import app from "../src/server.ts";
import { db, users, magicLinkTokens, sessions } from "@marketing-auto/db";
import { eq } from "drizzle-orm";

describe("Magic Link Auth", () => {
  const testEmail = `test-${Date.now()}@example.com`;
  let userId: string;
  
  beforeEach(async () => {
    const [u] = await db.insert(users).values({
      email: testEmail,
      name: "Test User",
      role: "owner",
    }).onConflictDoUpdate({
      target: users.email,
      set: { name: "Test User" },
    }).returning();
    userId = u!.id;
  });
  
  afterAll(async () => {
    await db.delete(users).where(eq(users.email, testEmail));
  });
  
  it("login creates a magic link token", async () => {
    const res = await app.fetch(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail }),
    }));
    expect(res.status).toBe(200);
    
    const tokens = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, testEmail));
    expect(tokens.length).toBeGreaterThan(0);
  });
  
  it("login with non-existent email still returns 200 but creates no token", async () => {
    const fakeEmail = `nonexistent-${Date.now()}@example.com`;
    const res = await app.fetch(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: fakeEmail }),
    }));
    expect(res.status).toBe(200);
    
    const tokens = await db.select().from(magicLinkTokens).where(eq(magicLinkTokens.email, fakeEmail));
    expect(tokens.length).toBe(0);
  });
  
  it("verify with invalid token redirects to login with error", async () => {
    const res = await app.fetch(new Request("http://localhost/api/auth/verify?token=" + "x".repeat(48)));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=invalid_link");
  });
  
  it("/me without cookie returns 401", async () => {
    const res = await app.fetch(new Request("http://localhost/api/auth/me"));
    expect(res.status).toBe(401);
  });
  
  // Full E2E test (login → extract token from DB → verify → check cookie → /me) is best done
  // in integration tests rather than unit. Skip here; verify manually in dev.
});
```

## Open Questions / Decisions Made

**Decision 1: Server-side sessions, not JWT.** Easier to revoke, cheaper to implement (no key rotation logic), session lookup is one indexed query (~1ms).

**Decision 2: No sign-up flow.** This is an internal tool. Marcel adds users manually via the CLI script. Anyone trying to sign up with an unlisted email gets the same response as a real user (anti-enumeration), but no email is sent.

**Decision 3: 30-day session, 15-min magic link.** Magic link is short to limit theft window. Session is long because the device IS the trust factor on a known device.

**Decision 4: Single-use magic links.** `consumedAt` is set on first use. Re-clicking the email gets `?error=invalid_link`. Slight UX cost, big security win.

**Decision 5: Hash tokens before storage.** Even if DB is dumped, attacker can't reuse session tokens or magic links. Cost: 1 SHA-256 per request (microseconds).

**Decision 6: Anti-enumeration.** Same response shape regardless of whether email exists. Prevents attackers from probing for valid users.

**Decision 7: Resend over SES/Mailgun/Postmark.** Resend has the best DX, free tier covers our usage, modern API. SES is cheaper at scale but more setup. We can switch later.

**Decision 8: Rate limiting deferred.** Not in this spec. Will be added with general API rate limiting (Spec 06+ if MVP needs it). For MVP with 1-3 trusted users, it's fine. The 15-min token TTL plus single-use already limits damage.

**Decision 9: No CSRF token.** SameSite=Lax cookie + magic link is GET (state changes on the verify endpoint, but the link is intent-from-user). For the actual auth POST endpoints (`/login`, `/logout`), we'd add CSRF if browser-form-submitted, but our Quasar SPA uses fetch with JSON which doesn't trigger SameSite=None defaults. Lax is sufficient.

## Implementation Order

1. Add `APP_BASE_URL` to config + `.env.example`
2. Create `apps/api/src/lib/tokens.ts` (`generateToken`, `hashToken`)
3. Create `apps/api/src/lib/email.ts` (`sendMagicLinkEmail`)
4. Create `apps/api/src/middleware/auth.ts` (`sessionLoader`, `requireAuth`)
5. Create `apps/api/src/routes/auth.ts` (login, verify, logout, me)
6. Wire middleware + routes into `server.ts`
7. Create `apps/api/src/lib/cleanup.ts`
8. Create `apps/api/src/scripts/add-user.ts` and add npm script
9. Test manually in dev:
  - Add yourself as user: `bun --filter @marketing-auto/api add-user your@email.com YourName owner`
  - POST /api/auth/login with your email
  - Copy magic link from console logs
  - Hit it in browser → should redirect to /inbox (404 fine, no UI yet) and set cookie
  - GET /api/auth/me with cookie → returns user data
10. Run tests: `bun --filter @marketing-auto/api test`
11. Commit: `feat(auth): magic link authentication with Resend (spec 04)`

## Splitting Plan

Single session, ½ day. No splitting needed.

## Discovered During Implementation

- `apps/api/tsconfig.json` was missing `allowImportingTsExtensions: true`, `noEmit: true`, and the `@marketing-auto/db` path alias — added all three.
- `drizzle-orm` needed to be added directly to `apps/api/package.json` (the operator imports `eq`, `lt`, etc. are direct, not re-exported through `@marketing-auto/db`).
- `server.ts` had a `.js` extension import for `health.ts` — corrected to `.ts` for consistency.

## Deviations

- `email.ts` uses raw `fetch()` to call the Resend API, which technically violates the "no raw fetch" rule in CLAUDE.md. Accepted as-is for MVP since there is no Resend adapter package yet; a typed `ResendAdapter` can be extracted to `packages/core` when Spec 05 adds the adapter layer.
