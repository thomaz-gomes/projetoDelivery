import { defineStore } from 'pinia';
import api from '../api';

export const useRidersStore = defineStore('riders', {
  state: () => ({ riders: [], loaded: false }),
  actions: {
    async fetch({ includeInactive = false, force = false } = {}) {
      if (this.loaded && !force) return;
      const params = includeInactive ? { includeInactive: 'true' } : {};
      const { data } = await api.get('/riders', { params });
      this.riders = data || [];
      this.loaded = true;
    },
    reset() {
      this.riders = [];
      this.loaded = false;
    }
    ,
    async get(id) {
      const { data } = await api.get(`/riders/${id}`);
      return data;
    },

    async create(payload) {
      const { data } = await api.post('/riders', payload);
      // append to local list if present
      this.riders = [data, ...this.riders];
      return data;
    },

    async update(id, payload) {
      const { data } = await api.patch(`/riders/${id}`, payload);
      const idx = this.riders.findIndex(r => r.id === id);
      if (idx >= 0) this.riders[idx] = data;
      return data;
    }
  }
});