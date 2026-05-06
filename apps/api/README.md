# API Server (`apps/api`)

Hono-based backend for the Marketing Automation platform.

## First-time login (no SMTP setup needed)

The system uses magic-link authentication. SMTP is optional — for development, magic-link URLs are printed directly to the API server console.

To log in for the first time:

1. Make sure the API server is running: `bun --filter @marketing-auto/api dev`
2. Open the web app at `http://localhost:3051`
3. You'll be redirected to `/auth/login`
4. Enter any email address (it doesn't need to exist; SMTP is not used in dev mode)
5. Click "Send magic link"
6. **In the API server's terminal**, look for a block like:

```
════════════════════════════════════════════════════════════════════════
📧  EMAIL (DEV FALLBACK — SMTP not configured)
════════════════════════════════════════════════════════════════════════
Subject:    Sign in to Marketing Automation
To:         marcel@example.com
Operation:  magic-link

🔐  Magic link (copy this URL into your browser):

   http://localhost:3051/auth/verify?token=abc123...

Expires in: 15 minutes

Recipient: marcel@example.com
Note:      Configure SMTP via the installer to send real emails.
════════════════════════════════════════════════════════════════════════
```

7. Copy the URL and paste it into your browser
8. You're logged in — session cookie is set, redirected to `/inbox`

Once SMTP is configured (via the installer wizard), real emails will be sent and the console block is replaced by a brief info log.

## Auth Patterns

- `APP_BASE_URL` in `.env` must point to the **frontend** origin (e.g. `http://localhost:3051`), NOT the API port. Magic-link emails link to `APP_BASE_URL/auth/verify?token=...`.
- Session cookies are httpOnly, SameSite=Strict, max-age 30 days.
- Magic links expire after 15 minutes and are single-use.
