<template>
  <div class="p-3 border-top">
    <div class="fw-semibold small mb-2"><i class="bi bi-bag me-1"></i>Pedido</div>

    <!-- No customer linked yet -->
    <div v-if="!customerId" class="small text-muted">
      Vincule um cliente primeiro para iniciar um pedido.
    </div>

    <!-- Active wizard (always open when customerId present) -->
    <div v-else-if="draft?.active">
      <!-- Last order suggestion (optional) — shown above the wizard when present and not yet used -->
      <div v-if="lastOrder && showLastOrderHint" class="p-2 bg-light rounded mb-2">
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="fw-semibold small"><i class="bi bi-clock-history me-1"></i>Último pedido</span>
          <button type="button" class="btn btn-sm btn-link p-0 text-muted" @click="dismissLastOrderHint" title="Dispensar">
            <i class="bi bi-x-lg" style="font-size: 0.7rem;"></i>
          </button>
        </div>
        <div class="small text-muted mb-1">
          <span v-for="(item, i) in lastOrder.items" :key="i">
            {{ item.quantity }}x {{ item.name }}<span v-if="i < lastOrder.items.length - 1">, </span>
          </span>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-2">
          <small class="fw-semibold">R$ {{ Number(lastOrder.total || 0).toFixed(2).replace('.', ',') }}</small>
          <small class="text-muted">{{ formatDate(lastOrder.createdAt) }}</small>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-success flex-fill" @click="repeatOrder" title="Preencher carrinho com o último pedido">
            <i class="bi bi-arrow-repeat me-1"></i>Repetir
          </button>
          <button class="btn btn-sm btn-outline-primary flex-fill" @click="askRepeat" :disabled="asking" title="Perguntar ao cliente">
            <span v-if="asking" class="spinner-border spinner-border-sm me-1"></span>
            <i v-else class="bi bi-chat-dots me-1"></i>Perguntar
          </button>
        </div>
      </div>

      <div class="d-flex justify-content-between align-items-center mb-2">
        <small class="badge bg-info-subtle text-info">{{ draft.orderType === 'DELIVERY' ? 'Entrega' : 'Balcão' }}</small>
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
    <transition name="fade">
      <div v-if="askedSuccessfully" class="alert alert-success small py-1 mt-2 mb-0">
        <i class="bi bi-check-circle me-1"></i>Mensagem enviada!
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
  orderType: { type: String, default: 'DELIVERY' },
  lastOrder: Object,
});

const inboxStore = useInboxStore();
const justCreated = ref(false);
const asking = ref(false);
const askedSuccessfully = ref(false);
const showLastOrderHint = ref(true);

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

// Auto-start the wizard whenever a customer is linked and no draft is active.
// The last-order suggestion is shown above the wizard (not as a separate step).
watch(
  () => [props.customerId, props.conversationId],
  ([cid]) => {
    if (!cid) return;
    if (draft.value?.active) return;
    startOrder();
  },
  { immediate: true }
);

// Reset the hint whenever the conversation changes
watch(() => props.conversationId, () => {
  showLastOrderHint.value = true;
});

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
  // Replace the current draft items (keeps the wizard open)
  inboxStore.setOrderDraft(props.conversationId, {
    active: true,
    orderType: draft.value?.orderType || props.orderType,
    items,
  });
  showLastOrderHint.value = false;
}

function dismissLastOrderHint() {
  showLastOrderHint.value = false;
}

async function askRepeat() {
  if (!props.lastOrder?.items?.length || asking.value) return;
  asking.value = true;
  try {
    const itemsText = props.lastOrder.items
      .map(it => `• ${it.quantity}x ${it.name}`)
      .join('\n');
    const total = Number(props.lastOrder.total || 0).toFixed(2).replace('.', ',');
    const body =
      `Olá! 👋\n\nSeu último pedido foi:\n${itemsText}\n\nTotal: *R$ ${total}*\n\n` +
      `Deseja repetir o pedido? 😊`;
    await inboxStore.sendMessage(props.conversationId, { type: 'TEXT', body });
    askedSuccessfully.value = true;
    setTimeout(() => { askedSuccessfully.value = false; }, 3000);
  } catch (e) {
    console.error('Erro ao enviar pergunta', e);
  } finally {
    asking.value = false;
  }
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
