<template>
  <div class="mb-3">
    <div class="card">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-center mb-3">
          <h5 class="card-title mb-0">MARKETPLACE</h5>
          <small class="text-muted">Auxiliar de precificação para marketplaces</small>
        </div>

        <div class="row">
          <!-- Left (inputs) -->
          <div class="col-md-8">
            <div class="row g-3">
              <div class="col-12">
                <div class="card border-0 bg-light">
                  <div class="card-body py-3">
                    <div class="small text-muted">CMV (Ficha Técnica)</div>
                    <div class="h5 fw-bold mt-1">R$ {{ cmv.toFixed(2) }}</div>
                  </div>
                </div>
              </div>

              <div class="col-12">
                <div class="card">
                  <div class="card-body">
                    <h6 class="mb-3">Configuração iFood / Marketplace</h6>
                    <div class="row g-2">
                      <div class="col-sm-6">
                        <label class="form-label small">Taxa Marketplace (%)</label>
                        <div class="input-group">
                          <input class="form-control" v-model.number="marketplaceFeePercent" type="number" step="0.01" min="0" max="100" />
                          <span class="input-group-text">%</span>
                        </div>
                      </div>

                      <div class="col-sm-6">
                        <label class="form-label small">Taxa Pagamento Online (%)</label>
                        <div class="input-group">
                          <input class="form-control" v-model.number="paymentFeePercent" type="number" step="0.01" min="0" max="100" />
                          <span class="input-group-text">%</span>
                        </div>
                      </div>

                      <div class="col-12">
                        <label class="form-label small">Margem Líquida Desejada (%)</label>
                        <div class="input-group">
                          <input class="form-control" v-model.number="desiredMarginPercent" type="number" step="0.01" min="0" max="100" />
                          <span class="input-group-text">%</span>
                        </div>
                      </div>

                      <div class="col-sm-6">
                        <label class="form-label small">Custo Embalagem (R$)</label>
                        <div class="input-group">
                          <span class="input-group-text">R$</span>
                          <input class="form-control" v-model.number="packagingCost" type="number" step="0.01" min="0" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="col-12">
                <div class="card">
                  <div class="card-body">
                    <h6 class="mb-3">Cupom / Promoção (restaurante absorve)</h6>
                    <div class="d-flex gap-2 align-items-center">
                      <select class="form-select w-auto" v-model="couponType">
                        <option value="fixed">R$ (fixo)</option>
                        <option value="percent">% (percentual)</option>
                      </select>
                      <div class="input-group flex-grow-1">
                        <input class="form-control" v-model.number="couponValue" type="number" step="0.01" min="0" />
                        <span class="input-group-text">{{ couponType === 'percent' ? '%' : 'R$' }}</span>
                      </div>
                      <small class="text-muted">Valor que o restaurante absorve no cupom</small>
                    </div>
                  </div>
                </div>
              </div>

              <div class="col-12">
                <div class="card">
                  <div class="card-body">
                    <h6 class="mb-3">Logística</h6>
                    <div class="form-check form-switch mb-2">
                      <input class="form-check-input" type="checkbox" v-model="freeDelivery" id="freeDeliverySwitch" />
                      <label class="form-check-label small" for="freeDeliverySwitch">Entrega Grátis para o Cliente?</label>
                    </div>

                    <div v-if="freeDelivery" class="mt-2">
                      <label class="form-label small">Custo de Entrega para o Restaurante (R$)</label>
                      <div class="input-group">
                        <span class="input-group-text">R$</span>
                        <input class="form-control" v-model.number="deliveryCostForRestaurant" type="number" step="0.01" min="0" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right (summary) -->
          <div class="col-md-4">
            <div class="card mb-3 text-center">
              <div class="card-body">
                <div class="small text-muted">Preço Sugerido</div>
                <div class="display-6 fw-bold">{{ suggestedPriceDisplay }}</div>
                <div class="small text-muted mt-2">Recalculado automaticamente</div>
                <div class="d-grid gap-2 mt-3">
                  <button class="btn btn-outline-primary btn-sm" @click="$emit('applyPrice', calc.suggestedPrice)">Copiar preço sugerido</button>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-2">
                  <div class="small text-muted">Lucro Líquido</div>
                  <div :class="['fw-semibold', calc.netProfit !== null && calc.netProfit >= 0 ? 'text-success' : 'text-danger']">{{ netProfitDisplay }}</div>
                </div>

                <div v-if="!calc.denominatorValid" class="text-danger small mb-2">Denominador inválido (≤ 0). Ajuste taxas/margem/cupom.</div>

                <dl class="row small text-muted">
                  <div class="col-7">CMV</div><div class="col-5 text-end">R$ {{ cmv.toFixed(2) }}</div>
                  <div class="col-7">Embalagem</div><div class="col-5 text-end">R$ {{ packagingCost.toFixed(2) }}</div>
                  <div class="col-7">Entrega (rest.)</div><div class="col-5 text-end">R$ {{ (freeDelivery ? deliveryCostForRestaurant : 0).toFixed(2) }}</div>
                  <div class="col-7">Taxa Mkpt</div><div class="col-5 text-end">R$ {{ calc.marketplaceFeeAmount.toFixed(2) }}</div>
                  <div class="col-7">Taxa Pagto</div><div class="col-5 text-end">R$ {{ calc.paymentFeeAmount.toFixed(2) }}</div>
                  <div class="col-7">Cupom</div><div class="col-5 text-end">R$ {{ calc.couponAmount.toFixed(2) }}</div>
                  <div class="col-12 border-top mt-2 pt-2 fw-semibold"><div class="d-flex justify-content-between"><span>Total custo base</span><span>R$ {{ calc.totalCostBase.toFixed(2) }}</span></div></div>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, watch, ref } from 'vue'
