import { defineStore } from 'pinia';
import api from '../api';

export const useCustomersStore = defineStore('customers', {
  state: () => ({
    list: [],
    total: 0,
    loading: false,
    current: null,
  }),
  actions: {
    async fetch({ q = '', skip = 0, take = 50 } = {}) {
      this.loading = true;
      try {
        const { data } = await api.get('/customers', { params: { q, skip, take } });
        this.list = data.rows;
        this.total = data.total;
        return data;
      } finally {
        this.loading = false;
      }
    },
    async get(id) {
      const { data } = await api.get(`/customers/${id}`);
      this.current = data;
      return data;
    },
    async create(payload) {
      const { data } = await api.post('/customers', payload);
      return data;
    },
    async update(id, payload) {
      const { data } = await api.patch(`/customers/${id}`, payload);
      return data;
    },
    async importFile(file) {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/customers/import', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
  },
});