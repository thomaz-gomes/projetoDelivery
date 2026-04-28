<template>
  <div class="d-flex flex-column h-100 bg-white" style="min-height:0">

    <!-- Step indicator (only when order active) -->
    <div v-if="customerId && draft?.active" class="px-3 py-2 border-bottom bg-light d-flex align-items-center gap-1" style="flex-shrink:0">
      <template v-for="(label, i) in activeStepLabels" :key="i">
        <div class="d-flex align-items-center gap-1 flex-shrink-0">
          <span
            class="rounded-circle d-inline-flex align-items-center justify-content-center fw-bold"
            style="width:20px;height:20px;font-size:0.65rem;flex-shrink:0"
            :style="panelStep===i+1 ? 'background:#0d6efd;color:#fff' : panelStep>i+1 ? 'background:#198754;color:#fff' : 'background:#dee2e6;color:#6c757d'"
          >
            <i v-if="panelStep>i+1" class="bi bi-check" style="font-size:0.6rem"></i>
            <span v-else>{{ i+1 }}</span>
          </span>
          <span class="small" :class="panelStep===i+1 ? 'fw-semibold' : 'text-muted'" style="font-size:0.7rem;white-space:nowrap">{{ label }}</span>
        </div>
        <div v-if="i < activeStepLabels.length-1" style="flex:1;height:1px;min-width:6px;background:#dee2e6"></div>
      </template>
      <button class="btn btn-link btn-sm p-0 text-danger ms-2 flex-shrink-0" @click="cancelOrder" title="Cancelar pedido">
        <i class="bi bi-x-lg" style="font-size:0.75rem"></i>
      </button>
    </div>

    <!-- Scrollable content area -->
    <div class="flex-grow-1 overflow-auto" style="min-height:0">

      <ContactInfo
        :customer-id="customerId"
        :phone="conversation?.channelContactId"
        :conversation-id="conversationId"
        :contact-name="conversation?.contactName"
      />

      <!-- No customer linked -->
      <div v-if="!customerId" class="p-3 border-top small text-muted">
        Vincule um cliente para iniciar um pedido.
      </div>

      <!-- Customer linked, no active order -->
      <div v-else-if="!draft?.active" class="p-3 border-top">
        <button class="btn btn-primary w-100 btn-sm" @click="startOrder">
          <i class="bi bi-bag-plus me-1"></i>Iniciar pedido
        </button>
      </div>

      <!-- Active order: step content -->
      <template v-else>

        <!-- Step 1: Order type + last order hint -->
        <div v-if="panelStep === 1" class="p-3 border-top">
          <div class="fw-semibold small mb-2"><i class="bi bi-bag me-1"></i>Tipo de pedido</div>
          <select class="form-select form-select-sm mb-3" v-model="orderType">
            <option value="DELIVERY">Entrega</option>
            <option value="BALCAO">Balcão (retirada)</option>
          </select>

          <div v-if="lastOrder && showLastOrderHint" class="p-2 bg-light rounded border">
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="fw-semibold small"><i class="bi bi-clock-history me-1"></i>Último pedido</span>
              <button type="button" class="btn btn-sm btn-link p-0 text-muted" @click="showLastOrderHint=false">
                <i class="bi bi-x-lg" style="font-size:0.65rem"></i>
              </button>
            </div>
            <div class="small text-muted mb-1">
              <span v-for="(item, i) in lastOrder.items" :key="i">
                {{ item.quantity }}x {{ item.name }}<span v-if="i < lastOrder.items.length-1">, </span>
              </span>
            </div>
            <div class="d-flex justify-content-between align-items-center mb-2">
              <small class="fw-semibold">R$ {{ Number(lastOrder.total||0).toFixed(2).replace('.',',') }}</small>
              <small class="text-muted">{{ formatDate(lastOrder.createdAt) }}</small>
            </div>
            <div class="d-flex gap-1">
              <button class="btn btn-sm btn-success flex-fill" @click="repeatOrder">
                <i class="bi bi-arrow-repeat me-1"></i>Repetir
              </button>
              <button class="btn btn-sm btn-outline-primary flex-fill" @click="askRepeat" :disabled="asking">
                <span v-if="asking" class="spinner-border spinner-border-sm me-1"></span>
                <i v-else class="bi bi-chat-dots me-1"></i>Perguntar
              </button>
            </div>
          </div>
        </div>

        <!-- Step 2: Address (DELIVERY only) -->
        <div v-else-if="panelStep === 2 && orderType === 'DELIVERY'">
          <ContactAddress :customer-id="customerId" @address-selected="onAddressSelected" />
        </div>

        <!-- Steps 3+4: POSOrderWizard (kept mounted after first visit to avoid cart loss) -->
        <div v-if="posWizardMounted" v-show="showPosWizard">
          <POSOrderWizard
            ref="posRef"
            :visible="true"
            :embedded="true"
            :preset="wizardPreset"
            :force-step="posForceStep"
            @created="onOrderCreated"
            @cart-update="onCartUpdate"
          />
        </div>

        <transition name="fade">
          <div v-if="justCreated" class="alert alert-success small py-2 mx-3 mt-2">
            <i class="bi bi-check-circle me-1"></i>Pedido criado com sucesso!
          </div>
        </transition>
        <transition name="fade">
          <div v-if="askedSuccessfully" class="alert alert-success small py-2 mx-3 mt-2">
            <i class="bi bi-check-circle me-1"></i>Mensagem enviada!
          </div>
        </transition>

      </template>
    </div>

    <!-- Footer: coupon + totals + navigation -->
    <div v-if="customerId && draft?.active" class="border-top p-3 bg-light" style="flex-shrink:0">

      <!-- Coupon -->
      <div class="mb-2">
        <div v-if="cart.couponApplied" class="d-flex align-items-center justify-content-between small text-success mb-1 px-2 py-1 rounded" style="background:rgba(25,135,84,0.08)">
          <span><i class="bi bi-tag-fill me-1"></i>Cupom <strong>{{ cart.couponInfo?.code }}</strong></span>
          <div class="d-flex align-items-center gap-2">
            <span class="fw-semibold">-{{ formatCurrency(cart.couponDiscount) }}</span>
            <button class="btn btn-link btn-sm p-0 text-danger" @click="posRef?.removeCoupon()" style="line-height:1;font-size:1rem">×</button>
          </div>
        </div>
        <div v-else class="d-flex gap-1">
          <input
            v-model="couponCodeInput"
            class="form-control form-control-sm"
            placeholder="Cupom de desconto"
            @keyup.enter="applyExternalCoupon"
          />
          <button
            class="btn btn-sm btn-outline-secondary px-2"
            @click="applyExternalCoupon"
            :disabled="cart.couponLoading || !couponCodeInput.trim()"
          >
            <span v-if="cart.couponLoading" class="spinner-border spinner-border-sm"></span>
            <span v-else>OK</span>
          </button>
        </div>
        <div v-if="cart.couponError" class="small text-danger mt-1">{{ cart.couponError }}</div>
        <div v-if="!posWizardMounted && couponCodeInput.trim()" class="small text-muted mt-1">
          <i class="bi bi-info-circle me-1"></i>Cupom será aplicado ao chegar nos produtos
        </div>
      </div>

      <!-- Totals -->
      <div class="d-flex justify-content-between small text-muted mb-1">
        <span>Subtotal</span>
        <span>{{ formatCurrency(cart.subtotal) }}</span>
      </div>
      <div v-if="orderType === 'DELIVERY'" class="d-flex justify-content-between small text-muted mb-1">
        <span>Taxa entrega</span>
        <span>{{ formatCurrency(cart.deliveryFee) }}</span>
      </div>
      <div v-if="cart.couponApplied" class="d-flex justify-content-between small text-success mb-1">
        <span>Desconto</span>
        <span>-{{ formatCurrency(cart.couponDiscount) }}</span>
      </div>
      <div class="d-flex justify-content-between fw-semibold mb-3 pt-1" style="border-top:1px solid #dee2e6">
        <span>Total</span>
        <span>{{ formatCurrency(cart.totalWithDelivery) }}</span>
      </div>

      <!-- Navigation -->
      <div class="d-flex gap-2">
        <button
          v-if="panelStep > 1"
          class="btn btn-outline-secondary btn-sm"
          @click="prevStep"
          style="min-width:72px"
        >
          <i class="bi bi-chevron-left"></i> Voltar
        </button>
        <button
          v-if="panelStep < maxPanelStep"
          class="btn btn-primary btn-sm flex-grow-1"
          @click="nextStep"
          :disabled="!canGoNext"
        >
          Continuar <i class="bi bi-chevron-right"></i>
        </button>
        <button
          v-if="panelStep === maxPanelStep"
          class="btn btn-success btn-sm flex-grow-1"
          @click="posRef?.finalize()"
          :disabled="posRef?.finalizing || !cart.paymentMethodCode"
        >
          <span v-if="posRef?.finalizing" class="spinner-border spinner-border-sm me-1"></span>
          Concluir pedido
        </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import { formatCurrency } from '@/utils/formatters.js';
