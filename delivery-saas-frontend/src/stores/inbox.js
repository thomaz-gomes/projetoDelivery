import { defineStore } from 'pinia';
import api from '../api';

export const useInboxStore = defineStore('inbox', {
  state: () => ({
    conversations: [],
    activeConversationId: null,
    messages: {}, // { [conversationId]: Message[] }
    unreadTotal: 0,
    quickReplies: [],
    customerCache: {},   // { [customerId]: customerData }
    orderDrafts: {},     // { [conversationId]: { active, orderType, ... } }
    loading: false,
    filters: {
      storeId: null,
      status: 'OPEN',
      search: '',
      mine: false,
      unread: false,
    },
    replyToMessageId: null,
    internalMode: false,
    allTags: [],
  }),

  getters: {
    activeConversation(state) {
      return state.conversations.find(c => c.id === state.activeConversationId) || null;
    },
    activeMessages(state) {
      if (!state.activeConversationId) return [];
      return state.messages[state.activeConversationId] || [];
    },
  },

  actions: {
    async fetchConversations() {
      this.loading = true;
      try {
        const params = {};
        if (this.filters.storeId) params.storeId = this.filters.storeId;
        if (this.filters.status) params.status = this.filters.status;
        if (this.filters.search) params.search = this.filters.search;
        if (this.filters.mine) params.mine = 'true';
        if (this.filters.unread) params.unread = 'true';
        const { data } = await api.get('/inbox/conversations', { params });
        this.conversations = Array.isArray(data) ? data : [];
        this.recalcUnread();
      } finally {
        this.loading = false;
      }
    },

    async fetchMessages(conversationId, cursor = null) {
      const params = { limit: 50 };
      if (cursor) params.cursor = cursor;
      const { data } = await api.get(`/inbox/conversations/${conversationId}/messages`, { params });
      const msgs = Array.isArray(data) ? data : [];
      if (cursor && this.messages[conversationId]) {
        // Prepend older messages (API returns desc, we display asc)
        this.messages[conversationId] = [...msgs.reverse(), ...this.messages[conversationId]];
      } else {
        this.messages[conversationId] = msgs.reverse();
      }
      return msgs;
    },

    async sendMessage(conversationId, { type, body, mediaFile, quotedMessageId, latitude, longitude }) {
      const formData = new FormData();
      formData.append('type', type || 'TEXT');
      if (body) formData.append('body', body);
      if (mediaFile) formData.append('media', mediaFile);
      if (quotedMessageId) formData.append('quotedMessageId', quotedMessageId);
      if (latitude) formData.append('latitude', latitude);
      if (longitude) formData.append('longitude', longitude);
      const { data } = await api.post(`/inbox/conversations/${conversationId}/send`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },

    async markAsRead(conversationId) {
      await api.patch(`/inbox/conversations/${conversationId}/read`);
      const conv = this.conversations.find(c => c.id === conversationId);
      if (conv) { conv.unreadCount = 0; this.recalcUnread(); }
    },

    async updateConversation(conversationId, updates) {
      const { data } = await api.patch(`/inbox/conversations/${conversationId}`, updates);
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], ...data };
      return data;
    },

    async linkCustomer(conversationId, customerId) {
      const { data } = await api.post(`/inbox/conversations/${conversationId}/link-customer`, { customerId });
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], ...data };
      return data;
    },

    async fetchQuickReplies() {
      const { data } = await api.get('/inbox/quick-replies');
      this.quickReplies = Array.isArray(data) ? data : [];
    },

    async createQuickReply(payload) {
      const { data } = await api.post('/inbox/quick-replies', payload);
      this.quickReplies.push(data);
      return data;
    },

    async updateQuickReply(id, payload) {
      const { data } = await api.put(`/inbox/quick-replies/${id}`, payload);
      const idx = this.quickReplies.findIndex(r => r.id === id);
      if (idx >= 0) this.quickReplies[idx] = data;
      return data;
    },

    async deleteQuickReply(id) {
      await api.delete(`/inbox/quick-replies/${id}`);
      this.quickReplies = this.quickReplies.filter(r => r.id !== id);
    },

    // Socket.IO event handlers
    handleNewMessage({ conversationId, message, conversation: convData }) {
      // 1) Update conversations list (reassign array to ensure reactivity)
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) {
        const existing = this.conversations[idx];
        const merged = { ...existing, ...(convData || {}), messages: [message] };
        // Move merged conversation to top
        const newList = [merged, ...this.conversations.filter((_, i) => i !== idx)];
        this.conversations = newList;
      } else if (convData) {
        this.conversations = [{ ...convData, id: conversationId, messages: [message] }, ...this.conversations];
      }

      // 2) Update loaded messages map (reassign nested array to trigger reactivity)
      const current = this.messages[conversationId];
      if (current) {
        const exists = current.find(m => m.id === message.id);
        if (!exists) {
          this.messages = {
            ...this.messages,
            [conversationId]: [...current, message],
          };
        }
      } else if (this.activeConversationId === conversationId) {
        this.messages = {
          ...this.messages,
          [conversationId]: [message],
        };
      }

      this.recalcUnread();
    },

    handleMessageSent({ conversationId, message }) {
      const current = this.messages[conversationId];
      if (current) {
        const exists = current.find(m => m.id === message.id);
        if (!exists) {
          this.messages = {
            ...this.messages,
            [conversationId]: [...current, message],
          };
        }
      }
    },

    handleMessageStatus({ messageId, conversationId, status }) {
      const current = this.messages[conversationId];
      if (current) {
        const updated = current.map(m => m.id === messageId ? { ...m, status } : m);
        this.messages = { ...this.messages, [conversationId]: updated };
      }
    },

    handleConversationUpdated({ conversation }) {
      const idx = this.conversations.findIndex(c => c.id === conversation.id);
      if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], ...conversation };
    },

    recalcUnread() {
      this.unreadTotal = this.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    },

    // Customer cache actions
    async fetchCustomer(customerId) {
      if (!customerId) return null;
      const { data } = await api.get(`/inbox/customer/${customerId}`);
      this.customerCache[customerId] = data;
      return data;
    },

    async fetchCustomerByPhone(phone, conversationId) {
      if (!phone) return null;
      try {
        const { data } = await api.get(`/inbox/customer/by-phone/${encodeURIComponent(phone)}`);
        if (data && data.id) {
          this.customerCache[data.id] = data;
          // Auto-link to conversation if provided
          if (conversationId) {
            await this.linkCustomer(conversationId, data.id);
          }
          return data;
        }
      } catch (e) {
        // 404 = customer not found by phone, that's ok
        if (e.response?.status !== 404) console.warn('fetchCustomerByPhone error:', e);
      }
      return null;
    },

    async updateCustomerField(customerId, field, value) {
      const { data } = await api.patch(`/inbox/customer/${customerId}`, { [field]: value });
      if (this.customerCache[customerId]) {
        Object.assign(this.customerCache[customerId], data);
      }
      return data;
    },

    async createAddress(customerId, addressData) {
      const { data } = await api.post(`/inbox/customer/${customerId}/addresses`, addressData);
      if (this.customerCache[customerId]) {
        if (!this.customerCache[customerId].addresses) this.customerCache[customerId].addresses = [];
        this.customerCache[customerId].addresses.unshift(data);
      }
      return data;
    },

    async updateAddressField(customerId, addrId, field, value) {
      const { data } = await api.patch(`/inbox/customer/${customerId}/addresses/${addrId}`, { [field]: value });
      if (this.customerCache[customerId]) {
        const addrs = this.customerCache[customerId].addresses || [];
        const idx = addrs.findIndex(a => a.id === addrId);
        if (idx >= 0) Object.assign(addrs[idx], data);
      }
      return data;
    },

    // Order draft actions
    getOrderDraft(conversationId) {
      return this.orderDrafts[conversationId] || null;
    },

    setOrderDraft(conversationId, draft) {
      this.orderDrafts[conversationId] = draft;
    },

    clearOrderDraft(conversationId) {
      delete this.orderDrafts[conversationId];
    },

    async sendInternalNote(conversationId, body) {
      const { data } = await api.post(`/inbox/conversations/${conversationId}/internal-note`, { body });
      return data;
    },

    async updateTags(conversationId, tags) {
      const { data } = await api.patch(`/inbox/conversations/${conversationId}/tags`, { tags });
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], tags: data.tags };
      return data;
    },

    async fetchAllTags() {
      try {
        const { data } = await api.get('/inbox/tags');
        this.allTags = Array.isArray(data) ? data : [];
      } catch (e) { this.allTags = []; }
    },

    setReplyTo(messageId) { this.replyToMessageId = messageId; },
    clearReplyTo() { this.replyToMessageId = null; },
    toggleInternalMode() { this.internalMode = !this.internalMode; },
  },
});
