# Email Adapter (Nodemailer + Gmail SMTP)

Transactional email via Gmail SMTP. Replaces the raw fetch() implementation that lived in
apps/api/src/lib/email.ts during Phase 1. Used for magic-link auth and (later) cost alerts.

## Hard Rules

- ALL email sending goes through this adapter — never `nodemailer` directly
- ALL calls require `operation` for cost-log attribution
- For platform-wide emails (auth, system notifications), pass `projectId: null` — the adapter
  attributes to PLATFORM_PROJECT_ID synthetic project
- Dev mode (no `SMTP_USER` or `SMTP_APP_PASSWORD`): adapter logs the email content to console
  and returns `delivered: false` — NO cost tracked, NO error thrown
- Cost is always 0 for Gmail SMTP — entries exist for visibility, not billing

## Production Considerations

- **500 recipients/day cap** on personal Gmail accounts. We send 1-5/day. If we ever blast
  more, we'll exceed it and Gmail will start rejecting.
- **Deliverability**: Gmail's reputation for transactional emails is "good enough for tools".
  If magic links land in spam, the user can find them in their Spam folder. For an internal
  tool with 1-2 users, this is acceptable. For external users at scale, switch to
  Resend/SES/Mailgun.
- **From-address rewrite**: Gmail always rewrites `From:` to the authenticated user. Don't
  bother passing custom `from` — it's silently ignored. Display name (`SMTP_FROM_NAME`) IS
  honored.

## Migration Path

If we ever outgrow Gmail (volume, deliverability, or branded sender domain):

1. Sign up with new provider (Resend, SES, Mailgun)
2. Update `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_APP_PASSWORD` in `.env`
3. Done — adapter code doesn't change. SMTP is the universal interface.

If switching to a non-SMTP provider (e.g., Resend's HTTP API), refactor `client.ts`'s
`sendEmail()` internals only. Public API stays the same.

## Common Mistakes

- DO NOT pass `to: string[]` — multi-recipient is not supported
- DO NOT skip the `text` fallback — Gmail's deliverability scoring penalizes HTML-only
- DO NOT use `from: "..."` per-call — Gmail rewrites it anyway
- DO NOT call sendEmail() in tight loops — Gmail rate-limits aggressive senders to ~20/sec
- DO NOT use a personal Gmail you also use for important conversations — bot-like behavior
  could trigger Google's security flags. Consider a dedicated `marcel-bot@gmail.com`.
