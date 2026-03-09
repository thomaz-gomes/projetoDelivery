import { defineStore } from 'pinia'
import api from '../api'

export const useSaasStore = defineStore('saas', {
  state: () => ({
    subscription: null,
    moduleSubscriptions: [],
    loading: false,
    error: null,
  }),
  getters: {
    planName: (s) => s.subscription && s.subscription.plan ? s.subscription.plan.name : null,
    menuLimit: (s) => s.subscription && s.subscription.plan ? (s.subscription.plan.unlimitedMenus ? Infinity : s.subscription.plan.menuLimit) : null,
    storeLimit: (s) => s.subscription && s.subscription.plan ? (s.subscription.plan.unlimitedStores ? Infinity : s.subscription.plan.storeLimit) : null,
    enabledModules: (s) => {
      const planKeys = (!s.subscription || !s.subscription.plan)
        ? []
        : (s.subscription.plan.modules || []).map(pm => pm.module?.key || pm.moduleId)
      const addonKeys = (s.moduleSubscriptions || [])
        .filter(ms => ms.status === 'ACTIVE')
        .map(ms => ms.module?.key || ms.moduleKey)
        .filter(Boolean)
      return [...new Set([...planKeys, ...addonKeys])]
    },
    // true se o tenant possui CARDAPIO_SIMPLES mas NÃO possui CARDAPIO_COMPLETO
    isCardapioSimplesOnly() {
      const mods = this.enabledModules.map(k => String(k).toUpperCase())
      if (!mods.length) return false
      return mods.includes('CARDAPIO_SIMPLES') && !mods.includes('CARDAPIO_COMPLETO')
    }
  },
  actions: {
    async fetchMySubscription(force = false) {
      if (this.loading) return this.subscription
      this.loading = true
      this.error = null
      try {
        const [subRes, modsRes] = await Promise.all([
          api.get('/saas/subscription/me'),
          api.get('/saas/module-subscriptions/me').catch(() => ({ data: [] }))
        ])
        this.subscription = subRes.data || null
        this.moduleSubscriptions = modsRes.data || []
        return this.subscription
      } catch (e) {
        this.error = e?.message || String(e)
        this.subscription = null
        this.moduleSubscriptions = []
        return null
      } finally {
        this.loading = false
      }
    }
  }
})
