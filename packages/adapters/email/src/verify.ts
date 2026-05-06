import nodemailer from "nodemailer";

export interface VerifyResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function verifySmtp(creds: Record<string, string>): Promise<VerifyResult> {
  const { host, port, user, password } = creds;
  if (!host || !port || !user || !password) {
    return { ok: false, message: "Missing required SMTP credentials (host, port, user, password)" };
  }

  const portNum = parseInt(port, 10);
  const transporter = nodemailer.createTransport({
    host,
    port: portNum,
    secure: portNum === 465,
    auth: { user, pass: password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });

  try {
    await transporter.verify();
    return { ok: true, message: "SMTP connection successful", details: { host, port: portNum } };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  } finally {
    transporter.close();
  }
}