import ContactInfo from './ContactInfo.vue';
import ContactAddress from './ContactAddress.vue';
import POSOrderWizard from '@/components/POSOrderWizard.vue';

const props = defineProps({ conversationId: String });

const inboxStore = useInboxStore();

const conversation = computed(() => inboxStore.conversations.find(c => c.id === props.conversationId));
const customerId = computed(() => conversation.value?.customerId || null);
const customerName = computed(() => conversation.value?.customer?.fullName || conversation.value?.contactName || '');

const lastOrder = computed(() => {
  if (!customerId.value) return null;
  return inboxStore.customerCache[customerId.value]?.orders?.[0] || null;
});

// Step state
const panelStep = ref(1);
const orderType = ref('DELIVERY');
const showLastOrderHint = ref(true);
const posWizardMounted = ref(false);
const selectedAddress = ref(null);
const posRef = ref(null);

// Step labels: 4 steps for DELIVERY, 3 for BALCAO (no address step)
const activeStepLabels = computed(() =>
  orderType.value === 'DELIVERY'
    ? ['Cliente', 'Endereço', 'Produtos', 'Pagamento']
    : ['Cliente', 'Produtos', 'Pagamento']
);
const maxPanelStep = computed(() => activeStepLabels.value.length);

// Index of each logical step (1-based)
const productsStepIndex = computed(() => activeStepLabels.value.indexOf('Produtos') + 1);
const paymentStepIndex = computed(() => activeStepLabels.value.indexOf('Pagamento') + 1);

