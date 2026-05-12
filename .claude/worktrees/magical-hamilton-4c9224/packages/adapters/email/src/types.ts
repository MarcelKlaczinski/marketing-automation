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

  /**
   * Structured payload for dev-mode console output.
   * When SMTP is NOT configured, printed as a formatted block instead of the truncated HTML body.
   * Use for emails where a specific URL or token is the primary content (e.g. magic links).
   */
  devLog?: {
    primaryAction: string;
    url?: string;
    token?: string;
    expiresInMinutes?: number;
    additionalLines?: string[];
  };
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
    public readonly originalCause?: unknown
  ) {
    super(message);
    this.name = "EmailError";
  }
}
