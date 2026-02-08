<script setup>
import { onMounted, computed } from 'vue';
import { formatCurrency, formatDate } from '../utils/formatters.js';
import { useRoute } from 'vue-router';
import { useCustomersStore } from '../stores/customers';
import BaseButton from '../components/BaseButton.vue';

const route = useRoute();
const store = useCustomersStore();

onMounted(() => store.get(route.params.id));

const stats = computed(() => store.current?.stats || {});

const tierConfig = {
  em_risco: { color: '#dc3545', bg: 'rgba(220,53,69,0.1)', icon: 'bi-exclamation-triangle' },
  regular:  { color: '#ffc107', bg: 'rgba(255,193,7,0.1)',  icon: 'bi-person' },
  fiel:     { color: '#0d6efd', bg: 'rgba(13,110,253,0.1)', icon: 'bi-star' },
  vip:      { color: '#198754', bg: 'rgba(25,135,84,0.1)',   icon: 'bi-trophy' },
};

const currentTier = computed(() => tierConfig[stats.value.tier] || tierConfig.em_risco);

function starsHtml(stars) {
  return '\u2605'.repeat(stars || 0) + '\u2606'.repeat(4 - (stars || 0));
}

function statusLabel(s) {
  const map = { EM_PREPARO: 'Em preparo', SAIU_PARA_ENTREGA: 'Saiu p/ entrega', CONFIRMACAO_PAGAMENTO: 'Conf. pagamento', CONCLUIDO: 'Concluído', CANCELADO: 'Cancelado', INVOICE_AUTHORIZED: 'NF-e emitida' };
  return map[s] || s;
}

function statusColor(s) {
  const map = { EM_PREPARO: '#ffc107', SAIU_PARA_ENTREGA: '#0d6efd', CONFIRMACAO_PAGAMENTO: '#6f42c1', CONCLUIDO: '#198754', CANCELADO: '#dc3545', INVOICE_AUTHORIZED: '#0dcaf0' };
  return map[s] || '#6c757d';
}
</script>

