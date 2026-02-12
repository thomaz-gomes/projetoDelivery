<template>
  <div class="container py-3">
    <h3 class="mb-3">Conciliação OFX</h3>

    <!-- Upload -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-4">
            <label class="form-label">Conta Bancária</label>
            <SelectInput v-model="importAccountId" :options="accountOptions" optionValueKey="id" optionLabelKey="name" placeholder="Selecionar conta" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Arquivo OFX</label>
            <input type="file" class="form-control" @change="onFileSelect" accept=".ofx,.OFX">
          </div>
          <div class="col-md-4">
            <button class="btn btn-primary" @click="importFile" :disabled="!importAccountId || !fileContent || importing">
              {{ importing ? 'Importando...' : 'Importar' }}
            </button>
          </div>
        </div>
        <div v-if="importResult" class="alert alert-success mt-3 mb-0">
          Importação concluída: {{ importResult.totalItems }} transações,
          <strong>{{ importResult.matched }}</strong> conciliadas automaticamente,
          <strong>{{ importResult.unmatched }}</strong> pendentes.
        </div>
      </div>
    </div>

    <!-- Importações anteriores -->
    <div class="card mb-3">
      <div class="card-header d-flex justify-content-between">
        <strong>Importações</strong>
      </div>
      <div class="table-responsive">
        <table class="table table-hover mb-0">
          <thead class="table-light">
            <tr>
              <th>Data</th>
              <th>Arquivo</th>
              <th>Conta</th>
              <th>Total</th>
              <th>Conciliados</th>
              <th>Pendentes</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="imp in imports" :key="imp.id">
              <td>{{ formatDate(imp.createdAt) }}</td>
              <td>{{ imp.fileName }}</td>
              <td>{{ imp.account?.name || '-' }}</td>
              <td>{{ imp.totalItems }}</td>
              <td class="text-success">{{ imp.matchedItems }}</td>
              <td class="text-warning">{{ imp.unmatchedItems }}</td>
              <td><span class="badge bg-secondary">{{ imp.status }}</span></td>
              <td>
                <button class="btn btn-sm btn-outline-primary" @click="viewItems(imp)">Ver itens</button>
              </td>
            </tr>
            <tr v-if="imports.length === 0">
              <td colspan="8" class="text-center py-3 text-muted">Nenhuma importação realizada.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Fila de conciliação (itens de uma importação) -->
    <div v-if="selectedImport" class="card">
      <div class="card-header d-flex justify-content-between">
        <strong>Itens - {{ selectedImport.fileName }}</strong>
        <div>
          <button class="btn btn-sm btn-outline-secondary me-1" :class="{active: itemFilter === ''}" @click="itemFilter = ''; loadItems()">Todos</button>
          <button class="btn btn-sm btn-outline-warning me-1" :class="{active: itemFilter === 'PENDING'}" @click="itemFilter = 'PENDING'; loadItems()">Pendentes</button>
          <button class="btn btn-sm btn-outline-success me-1" :class="{active: itemFilter === 'MATCHED'}" @click="itemFilter = 'MATCHED'; loadItems()">Conciliados</button>
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-sm mb-0">
          <thead class="table-light">
            <tr>
              <th>Data</th>
              <th>Descrição</th>
              <th>Valor</th>
              <th>FITID</th>
              <th>Status</th>
              <th>Match</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" :class="{'table-success': item.matchStatus === 'MATCHED', 'table-warning': item.matchStatus === 'PENDING'}">
              <td>{{ formatDate(item.ofxDate) }}</td>
              <td>{{ item.memo || '-' }}</td>
              <td :class="Number(item.amount) >= 0 ? 'text-success' : 'text-danger'">
                {{ formatCurrency(item.amount) }}
              </td>
              <td><small class="text-muted">{{ item.fitId || '-' }}</small></td>
              <td><span :class="matchBadge(item.matchStatus)">{{ item.matchStatus }}</span></td>
              <td>
                <small v-if="item.transaction">{{ item.transaction.description }}</small>
                <small v-else class="text-muted">-</small>
              </td>
              <td class="text-end">
                <button v-if="item.matchStatus === 'PENDING' || item.matchStatus === 'UNMATCHED'"
                        class="btn btn-sm btn-outline-secondary me-1" @click="ignoreItem(item)">Ignorar</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script>
import api from '../../api';
import SelectInput from '../../components/form/select/SelectInput.vue';

export default {
  name: 'FinancialOFX',
  components: { SelectInput },
  data() {
    return {
      accounts: [],
      imports: [],
      importAccountId: '',
      fileContent: null,
      fileName: '',
      importing: false,
      importResult: null,
      selectedImport: null,
      items: [],
      itemFilter: '',
    };
  },
  computed: {
    accountOptions() { return this.accounts.filter(a => a.isActive); },
  },
  async mounted() {
    await Promise.all([this.loadAccounts(), this.loadImports()]);
  },
  methods: {
    async loadAccounts() {
      try {
        const { data } = await api.get('/financial/accounts');
        this.accounts = data;
      } catch (e) { /* ignore */ }
    },
    async loadImports() {
      try {
        const { data } = await api.get('/financial/ofx/imports');
        this.imports = data;
      } catch (e) {
        console.error('Failed to load imports:', e);
      }
    },
    onFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
      this.fileName = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        this.fileContent = ev.target.result;
      };
      reader.readAsText(file);
    },
    async importFile() {
      this.importing = true;
      this.importResult = null;
      try {
        const { data } = await api.post('/financial/ofx/import', {
          accountId: this.importAccountId,
          content: this.fileContent,
          fileName: this.fileName,
        });
        this.importResult = data;
        await this.loadImports();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao importar');
      } finally {
        this.importing = false;
      }
    },
    async viewItems(imp) {
      this.selectedImport = imp;
      this.itemFilter = '';
      await this.loadItems();
    },
    async loadItems() {
      if (!this.selectedImport) return;
      try {
        const params = {};
        if (this.itemFilter) params.matchStatus = this.itemFilter;
        const { data } = await api.get(`/financial/ofx/imports/${this.selectedImport.id}/items`, { params });
        this.items = data;
      } catch (e) {
        console.error('Failed to load items:', e);
      }
    },
    async ignoreItem(item) {
      try {
        await api.post(`/financial/ofx/items/${item.id}/match`, { action: 'ignore' });
        await this.loadItems();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro');
      }
    },
    matchBadge(status) {
      const map = { PENDING: 'badge bg-warning text-dark', MATCHED: 'badge bg-success', MANUAL: 'badge bg-info', IGNORED: 'badge bg-secondary', UNMATCHED: 'badge bg-danger' };
      return map[status] || 'badge bg-secondary';
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    formatDate(d) {
      if (!d) return '-';
      return new Date(d).toLocaleDateString('pt-BR');
    },
  },
};
</script>
