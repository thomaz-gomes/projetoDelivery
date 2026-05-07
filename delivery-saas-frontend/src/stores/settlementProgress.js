import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../api';

/**
 * Tracks the background job that recreates marketplace settlements
 * (POST /financial/settlements/recreate). Mirrors the importProgress store:
 *  start(jobId, total, label) → polls /:jobId/status every 800ms until done.
 *
 * UI is rendered by the global <SettlementProgressBar /> component.
 */
export const useSettlementProgressStore = defineStore('settlementProgress', () => {
  const jobId = ref(null);
  const label = ref('');
  const total = ref(0);
  const processed = ref(0);
  const recreated = ref(0);
  const skipped = ref(0);
  const failed = ref(0);
  const deletedTransactions = ref(0);
  const errors = ref([]);
  const done = ref(false);
  const error = ref(null);

  let _timer = null;

  function start(id, totalRows, lbl) {
    if (_timer) clearTimeout(_timer);
    jobId.value = id;
    label.value = lbl || '';
    total.value = totalRows;
    processed.value = 0;
    recreated.value = 0;
    skipped.value = 0;
    failed.value = 0;
    deletedTransactions.value = 0;
    errors.value = [];
    done.value = false;
    error.value = null;
    _schedulePoll();
  }

  function _schedulePoll() { _timer = setTimeout(_poll, 800); }

  async function _poll() {
    if (!jobId.value || done.value) return;
    try {
      const { data } = await api.get(`/financial/settlements/recreate/${jobId.value}/status`);
      processed.value = data.processed ?? processed.value;
      recreated.value = data.recreated ?? recreated.value;
      skipped.value = data.skipped ?? skipped.value;
      failed.value = data.failed ?? failed.value;
      deletedTransactions.value = data.deletedTransactions ?? deletedTransactions.value;
      errors.value = Array.isArray(data.errors) ? data.errors : errors.value;
      done.value = !!data.done;
      error.value = data.error || null;
      if (!data.done) _schedulePoll();
    } catch (e) {
      error.value = e?.response?.data?.message || e?.message || 'Erro ao consultar progresso';
      done.value = true;
    }
  }

  function clear() {
    if (_timer) clearTimeout(_timer);
    _timer = null;
    jobId.value = null;
    done.value = false;
    error.value = null;
  }

  const percent = () => total.value > 0 ? Math.round((processed.value / total.value) * 100) : 0;

  return {
    jobId, label, total, processed, recreated, skipped, failed,
    deletedTransactions, errors, done, error, percent, start, clear,
  };
});
