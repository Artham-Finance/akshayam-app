import nodemailer, { type Transporter } from "nodemailer";

/**
 * Sending mail, over SMTP - Amazon SES, Google Workspace, or any provider that gives an SMTP
 * login. Nothing is sent until these are set in the server's .env.local:
 *
 *   SMTP_HOST   the provider's server, e.g. email-smtp.ap-south-1.amazonaws.com
 *   SMTP_PORT   587 (STARTTLS, the default) or 465 (set SMTP_SECURE=true)
 *   SMTP_USER   the SMTP username
 *   SMTP_PASS   the SMTP password
 *   SMTP_FROM   the sender, e.g. "Akshayam Group Reporting <reports@example.com>"
 */

let cached: Transporter | null = null;

export function emailConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

function transporter(): Transporter {
  if (cached) return cached;
  const port = Number(process.env.SMTP_PORT ?? 587);
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return cached;
}

export async function sendEmail(message: {
  to: string;
  /** blind copies, comma separated */
  bcc?: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  if (!emailConfigured()) {
    throw new Error("Email is not set up: SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM are required.");
  }
  await transporter().sendMail({ from: process.env.SMTP_FROM, ...message });
}
