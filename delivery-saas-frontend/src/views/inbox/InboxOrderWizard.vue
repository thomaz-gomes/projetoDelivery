<template>
  <div class="p-3 border-top">
    <div class="fw-semibold small mb-2"><i class="bi bi-bag me-1"></i>Pedido</div>

    <div v-if="!draft || !draft.active">
      <div class="mb-2">
        <select class="form-select form-select-sm" v-model="orderType">
          <option value="BALCAO">Balcao (retirada)</option>
          <option value="DELIVERY">Entrega</option>
        </select>
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
import { ref, computed, watch } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import POSOrderWizard from '@/components/POSOrderWizard.vue';

const props = defineProps({
  conversationId: String,
  customerId: String,
  customerName: String,
  address: Object,
});

const inboxStore = useInboxStore();
const orderType = ref('BALCAO');
const justCreated = ref(false);

const draft = computed(() => inboxStore.getOrderDraft(props.conversationId));

const wizardPreset = computed(() => ({
  customerId: props.customerId,
  customerName: props.customerName,
  address: props.address,
  orderType: draft.value?.orderType || orderType.value,
  skipCustomer: true,
  skipAddress: true,
}));

function startOrder() {
  inboxStore.setOrderDraft(props.conversationId, {
    active: true,
    orderType: orderType.value,
  });
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
