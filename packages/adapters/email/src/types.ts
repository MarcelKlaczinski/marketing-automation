export type SendEmailInput = {
  /**
   * Project to attribute the cost to. Pass `null` for platform-wide emails (auth,
   * system notifications) — adapter falls back to PLATFORM_PROJECT_ID.
   */
  projectId: string | null;

  /** cost_logs operation field (e.g., "magic-link", "cost-alert", "daily-briefing"). */
  operation: string;

  /** Single recipient email address. */
  to: string;

  /** Subject line. */
  subject: string;

  /** HTML body. */
  html: string;

  /** Plain-text fallback body. Strongly recommended for deliverability. */
  text?: string;

  /** Reply-to address. Falls back to from if not set. */
  replyTo?: string;
};

export type SendEmailResult = {
  /** Nodemailer's messageId (the SMTP server's accepted ID). */
  messageId: string;
  /** Whether the call actually went through SMTP (false in dev-fallback mode). */
  delivered: boolean;
};

export type SendMagicLinkInput = {
  to: string;
  verifyUrl: string;
  expiresInMinutes: number;
  /** Optional: attribute to a project. Defaults to platform-wide. */
  projectId?: string;
};

export class EmailError extends Error {
  constructor(
    message: string,
    public readonly originalCause?: unknown,
  ) {
    super(message);
    this.name = "EmailError";
  }
}
