<script setup>
import { computed, watch } from 'vue';
import { useImportProgressStore } from '../stores/importProgress';
import Swal from 'sweetalert2';

const imp = useImportProgressStore();

const visible = computed(() => !!imp.jobId);
const pct = computed(() => imp.percent());
const statusText = computed(() => {
  if (imp.error) return 'Erro durante a importação';
  if (imp.done) return `Concluído — ${imp.created} criados, ${imp.updated} atualizados`;
  return `Processando ${imp.processed.toLocaleString('pt-BR')} de ${imp.total.toLocaleString('pt-BR')}`;
});

watch(() => imp.done, (isDone) => {
  if (!isDone) return;
  if (imp.error) {
    Swal.fire({ icon: 'error', title: 'Falha na importação', text: imp.error });
  } else {
    Swal.fire({
      icon: 'success',
      title: 'Importação concluída',
      html: `<b>${imp.created.toLocaleString('pt-BR')}</b> criados &nbsp;·&nbsp; <b>${imp.updated.toLocaleString('pt-BR')}</b> atualizados<br>
             <span class="text-muted small">${imp.total.toLocaleString('pt-BR')} linhas processadas${imp.errors ? ` · ${imp.errors} com erro` : ''}</span>`,
      timer: 6000,
      timerProgressBar: true,
    });
  }
  setTimeout(() => imp.clear(), 4000);
});
</script>

<template>
  <Transition name="slide-up">
    <div v-if="visible" class="import-bar">
      <div class="import-bar-inner">
        <div class="import-bar-info">
          <span v-if="!imp.done && !imp.error" class="spinner-border spinner-border-sm me-2 text-white flex-shrink-0"></span>
          <i v-else-if="imp.error" class="bi bi-exclamation-triangle-fill me-2 text-warning flex-shrink-0"></i>
          <i v-else class="bi bi-check-circle-fill me-2 text-white flex-shrink-0"></i>
          <div class="import-bar-text">
            <div class="import-bar-title">
              {{ imp.done ? (imp.error ? 'Falhou' : 'Importação concluída') : 'Importando clientes...' }}
              <span v-if="imp.fileName" class="import-bar-filename"> · {{ imp.fileName }}</span>
            </div>
            <div class="import-bar-status">{{ statusText }}</div>
          </div>
        </div>
        <div class="import-bar-right">
          <span class="import-bar-pct">{{ pct }}%</span>
          <button v-if="imp.done" class="import-bar-close" @click="imp.clear()" aria-label="Fechar">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      </div>
      <div class="import-bar-progress">
        <div
          class="import-bar-fill"
          :class="{ done: imp.done && !imp.error, error: !!imp.error }"
          :style="{ width: pct + '%' }"
        ></div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.import-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2000;
  background: #1a1a2e;
  color: #fff;
  box-shadow: 0 -2px 16px rgba(0,0,0,0.25);
}

.import-bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px 6px;
  gap: 12px;
}

.import-bar-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.import-bar-text {
  min-width: 0;
}

.import-bar-title {
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.import-bar-filename {
  opacity: 0.65;
  font-weight: 400;
}

.import-bar-status {
  font-size: 0.75rem;
  opacity: 0.8;
  margin-top: 1px;
}

.import-bar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.import-bar-pct {
  font-size: 1rem;
  font-weight: 700;
  min-width: 3ch;
  text-align: right;
}

.import-bar-close {
  background: none;
  border: none;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
  font-size: 0.85rem;
}
.import-bar-close:hover { color: #fff; }

.import-bar-progress {
  height: 4px;
  background: rgba(255,255,255,0.1);
}

.import-bar-fill {
  height: 100%;
  background: #89d136;
  transition: width 0.6s ease;
}
.import-bar-fill.done { background: #4caf50; }
.import-bar-fill.error { background: #f44336; }

/* Transição de entrada/saída */
.slide-up-enter-active, .slide-up-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.slide-up-enter-from, .slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
