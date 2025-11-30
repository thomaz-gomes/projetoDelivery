// src/stores/integrations.js
import { defineStore } from 'pinia';
import api from '../api';

export const useIntegrationsStore = defineStore('integrations', {
  state: () => ({
    ifood: null,
    loading: false,
    saving: false,
    polling: false,
    error: '',
    message: '',
  }),

  actions: {
    clearMessages() {
      this.error = '';
      this.message = '';
    },

    async fetchIFood() {
      this.clearMessages();
      this.loading = true;
      try {
        const { data } = await api.get('/integrations/IFOOD');
        this.ifood = data;
      } catch (e) {
        if (e?.response?.status === 404) {
          this.ifood = { provider: 'IFOOD', enabled: false, clientId: '', clientSecret: '', merchantId: '' };
        } else {
          this.error = e?.response?.data?.message || 'Falha ao carregar integração iFood';
        }
      } finally {
        this.loading = false;
      }
    },

    async saveIFood(payload) {
      this.clearMessages();
      this.saving = true;
      try {
        if (!payload || !payload.storeId) throw new Error('Selecione a loja para vincular a integração.');
        const { data } = await api.post('/integrations/IFOOD', payload);
        this.ifood = data;
        this.message = 'Integração salva com sucesso.';
      } catch (e) {
        this.error = e?.response?.data?.message || e?.message || 'Falha ao salvar integração';
      } finally {
        this.saving = false;
      }
    },

    async pollIFood() {
      this.clearMessages();
      this.polling = true;
      try {
        const { data } = await api.post('/integrations/ifood/poll', {});
        this.message = `Polling concluído. Eventos: ${data?.count ?? 0}`;
        return data;
      } catch (e) {
        this.error = e?.response?.data?.message || 'Falha ao executar polling do iFood';
        throw e;
      } finally {
        this.polling = false;
      }
    },
  },
});
