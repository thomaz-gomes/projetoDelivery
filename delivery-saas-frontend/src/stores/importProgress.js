import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '../api';

export const useImportProgressStore = defineStore('importProgress', () => {
  const jobId = ref(null);
  const fileName = ref('');
  const total = ref(0);
  const processed = ref(0);
  const created = ref(0);
  const updated = ref(0);
  const errors = ref(0);
  const done = ref(false);
  const error = ref(null);

  let _timer = null;

  function start(id, totalRows, name) {
    if (_timer) clearTimeout(_timer);
    jobId.value = id;
    fileName.value = name || '';
    total.value = totalRows;
    processed.value = 0;
    created.value = 0;
    updated.value = 0;
    errors.value = 0;
    done.value = false;
    error.value = null;
    _schedulePoll();
  }

  function _schedulePoll() {
    _timer = setTimeout(_poll, 800);
  }

  async function _poll() {
    if (!jobId.value || done.value) return;
    try {
      const { data } = await api.get(`/customers/import/${jobId.value}/status`);
      processed.value = data.processed ?? processed.value;
      created.value = data.created ?? created.value;
      updated.value = data.updated ?? updated.value;
      errors.value = data.errors ?? errors.value;
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

  return { jobId, fileName, total, processed, created, updated, errors, done, error, percent, start, clear };
});
