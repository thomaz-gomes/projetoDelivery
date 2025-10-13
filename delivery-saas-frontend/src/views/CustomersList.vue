<script setup>
import { ref, onMounted } from 'vue';
import { useCustomersStore } from '../stores/customers';
import { useRouter } from 'vue-router';
import BaseButton from '../components/BaseButton.vue';

const store = useCustomersStore();
const router = useRouter();
const q = ref('');

onMounted(() => store.fetch());

function search() {
  store.fetch({ q: q.value });
}

function goNew() {
  router.push('/customers/new');
}

function goProfile(id) {
  router.push(`/customers/${id}`);
}

async function onImport(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const res = await store.importFile(file);
  alert(`Importação: criados ${res.created}, atualizados ${res.updated}.`);
  await store.fetch();
}
</script>

<template>
  <div class="d-flex flex-column gap-4">
    <!-- Topo com busca e ações -->
    <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
      <h2 class="h4 fw-semibold m-0">Clientes</h2>

      <div class="d-flex align-items-center gap-2 flex-wrap">
        <input
          v-model="q"
          type="text"
          class="form-control form-control-sm"
          style="min-width: 260px;"
          placeholder="Buscar por nome, CPF, WhatsApp"
          @keyup.enter="search"
        />

        <BaseButton variant="outline" @click="search">Buscar</BaseButton>

        <label class="btn btn-outline-secondary btn-sm mb-0">
          Importar
          <input type="file" accept=".csv,.xlsx,.xls" class="d-none" @change="onImport" />
        </label>

        <BaseButton icon="➕" @click="goNew">Novo</BaseButton>
      </div>
    </div>

    <!-- Tabela -->
    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover table-bordered align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Nome</th>
              <th>CPF</th>
              <th>WhatsApp</th>
              <th>Endereço</th>
              <th>Pedidos</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in store.list"
              :key="c.id"
              class="cursor-pointer"
              @click="goProfile(c.id)"
              style="cursor: pointer;"
            >
              <td>{{ c.fullName }}</td>
              <td>{{ c.cpf || '—' }}</td>
              <td>{{ c.whatsapp || c.phone || '—' }}</td>
              <td>
                <div class="small text-dark">
                  {{
                    c.addresses?.[0]?.formatted ||
                    [c.addresses?.[0]?.street, c.addresses?.[0]?.number]
                      .filter(Boolean)
                      .join(', ') ||
                    '—'
                  }}
                </div>
              </td>
              <td>{{ c.orders?.length || 0 }}</td>
            </tr>

            <tr v-if="store.list.length === 0">
              <td colspan="5" class="text-center text-secondary py-4">
                Nenhum cliente encontrado.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
