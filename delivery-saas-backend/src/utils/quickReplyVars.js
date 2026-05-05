import { prisma } from '../prisma.js';

/**
 * Variables supported in quick-reply bodies sent to customers via WhatsApp.
 *
 * | Token         | Resolves to                                                    |
 * |---------------|----------------------------------------------------------------|
 * | {{nome}}      | Customer.fullName, falls back to Conversation.contactName.     |
 * | {{cashback}}  | "R$ X,YZ" — current CashbackWallet balance for the customer.   |
 * | {{endereco}}  | Default address formatted as "rua, nº - bairro" (with fallbacks).|
 *
 * Unknown / unresolvable tokens are replaced with an empty string.
 *
 * Public so the frontend builder UI and the inbox/automation senders share
 * a single contract.
 */
export const QUICK_REPLY_VARIABLES = [
  { token: 'nome',     label: 'Nome do cliente' },
  { token: 'cashback', label: 'Saldo de cashback' },
  { token: 'endereco', label: 'Endereço padrão' },
];

function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatAddress(addr) {
  if (!addr) return '';
  const street = addr.street || '';
  const number = addr.number ? `, ${addr.number}` : '';
  const neigh = addr.neighborhood ? ` - ${addr.neighborhood}` : '';
  const built = `${street}${number}${neigh}`.trim();
  if (built) return built;
  return addr.formatted || '';
}

/**
 * @param {string} body            Raw body that may contain {{variables}}.
 * @param {object} ctx             Resolution context.
 * @param {object} [ctx.conversation]  Conversation row (for fallbacks like contactName).
 * @param {string|null} [ctx.customerId] Customer to resolve. Defaults to conversation.customerId.
 * @param {string} ctx.companyId   Company scope (required for the cashback wallet lookup).
 * @returns {Promise<string>}      Body with all known {{variables}} replaced.
 */
export async function renderQuickReplyVariables(body, { conversation, customerId, companyId }) {
  if (!body || typeof body !== 'string') return body || '';
  if (!/\{\{(nome|cashback|endereco)\}\}/.test(body)) return body;

  const cid = customerId || conversation?.customerId || null;
  let customer = null;
  let wallet = null;
  if (cid) {
    customer = await prisma.customer.findUnique({
      where: { id: cid },
      include: { addresses: true },
    }).catch(() => null);
    if (companyId) {
      wallet = await prisma.cashbackWallet.findFirst({
        where: { companyId, customerId: cid },
        select: { balance: true },
      }).catch(() => null);
    }
  }

  const name = (customer?.fullName || conversation?.contactName || '').trim();
  const balance = wallet ? brl(wallet.balance) : brl(0);
  const defaultAddr = customer?.addresses?.find?.((a) => a.isDefault) || customer?.addresses?.[0] || null;
  const address = formatAddress(defaultAddr);

  return body
    .replace(/\{\{\s*nome\s*\}\}/g, name)
    .replace(/\{\{\s*cashback\s*\}\}/g, balance)
    .replace(/\{\{\s*endereco\s*\}\}/g, address);
}
