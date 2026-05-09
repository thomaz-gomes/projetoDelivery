// Shared helpers for the "remind last order" / "repeat last order" flow.
// Used by both webhookEvolution (when a registered customer messages and the
// menu has the toggle on) and the inbox "Perguntar" action so they produce
// the exact same body + magic link.
import jwt from 'jsonwebtoken';

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

/**
 * Builds the magic-link URL the customer taps to land on /public/<co> with
 * the cart pre-filled. The token is a 24h JWT bound to (orderId, customerId,
 * companyId) — the public reorder preview endpoint validates it.
 *
 * Returns null when PUBLIC_FRONTEND_URL is not configured.
 */
export function buildReorderMagicLink({ companyId, orderId, customerId }) {
  const frontend = (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  if (!frontend) return null;
  const secret = process.env.JWT_SECRET || 'dev-jwt-secret';
  const token = jwt.sign(
    { orderId, customerId, companyId, kind: 'reorder' },
    secret,
    { expiresIn: '24h' },
  );
  return `${frontend}/public/${companyId}?reorder=${encodeURIComponent(orderId)}&t=${encodeURIComponent(token)}`;
}

/**
 * Builds the full message body the inbox/webhook sends when offering the
 * customer to repeat their last order. Combines the template body with the
 * call-to-action link below.
 */
export function buildReorderSuggestionBody({ template, customer, order, companyId }) {
  const text = renderRemindLastOrderTemplate(template, { customer, order });
  const link = buildReorderMagicLink({ companyId, orderId: order.id, customerId: customer.id });
  if (!link) return text;
  return `${text}\n\n👉 Para repetir, toque no link:\n${link}\n\nO link é válido por 24h.`;
}
