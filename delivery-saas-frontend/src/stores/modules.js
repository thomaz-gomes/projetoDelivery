import { defineStore } from 'pinia'
import api from '../api'

export const useModulesStore = defineStore('modules', {
  state: () => ({
    enabled: [],
    loading: false,
    loadedAt: 0,
    error: null,
  }),
  getters: {
    has: (state) => (key) => {
      if (!key) return false
      const k = String(key).toLowerCase()
      return state.enabled.some((m) => String(m).toLowerCase() === k)
    },
  },
  actions: {
    async fetchEnabled(force = false) {
      if (this.loading) return this.enabled
      const freshMs = 60000
      if (!force && this.loadedAt && (Date.now() - this.loadedAt) < freshMs) return this.enabled
      this.loading = true
      this.error = null
      try {
        const { data } = await api.get('/saas/modules/me')
        const arr = (data && Array.isArray(data.enabled)) ? data.enabled : []
        this.enabled = arr
        this.loadedAt = Date.now()
        return this.enabled
      } catch (e) {
        this.error = e?.message || String(e)
        this.enabled = []
        return []
      } finally {
        this.loading = false
      }
    },
  },
})