<template>
  <div v-if="store.current" class="container py-4">
    <!-- Cabeçalho -->
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div class="d-flex align-items-center gap-3">
        <div class="profile-avatar" :style="{ background: currentTier.bg, color: currentTier.color }">
          {{ (store.current.fullName || '?')[0].toUpperCase() }}
        </div>
        <div>
          <h2 class="h4 fw-bold mb-0">{{ store.current.fullName }}</h2>
          <div class="d-flex align-items-center gap-2 mt-1">
            <span class="tier-stars" :style="{ color: currentTier.color }">{{ starsHtml(stats.stars) }}</span>
            <span class="badge tier-badge" :style="{ background: currentTier.bg, color: currentTier.color }">
              <i :class="'bi ' + currentTier.icon + ' me-1'"></i>{{ stats.label || 'Em Risco' }}
            </span>
          </div>
        </div>
      </div>
      <div class="d-flex gap-2">
        <BaseButton variant="outline" @click="$router.push('/customers')">
          <i class="bi bi-arrow-left me-1"></i> Voltar
        </BaseButton>
        <BaseButton variant="primary" @click="$router.push(`/customers/${store.current.id}/edit`)">
          <i class="bi bi-pencil me-1"></i> Editar
        </BaseButton>
        <BaseButton variant="success" @click="$router.push(`/customers/${store.current.id}/edit?addAddress=1`)">
          <i class="bi bi-geo-alt me-1"></i> Novo endereço
        </BaseButton>
      </div>
    </div>

    <!-- Cards de Indicadores -->
    <div class="row g-3 mb-4">
      <div class="col-md-3 col-6">
        <div class="stat-card" style="border-left: 4px solid #198754;">
          <div class="stat-label">Total gasto</div>
          <div class="stat-value text-success">{{ formatCurrency(stats.totalSpent || 0) }}</div>
          <div class="stat-sub">{{ stats.totalOrders || 0 }} pedidos concluídos</div>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="stat-card" style="border-left: 4px solid #0d6efd;">
          <div class="stat-label">Último pedido</div>
          <div class="stat-value text-primary">{{ formatDate(stats.lastOrderDate) }}</div>
          <div class="stat-sub">{{ store.current.orders?.length || 0 }} pedidos no total</div>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="stat-card" style="border-left: 4px solid #6f42c1;">
          <div class="stat-label">Item favorito</div>
          <div class="stat-value text-purple">{{ stats.favoriteItem || 'Nenhum' }}</div>
          <div class="stat-sub">Mais pedido pelo cliente</div>
        </div>
      </div>
      <div class="col-md-3 col-6">
        <div class="stat-card" :style="{ borderLeft: '4px solid ' + currentTier.color }">
          <div class="stat-label">Classificação</div>
          <div class="stat-value" :style="{ color: currentTier.color }">
            {{ starsHtml(stats.stars) }}
          </div>
          <div class="stat-sub">
            <span class="badge" :style="{ background: currentTier.bg, color: currentTier.color }">{{ stats.label || 'Em Risco' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Grid principal -->
    <div class="row g-4">
      <!-- Dados do cliente e endereços -->
      <div class="col-md-7">
        <div class="card mb-4">
          <div class="card-header bg-white fw-semibold d-flex align-items-center gap-2">
            <i class="bi bi-person-vcard text-primary"></i> Dados do cliente
          </div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-sm-4">
                <div class="info-label">CPF</div>
                <div class="info-value">{{ store.current.cpf || '—' }}</div>
              </div>
              <div class="col-sm-4">
                <div class="info-label">WhatsApp</div>
                <div class="info-value">{{ store.current.whatsapp || '—' }}</div>
              </div>
              <div class="col-sm-4">
                <div class="info-label">Telefone</div>
                <div class="info-value">{{ store.current.phone || '—' }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-geo-alt text-primary"></i> Endereços
              <span class="badge bg-light text-dark">{{ store.current.addresses?.length || 0 }}</span>
            </div>
          </div>
          <div class="card-body p-0">
            <div
              v-for="(a, i) in store.current.addresses"
              :key="a.id"
              class="address-item"
            >
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <div class="fw-medium">
                    {{ a.label || 'Endereço ' + (i + 1) }}
                    <span v-if="a.isDefault" class="badge bg-success-subtle text-success ms-1">Padrão</span>
                  </div>
                  <div class="mt-1">
                    <div v-if="a.formatted && !a.street">{{ a.formatted }}</div>
                    <div v-else>
                      {{ [a.street, a.number].filter(Boolean).join(', ') }}
                      <span v-if="a.complement"> — {{ a.complement }}</span>
                    </div>
                  </div>
                  <div class="small text-muted mt-1">
                    <span v-if="a.neighborhood">{{ a.neighborhood }} — </span>
                    <span v-if="a.city || a.state">{{ [a.city, a.state].filter(Boolean).join('/') }}</span>
                    <span v-if="(a.postalCode || a.zip || a.postal_code)"> | CEP {{ a.postalCode || a.zip || a.postal_code }}</span>
                  </div>
                  <div v-if="a.reference" class="small text-muted">Ref: {{ a.reference }}</div>
                </div>
                <div class="d-flex gap-1">
                  <button class="btn btn-sm btn-outline-primary" @click="$router.push(`/customers/${store.current.id}/edit?editAddressIndex=${i}`)">
                    <i class="bi bi-pencil"></i>
                  </button>
                  <a v-if="a.latitude && a.longitude" :href="`https://www.google.com/maps?q=${a.latitude},${a.longitude}`" target="_blank" class="btn btn-sm btn-outline-secondary" title="Ver no mapa">
                    <i class="bi bi-geo-alt"></i>
                  </a>
                </div>
              </div>
            </div>

            <div
              v-if="!store.current.addresses?.length"
              class="text-muted text-center py-4 small"
            >
              Nenhum endereço cadastrado.
            </div>
          </div>
        </div>
      </div>

      <!-- Pedidos -->
      <div class="col-md-5">
        <div class="card">
          <div class="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-bag text-primary"></i> Pedidos
              <span class="badge bg-light text-dark">{{ store.current.orders?.length || 0 }}</span>
            </div>
          </div>
          <div class="card-body p-0">
            <div
              v-for="o in store.current.orders"
              :key="o.id"
              class="order-item"
            >
              <div class="d-flex justify-content-between align-items-start">
                <div>
                  <div class="fw-medium">
                    #{{ o.displaySimple != null ? String(o.displaySimple).padStart(2,'0') : (o.displayId != null ? String(o.displayId).padStart(2,'0') : o.id.slice(0, 6)) }}
                  </div>
                  <div class="small text-muted">{{ formatDate(o.createdAt) }}</div>
                  <div v-if="o.items?.length" class="small text-muted mt-1">
                    {{ o.items.map(i => `${i.quantity}x ${i.name}`).join(', ') }}
                  </div>
                </div>
                <div class="text-end">
                  <div class="fw-semibold">{{ formatCurrency(Number(o.total || 0)) }}</div>
                  <span class="badge" :style="{ background: statusColor(o.status) + '1a', color: statusColor(o.status) }">
                    {{ statusLabel(o.status) }}
                  </span>
                </div>
              </div>
            </div>

            <div
              v-if="!store.current.orders?.length"
              class="text-muted text-center py-4 small"
            >
              Nenhum pedido encontrado.
            </div>
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

<style scoped>
.profile-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.5rem;
  flex-shrink: 0;
}
.tier-stars {
  font-size: 1.05rem;
  letter-spacing: 1px;
}
.tier-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 12px;
}

/* Stat cards */
.stat-card {
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 16px 18px;
  height: 100%;
}
.stat-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c757d;
  margin-bottom: 4px;
}
.stat-value {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
}
.stat-sub {
  font-size: 0.78rem;
  color: #adb5bd;
  margin-top: 4px;
}
.text-purple { color: #6f42c1; }

/* Info fields */
.info-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #6c757d;
  margin-bottom: 2px;
}
.info-value {
  font-size: 0.95rem;
  font-weight: 500;
}

/* Address items */
.address-item {
  padding: 14px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.address-item:last-child {
  border-bottom: none;
}
.address-item:hover {
  background: #f9fafb;
}

/* Order items */
.order-item {
  padding: 12px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.order-item:last-child {
  border-bottom: none;
}
.order-item:hover {
  background: #f9fafb;
}

/* Card headers */
.card-header {
  border-bottom: 1px solid #e9ecef;
  padding: 12px 18px;
}
</style>
