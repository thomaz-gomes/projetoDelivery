<template>
  <div class="affiliate-payment-form">
      <div class="affiliate-info mb-3" v-if="affiliate">
      <strong class="d-block mb-1">{{ affiliate.name }}</strong>
      <div class="contact-info text-muted mb-1">{{ affiliate.email || '' }} {{ affiliate.whatsapp || '' }}</div>
      <div class="balance">Saldo disponível: <span class="fw-bold">{{ formatCurrency(affiliate.currentBalance) }}</span></div>
    </div>

    <form @submit.prevent="submit">
      <div class="form-group">
        <label for="amount">Valor do Pagamento (R$)</label>
        <div class="d-flex align-items-center">
          <CurrencyInput id="amount" v-model="form.amount" :min="0.01" :max="affiliate?.currentBalance || null" placeholder="0,00" required />
          <button type="button" class="btn btn-sm btn-outline-secondary btn-max ms-2" @click.prevent="setMax">MAX</button>
        </div>
      </div>

      <div class="form-group">
        <label for="method">Método</label>
        <SelectInput  id="method" class="form-select"  v-model="form.method" >
          <option value="">Selecione...</option>
          <option value="PIX">PIX</option>
          <option value="TED">TED</option>
          <option value="Dinheiro">Dinheiro</option>
          <option value="Crédito em conta">Crédito em conta</option>
        </SelectInput>
      </div>

      <div class="form-group">
        <label for="note">Observação (opcional)</label>
        <textarea id="note" class="form-control" v-model="form.note" rows="3"></textarea>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-outline-secondary" @click.prevent="$emit('cancel')">Cancelar</button>
        <button type="submit" class="btn btn-primary" :disabled="processing || !canSubmit">
          {{ processing ? 'Processando...' : 'Confirmar Pagamento' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script>
import { ref, computed, watch } from 'vue'
import { formatCurrency } from '../utils/formatters.js'

export default {
  name: 'AffiliatePaymentForm',
  props: {
    affiliate: { type: Object, default: null },
    initialAmount: { type: Number, default: 0 },
    processing: { type: Boolean, default: false }
  },
  emits: ['submit', 'cancel'],
  setup(props, { emit }) {
    const form = ref({ amount: props.initialAmount || '', method: '', note: '' })

    watch(() => props.initialAmount, (v) => {
      form.value.amount = v || ''
    })

    const setMax = () => {
      form.value.amount = Number(props.affiliate?.currentBalance || 0)
    }

    const canSubmit = computed(() => {
      const amt = Number(form.value.amount || 0)
      return amt > 0 && amt <= Number(props.affiliate?.currentBalance || 0)
    })

    const submit = () => {
      if (!canSubmit.value) return
      emit('submit', { ...form.value })
    }

    return { form, setMax, canSubmit, submit, formatCurrency }
  }
}
</script>

<style scoped>
.affiliate-payment-form { padding: 0 }
.form-group { margin-bottom: 16px }
.form-actions { display:flex; gap:12px; justify-content:flex-end }
.btn-primary { background:#3498db; color:white; padding:8px 16px; border-radius:6px }
.btn-secondary { background:#f8f9fa; padding:8px 16px; border-radius:6px }
.btn-max { margin-left:8px }
.balance { margin-top:6px; font-weight:600 }
.contact-info { font-size:0.9rem }
</style>
