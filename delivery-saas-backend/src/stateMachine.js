export const ALLOWED = {
  NOVO: ['CONFIRMADO', 'CANCELADO'],
  CONFIRMADO: ['EM_PREPARO', 'CANCELADO'],
  EM_PREPARO: ['PRONTO', 'CANCELADO'],
  PRONTO: ['DESPACHADO', 'CANCELADO'],
  DESPACHADO: ['ENTREGUE'],
  ENTREGUE: [],
  CANCELADO: []
};

export function canTransition(from, to) {
  return ALLOWED[from]?.includes(to) ?? false;
}