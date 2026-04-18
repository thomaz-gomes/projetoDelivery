<script setup>
import { computed } from 'vue';

const props = defineProps({
  order: { type: Object, required: true },
  gpsStatus: { type: String, default: '' },
  arrivalNotified: { type: Boolean, default: false },
  arrivalSending: { type: Boolean, default: false },
});
const emit = defineEmits(['dismiss', 'mark-delivered', 'notify-arrival', 'open-maps', 'call', 'whatsapp']);

function formatMoney(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
}

function hasDiscount(o) {
  if (!o) return false;
  return Number(o.couponDiscount || 0) > 0 || Number(o.discountMerchant || 0) > 0 ||
    Number(o.payload?.order?.total?.benefits || 0) > 0;
}

function customerCharge(o) {
  return Number(o?.total || 0);
}

const address = computed(() => {
  const o = props.order;
  if (!o) return '';
  const a = o.payload?.delivery?.deliveryAddress || o.address || o.deliveryAddress || o.payload?.rawPayload?.address;
  if (typeof a === 'string') return a;
  if (!a) return '';
  const parts = [];
  if (a.street || a.streetName) parts.push(a.street || a.streetName);
  if (a.number || a.streetNumber) parts.push(a.number || a.streetNumber);
  if (a.neighborhood) parts.push(a.neighborhood);
  if (a.complement) parts.push('Comp: ' + a.complement);
  if (a.reference) parts.push('Ref: ' + a.reference);
  return parts.join(', ') || a.formattedAddress || '';
});

const hasCoords = computed(() => {
  const a = props.order?.payload?.delivery?.deliveryAddress || props.order?.address;
  return a && a.latitude && a.longitude;
});

const mapsUrl = computed(() => {
  const a = props.order?.payload?.delivery?.deliveryAddress || props.order?.address;
  if (a?.latitude && a?.longitude) return `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}`;
  if (address.value) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.value)}`;
  return '#';
});
</script>

<template>
  <div class="adf">
    <!-- Header -->
    <div class="adf__header">
      <button class="adf__dismiss" @click="emit('dismiss')">
        <i class="bi bi-chevron-down"></i>
      </button>
      <div class="adf__status">
        <span class="adf__pulse"></span>
        Em entrega
      </div>
      <div class="adf__order-id">#{{ order.displayId || order.displaySimple }}</div>
    </div>

    <!-- Map placeholder / Navigate button -->
    <a :href="mapsUrl" target="_blank" class="adf__map-area" @click.stop>
      <div class="adf__map-content">
        <i class="bi bi-map" style="font-size:2.5rem;opacity:0.6"></i>
        <div class="adf__map-label">
          <i class="bi bi-cursor-fill me-1"></i>Abrir navegação
        </div>
      </div>
    </a>

    <!-- Info -->
    <div class="adf__info">
      <div class="adf__address">
        <i class="bi bi-geo-alt-fill text-danger me-2"></i>
        <span>{{ address || 'Endereço não informado' }}</span>
      </div>

      <div class="adf__customer">
        <div class="adf__customer-name">
          <i class="bi bi-person-fill me-2"></i>{{ order.customerName || 'Cliente' }}
        </div>
        <div v-if="order.customerPhone" class="adf__customer-actions">
          <a :href="'tel:' + order.customerPhone" class="adf__action-btn" @click.stop>
            <i class="bi bi-telephone-fill"></i>
          </a>
          <a :href="'https://wa.me/55' + String(order.customerPhone).replace(/\\D/g,'')" target="_blank" class="adf__action-btn adf__action-btn--wa" @click.stop>
            <i class="bi bi-whatsapp"></i>
          </a>
        </div>
      </div>

      <div class="adf__total">
        <span>Total:</span>
        <span class="fw-bold">{{ formatMoney(order.total) }}</span>
      </div>
      <div v-if="hasDiscount(order)" class="adf__total" style="font-size: 0.85rem; color: var(--success-dark, #6DAE1E);">
        <span>Cobrar:</span>
        <span class="fw-bold">{{ formatMoney(customerCharge(order)) }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="adf__actions">
      <button
        v-if="order.customerPhone && !arrivalNotified"
        class="adf__btn adf__btn--outline"
        :disabled="arrivalSending"
        @click="emit('notify-arrival')"
      >
        <i class="bi bi-whatsapp me-2"></i>
        {{ arrivalSending ? 'Enviando...' : 'Avisar Chegada' }}
      </button>
      <div v-else-if="arrivalNotified" class="adf__notified">
        <i class="bi bi-check2-circle me-1"></i>Cliente notificado
      </div>
      <button class="adf__btn adf__btn--primary" @click="emit('mark-delivered')">
        <i class="bi bi-check-circle-fill me-2"></i>Marcar Entregue
      </button>
    </div>
  </div>
</template>

<style scoped>
.adf {
  position: fixed;
  inset: 0;
  z-index: 1045;
  background: var(--rider-bg, #f0f2f5);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.adf__header {
  background: var(--rider-primary, #198754);
  color: #fff;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.adf__dismiss {
  background: rgba(255,255,255,0.15);
  border: none;
  color: #fff;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}
.adf__status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.9rem;
}
.adf__pulse {
  width: 10px;
  height: 10px;
  background: #4caf50;
  border-radius: 50%;
  animation: adf-pulse 1.5s infinite;
}
@keyframes adf-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
}
.adf__order-id {
  margin-left: auto;
  font-weight: 700;
  font-size: 1.1rem;
}

.adf__map-area {
  flex: 1;
  min-height: 180px;
  max-height: 280px;
  background: #e8e8e8;
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  color: var(--rider-text, #1a1a1a);
  position: relative;
}
.adf__map-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.adf__map-label {
  background: var(--rider-primary, #198754);
  color: #fff;
  padding: 8px 20px;
  border-radius: 24px;
  font-weight: 600;
  font-size: 0.9rem;
}

.adf__info {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.adf__address {
  display: flex;
  align-items: flex-start;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.4;
}
.adf__customer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.adf__customer-name {
  font-size: 0.95rem;
  color: var(--rider-text-secondary, #6c757d);
}
.adf__customer-actions {
  display: flex;
  gap: 8px;
}
.adf__action-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--rider-card, #fff);
  border: 1px solid var(--rider-card-border, rgba(0,0,0,0.1));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #0d6efd;
  font-size: 1.1rem;
  text-decoration: none;
  box-shadow: var(--rider-shadow);
}
.adf__action-btn--wa { color: #25d366; }
.adf__total {
  display: flex;
  justify-content: space-between;
  font-size: 1.1rem;
  padding: 12px 16px;
  background: var(--rider-card, #fff);
  border-radius: var(--rider-radius-sm, 10px);
}

.adf__actions {
  padding: 16px 20px;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.adf__btn {
  width: 100%;
  padding: 16px;
  border-radius: var(--rider-radius, 16px);
  font-size: 1.1rem;
  font-weight: 700;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.adf__btn--primary {
  background: var(--rider-primary, #198754);
  color: #fff;
}
.adf__btn--primary:active { background: var(--rider-primary-dark, #157347); transform: scale(0.98); }
.adf__btn--outline {
  background: transparent;
  border: 2px solid var(--rider-primary, #198754);
  color: var(--rider-primary, #198754);
}
.adf__btn--outline:active { background: rgba(25,135,84,0.05); transform: scale(0.98); }
.adf__notified {
  text-align: center;
  color: var(--rider-primary, #198754);
  font-weight: 600;
  padding: 8px;
}
</style>
