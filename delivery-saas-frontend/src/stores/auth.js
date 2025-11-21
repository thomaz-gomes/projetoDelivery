import { defineStore } from 'pinia';
import api from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    token: localStorage.getItem('token') || null
  }),
  actions: {
    async login(email, password) {
      const { data } = await api.post('/auth/login', { email, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('token', this.token);
    },
    async loginWhatsapp(whatsapp, password) {
      // send masked or unmasked WhatsApp; backend will normalize
      const { data } = await api.post('/auth/login-whatsapp', { whatsapp, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('token', this.token);
    },
    logout() {
      this.user = null;
      this.token = null;
      localStorage.removeItem('token');
    }
  }
});