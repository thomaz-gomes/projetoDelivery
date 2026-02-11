import { defineStore } from 'pinia';
import api from '../api';
import printService from '../services/printService.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: (() => {
      try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e){ return null; }
    })(),
    token: localStorage.getItem('token') || null
  }),
  actions: {
    async login(email, password) {
      const { data } = await api.post('/auth/login', { email, password });
      this.token = data.token;
      this.user = data.user;
      // if backend returned a newly-generated agent token, persist it to session/local and configure printService
      if (data.agentToken) {
        try {
          localStorage.setItem('agentToken', data.agentToken);
          await printService.setPrinterConfig({ agentToken: data.agentToken });
        } catch (e) { console.warn('Failed to apply agent token to printService', e); }
      }
      localStorage.setItem('token', this.token);
      try { localStorage.setItem('user', JSON.stringify(this.user)); } catch(e){}
      // Notify other parts of the SPA that a login occurred so they can identify sockets
      try { window.dispatchEvent(new CustomEvent('app:user-logged-in', { detail: { token: this.token } })); } catch(e) {}
      return data;
    },
    async loginWhatsapp(whatsapp, password) {
      // send masked or unmasked WhatsApp; backend will normalize
      const { data } = await api.post('/auth/login-whatsapp', { whatsapp, password });
      this.token = data.token;
      this.user = data.user;
      if (data.agentToken) {
        try {
          localStorage.setItem('agentToken', data.agentToken);
          await printService.setPrinterConfig({ agentToken: data.agentToken });
        } catch (e) { console.warn('Failed to apply agent token to printService', e); }
      }
      localStorage.setItem('token', this.token);
      try { localStorage.setItem('user', JSON.stringify(this.user)); } catch(e){}
      try { window.dispatchEvent(new CustomEvent('app:user-logged-in', { detail: { token: this.token } })); } catch(e) {}
    },
    async loginWhatsappAffiliate(whatsapp, password) {
      // Separate endpoint for affiliate login
      const { data } = await api.post('/auth/login-whatsapp-affiliate', { whatsapp, password });
      this.token = data.token;
      this.user = data.user;
      if (data.agentToken) {
        try {
          localStorage.setItem('agentToken', data.agentToken);
          await printService.setPrinterConfig({ agentToken: data.agentToken });
        } catch (e) { console.warn('Failed to apply agent token to printService', e); }
      }
      localStorage.setItem('token', this.token);
      try { localStorage.setItem('user', JSON.stringify(this.user)); } catch(e){}
      try { window.dispatchEvent(new CustomEvent('app:user-logged-in', { detail: { token: this.token } })); } catch(e) {}
    },
    logout() {
      this.user = null;
      this.token = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  }
});