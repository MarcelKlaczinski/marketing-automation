import nodemailer, { type Transporter } from "nodemailer";
import { getEnv, createLogger } from "@marketing-auto/shared";
import { getGlobal } from "@marketing-auto/core/credentials";
import { track } from "@marketing-auto/cost-tracker";
import {
  type SendEmailInput,
  type SendEmailResult,
  type SendMagicLinkInput,
  EmailError,
} from "./types.ts";

const log = createLogger("email");

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromAddress: string;
}

let _transporter: Transporter | null = null;
let _smtpConfig: SmtpConfig | null = null;

async function resolveSmtpConfig(): Promise<SmtpConfig | null> {
  const env = getEnv();

  const user = (await getGlobal("smtp", "user")) ?? env.SMTP_USER;
  const password = (await getGlobal("smtp", "password")) ?? env.SMTP_APP_PASSWORD;

  if (!user || !password) return null;

  const host = (await getGlobal("smtp", "host")) ?? env.SMTP_HOST;
  const portStr = await getGlobal("smtp", "port");
  const port = portStr ? parseInt(portStr, 10) : env.SMTP_PORT;
  const fromAddress = (await getGlobal("smtp", "from_address")) ?? env.SMTP_USER ?? user;

  return { host, port, user, password, fromAddress };
}

async function getTransporter(): Promise<{ transporter: Transporter; config: SmtpConfig } | null> {
  if (_transporter && _smtpConfig) return { transporter: _transporter, config: _smtpConfig };

  const config = await resolveSmtpConfig();
  if (!config) return null;

  _smtpConfig = config;
  _transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
  return { transporter: _transporter, config };
}

/** Synthetic project ID for platform-wide emails (auth, system alerts). */
export const PLATFORM_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Generic transactional send. All emails go through here.
 *
 * Gmail SMTP is free — cost_eur = 0, but we still write a cost_logs row for
 * observability ("how many auth emails went out this week?").
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const env = getEnv();
  const smtp = await getTransporter();

  if (!smtp) {
    log.warn(
      { to: input.to, subject: input.subject, operation: input.operation },
      "SMTP not configured — email logged to console (dev fallback)",
    );
    console.log(
      `\n📧 Email (would-be-sent) — ${input.subject}\n` +
      `   To: ${input.to}\n` +
      `   ${input.html.slice(0, 200)}${input.html.length > 200 ? "…" : ""}\n`,
    );
    return { messageId: "dev-fallback", delivered: false };
  }

  const { transporter, config } = smtp;
  const projectId = input.projectId ?? PLATFORM_PROJECT_ID;
  const fromAddress = `"${env.SMTP_FROM_NAME}" <${config.fromAddress}>`;

  log.debug({
    projectId,
    operation: input.operation,
    to: input.to,
    subjectLen: input.subject.length,
    htmlLen: input.html.length,
  }, "Sending email via SMTP");

  const info = await track({
    projectId,
    service: "smtp",
    operation: input.operation,
    estimatedCostEur: 0,
    fn: async () => {
      try {
        const mailOptions: nodemailer.SendMailOptions = {
          from: fromAddress,
          to: input.to,
          subject: input.subject,
          html: input.html,
        };
        if (input.text) mailOptions.text = input.text;
        if (input.replyTo) mailOptions.replyTo = input.replyTo;
        return await transporter.sendMail(mailOptions);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        log.error({ err: e, to: input.to, operation: input.operation }, "SMTP send failed");
        throw new EmailError(`SMTP send failed: ${errMsg}`, e);
      }
    },
    computeCostEur: () => 0,
    metadata: (result) => ({
      messageId: result.messageId,
      to: input.to,
      subject: input.subject,
      smtpResponse: result.response,
      accepted: result.accepted,
      rejected: result.rejected,
    }),
  });

  log.info(
    { projectId, operation: input.operation, messageId: info.messageId, to: input.to },
    "Email sent",
  );

  return { messageId: info.messageId, delivered: true };
}

/**
 * Magic-link login email. Wraps sendEmail with auth-specific copy.
 * Replaces the raw fetch() in apps/api/src/lib/email.ts.
 */
export async function sendMagicLinkEmail(input: SendMagicLinkInput): Promise<SendEmailResult> {
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:24px auto;color:#1a1a1a;">
      <h1 style="font-size:18px;margin:0 0 16px;">Sign in to Marketing Automation</h1>
      <p style="font-size:14px;line-height:1.5;margin:0 0 24px;">
        Click the button below to sign in. This link expires in ${input.expiresInMinutes} minutes
        and can only be used once.
      </p>
      <a href="${escapeHtml(input.verifyUrl)}"
         style="display:inline-block;background:#0066ff;color:#fff;padding:12px 24px;
                border-radius:6px;text-decoration:none;font-weight:500;">
        Sign in
      </a>
      <p style="font-size:12px;color:#666;margin:24px 0 0;line-height:1.5;">
        If you didn't request this, you can safely ignore this email.<br>
        Or copy this link: <span style="word-break:break-all;">${escapeHtml(input.verifyUrl)}</span>
      </p>
    </div>
  `.trim();

  const text = [
    "Sign in to Marketing Automation",
    "",
    input.verifyUrl,
    "",
    `This link expires in ${input.expiresInMinutes} minutes.`,
  ].join("\n");

  return sendEmail({
    projectId: input.projectId ?? null,
    operation: "magic-link",
    to: input.to,
    subject: "Sign in to Marketing Automation",
    html,
    text,
  });
}
