<script setup>
import { onMounted, ref } from 'vue';
import { useOrdersStore } from '../stores/orders';
import { useAuthStore } from '../stores/auth';
import { useRouter } from 'vue-router';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const store = useOrdersStore();
const auth = useAuthStore();
const router = useRouter();

const loading = ref(false);

// mapeamento de status + labels
const statusActions = [
  { to: 'EM_PREPARO', label: 'Em preparo' },
  { to: 'SAIU_PARA_ENTREGA', label: 'Saiu p/ entrega' },
  { to: 'CONCLUIDO', label: 'Concluído' },
  { to: 'CANCELADO', label: 'Cancelar' },
];

onMounted(async () => {
  try {
    await store.fetch();
    await store.fetchRiders();
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao carregar pedidos/entregadores.', 'error');
  }
});

function logout() {
  auth.logout();
  location.href = '/login';
}

function printReceipt(o) {
  router.push(`/orders/${o.id}/receipt`);
}

async function openAssignModal(order) {
  // garante lista atual
  const riders = (await store.fetchRiders()) || [];
  const options = riders.reduce((acc, r) => {
    acc[r.id] = `${r.name} — ${r.whatsapp || 'sem WhatsApp'}`;
    return acc;
  }, {});

  const { value: riderId } = await Swal.fire({
    title: 'Escolher entregador',
    input: 'select',
    inputOptions: options,
    inputPlaceholder: 'Selecione um entregador',
    showCancelButton: true,
    confirmButtonText: 'Atribuir',
    cancelButtonText: 'Cancelar',
    footer: 'Se o entregador não estiver cadastrado, você poderá digitar um WhatsApp.',
  });

  if (riderId) {
    // atribui e muda status para SAIU_PARA_ENTREGA (notify rider + cliente)
    await store.assignOrder(order.id, { riderId, alsoSetStatus: true });
    await store.fetch();
    Swal.fire('OK', 'Pedido atribuído e notificado via WhatsApp.', 'success');
    return;
  }

  // Digitar WhatsApp manualmente
  const { value: phone } = await Swal.fire({
    title: 'WhatsApp do entregador',
    text: 'Formato: 55DDXXXXXXXXX',
    input: 'text',
    inputPlaceholder: '5599999999999',
    showCancelButton: true,
    confirmButtonText: 'Atribuir via WhatsApp',
  });

  if (phone) {
    await store.assignOrder(order.id, { riderPhone: phone, alsoSetStatus: true });
    await store.fetch();
    Swal.fire('OK', 'Pedido atribuído e notificado via WhatsApp.', 'success');
  }
}

async function changeStatus(order, to) {
  try {
    if (to === 'SAIU_PARA_ENTREGA') {
      await openAssignModal(order);
      return;
    }
    loading.value = true;
    await store.updateStatus(order.id, to);
    await store.fetch();
  } catch (e) {
    console.error(e);
    Swal.fire('Erro', 'Falha ao atualizar status.', 'error');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="container py-4">
    <header class="d-flex align-items-center justify-content-between mb-4">
      <h2 class="fs-4 fw-semibold m-0">Pedidos</h2>
      <div class="d-flex gap-2">
        <BaseButton variant="primary" @click="store.fetch">Atualizar</BaseButton>

        <button type="button" class="btn btn-danger" @click="logout">
          Sair
        </button>
      </div>
    </header>

    <div class="card">
      <div class="card-body p-0">
        <div class="table-responsive">
          <table class="table table-hover table-bordered align-middle mb-0">
            <thead class="table-light">
              <tr>
                <th scope="col">#</th>
                <th scope="col">Cliente</th>
                <th scope="col">Endereço</th>
                <th scope="col">Total</th>
                <th scope="col">Status</th>
                <th scope="col">Entregador</th>
                <th scope="col" style="width: 320px;">Ações</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in store.orders" :key="o.id">
                <td class="text-nowrap">
                  {{ o.displayId || o.id.slice(0,6) }}
                </td>

                <td>
                  <div class="fw-medium">{{ o.customerName || '-' }}</div>
                  <div class="small text-muted">{{ o.customerPhone || '' }}</div>
                </td>

                <td>
                  <div class="small">
                    {{ o.address || o.payload?.delivery?.deliveryAddress?.formattedAddress || '-' }}
                  </div>
                </td>

                <td class="text-nowrap">
                  R$ {{ Number(o.total || o.total?.orderAmount || 0).toFixed(2) }}
                </td>

                <td>
                  <span
                    class="badge"
                    :class="{
                      'bg-warning text-dark': o.status === 'EM_PREPARO',
                      'bg-primary': o.status === 'SAIU_PARA_ENTREGA',
                      'bg-success': o.status === 'CONCLUIDO',
                      'bg-danger': o.status === 'CANCELADO',
                    }"
                  >
                    {{ o.status }}
                  </span>
                </td>

                <td>
                  <div class="small">
                    <span v-if="o.rider">{{ o.rider.name }}</span>
                    <span v-else class="text-muted">—</span>
                  </div>
                </td>

                <td>
                  <div class="d-flex flex-wrap gap-2">
                    <button
                      v-for="a in statusActions"
                      :key="a.to"
                      type="button"
                      class="btn btn-outline-secondary btn-sm"
                      :disabled="!store.canTransition(o.status, a.to) || loading"
                      @click="changeStatus(o, a.to)"
                    >
                      {{ a.label }}
                    </button>

                    <button
                      type="button"
                      class="btn btn-dark btn-sm"
                      @click="printReceipt(o)"
                    >
                      Imprimir comanda
                    </button>
                  </div>
                </td>
              </tr>

              <tr v-if="store.orders.length === 0">
                <td colspan="7" class="text-center text-secondary py-4">
                  Nenhum pedido encontrado.
                </td>
              </tr>
            </tbody>
          </table>
        </div> <!-- /.table-responsive -->
      </div>
    </div>
  </div>
</template>