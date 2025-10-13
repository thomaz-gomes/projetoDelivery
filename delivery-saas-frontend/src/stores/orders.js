import { defineStore } from 'pinia';
import api from '../api';

export const useOrdersStore = defineStore('orders', {
  state: () => ({
    orders: [],
    riders: [],
    qrUrl: '', // reservado caso ainda use QR de comanda
    loading: false,
  }),

  actions: {
    async fetch() {
      this.loading = true;
      try {
        const { data } = await api.get('/orders');
        this.orders = data;
        return data;
      } finally {
        this.loading = false;
      }
    },

    async fetchOne(id) {
      const { data } = await api.get(`/orders/${id}`);
      return data;
    },

    async fetchRiders() {
      const { data } = await api.get('/riders');
      this.riders = data;
      return data;
    },

    canTransition(current, to) {
      const flow = {
        EM_PREPARO: ['SAIU_PARA_ENTREGA', 'CANCELADO'],
        SAIU_PARA_ENTREGA: ['CONCLUIDO', 'CANCELADO'],
        CONCLUIDO: [],
        CANCELADO: [],
      };
      return (flow[current] || []).includes(to);
    },

    async updateStatus(id, status) {
      const { data } = await api.patch(`/orders/${id}/status`, { status });
      const idx = this.orders.findIndex(o => o.id === id);
      if (idx >= 0) this.orders[idx] = data;
      return data;
    },

    /**
     * Atribui entregador e opcionalmente já muda status para SAIU_PARA_ENTREGA
     * @param {string} id
     * @param {{riderId?: string, riderPhone?: string, alsoSetStatus?: boolean}} payload
     */
    async assignOrder(id, { riderId, riderPhone, alsoSetStatus = true }) {
      const { data } = await api.post(`/orders/${id}/assign`, {
        riderId,
        riderPhone,
        alsoSetStatus,
      });
      const idx = this.orders.findIndex(o => o.id === id);
      if (idx >= 0) this.orders[idx] = data.order;
      return data.order;
    },

    // se ainda usar geração de comanda com QR
    async generateTicket(id) {
      const { data } = await api.post(`/tickets/${id}`);
      this.qrUrl = data?.url || '';
      return data;
    },

    clearQr() {
      this.qrUrl = '';
    },
  },
});