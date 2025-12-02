<script setup>
import { onMounted } from 'vue';
import { formatCurrency } from '../utils/formatters.js';
import { useRoute } from 'vue-router';
import { useCustomersStore } from '../stores/customers';
import BaseButton from '../components/BaseButton.vue';

const route = useRoute();
const store = useCustomersStore();

onMounted(() => store.get(route.params.id));
</script>

<template>
  <div v-if="store.current" class="container py-4">
    <!-- Cabeçalho -->
    <div class="d-flex justify-content-between align-items-center mb-4">
      <h2 class="h4 fw-semibold mb-0">{{ store.current.fullName }}</h2>
      <BaseButton variant="outline" @click="$router.push('/customers')">Voltar</BaseButton>
    </div>

    <!-- Grid principal -->
    <div class="row g-4">
      <!-- Dados do cliente e endereços -->
      <div class="col-md-8">
        <div class="card mb-4">
          <div class="card-body">
            <div><strong>CPF:</strong> {{ store.current.cpf || '—' }}</div>
            <div><strong>WhatsApp:</strong> {{ store.current.whatsapp || '—' }}</div>
            <div><strong>Telefone:</strong> {{ store.current.phone || '—' }}</div>

            <hr class="my-3" />

            <h5 class="fw-semibold mb-3">Endereços</h5>
            <ul class="list-group list-group-flush">
              <li
                v-for="a in store.current.addresses"
                :key="a.id"
                class="list-group-item"
              >
                <div class="fw-medium">
                  {{ a.label || '—' }}
                  <span v-if="a.isDefault" class="text-success small ms-1">(padrão)</span>
                </div>

                <div>
                  {{ a.formatted || [a.street, a.number].filter(Boolean).join(', ') }}
                </div>

                <div class="small text-muted">
                  {{ a.neighborhood }} — {{ a.city }}/{{ a.state }} • CEP {{ a.postalCode }}
                </div>

                <div v-if="a.latitude && a.longitude" class="small mt-1">
                  <a
                    :href="`https://www.google.com/maps?q=${a.latitude},${a.longitude}`"
                    target="_blank"
                    class="link-primary text-decoration-none"
                  >
                    📍 Ver no mapa
                  </a>
                </div>
              </li>

              <li
                v-if="!store.current.addresses?.length"
                class="list-group-item text-muted small"
              >
                Nenhum endereço cadastrado.
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Pedidos -->
      <div class="col-md-4">
        <div class="card">
          <div class="card-header bg-light fw-semibold">Pedidos</div>
          <div class="card-body p-0">
            <ul class="list-group list-group-flush small">
              <li
                v-for="o in store.current.orders"
                :key="o.id"
                class="list-group-item d-flex justify-content-between align-items-center"
              >
                <span>
                  #{{ o.displaySimple != null ? String(o.displaySimple).padStart(2,'0') : (o.displayId != null ? String(o.displayId).padStart(2,'0') : o.id.slice(0, 6)) }} — {{ o.status }}
                </span>
                <span class="fw-medium">
                  {{ formatCurrency(Number(o.total || o.total?.orderAmount || 0)) }}
                </span>
              </li>

              <li
                v-if="!store.current.orders?.length"
                class="list-group-item text-muted text-center small py-3"
              >
                Nenhum pedido encontrado.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-else class="container py-5 text-center text-muted">
    <div class="spinner-border text-secondary mb-3"></div>
    <p>Carregando dados do cliente...</p>
  </div>
</template>