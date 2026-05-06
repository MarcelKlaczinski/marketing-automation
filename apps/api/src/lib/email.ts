import { email, type SendEmailResult } from "@marketing-auto/adapter-email";

export type SendMagicLinkEmail = {
  to: string;
  verifyUrl: string;
  expiresInMinutes: number;
};

/**
 * Thin shim over @marketing-auto/adapter-email.
 * Preserves the call site in auth.ts. In dev (no SMTP creds): logs link to console.
 * Returns SendEmailResult so callers can check .delivered for dev-mode logging.
 */
export async function sendMagicLinkEmail(input: SendMagicLinkEmail): Promise<SendEmailResult> {
  return email.sendMagicLinkEmail(input);
}
