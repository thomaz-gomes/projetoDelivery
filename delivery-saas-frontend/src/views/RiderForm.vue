<script setup>
import { ref, onMounted } from 'vue';
import TextInput from '../components/form/input/TextInput.vue';
import CurrencyInput from '../components/form/input/CurrencyInput.vue';
import { useRidersStore } from '../stores/riders';
import { useRoute, useRouter } from 'vue-router';
import { applyPhoneMask } from '../utils/phoneMask';

const store = useRidersStore();
const route = useRoute();
const router = useRouter();

const isEdit = !!route.params.id;
const loading = ref(false);
const error = ref('');

const rider = ref({ name: '', whatsapp: '', dailyRate: '', active: true, password: '' });

onMounted(async () => {
  if (isEdit) {
    loading.value = true;
    try {
      const data = await store.get(route.params.id);
      Object.assign(rider.value, data);
    } catch (e) {
      console.error(e);
      error.value = 'Falha ao carregar entregador';
    } finally {
      loading.value = false;
    }
  }
});

function handleWhatsAppInput(e) {
  rider.value.whatsapp = applyPhoneMask(e.target.value);
}

async function save() {
  loading.value = true;
  error.value = '';
  try {
    if (isEdit) {
      // send password only if provided
      const body = { name: rider.value.name, whatsapp: rider.value.whatsapp, dailyRate: rider.value.dailyRate, active: rider.value.active };
      if (rider.value.password) body.password = rider.value.password;
      await store.update(route.params.id, body);
    } else {
      const body = { name: rider.value.name, whatsapp: rider.value.whatsapp, dailyRate: rider.value.dailyRate, active: rider.value.active };
      if (rider.value.password) body.password = rider.value.password;
      await store.create(body);
    }
    router.push('/riders');
  } catch (e) {
    console.error(e);
    error.value = e?.response?.data?.message || 'Erro ao salvar entregador';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="container py-4">
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="h4 fw-semibold m-0">{{ isEdit ? 'Editar entregador' : 'Novo entregador' }}</h2>
      <button class="btn btn-outline-secondary btn-sm" @click="$router.back()">Voltar</button>
    </div>

    <div class="card">
      <div class="card-body">
        <form @submit.prevent="save" class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Nome</label>
            <TextInput v-model="rider.name" type="text" required />
          </div>
          <div class="col-md-3">
            <label class="form-label">WhatsApp</label>
            <TextInput v-model="rider.whatsapp" @input="handleWhatsAppInput" type="tel" maxlength="16" placeholder="(00) 0 0000-0000" />
          </div>
          <div class="col-md-3">
            <CurrencyInput label="Diária" labelClass="form-label" v-model="rider.dailyRate" inputClass="form-control" placeholder="0,00" />
          </div>
          <div class="col-md-6">
            <label class="form-label">Senha (para o app do motoboy)</label>
            <TextInput v-model="rider.password" type="password" placeholder="Deixe em branco para não criar/alterar senha" />
          </div>

          <div class="col-12">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" v-model="rider.active" id="activeCheck" />
              <label class="form-check-label" for="activeCheck">Ativo</label>
            </div>
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

<style scoped>
.form-label { font-weight: 600; }
</style>