// Show POSOrderWizard when on products or payment step
const showPosWizard = computed(() => panelStep.value >= productsStepIndex.value);

// Force POSOrderWizard internal step
const posForceStep = computed(() => {
  if (panelStep.value === productsStepIndex.value) return 3;
  if (panelStep.value === paymentStepIndex.value) return 4;
  return null;
});

// Active address: prefer user selection from ContactAddress, fallback to store default
const activeAddress = computed(() => {
  if (selectedAddress.value) return selectedAddress.value;
  if (!customerId.value || orderType.value !== 'DELIVERY') return null;
  const cust = inboxStore.customerCache[customerId.value];
  if (!cust?.addresses?.length) return null;
  return cust.addresses.find(a => a.isDefault) || cust.addresses[0];
});

// Draft
const draft = computed(() => inboxStore.getOrderDraft(props.conversationId));

const wizardPreset = computed(() => ({
  customerId: customerId.value,
  customerName: customerName.value,
  address: activeAddress.value,
  orderType: draft.value?.orderType || orderType.value,
  skipCustomer: true,
  skipAddress: true,
  items: draft.value?.items || null,
}));

// Cart state (synced from POSOrderWizard via @cart-update)
const emptyCart = () => ({
  subtotal: 0, deliveryFee: 0, totalWithDelivery: 0,
  couponApplied: false, couponDiscount: 0, couponInfo: null,
  couponError: '', couponLoading: false, cartLength: 0, paymentMethodCode: '',
});
const cart = ref(emptyCart());

function onCartUpdate(state) {
  cart.value = { ...cart.value, ...state };
}

