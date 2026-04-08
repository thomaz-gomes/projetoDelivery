<template>
  <div class="p-3 border-top">
    <div class="fw-semibold small mb-2"><i class="bi bi-bag me-1"></i>Pedido</div>

    <!-- Initial state: only "Iniciar Pedido" button -->
    <div v-if="!draft?.active && !showLastOrderPrompt">
      <button class="btn btn-sm btn-success w-100" @click="onStartClick" :disabled="!customerId">
        <i class="bi bi-plus me-1"></i>Iniciar Pedido
      </button>
      <small v-if="!customerId" class="text-muted d-block mt-1">Vincule um cliente primeiro</small>
    </div>

    <!-- Last order prompt: shown after clicking "Iniciar Pedido" when there's a last order -->
    <div v-else-if="showLastOrderPrompt && lastOrder" class="p-2 bg-light rounded">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="fw-semibold small">Último pedido</span>
        <small class="text-muted">{{ formatDate(lastOrder.createdAt) }}</small>
      </div>
      <div class="small text-muted mb-1">
        <span v-for="(item, i) in lastOrder.items" :key="i">
          {{ item.quantity }}x {{ item.name }}<span v-if="i < lastOrder.items.length - 1">, </span>
        </span>
      </div>
      <div class="d-flex justify-content-between align-items-center mb-2">
        <small class="fw-semibold">R$ {{ Number(lastOrder.total || 0).toFixed(2).replace('.', ',') }}</small>
      </div>
      <div class="d-flex gap-1 flex-wrap">
        <button class="btn btn-sm btn-success flex-fill" @click="repeatOrder" title="Repetir o último pedido">
          <i class="bi bi-arrow-repeat me-1"></i>Repetir
        </button>
        <button class="btn btn-sm btn-outline-primary flex-fill" @click="askRepeat" :disabled="asking" title="Perguntar ao cliente">
          <span v-if="asking" class="spinner-border spinner-border-sm me-1"></span>
          <i v-else class="bi bi-chat-dots me-1"></i>Perguntar
        </button>
      </div>
      <div class="d-flex gap-1 mt-1">
        <button class="btn btn-sm btn-outline-secondary flex-fill" @click="newOrder" title="Pedido novo">
          <i class="bi bi-plus me-1"></i>Pedido novo
        </button>
        <button class="btn btn-sm btn-outline-danger" @click="cancelPrompt" title="Cancelar">
          <i class="bi bi-x"></i>
        </button>
      </div>
    </div>

    <!-- Active wizard -->
    <div v-else-if="draft?.active">
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
    <transition name="fade">
      <div v-if="askedSuccessfully" class="alert alert-success small py-1 mt-2 mb-0">
        <i class="bi bi-check-circle me-1"></i>Mensagem enviada!
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
const showLastOrderPrompt = ref(false);
const asking = ref(false);
const askedSuccessfully = ref(false);

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

// "Iniciar Pedido" handler: if there's a last order, show prompt; else go straight to wizard
function onStartClick() {
  if (props.lastOrder?.items?.length) {
    showLastOrderPrompt.value = true;
  } else {
    startOrder();
  }
}

function startOrder(items) {
  showLastOrderPrompt.value = false;
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

function newOrder() {
  startOrder();
}

function cancelPrompt() {
  showLastOrderPrompt.value = false;
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
    showLastOrderPrompt.value = false;
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
