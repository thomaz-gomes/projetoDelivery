# Inbox Contact Panel & Embedded Order — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a right-side panel to the inbox showing contact data (auto-save on blur), editable address, and an embedded POSOrderWizard for creating orders without leaving the chat.

**Architecture:** New ContactPanel component with 3 sub-components (ContactInfo, ContactAddress, InboxOrderWizard) rendered as a 4th panel in Inbox.vue. Auto-create Customer on webhook. POSOrderWizard gets `embedded` prop to skip steps 1-2. Order drafts stored per-conversation in Pinia.

**Tech Stack:** Vue 3 Composition API, Pinia, Bootstrap 5, Express.js, Prisma.

---

### Task 1: Backend — Auto-create Customer in Webhook

**Files:**
- Modify: `delivery-saas-backend/src/routes/webhookEvolution.js`

**Step 1: Modify handleMessagesUpsert to auto-create Customer**

In the `handleMessagesUpsert` function, after looking up the customer by phone (the existing `prisma.customer.findUnique` with `company_whatsapp`), if no customer is found and the message is inbound (`!isFromMe`), create one:

```javascript
// After existing customer lookup (where customerId is still null)
if (!customerId && !isFromMe) {
  try {
    const newCustomer = await prisma.customer.create({
      data: {
        companyId,
        fullName: pushName || phone,
        whatsapp: phone,
      },
    });
    customerId = newCustomer.id;
  } catch (e) {
    // P2002 = unique constraint (race condition, customer created between check and create)
    if (e.code === 'P2002') {
      const existing = await prisma.customer.findFirst({
        where: { companyId, whatsapp: phone },
        select: { id: true },
      });
      if (existing) customerId = existing.id;
    } else {
      console.warn('[webhook-evolution] Failed to auto-create customer:', e.message);
    }
  }
}
```

This goes right after the existing `if (!customerId)` block that searches for a matching customer, and before the conversation create/update logic.

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/webhookEvolution.js
git commit -m "feat(inbox): auto-create Customer on first inbound WhatsApp message"
```

---

### Task 2: Backend — Customer Inline Update Endpoints

**Files:**
- Modify: `delivery-saas-backend/src/routes/inbox.js`

**Step 1: Add customer endpoints to inbox.js**

Add these endpoints after the existing quick-replies CRUD, before `export default router`:

```javascript
// ─── CUSTOMER INLINE ENDPOINTS ───────────────────────────────────────────────

// GET customer with addresses and stats
router.get('/customer/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        addresses: { orderBy: { isDefault: 'desc' } },
        _count: { select: { orders: true } },
      },
    });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

    // Calculate totalSpent
    const agg = await prisma.order.aggregate({
      where: { customerId: customer.id, status: { in: ['CONCLUIDO', 'ENTREGUE'] } },
      _sum: { total: true },
    });

    res.json({
      ...customer,
      orderCount: customer._count.orders,
      totalSpent: agg._sum.total || 0,
    });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao buscar cliente', error: e.message });
  }
});

// PATCH customer fields (blur save)
router.patch('/customer/:id', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const existing = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ message: 'Cliente não encontrado' });

    const { fullName, cpf, email, phone } = req.body;
    const data = {};
    if (fullName !== undefined) data.fullName = fullName;
    if (cpf !== undefined) data.cpf = cpf ? cpf.replace(/\D+/g, '') : null;
    if (email !== undefined) data.email = email || null;
    if (phone !== undefined) data.phone = phone || null;

    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data,
    });
    res.json(updated);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'CPF ou telefone já cadastrado' });
    res.status(500).json({ message: 'Erro ao atualizar cliente', error: e.message });
  }
});

// POST new address
router.post('/customer/:id/addresses', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

    const { label, street, number, complement, neighborhood, reference, observation, city, state, postalCode } = req.body;

    const address = await prisma.customerAddress.create({
      data: {
        customerId: customer.id,
        label: label || null,
        street: street || null,
        number: number || null,
        complement: complement || null,
        neighborhood: neighborhood || null,
        reference: reference || null,
        observation: observation || null,
        city: city || null,
        state: state || null,
        postalCode: postalCode || null,
        isDefault: true,
      },
    });

    // Unset other defaults
    await prisma.customerAddress.updateMany({
      where: { customerId: customer.id, isDefault: true, NOT: { id: address.id } },
      data: { isDefault: false },
    });

    res.status(201).json(address);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao criar endereço', error: e.message });
  }
});