// Can user proceed to next step?
const canGoNext = computed(() => {
  const label = activeStepLabels.value[panelStep.value - 1];
  if (label === 'Produtos') return cart.value.cartLength > 0;
  return true;
});

// Coupon
const couponCodeInput = ref('');

async function applyExternalCoupon() {
  if (!couponCodeInput.value.trim()) return;
  if (!posRef.value) return;
  await posRef.value.applyCouponWithCode(couponCodeInput.value.trim());
}

// Auto-apply coupon when POSOrderWizard mounts (user may have typed it in steps 1-2)
watch(() => posWizardMounted.value, async (mounted) => {
  if (!mounted || !couponCodeInput.value.trim()) return;
  await nextTick();
  if (posRef.value) await posRef.value.applyCouponWithCode(couponCodeInput.value.trim());
});

// Navigation
function nextStep() {
  if (panelStep.value < maxPanelStep.value) panelStep.value++;
}
function prevStep() {
  if (panelStep.value > 1) panelStep.value--;
}

// Mount POSOrderWizard once when first reaching products step (keep mounted to preserve cart)
watch(() => panelStep.value, (step) => {
  if (!posWizardMounted.value && step >= productsStepIndex.value) {
    posWizardMounted.value = true;
  }
});

function onAddressSelected(addr) {
  selectedAddress.value = addr;
}

function startOrder(items) {
  panelStep.value = 1;
  showLastOrderHint.value = true;
  posWizardMounted.value = false;
  cart.value = emptyCart();
  couponCodeInput.value = '';
  selectedAddress.value = null;
  inboxStore.setOrderDraft(props.conversationId, {
    active: true,
    orderType: orderType.value,
    items: items || null,
  });
}

function cancelOrder() {
  inboxStore.clearOrderDraft(props.conversationId);
  panelStep.value = 1;
  posWizardMounted.value = false;
  cart.value = emptyCart();
  couponCodeInput.value = '';
}

function repeatOrder() {
  if (!lastOrder.value?.items?.length) return;
  const items = lastOrder.value.items.map(it => ({
    productId: it.productId, name: it.name,
    quantity: it.quantity, price: it.price, options: it.options || [],
  }));
  inboxStore.setOrderDraft(props.conversationId, {
    active: true,
    orderType: draft.value?.orderType || orderType.value,
    items,
  });
  showLastOrderHint.value = false;
  panelStep.value = productsStepIndex.value;
}

// Auto-start when customer is linked
watch(
  () => [customerId.value, props.conversationId],
  ([cid]) => {
    if (!cid) return;
    if (draft.value?.active) return;
    startOrder();
  },
  { immediate: true }
);

// Reset state on conversation change
watch(() => props.conversationId, () => {
  showLastOrderHint.value = true;
  panelStep.value = 1;
  selectedAddress.value = null;
  posWizardMounted.value = false;
  cart.value = emptyCart();
  couponCodeInput.value = '';
});

const justCreated = ref(false);
function onOrderCreated() {
  inboxStore.clearOrderDraft(props.conversationId);
  justCreated.value = true;
  panelStep.value = 1;
  posWizardMounted.value = false;
  cart.value = emptyCart();
  couponCodeInput.value = '';
  setTimeout(() => { justCreated.value = false; }, 3000);
}

const asking = ref(false);
const askedSuccessfully = ref(false);

async function askRepeat() {
  if (!lastOrder.value?.items?.length || asking.value) return;
  asking.value = true;
  try {
    const itemsText = lastOrder.value.items.map(it => `• ${it.quantity}x ${it.name}`).join('\n');
    const total = Number(lastOrder.value.total || 0).toFixed(2).replace('.', ',');
    const body = `Olá! 👋\n\nSeu último pedido foi:\n${itemsText}\n\nTotal: *R$ ${total}*\n\nDeseja repetir o pedido? 😊`;
    await inboxStore.sendMessage(props.conversationId, { type: 'TEXT', body });
    askedSuccessfully.value = true;
    setTimeout(() => { askedSuccessfully.value = false; }, 3000);
  } catch (e) {
    console.error('Erro ao enviar pergunta', e);
  } finally {
    asking.value = false;
  }
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('pt-BR');
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
