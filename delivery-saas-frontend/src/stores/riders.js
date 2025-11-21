import { defineStore } from 'pinia';
import api from '../api';

export const useRidersStore = defineStore('riders', {
  state: () => ({ riders: [], loaded: false }),
  actions: {
    async fetch() {
      if (this.loaded) return;
      const { data } = await api.get('/riders');
      this.riders = data || [];
      this.loaded = true;
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