// PATCH existing address (blur save)
router.patch('/customer/:id/addresses/:addrId', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true },
    });
    if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

    const addr = await prisma.customerAddress.findFirst({
      where: { id: req.params.addrId, customerId: customer.id },
    });
    if (!addr) return res.status(404).json({ message: 'Endereço não encontrado' });

    const { label, street, number, complement, neighborhood, reference, observation, city, state, postalCode } = req.body;
    const data = {};
    if (label !== undefined) data.label = label || null;
    if (street !== undefined) data.street = street || null;
    if (number !== undefined) data.number = number || null;
    if (complement !== undefined) data.complement = complement || null;
    if (neighborhood !== undefined) data.neighborhood = neighborhood || null;
    if (reference !== undefined) data.reference = reference || null;
    if (observation !== undefined) data.observation = observation || null;
    if (city !== undefined) data.city = city || null;
    if (state !== undefined) data.state = state || null;
    if (postalCode !== undefined) data.postalCode = postalCode || null;

    const updated = await prisma.customerAddress.update({
      where: { id: addr.id },
      data,
    });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: 'Erro ao atualizar endereço', error: e.message });
  }
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/inbox.js
git commit -m "feat(inbox): add customer inline update and address endpoints"
```

---

### Task 3: Frontend — Extend Inbox Store with Customer & Order Drafts

**Files:**
- Modify: `delivery-saas-frontend/src/stores/inbox.js`

**Step 1: Add new state, getters, and actions**

Add to state:
```javascript
customerCache: {},   // { [customerId]: customerData }
orderDrafts: {},     // { [conversationId]: { active, orderType, ... } }
```

Add new actions:
```javascript
async fetchCustomer(customerId) {
  if (!customerId) return null;
  const { data } = await api.get(`/inbox/customer/${customerId}`);
  this.customerCache[customerId] = data;
  return data;
},

async updateCustomerField(customerId, field, value) {
  const { data } = await api.patch(`/inbox/customer/${customerId}`, { [field]: value });
  if (this.customerCache[customerId]) {
    Object.assign(this.customerCache[customerId], data);
  }
  return data;
},

async createAddress(customerId, addressData) {
  const { data } = await api.post(`/inbox/customer/${customerId}/addresses`, addressData);
  if (this.customerCache[customerId]) {
    if (!this.customerCache[customerId].addresses) this.customerCache[customerId].addresses = [];
    this.customerCache[customerId].addresses.unshift(data);
  }
  return data;
},

async updateAddressField(customerId, addrId, field, value) {
  const { data } = await api.patch(`/inbox/customer/${customerId}/addresses/${addrId}`, { [field]: value });
  if (this.customerCache[customerId]) {
    const addrs = this.customerCache[customerId].addresses || [];
    const idx = addrs.findIndex(a => a.id === addrId);
    if (idx >= 0) Object.assign(addrs[idx], data);
  }
  return data;
},

getOrderDraft(conversationId) {
  return this.orderDrafts[conversationId] || null;
},

setOrderDraft(conversationId, draft) {
  this.orderDrafts[conversationId] = draft;
},

clearOrderDraft(conversationId) {
  delete this.orderDrafts[conversationId];
},
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/stores/inbox.js
git commit -m "feat(inbox): add customer cache, address actions, and order drafts to store"
```

---

### Task 4: Frontend — ContactInfo Component

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/ContactInfo.vue`

**Step 1: Create ContactInfo component**

This component shows customer data fields that save on blur. Props: `customerId`. Fetches customer data on mount/watch. Each input field calls `updateCustomerField` on blur.

Key features:
- fullName as editable header (input styled as text)
- whatsapp read-only
- cpf, email, phone as inputs with blur save
- Stats: createdAt, totalSpent, orderCount read-only
- Small save indicator ("Salvo" that fades after 2s)
- Watch `customerId` prop to refetch when conversation changes

