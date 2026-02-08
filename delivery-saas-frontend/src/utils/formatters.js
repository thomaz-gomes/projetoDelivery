export function formatCurrency(v) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
  } catch (e) {
    return 'R$ ' + String(Number(v || 0).toFixed(2)).replace('.', ',');
  }
}

export function formatAmount(v) {
  try {
    return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (e) {
    return String(Number(v || 0).toFixed(2)).replace('.', ',');
  }
}

export function formatDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('pt-BR');
  } catch (e) {
    return '—';
  }
}
