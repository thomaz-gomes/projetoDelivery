// Shared helpers for the "remind last order" / "repeat last order" flow.
// Used by both webhookEvolution (when a registered customer messages and the
// menu has the toggle on) and the inbox "Perguntar" action so they produce
// the exact same body + magic link.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../prisma.js';

function fmtCurrencyBR(value) {
  try { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  catch (_) { return `R$ ${Number(value || 0).toFixed(2)}`; }
}

function summarizeOrderItems(order) {
  const items = order?.items || [];
  if (!items.length) return '';
  return items
    .slice(0, 5)
    .map(it => `• ${it.quantity || 1}x ${it.name}`)
    .concat(items.length > 5 ? [`...e mais ${items.length - 5} item(ns)`] : [])
    .join('\n');
}

/**
 * Renders the "remind last order" template with the customer + order data.
 * Falls back to a sensible default body when no template is configured.
 *
 * Available placeholders: {{nome}}, {{itens}}, {{total}}, {{data}}.
 */
export function renderRemindLastOrderTemplate(template, { customer, order }) {
  const fallback = 'Olá {{nome}}! 👋\n\nQuer repetir seu último pedido?\n\n{{itens}}\n\nTotal: {{total}}';
  const raw = (template && String(template).trim()) || fallback;
  const data = new Date(order?.createdAt || Date.now());
  const dataStr = data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return String(raw)
    .replace(/\{\{nome\}\}/g, customer?.fullName || customer?.name || '')
    .replace(/\{\{itens\}\}/g, summarizeOrderItems(order))
    .replace(/\{\{total\}\}/g, fmtCurrencyBR(order?.total || 0))
    .replace(/\{\{data\}\}/g, dataStr);
}

// Pulls + sanitizes the configured frontend host. We skip URLs that look
// like the API host (api.*) because operators sometimes set both env vars
// to the same value during deploys, which makes the links 404 — the API
// domain doesn't serve the SPA's /public route.
function getFrontendBase() {
  const raw = (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (/^api\./i.test(u.hostname)) {
      console.warn(`[reorder] PUBLIC_FRONTEND_URL looks like an API host (${u.hostname}); the SPA must serve the link domain. Refusing to build a broken link.`);
      return null;
    }
  } catch (_) {
    // not a parseable URL — let the caller decide
  }
  return raw;
}

/**
 * Builds the long-form magic-link URL the customer taps to land on /public/<co>
 * with the cart pre-filled. The token is a 24h JWT bound to (orderId,
 * customerId, companyId) — the public reorder preview endpoint validates it.
 *
 * Kept around for callers that don't have a Prisma context (and as the target
 * the short-link resolver redirects to). New flows should call
 * createShortReorderLink instead so WhatsApp doesn't truncate the preview.
 *
 * Returns null when PUBLIC_FRONTEND_URL is not configured (or looks wrong).
 */
export function buildReorderMagicLink({ companyId, orderId, customerId }) {
  const frontend = getFrontendBase();
  if (!frontend) return null;
  const secret = process.env.JWT_SECRET || 'dev-jwt-secret';
  const token = jwt.sign(
    { orderId, customerId, companyId, kind: 'reorder' },
    secret,
    { expiresIn: '24h' },
  );
  return `${frontend}/public/${companyId}?reorder=${encodeURIComponent(orderId)}&t=${encodeURIComponent(token)}`;
}

// 8 url-safe chars (~280 trillion combinations) — collision risk negligible
// at our volume. Loop on the (rare) duplicate to keep the @id constraint
// happy without surfacing 500s to the operator.
async function generateUniqueShortCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    const existing = await prisma.shortLink.findUnique({ where: { code }, select: { code: true } });
    if (!existing) return code;
  }
  throw new Error('Failed to generate unique short link code');
}

/**
 * Creates a database-backed short link and returns the public URL the
 * customer taps. The frontend route /r/:code resolves the code, mints a
 * fresh JWT, and redirects to the canonical /public/<co>?reorder=... URL.
 *
 * Returns null when PUBLIC_FRONTEND_URL isn't configured.
 */
export async function createShortReorderLink({ companyId, orderId, customerId }) {
  const frontend = getFrontendBase();
  if (!frontend) return null;
  const code = await generateUniqueShortCode();
  await prisma.shortLink.create({
    data: {
      code,
      kind: 'reorder',
      companyId,
      payload: { orderId, customerId: customerId || null },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return `${frontend}/r/${code}`;
}

/**
 * Builds the full message body the inbox/webhook sends when offering the
 * customer to repeat their last order. Combines the template body with the
 * call-to-action link below.
 *
 * Async because the short-link helper writes a row to the DB.
 */
export async function buildReorderSuggestionBody({ template, customer, order, companyId }) {
  const text = renderRemindLastOrderTemplate(template, { customer, order });
  const link = await createShortReorderLink({ companyId, orderId: order.id, customerId: customer.id });
  if (!link) return text;
  return `${text}\n\n👉 Para repetir, toque no link:\n${link}\n\nO link é válido por 24h.`;
}