Template structure:
```vue
<template>
  <div class="p-3">
    <div v-if="loading" class="text-center py-3">
      <div class="spinner-border spinner-border-sm"></div>
    </div>
    <div v-else-if="customer">
      <!-- Name -->
      <div class="mb-3">
        <input
          type="text"
          class="form-control form-control-sm fw-semibold"
          v-model="customer.fullName"
          @blur="save('fullName', customer.fullName)"
          placeholder="Nome do contato"
        />
      </div>
      <!-- WhatsApp (read-only) -->
      <div class="mb-2 d-flex align-items-center gap-1">
        <i class="bi bi-whatsapp text-success"></i>
        <small class="text-muted">{{ customer.whatsapp }}</small>
      </div>
      <!-- Editable fields -->
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">CPF</label>
        <input type="text" class="form-control form-control-sm" v-model="customer.cpf" @blur="save('cpf', customer.cpf)" placeholder="000.000.000-00" />
      </div>
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">Email</label>
        <input type="email" class="form-control form-control-sm" v-model="customer.email" @blur="save('email', customer.email)" />
      </div>
      <div class="mb-2">
        <label class="form-label small text-muted mb-0">Telefone 2</label>
        <input type="text" class="form-control form-control-sm" v-model="customer.phone" @blur="save('phone', customer.phone)" />
      </div>
      <!-- Stats -->
      <div class="mt-3 small text-muted">
        <div>Cliente desde: {{ formatDate(customer.createdAt) }}</div>
        <div>Total gasto: {{ formatCurrency(customer.totalSpent || 0) }}</div>
        <div>Pedidos: {{ customer.orderCount || 0 }}</div>
      </div>
      <!-- Save indicator -->
      <div v-if="saved" class="small text-success mt-1"><i class="bi bi-check"></i> Salvo</div>
    </div>
    <div v-else class="text-center text-muted py-3">
      <small>Sem cliente vinculado</small>
    </div>
  </div>
</template>
```

Script: use `useInboxStore`, watch `customerId`, fetch on change, `save(field, value)` calls `inboxStore.updateCustomerField` and shows indicator.

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ContactInfo.vue
git commit -m "feat(inbox): add ContactInfo component with blur-save fields"
```

---

### Task 5: Frontend — ContactAddress Component

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/ContactAddress.vue`

**Step 1: Create ContactAddress component**

Shows address fields that save on blur + list of saved addresses. Props: `customerId`.

Key features:
- Active address fields: street, number (row), neighborhood (SelectInput with fee), complement, reference, observation
- List of saved addresses as clickable radio items
- Click saved address fills the form fields
- "+ Novo endereço" button creates blank form
- Each field saves on blur via `updateAddressField` (if existing) or accumulates for `createAddress` (if new)
- Fetch neighborhoods from `GET /neighborhoods` for the SelectInput

Template structure:
```vue
<template>
  <div class="p-3 border-top">
    <div class="d-flex align-items-center justify-content-between mb-2">
      <span class="fw-semibold small"><i class="bi bi-geo-alt me-1"></i>Endereço</span>
      <button class="btn btn-sm btn-link p-0" @click="newAddress">+ Novo</button>
    </div>

    <!-- Saved addresses -->
    <div v-if="addresses.length > 1" class="mb-2">
      <div
        v-for="addr in addresses"
        :key="addr.id"
        class="form-check small"
      >
        <input class="form-check-input" type="radio" :value="addr.id" v-model="selectedAddrId" @change="selectAddress(addr)" />
        <label class="form-check-label text-truncate">
          {{ addr.label || '' }} {{ addr.street || '' }}, {{ addr.number || '' }} - {{ addr.neighborhood || '' }}
        </label>
      </div>
    </div>

    <!-- Address form -->
    <div class="row g-2">
      <div class="col-8">
        <input type="text" class="form-control form-control-sm" v-model="form.street" @blur="saveField('street')" placeholder="Rua" />
      </div>
      <div class="col-4">
        <input type="text" class="form-control form-control-sm" v-model="form.number" @blur="saveField('number')" placeholder="Nº" />
      </div>
      <div class="col-12">
        <select class="form-select form-select-sm" v-model="form.neighborhood" @blur="saveField('neighborhood')">
          <option value="">Bairro</option>
          <option v-for="n in neighborhoods" :key="n.id" :value="n.name">{{ n.name }} - {{ formatCurrency(n.deliveryFee) }}</option>
        </select>
      </div>
      <div class="col-12">
        <input type="text" class="form-control form-control-sm" v-model="form.complement" @blur="saveField('complement')" placeholder="Complemento" />
      </div>
      <div class="col-12">
        <input type="text" class="form-control form-control-sm" v-model="form.reference" @blur="saveField('reference')" placeholder="Referência" />
      </div>
      <div class="col-12">
        <input type="text" class="form-control form-control-sm" v-model="form.observation" @blur="saveField('observation')" placeholder="Observação" />
      </div>
    </div>
    <div v-if="saved" class="small text-success mt-1"><i class="bi bi-check"></i> Salvo</div>
  </div>
</template>
```

