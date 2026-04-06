<template>
  <div class="d-flex flex-column h-100 bg-white overflow-auto">
    <ContactInfo
      :customer-id="customerId"
      :phone="conversation?.channelContactId"
      :conversation-id="conversationId"
      :contact-name="conversation?.contactName"
    />

    <!-- Order type selector -->
    <div v-if="customerId" class="px-3 pb-2 border-top pt-3">
      <div class="fw-semibold small mb-1"><i class="bi bi-bag me-1"></i>Tipo</div>
      <select class="form-select form-select-sm" v-model="orderType">
        <option value="DELIVERY">Entrega</option>
        <option value="BALCAO">Balcao (retirada)</option>
      </select>
    </div>

    <ContactAddress v-if="orderType === 'DELIVERY'" :customer-id="customerId" />

    <InboxOrderWizard
      :conversation-id="conversationId"
      :customer-id="customerId"
      :customer-name="customerName"
      :address="activeAddress"
      :order-type="orderType"
      :last-order="lastOrder"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import ContactInfo from './ContactInfo.vue';
import ContactAddress from './ContactAddress.vue';
import InboxOrderWizard from './InboxOrderWizard.vue';

const props = defineProps({ conversationId: String });

const inboxStore = useInboxStore();
const orderType = ref('DELIVERY');

const conversation = computed(() =>
  inboxStore.conversations.find(c => c.id === props.conversationId)
);
const customerId = computed(() => conversation.value?.customerId || null);
const customerName = computed(() =>
  conversation.value?.customer?.fullName || conversation.value?.contactName || ''
);
const activeAddress = computed(() => {
  if (!customerId.value || orderType.value !== 'DELIVERY') return null;
  const cust = inboxStore.customerCache[customerId.value];
  if (!cust?.addresses?.length) return null;
  return cust.addresses.find(a => a.isDefault) || cust.addresses[0];
});
const lastOrder = computed(() => {
  if (!customerId.value) return null;
  const cust = inboxStore.customerCache[customerId.value];
  const orders = cust?.orders;
  if (!orders?.length) return null;
  return orders[0];
});
</script>
