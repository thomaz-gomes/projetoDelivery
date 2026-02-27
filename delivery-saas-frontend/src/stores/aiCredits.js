import { defineStore } from 'pinia'
import { ref } from 'vue'
import api from '../api.js'

export const useAiCreditsStore = defineStore('aiCredits', () => {
  const balance = ref(null)       // null = ainda não carregado
  const monthlyLimit = ref(100)
  const lastReset = ref(null)
  const nextReset = ref(null)
  const loading = ref(false)
  const error = ref(null)

  async function fetch() {
    loading.value = true
    error.value = null
    try {
      const res = await api.get('/ai-credits/balance')
      balance.value = res.data.balance
      monthlyLimit.value = res.data.monthlyLimit
      lastReset.value = res.data.lastReset ? new Date(res.data.lastReset) : null
      nextReset.value = res.data.nextReset ? new Date(res.data.nextReset) : null
    } catch (err) {
      error.value = err?.response?.data?.message || 'Erro ao carregar créditos'
    } finally {
      loading.value = false
    }
  }

  /** Verifica se há créditos suficientes para uma operação */
  function hasCredits(amount = 1) {
    return (balance.value ?? 0) >= amount
  }

  /** Percentual de créditos restantes (0-100) */
  function percent() {
    if (!monthlyLimit.value) return 0
    return Math.min(100, Math.round(((balance.value ?? 0) / monthlyLimit.value) * 100))
  }

  /** Data formatada do próximo reset (DD/MM) */
  function nextResetFormatted() {
    const date = nextReset.value
    if (!date) return null
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  /** Classe Bootstrap do progresso baseado no saldo restante */
  function progressVariant() {
    const pct = percent()
    if (pct >= 50) return 'success'
    if (pct >= 20) return 'warning'
    return 'danger'
  }

  return {
    balance,
    monthlyLimit,
    lastReset,
    nextReset,
    loading,
    error,
    fetch,
    hasCredits,
    percent,
    nextResetFormatted,
    progressVariant,
  }
})