Logic:
- On mount/customerId change: load addresses from `customerCache`
- `selectAddress(addr)`: fills form fields, sets `selectedAddrId`
- `saveField(field)`: if `selectedAddrId` → PATCH, else accumulate. If all required fields filled on a new address → POST to create.
- Fetch neighborhoods: `api.get('/neighborhoods')`

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ContactAddress.vue
git commit -m "feat(inbox): add ContactAddress component with blur-save and address list"
```

---

### Task 6: Frontend — InboxOrderWizard Component

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/InboxOrderWizard.vue`

**Step 1: Create InboxOrderWizard wrapper**

This is a thin wrapper that renders POSOrderWizard with `embedded` mode. Props: `conversationId`, `customerId`, `customerName`, `address`.

Key features:
- "Iniciar Pedido" button when no active draft
- OrderType select (BALCAO/DELIVERY) before starting
- Renders POSOrderWizard with props: `visible=true`, `embedded=true`, preset with customerId, address, orderType
- On `@created` event: clear draft, show brief confirmation
- Watch conversationId to swap drafts

```vue
<template>
  <div class="p-3 border-top">
    <div class="fw-semibold small mb-2"><i class="bi bi-bag me-1"></i>Pedido</div>

    <div v-if="!draft?.active">
      <div class="mb-2">
        <select class="form-select form-select-sm" v-model="orderType">
          <option value="BALCAO">Balcão (retirada)</option>
          <option value="DELIVERY">Entrega</option>
        </select>
      </div>
      <button class="btn btn-sm btn-success w-100" @click="startOrder">
        <i class="bi bi-plus me-1"></i>Iniciar Pedido
      </button>
    </div>

    <div v-else>
      <POSOrderWizard
        :visible="true"
        :embedded="true"
        :preset="wizardPreset"
        @created="onOrderCreated"
      />
    </div>

    <div v-if="justCreated" class="alert alert-success small py-1 mt-2">
      Pedido criado!
    </div>
  </div>
</template>
```

Script:
- `draft` is computed from `inboxStore.getOrderDraft(conversationId)`
- `startOrder()` sets draft `{ active: true, orderType }`
- `wizardPreset` computed: `{ customerId, customerName, address, orderType: draft.orderType, skipCustomer: true, skipAddress: true }`
- `onOrderCreated()`: `inboxStore.clearOrderDraft(conversationId)`, set `justCreated = true`, reset after 3s

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/InboxOrderWizard.vue
git commit -m "feat(inbox): add InboxOrderWizard wrapper component"
```

---

### Task 7: Frontend — POSOrderWizard `embedded` Prop

**Files:**
- Modify: `delivery-saas-frontend/src/components/POSOrderWizard.vue`

**Step 1: Add `embedded` prop and skip logic**

Add to props:
```javascript
embedded: { type: Boolean, default: false },
```

In the existing `preset` watcher or `onMounted`, when `embedded` is true:
- Set `foundCustomer` from preset.customerId (fetch customer data)
- Set `orderType` from preset.orderType
- Set address from preset.address (if DELIVERY)
- Set `step.value = 3` directly
- Call `loadMenu()`

In the template:
- When `embedded`, hide the outer modal wrapper/card (render content directly)
- Hide "Voltar" buttons on step 3 that would go to steps 1-2
- Step 5 (confirmation): emit `@created` instead of showing modal close button

**Step 2: Modify template for embedded mode**

The component currently wraps everything in a modal-like card. When `embedded`:
- Skip the outer card wrapper
- Render steps 3-5 directly
- Replace "Voltar" in step 3 with nothing (or disabled)
- In step 5 show "Novo Pedido" button that resets to step 3

**Step 3: Commit**

```bash
git add delivery-saas-frontend/src/components/POSOrderWizard.vue
git commit -m "feat(inbox): add embedded prop to POSOrderWizard for inline rendering"
```

---

### Task 8: Frontend — ContactPanel Container

**Files:**
- Create: `delivery-saas-frontend/src/views/inbox/ContactPanel.vue`

**Step 1: Create ContactPanel container**

Assembles the 3 sections with vertical scroll.

```vue
<template>
  <div class="d-flex flex-column h-100 bg-white overflow-auto">
    <ContactInfo :customer-id="customerId" />
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
  const cust = inboxStore.customerCache[customerId.value];
  if (!cust?.addresses?.length) return null;
  return cust.addresses.find(a => a.isDefault) || cust.addresses[0];
});
</script>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/ContactPanel.vue
git commit -m "feat(inbox): add ContactPanel container component"
```

---

### Task 9: Frontend — Update Inbox.vue Layout (4 Panels)

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/Inbox.vue`

