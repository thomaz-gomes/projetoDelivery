<script setup>
import { computed, watch } from 'vue';
import { useSettlementProgressStore } from '../stores/settlementProgress';
import Swal from 'sweetalert2';

const sp = useSettlementProgressStore();

const visible = computed(() => !!sp.jobId);
const pct = computed(() => sp.percent());
const statusText = computed(() => {
  if (sp.error) return 'Erro durante a recriação';
  if (sp.done) {
    const parts = [`${sp.recreated} recriados`];
    if (sp.skipped) parts.push(`${sp.skipped} ignorados`);
    if (sp.failed) parts.push(`${sp.failed} falharam`);
    return `Concluído — ${parts.join(', ')}`;
  }
  return `Processando ${sp.processed.toLocaleString('pt-BR')} de ${sp.total.toLocaleString('pt-BR')}`;
});

watch(() => sp.done, (isDone) => {
  if (!isDone) return;
  if (sp.error) {
    Swal.fire({ icon: 'error', title: 'Falha ao recriar lançamentos', text: sp.error });
  } else {
    const errorsHtml = sp.failed > 0 && Array.isArray(sp.errors) && sp.errors.length
      ? `<hr><div class="text-start small text-danger"><strong>Primeiras falhas:</strong><ul>${sp.errors.map(e => `<li><code>${String(e.orderId).slice(0, 8)}</code>: ${e.error}</li>`).join('')}</ul></div>`
      : '';
    Swal.fire({
      icon: sp.failed > 0 ? 'warning' : 'success',
      title: sp.failed > 0 ? 'Recriação parcial' : 'Recriação concluída',
      html: `<div class="text-start small">
        Pedidos verificados: <strong>${sp.total.toLocaleString('pt-BR')}</strong><br>
        Recriados: <strong class="text-success">${sp.recreated}</strong><br>
        Ignorados (já conciliados): <strong class="text-muted">${sp.skipped}</strong><br>
        ${sp.failed > 0 ? `Falharam: <strong class="text-danger">${sp.failed}</strong><br>` : ''}
        Lançamentos apagados: <strong>${sp.deletedTransactions}</strong>
      </div>${errorsHtml}`,
      width: sp.failed > 0 ? 600 : undefined,
    });
  }
  setTimeout(() => sp.clear(), 4000);
});
</script>

<template>
  <Transition name="slide-up">
    <div v-if="visible" class="settlement-bar">
      <div class="settlement-bar-inner">
        <div class="settlement-bar-info">
          <span v-if="!sp.done && !sp.error" class="spinner-border spinner-border-sm me-2 text-white flex-shrink-0"></span>
          <i v-else-if="sp.error" class="bi bi-exclamation-triangle-fill me-2 text-warning flex-shrink-0"></i>
          <i v-else class="bi bi-check-circle-fill me-2 text-white flex-shrink-0"></i>
          <div class="settlement-bar-text">
            <div class="settlement-bar-title">
              {{ sp.done ? (sp.error ? 'Falhou' : 'Recriação concluída') : 'Recriando lançamentos...' }}
              <span v-if="sp.label" class="settlement-bar-label"> · {{ sp.label }}</span>
            </div>
            <div class="settlement-bar-status">{{ statusText }}</div>
          </div>
        </div>
        <div class="settlement-bar-right">
          <span class="settlement-bar-pct">{{ pct }}%</span>
          <button v-if="sp.done" class="settlement-bar-close" @click="sp.clear()" aria-label="Fechar">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>
      <div class="settlement-bar-progress">
        <div
          class="settlement-bar-fill"
          :class="{ done: sp.done && !sp.error, error: !!sp.error }"
          :style="{ width: pct + '%' }"
        ></div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.settlement-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2000;
  background: #1a1a2e;
  color: #fff;
  box-shadow: 0 -2px 16px rgba(0,0,0,0.25);
}
.settlement-bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 6px;
  gap: 12px;
}
.settlement-bar-info { display: flex; align-items: center; gap: 8px; min-width: 0; }
.settlement-bar-text { min-width: 0; }
.settlement-bar-title {
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.settlement-bar-label { opacity: 0.65; font-weight: 400; }
.settlement-bar-status { font-size: 0.75rem; opacity: 0.8; margin-top: 1px; }
.settlement-bar-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.settlement-bar-pct { font-size: 1rem; font-weight: 700; min-width: 3ch; text-align: right; }
.settlement-bar-close {
  background: none; border: none; color: rgba(255,255,255,0.7);
  cursor: pointer; padding: 2px 4px; line-height: 1; font-size: 0.85rem;
}
.settlement-bar-close:hover { color: #fff; }
.settlement-bar-progress { height: 4px; background: rgba(255,255,255,0.1); }
.settlement-bar-fill {
  height: 100%;
  background: #89d136;
  transition: width 0.6s ease;
}
.settlement-bar-fill.done { background: #4caf50; }
.settlement-bar-fill.error { background: #f44336; }
.slide-up-enter-active, .slide-up-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); opacity: 0; }
</style>
