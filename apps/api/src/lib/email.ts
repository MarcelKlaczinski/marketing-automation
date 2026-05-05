import { email } from "@marketing-auto/adapter-email";

export type SendMagicLinkEmail = {
  to: string;
  verifyUrl: string;
  expiresInMinutes: number;
};

/**
 * Thin shim over @marketing-auto/adapter-email.
 * Preserves the call site in auth.ts. In dev (no SMTP creds): logs link to console.
 */
export async function sendMagicLinkEmail(input: SendMagicLinkEmail): Promise<void> {
  await email.sendMagicLinkEmail(input);
}
