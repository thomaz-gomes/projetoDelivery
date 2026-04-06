import { defineStore } from 'pinia';
import api from '../api';

export const useInboxStore = defineStore('inbox', {
  state: () => ({
    conversations: [],
    activeConversationId: null,
    messages: {}, // { [conversationId]: Message[] }
    unreadTotal: 0,
    quickReplies: [],
    loading: false,
    filters: {
      storeId: null,
      status: 'OPEN',
      search: '',
    },
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
      const idx = this.conversations.findIndex(c => c.id === conversationId);
      if (idx >= 0) {
        this.conversations[idx] = { ...this.conversations[idx], ...convData, messages: [message] };
        const [conv] = this.conversations.splice(idx, 1);
        this.conversations.unshift(conv);
      } else {
        this.conversations.unshift({ ...convData, messages: [message] });
      }
      if (this.messages[conversationId]) {
        this.messages[conversationId].push(message);
      }
      this.recalcUnread();
    },

    handleMessageSent({ conversationId, message }) {
      if (this.messages[conversationId]) {
        const exists = this.messages[conversationId].find(m => m.id === message.id);
        if (!exists) this.messages[conversationId].push(message);
      }
    },

    handleMessageStatus({ messageId, conversationId, status }) {
      if (this.messages[conversationId]) {
        const msg = this.messages[conversationId].find(m => m.id === messageId);
        if (msg) msg.status = status;
      }
    },

    handleConversationUpdated({ conversation }) {
      const idx = this.conversations.findIndex(c => c.id === conversation.id);
      if (idx >= 0) this.conversations[idx] = { ...this.conversations[idx], ...conversation };
    },

    recalcUnread() {
      this.unreadTotal = this.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    },
  },
});
