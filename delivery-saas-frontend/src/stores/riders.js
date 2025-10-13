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
  }
});