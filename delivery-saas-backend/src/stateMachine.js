// Centralized state transition rules used by backend APIs to validate manual
// or programmatic status changes. Keep legacy keys to avoid breaking older
// integrations, but prioritize the current pipeline used by the frontend:
// EM_PREPARO -> SAIU_PARA_ENTREGA -> CONFIRMACAO_PAGAMENTO -> CONCLUIDO
export const ALLOWED = {
  // New pipeline
  EM_PREPARO: ['SAIU_PARA_ENTREGA', 'CANCELADO'],
  SAIU_PARA_ENTREGA: ['CONFIRMACAO_PAGAMENTO', 'CONCLUIDO', 'CANCELADO'],
  CONFIRMACAO_PAGAMENTO: ['CONCLUIDO', 'CANCELADO'],
  CONCLUIDO: [],

  // Legacy / alternative states (kept for compatibility)
  NOVO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EM_PREPARO', 'CANCELADO'],
  PRONTO: ['DESPACHADO', 'CANCELADO'],
  DESPACHADO: ['ENTREGUE', 'CANCELADO'],
  ENTREGUE: [],
  CANCELADO: []
};

export function canTransition(from, to) {
  if (!from || !to) return false;
  // Normalize to strings and uppercase for robust comparison
  const f = String(from).toUpperCase();
  const t = String(to).toUpperCase();
  return (ALLOWED[f] || []).includes(t);
}