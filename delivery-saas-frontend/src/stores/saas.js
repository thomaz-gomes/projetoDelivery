import { defineStore } from 'pinia'
import api from '../api'

export const useSaasStore = defineStore('saas', {
  state: () => ({
    subscription: null,
    loading: false,
    error: null,
  }),
  getters: {
    planName: (s) => s.subscription && s.subscription.plan ? s.subscription.plan.name : null,
    menuLimit: (s) => s.subscription && s.subscription.plan ? (s.subscription.plan.unlimitedMenus ? Infinity : s.subscription.plan.menuLimit) : null,
    storeLimit: (s) => s.subscription && s.subscription.plan ? (s.subscription.plan.unlimitedStores ? Infinity : s.subscription.plan.storeLimit) : null,
    enabledModules: (s) => {
      if (!s.subscription || !s.subscription.plan) return []
      return (s.subscription.plan.modules || []).map(pm => pm.module?.key || pm.moduleId)
    },
    // true se o tenant possui CARDAPIO_SIMPLES mas NÃO possui CARDAPIO_COMPLETO
    isCardapioSimplesOnly: (s) => {
      if (!s.subscription || !s.subscription.plan) return false
      const mods = (s.subscription.plan.modules || []).map(pm => String(pm.module?.key || '').toUpperCase())
      return mods.includes('CARDAPIO_SIMPLES') && !mods.includes('CARDAPIO_COMPLETO')
    }
  },
  actions: {
    async fetchMySubscription(force = false) {
      if (this.loading) return this.subscription
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/saas/subscription/me')
        this.subscription = data || null
        return this.subscription
      } catch (e) {
        this.error = e?.message || String(e)
        this.subscription = null
        return null
      } finally {
        this.loading = false
      }
    }
  }
})
