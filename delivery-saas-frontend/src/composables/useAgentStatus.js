import { ref } from 'vue';
import api from '../api';

/**
 * Composable que busca o status de "última conexão" de um cliente de
 * automação do iFood Chat (extensão Chrome OU app Electron) e calcula
 * se devemos exibir um aviso para o operador.
 *
 * Uso:
 *   const { lastSeenAt, hoursSinceLastSeen, hasAnyToken, banner, fetch } = useAgentStatus();
 *   onMounted(fetch);
 *
 * Retorno:
 *   - banner === null            -> não exibir aviso
 *   - banner === 'never-connected' -> tem token configurado, mas nenhum cliente conectou ainda
 *   - banner === 'stale'         -> última conexão foi há >= 24h
 */
export function useAgentStatus() {
  const lastSeenAt = ref(null);
  const hoursSinceLastSeen = ref(null);
  const hasAnyToken = ref(false);
  const banner = ref(null); // null | 'never-connected' | 'stale'
  const loading = ref(false);
  const error = ref('');

  function computeBanner() {
    if (!hasAnyToken.value) {
      banner.value = null;
      return;
    }
    if (lastSeenAt.value === null) {
      banner.value = 'never-connected';
      return;
    }
    if (typeof hoursSinceLastSeen.value === 'number' && hoursSinceLastSeen.value >= 24) {
      banner.value = 'stale';
      return;
    }
    banner.value = null;
  }

  async function fetchStatus() {
    loading.value = true;
    error.value = '';
    try {
      const { data } = await api.get('/ifood-chat/agent-status');
      lastSeenAt.value = data?.lastSeenAt || null;
      hoursSinceLastSeen.value = (typeof data?.hoursSinceLastSeen === 'number') ? data.hoursSinceLastSeen : null;
      hasAnyToken.value = !!data?.hasAnyToken;
      computeBanner();
    } catch (e) {
      error.value = e?.response?.data?.message || e?.message || 'Erro ao consultar status do agente';
      // On error, don't show a banner — fail silently to avoid noise.
      banner.value = null;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Formata o lastSeenAt para "DD/MM/YYYY HH:mm" (pt-BR).
   */
  function formatLastSeen() {
    if (!lastSeenAt.value) return '';
    try {
      const d = new Date(lastSeenAt.value);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) {
      return '';
    }
  }

  return {
    lastSeenAt,
    hoursSinceLastSeen,
    hasAnyToken,
    banner,
    loading,
    error,
    fetch: fetchStatus,
    formatLastSeen,
  };
}
