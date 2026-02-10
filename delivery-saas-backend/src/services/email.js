import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[email] SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Emails will be logged to console.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return transporter;
}

const FROM = () => process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@delivery.app';

/**
 * Send a verification code email.
 * Falls back to console.log if SMTP is not configured.
 */
export async function sendVerificationCode(email, code) {
  const t = getTransporter();

  const subject = `Seu código de verificação: ${code}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a; margin-bottom: 8px;">Verificação de Email</h2>
      <p style="color: #555; font-size: 15px;">Use o código abaixo para verificar sua conta:</p>
      <div style="background: #f4f6f8; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1a1a1a;">${code}</span>
      </div>
      <p style="color: #888; font-size: 13px;">Este código expira em 15 minutos.</p>
      <p style="color: #888; font-size: 13px;">Se você não solicitou este código, ignore este email.</p>
    </div>
  `;

  if (!t) {
    console.log(`[email] VERIFICATION CODE for ${email}: ${code}`);
    return { accepted: [email], messageId: 'console-' + Date.now() };
  }

  const info = await t.sendMail({
    from: FROM(),
    to: email,
    subject,
    html,
  });

  console.log(`[email] Verification code sent to ${email} (messageId: ${info.messageId})`);
  return info;
}