import type { MarketplaceDTO, Coupon, ComputeResult } from './marketplaceTypes'
import { computeSuggestedPrice, mapToDTO } from './marketplaceTypes'

interface Props {
  cmv: number
  initial?: Partial<MarketplaceDTO>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'change', dto: MarketplaceDTO, calc: ComputeResult): void
  (e: 'applyPrice', price: number | null): void
}>()

const cmv = props.cmv ?? 0

const initial = props.initial ?? {}

const marketplaceFeePercent = ref<number>(initial.marketplaceFeePercent ?? 12)
const paymentFeePercent = ref<number>(initial.paymentFeePercent ?? 3.2)
const desiredMarginPercent = ref<number>(initial.desiredMarginPercent ?? 20)
const packagingCost = ref<number>(initial.packagingCost ?? 0)

const couponType = ref<'fixed' | 'percent'>(initial.coupon?.type ?? 'fixed')
const couponValue = ref<number>(initial.coupon ? initial.coupon.value : 0)

const freeDelivery = ref<boolean>(initial.freeDelivery ?? false)
const deliveryCostForRestaurant = ref<number>(initial.deliveryCostForRestaurant ?? 0)

const coupon = computed<Coupon | null>(() => {
  if (!couponValue.value) return null
  return { type: couponType.value, value: couponValue.value }
})

const calc = computed(() => {
  return computeSuggestedPrice(
    cmv,
    packagingCost.value,
    freeDelivery.value ? deliveryCostForRestaurant.value : 0,
    marketplaceFeePercent.value,
    paymentFeePercent.value,
    desiredMarginPercent.value,
    coupon.value
  )
})

const suggestedPriceDisplay = computed(() => (calc.value.suggestedPrice !== null ? `R$ ${calc.value.suggestedPrice.toFixed(2)}` : '—'))
const netProfitDisplay = computed(() => (calc.value.netProfit !== null ? `R$ ${calc.value.netProfit.toFixed(2)}` : '—'))

watch([
  marketplaceFeePercent,
  paymentFeePercent,
  desiredMarginPercent,
  packagingCost,
  couponType,
  couponValue,
  freeDelivery,
  deliveryCostForRestaurant
], () => {
  const dto = mapToDTO({
    marketplaceFeePercent: marketplaceFeePercent.value,
    paymentFeePercent: paymentFeePercent.value,
    desiredMarginPercent: desiredMarginPercent.value,
    coupon: coupon.value,
    freeDelivery: freeDelivery.value,
    deliveryCostForRestaurant: deliveryCostForRestaurant.value,
    packagingCost: packagingCost.value
  })
  emit('change', dto, calc.value)
}, { immediate: true })
</script>

<style scoped>
/* keep styles minimal; Bootstrap provides main UI */
</style>
/* Removed duplicated/malformed template+script at end — keeping single valid SFC */
