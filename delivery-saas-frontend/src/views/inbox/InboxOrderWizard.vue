<template>
  <div class="p-3 border-top">
    <div class="fw-semibold small mb-2"><i class="bi bi-bag me-1"></i>Pedido</div>

    <div v-if="!draft || !draft.active">
      <!-- Last order shortcut -->
      <div v-if="lastOrder" class="mb-2 p-2 bg-light rounded">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="fw-semibold small">Ultimo pedido</span>
          <small class="text-muted">{{ formatDate(lastOrder.createdAt) }}</small>
        </div>
        <div class="small text-muted mb-1">
          <span v-for="(item, i) in lastOrder.items" :key="i">
            {{ item.quantity }}x {{ item.name }}<span v-if="i < lastOrder.items.length - 1">, </span>
          </span>
        </div>
        <div class="d-flex justify-content-between align-items-center">
          <small class="fw-semibold">R$ {{ Number(lastOrder.total || 0).toFixed(2).replace('.', ',') }}</small>
          <button class="btn btn-sm btn-outline-success py-0 px-2" @click="repeatOrder" title="Repetir pedido">
            <i class="bi bi-arrow-repeat me-1"></i>Repetir
          </button>
        </div>
      </div>

      <button class="btn btn-sm btn-success w-100" @click="startOrder" :disabled="!customerId">
        <i class="bi bi-plus me-1"></i>Iniciar Pedido
      </button>
      <small v-if="!customerId" class="text-muted d-block mt-1">Vincule um cliente primeiro</small>
    </div>

    <div v-else>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <small class="badge bg-info-subtle text-info">{{ draft.orderType === 'DELIVERY' ? 'Entrega' : 'Balcao' }}</small>
        <button class="btn btn-sm btn-outline-danger" @click="cancelOrder" title="Cancelar pedido">
          <i class="bi bi-x"></i>
        </button>
      </div>
      <POSOrderWizard
        :visible="true"
        :embedded="true"
        :preset="wizardPreset"
        @created="onOrderCreated"
      />
    </div>

    <transition name="fade">
      <div v-if="justCreated" class="alert alert-success small py-1 mt-2 mb-0">
        <i class="bi bi-check-circle me-1"></i>Pedido criado!
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import POSOrderWizard from '@/components/POSOrderWizard.vue';

const props = defineProps({
  conversationId: String,
  customerId: String,
  customerName: String,
  address: Object,
  orderType: { type: String, default: 'DELIVERY' },
  lastOrder: Object,
});

const inboxStore = useInboxStore();
const justCreated = ref(false);

const draft = computed(() => inboxStore.getOrderDraft(props.conversationId));

const wizardPreset = computed(() => ({
  customerId: props.customerId,
  customerName: props.customerName,
  address: props.address,
  orderType: draft.value?.orderType || props.orderType,
  skipCustomer: true,
  skipAddress: true,
  items: draft.value?.items || null,
}));

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}

function startOrder(items) {
  inboxStore.setOrderDraft(props.conversationId, {
    active: true,
    orderType: props.orderType,
    items: items || null,
  });
}

function repeatOrder() {
  if (!props.lastOrder?.items?.length) return;
  const items = props.lastOrder.items.map(it => ({
    productId: it.productId,
    name: it.name,
    quantity: it.quantity,
    price: it.price,
    options: it.options || [],
  }));
  startOrder(items);
}

function cancelOrder() {
  inboxStore.clearOrderDraft(props.conversationId);
}

function onOrderCreated(order) {
  inboxStore.clearOrderDraft(props.conversationId);
  justCreated.value = true;
  setTimeout(() => { justCreated.value = false; }, 3000);
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
