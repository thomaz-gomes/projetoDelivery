<script setup>
import { ref, onMounted } from 'vue';
import { useCustomersStore } from '../stores/customers';
import { useRouter, useRoute } from 'vue-router';
import { applyPhoneMask } from '../utils/phoneMask';

const store = useCustomersStore();
const router = useRouter();
const route = useRoute();

const isEdit = !!route.params.id;

const customer = ref({
  fullName: '',
  cpf: '',
  whatsapp: '',
  phone: '',
  addresses: [{ street: '', number: '', city: '', state: '', zip: '' }]
});

const loading = ref(false);
const error = ref('');

onMounted(async () => {
  if (isEdit) {
    loading.value = true;
    try {
      const data = await store.get(route.params.id);
      // map backend shape to form
      customer.value.fullName = data.fullName || '';
      customer.value.cpf = data.cpf || '';
      customer.value.whatsapp = data.whatsapp || '';
      customer.value.phone = data.phone || '';
      customer.value.addresses = (data.addresses || []).map(a => ({
        id: a.id,
        label: a.label,
        street: a.street,
        number: a.number,
        complement: a.complement,
        neighborhood: a.neighborhood,
        city: a.city,
        state: a.state,
        zip: a.postalCode,
        isDefault: a.isDefault,
        formatted: a.formatted,
      }));
      if (!customer.value.addresses.length) customer.value.addresses = [{ street: '', number: '', city: '', state: '', zip: '' }];
    } catch (e) {
      console.error(e);
      error.value = 'Falha ao carregar cliente';
    } finally {
      loading.value = false;
    }
  }
});

async function save() {
  loading.value = true;
  error.value = '';
  try {
    if (isEdit) {
      await store.update(route.params.id, customer.value);
    } else {
      await store.create(customer.value);
    }
    router.push('/customers');
  } catch (err) {
    error.value = err?.response?.data?.message || 'Erro ao salvar cliente';
  } finally {
    loading.value = false;
  }
}

function addAddress() {
  customer.value.addresses.push({ street: '', number: '', city: '', state: '', zip: '' });
}

function removeAddress(index) {
  customer.value.addresses.splice(index, 1);
}

function handleWhatsAppInput(e) {
  customer.value.whatsapp = applyPhoneMask(e.target.value);
}

function handlePhoneInput(e) {
  customer.value.phone = applyPhoneMask(e.target.value);
}
</script>

<template>
  <div class="container py-4">
    <div class="d-flex justify-content-between align-items-center mb-4">
  <h2 class="h4 fw-semibold m-0">{{ isEdit ? 'Editar Cliente' : 'Novo Cliente' }}</h2>
      <button class="btn btn-outline-secondary btn-sm" @click="$router.back()">Voltar</button>
    </div>

    <div class="card">
      <div class="card-body">
        <form @submit.prevent="save" class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Nome completo</label>
            <TextInput v-model="customer.fullName" inputClass="form-control" required />
          </div>
          <div class="col-md-3">
            <label class="form-label">CPF</label>
            <TextInput v-model="customer.cpf" placeholder="000.000.000-00" inputClass="form-control" />
          </div>
          <div class="col-md-3">
            <label class="form-label">WhatsApp</label>
            <TextInput v-model="customer.whatsapp" placeholder="(00) 0 0000-0000" maxlength="16" inputClass="form-control" @input="handleWhatsAppInput" />
          </div>
          <div class="col-md-3">
            <label class="form-label">Telefone</label>
            <TextInput v-model="customer.phone" placeholder="(00) 0000-0000" maxlength="15" inputClass="form-control" @input="handlePhoneInput" />
          </div>

          <div class="col-12 mt-3">
            <h5 class="fw-semibold">Endereços</h5>
          </div>

          <div
            v-for="(addr, i) in customer.addresses"
            :key="i"
            class="border rounded p-3 mb-2 bg-light"
          >
            <div class="row g-2">
              <div class="col-md-5">
                <label class="form-label">Rua</label>
                <TextInput v-model="addr.street" inputClass="form-control" />
              </div>
              <div class="col-md-2">
                <label class="form-label">Número</label>
                <TextInput v-model="addr.number" inputClass="form-control" />
              </div>
              <div class="col-md-3">
                <label class="form-label">Cidade</label>
                <TextInput v-model="addr.city" inputClass="form-control" />
              </div>
              <div class="col-md-2">
                <label class="form-label">UF</label>
                <TextInput v-model="addr.state" maxlength="2" inputClass="form-control text-uppercase" />
              </div>
            </div>

            <div class="mt-2 d-flex justify-content-between align-items-center">
              <div class="text-muted small">CEP: <TextInput v-model="addr.zip" inputClass="form-control form-control-sm d-inline w-auto" /></div>
              <button type="button" class="btn btn-sm btn-outline-danger" @click="removeAddress(i)">Remover</button>
            </div>
          </div>

          <div>
            <button type="button" class="btn btn-outline-primary btn-sm" @click="addAddress">
              ➕ Adicionar endereço
            </button>
          </div>

          <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>

          <div class="mt-4">
            <button type="submit" class="btn btn-primary" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-2"></span>
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
