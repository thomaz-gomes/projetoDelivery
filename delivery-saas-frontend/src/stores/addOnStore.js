import { defineStore } from 'pinia'
import api from '../api'

export const useAddOnStoreStore = defineStore('addOnStore', {
  state: () => ({
    modules: [],
    creditPacks: [],
    loading: false,
    error: null
  }),

  actions: {
    async fetchStoreModules() {
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/saas/store/modules')
        this.modules = data
      } catch (e) {
        this.error = e?.response?.data?.message || 'Erro ao carregar módulos'
      } finally {
        this.loading = false
      }
    },

    async fetchCreditPacks() {
      try {
        const { data } = await api.get('/saas/credit-packs/available')
        this.creditPacks = data
      } catch (e) {
        this.error = e?.response?.data?.message || 'Erro ao carregar pacotes'
      }
    },

    async subscribeToModule(moduleId, period = 'MONTHLY') {
      const { data } = await api.post('/payment/create-preference', {
        type: 'MODULE',
        referenceId: moduleId,
        period
      })
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return data
      }
      await this.fetchStoreModules()
      return data
    },

    async cancelModuleSubscription(moduleId) {
      const { data } = await api.delete(`/saas/module-subscriptions/${moduleId}`)
      await this.fetchStoreModules()
      return data
    },

    async purchaseCreditPack(packId) {
      const { data } = await api.post('/payment/create-preference', {
        type: 'CREDIT_PACK',
        referenceId: packId
      })
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return data
      }
      return data
    },

    async payInvoice(invoiceId) {
      const { data } = await api.post('/payment/create-preference', { invoiceId })
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
        return data
      }
      return data
    },

    async checkPaymentStatus(paymentId) {
      const { data } = await api.get(`/payment/status/${paymentId}`)
      return data
    }
  }
})
