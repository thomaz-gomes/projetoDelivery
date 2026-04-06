<template>
  <div class="d-flex flex-column h-100 bg-white overflow-auto">
    <ContactInfo
      :customer-id="customerId"
      :phone="conversation?.channelContactId"
      :conversation-id="conversationId"
      :contact-name="conversation?.contactName"
    />
    <ContactAddress :customer-id="customerId" />
    <InboxOrderWizard
      :conversation-id="conversationId"
      :customer-id="customerId"
      :customer-name="customerName"
      :address="activeAddress"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useInboxStore } from '@/stores/inbox';
import ContactInfo from './ContactInfo.vue';
import ContactAddress from './ContactAddress.vue';
import InboxOrderWizard from './InboxOrderWizard.vue';

const props = defineProps({ conversationId: String });

const inboxStore = useInboxStore();

const conversation = computed(() =>
  inboxStore.conversations.find(c => c.id === props.conversationId)
);
const customerId = computed(() => conversation.value?.customerId || null);
const customerName = computed(() =>
  conversation.value?.customer?.fullName || conversation.value?.contactName || ''
);
const activeAddress = computed(() => {
  if (!customerId.value) return null;
  const cust = inboxStore.customerCache[customerId.value];
  if (!cust?.addresses?.length) return null;
  return cust.addresses.find(a => a.isDefault) || cust.addresses[0];
});
</script>