**Step 1: Add ContactPanel as 4th panel**

Update template to add ContactPanel after ChatPanel, with toggle button for screens <1400px:

```vue
<template>
  <div class="d-flex" style="height: calc(100vh - 56px); overflow: hidden;">
    <!-- Panel 1: Conversation List -->
    <div
      class="border-end bg-white d-flex flex-column"
      :class="{ 'd-none d-md-flex': inboxStore.activeConversationId }"
      style="width: 360px; min-width: 300px; flex-shrink: 0;"
    >
      <ConversationList @select="selectConversation" />
    </div>

    <!-- Panel 2: Chat -->
    <div class="flex-grow-1 d-flex flex-column" v-if="inboxStore.activeConversationId">
      <ChatPanel
        :conversation-id="inboxStore.activeConversationId"
        @back="inboxStore.activeConversationId = null"
        @toggle-panel="showContactPanel = !showContactPanel"
        :show-panel-toggle="true"
      />
    </div>

    <!-- Empty state -->
    <div v-else class="flex-grow-1 d-none d-md-flex align-items-center justify-content-center text-muted">
      <div class="text-center">
        <i class="bi bi-chat-left-dots" style="font-size: 3rem;"></i>
        <p class="mt-2">Selecione uma conversa</p>
      </div>
    </div>

    <!-- Panel 3: Contact Panel (right side) -->
    <div
      v-if="inboxStore.activeConversationId && showContactPanel"
      class="border-start bg-white d-none d-md-flex flex-column"
      style="width: 350px; min-width: 320px; flex-shrink: 0;"
    >
      <ContactPanel :conversation-id="inboxStore.activeConversationId" />
    </div>
  </div>
</template>
```

Add to script:
```javascript
import ContactPanel from './ContactPanel.vue';
const showContactPanel = ref(true);
```

**Step 2: Add toggle button to ConversationHeader**

Add a prop `showPanelToggle` and emit `toggle-panel`:

```vue
<!-- In ConversationHeader, add after existing action buttons -->
<button
  v-if="showPanelToggle"
  class="btn btn-sm btn-outline-secondary"
  title="Dados do contato"
  @click="$emit('toggle-panel')"
>
  <i class="bi bi-layout-sidebar-reverse"></i>
</button>
```

**Step 3: Remove the "Novo Pedido" redirect button from ConversationHeader**

The order creation is now in the ContactPanel. Remove the router.push to `/orders` button. Keep the "Vincular cliente" button as fallback.

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/Inbox.vue delivery-saas-frontend/src/views/inbox/ConversationHeader.vue delivery-saas-frontend/src/views/inbox/ChatPanel.vue
git commit -m "feat(inbox): add 4-panel layout with ContactPanel and toggle"
```

---

### Task 10: Frontend — Fetch Customer on Conversation Select

**Files:**
- Modify: `delivery-saas-frontend/src/views/inbox/Inbox.vue`

**Step 1: Fetch customer data when selecting conversation**

Update `selectConversation` to also fetch customer:

```javascript
async function selectConversation(conversationId) {
  inboxStore.activeConversationId = conversationId;
  inboxStore.markAsRead(conversationId).catch(() => {});

  // Fetch customer data for contact panel
  const conv = inboxStore.conversations.find(c => c.id === conversationId);
  if (conv?.customerId && !inboxStore.customerCache[conv.customerId]) {
    inboxStore.fetchCustomer(conv.customerId).catch(() => {});
  }
}
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/views/inbox/Inbox.vue
git commit -m "feat(inbox): fetch customer data on conversation select"
```

---

### Task 11: Integration Testing

**Step 1: Test auto-create customer**

Send a WhatsApp message from a new number to a connected instance. Verify:
- Customer created in DB with pushName and phone
- Conversation has customerId set
- Contact panel shows customer data

**Step 2: Test blur save**

Edit customer name in contact panel, click outside. Verify DB updated.
Edit address field, click outside. Verify DB updated.

**Step 3: Test embedded order**

1. Open conversation with customer
2. Click "Iniciar Pedido" in contact panel
3. Select products, payment
4. Switch to another conversation — verify cart preserved
5. Switch back — verify cart intact
6. Finalize order — verify draft cleared

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "feat(inbox): complete contact panel with embedded order wizard"
```
