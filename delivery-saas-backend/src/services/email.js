import nodemailer from 'nodemailer';
import { getSetting } from './systemSettings.js';

let transporter = null;
let transporterConfigHash = null; // track config to recreate if settings change

async function getSmtpConfig() {
  const host = await getSetting('smtp_host', 'SMTP_HOST');
  const port = Number(await getSetting('smtp_port', 'SMTP_PORT') || 587);
  const user = await getSetting('smtp_user', 'SMTP_USER');
  const pass = await getSetting('smtp_pass', 'SMTP_PASS');
  const from = await getSetting('smtp_from', 'SMTP_FROM') || user || 'noreply@delivery.app';
  return { host, port, user, pass, from };
}

async function getTransporter() {
  const config = await getSmtpConfig();
  if (!config.host || !config.user || !config.pass) {
    console.warn('[email] SMTP not configured (smtp_host, smtp_user, smtp_pass). Emails will be logged to console.');
    return null;
  }

  // Recreate transporter if config changed
  const hash = `${config.host}:${config.port}:${config.user}:${config.pass}`;
  if (transporter && transporterConfigHash === hash) return transporter;

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });
  transporterConfigHash = hash;
  return transporter;
}

/**
 * Send a verification code email.
 * Falls back to console.log if SMTP is not configured.
 */
export async function sendVerificationCode(email, code) {
  const t = await getTransporter();
  const config = await getSmtpConfig();

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
    from: config.from,
    to: email,
    subject,
    html,
  });

  console.log(`[email] Verification code sent to ${email} (messageId: ${info.messageId})`);
  return info;
}

/**
 * Send NF-e XML as email attachment.
 */
export async function sendNfeXmlEmail(toEmail, { xml, nProt, orderDisplay }) {
  const t = await getTransporter();
  const config = await getSmtpConfig();

  const filename = `nfe-${nProt || orderDisplay || 'xml'}.xml`;
  const subject = `NF-e ${nProt ? `Protocolo ${nProt}` : orderDisplay ? `Pedido ${orderDisplay}` : ''} — Documento Fiscal Eletrônico`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1a1a1a; margin-bottom: 8px;">Nota Fiscal Eletrônica</h2>
      <p style="color: #555; font-size: 15px;">Segue em anexo o arquivo XML da NF-e${nProt ? ` (Protocolo: <strong>${nProt}</strong>)` : ''}.</p>
      <p style="color: #888; font-size: 13px;">Guarde este documento para sua contabilidade.</p>
    </div>
  `;

  if (!t) {
    console.log(`[email] NF-e XML (${filename}) would be sent to ${toEmail} — SMTP not configured`);
    return { accepted: [toEmail], messageId: 'console-' + Date.now() };
  }

  const info = await t.sendMail({
    from: config.from,
    to: toEmail,
    subject,
    html,
    attachments: [{ filename, content: xml, contentType: 'application/xml' }],
  });

  console.log(`[email] NF-e XML sent to ${toEmail} (messageId: ${info.messageId})`);
  return info;
}

/**
 * Send a test email to verify SMTP configuration.
 */
export async function sendTestEmail(toEmail) {
  const t = await getTransporter();
  const config = await getSmtpConfig();

  if (!t) {
    return { messageId: 'console-' + Date.now() };
  }

  const info = await t.sendMail({
    from: config.from,
    to: toEmail,
    subject: 'Teste de configuração SMTP - Delivery SaaS',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a; margin-bottom: 8px;">Teste SMTP</h2>
        <p style="color: #555; font-size: 15px;">Se você recebeu este email, a configuração SMTP está funcionando corretamente!</p>
        <p style="color: #888; font-size: 13px;">Enviado em ${new Date().toLocaleString('pt-BR')}.</p>
      </div>
    `,
  });

  console.log(`[email] Test email sent to ${toEmail} (messageId: ${info.messageId})`);
  return info;
}
