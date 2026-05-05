import { getEnv, createLogger } from "@marketing-auto/shared";

const log = createLogger("email");

type SendMagicLinkEmailInput = {
  to: string;
  verifyUrl: string;
  expiresInMinutes: number;
};

/**
 * Sends a magic link email via Resend.
 * In dev (no RESEND_API_KEY), logs the link to console so Marcel can copy it.
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendMagicLinkEmail(input: SendMagicLinkEmailInput): Promise<void> {
  const env = getEnv();

  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    log.warn(
      { to: input.to, verifyUrl: input.verifyUrl },
      "Resend not configured — magic link logged to console",
    );
    console.log(
      `\n🔗 Magic link for ${input.to}:\n   ${input.verifyUrl}\n   (expires in ${input.expiresInMinutes} min)\n`,
    );
    return;
  }

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
    log.error(
      { status: response.status, body: errorBody, to: input.to },
      "Resend send failed",
    );
    throw new Error(`Resend send failed: ${response.status}`);
  }

  const result = (await response.json()) as { id: string };
  log.info({ emailId: result.id, to: input.to }, "Magic link sent via Resend");
}
