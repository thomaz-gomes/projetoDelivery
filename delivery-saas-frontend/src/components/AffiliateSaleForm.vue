<template>
  <div class="affiliate-sale-form">
    <div class="affiliate-info" v-if="affiliate">
      <strong>{{ affiliate.name }}</strong>
      <div class="contact-info">{{ affiliate.email || '' }} {{ affiliate.whatsapp || '' }}</div>
      <div class="rate">Taxa: {{ (Number(affiliate.commissionRate || 0) * 100).toFixed(1) }}%</div>
    </div>

    <form @submit.prevent="submit">
      <div class="form-group">
        <label for="saleAmount">Valor da Venda (R$)</label>
        <input id="saleAmount" type="number" v-model.number="form.saleAmount" min="0.01" step="0.01" required />
      </div>

      <div class="form-group">
        <label for="note">Observação (opcional)</label>
        <textarea id="note" v-model="form.note" rows="3"></textarea>
      </div>

      <div class="commission-preview" v-if="form.saleAmount && affiliate">
        Comissão: R$ {{ (Number(form.saleAmount) * Number(affiliate.commissionRate || 0)).toFixed(2) }} ({{ (Number(affiliate.commissionRate || 0) * 100).toFixed(1) }}%)
      </div>

      <div class="form-actions">
        <button type="button" class="btn-secondary" @click.prevent="$emit('cancel')">Cancelar</button>
        <button type="submit" class="btn-primary" :disabled="processing">{{ processing ? 'Processando...' : submitLabel }}</button>
      </div>
    </form>
  </div>
</template>

<script>
import { ref, watch, computed } from 'vue'

export default {
  name: 'AffiliateSaleForm',
  props: {
    affiliate: { type: Object, default: null },
    initialAmount: { type: Number, default: 0 },
    processing: { type: Boolean, default: false },
    submitLabel: { type: String, default: 'Registrar Venda' }
  },
  emits: ['submit', 'cancel'],
  setup(props, { emit }) {
    const form = ref({ saleAmount: props.initialAmount || '', note: '' })

    watch(() => props.initialAmount, (v) => {
      form.value.saleAmount = v || ''
    })

    const submit = () => {
      if (!form.value.saleAmount) return
      emit('submit', { saleAmount: Number(form.value.saleAmount), note: form.value.note })
    }

    return { form, submit }
  }
}
</script>

<style scoped>
.affiliate-sale-form { padding: 8px }
.form-group { margin-bottom: 12px }
.commission-preview { margin-top: 8px; font-weight: 600 }
.form-actions { display:flex; gap:12px; justify-content:flex-end }
.btn-primary { background:#3498db; color:white; padding:8px 16px; border-radius:6px }
.btn-secondary { background:#f8f9fa; padding:8px 16px; border-radius:6px }
</style>
