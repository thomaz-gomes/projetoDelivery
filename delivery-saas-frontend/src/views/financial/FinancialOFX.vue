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
        <div v-if="matchResults" class="alert alert-info mt-3 mb-0">
          <strong>{{ matchResults.exact }}</strong> conciliados (exato) &middot;
          <strong>{{ matchResults.aiAuto }}</strong> conciliados (IA) &middot;
          <strong>{{ matchResults.aiSuggested }}</strong> sugestões para revisar &middot;
          <strong>{{ matchResults.unmatched }}</strong> sem correspondência
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
                <button class="btn btn-sm btn-outline-primary me-1" @click="viewItems(imp)">Ver itens</button>
                <button class="btn btn-sm btn-outline-primary" @click="reReconcile(imp.id)">Re-conciliar com IA</button>
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
            <tr v-for="item in items" :key="item.id" :class="{'table-success': item.matchStatus === 'MATCHED' || item.matchStatus === 'MANUAL', 'table-warning': item.matchStatus === 'PENDING'}">
              <td>{{ formatDate(item.ofxDate) }}</td>
              <td>{{ item.memo || '-' }}</td>
              <td :class="Number(item.amount) >= 0 ? 'text-success' : 'text-danger'">
                {{ formatCurrency(item.amount) }}
              </td>
              <td><small class="text-muted">{{ item.fitId || '-' }}</small></td>
              <td><span :class="matchBadge(item.matchStatus)">{{ statusLabel(item.matchStatus) }}</span></td>
              <td>
                <template v-if="item.transaction">
                  <small>{{ item.transaction.description }}</small>
                  <span v-if="item.matchConfidence" class="badge bg-light text-dark ms-1" style="font-size: 0.7rem">
                    {{ item.matchMethod === 'EXACT' ? 'Exato' : Math.round(item.matchConfidence * 100) + '%' }}
                  </span>
                </template>
                <small v-else class="text-muted">-</small>
              </td>
              <td class="text-end">
                <template v-if="item.matchStatus === 'PENDING' || item.matchStatus === 'UNMATCHED'">
                  <button class="btn btn-sm btn-primary me-1" @click="openDrawer(item)">Conciliar</button>
                  <button class="btn btn-sm btn-outline-secondary" @click="ignoreItem(item)">Ignorar</button>
                </template>
                <template v-else-if="item.matchStatus === 'MATCHED' || item.matchStatus === 'MANUAL'">
                  <button class="btn btn-sm btn-outline-warning" @click="undoMatch(item)">Desfazer</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- AI Suggestions Review -->
      <div v-if="aiSuggestions.length" class="mt-4">
        <h6>Sugestões da IA para Revisar</h6>
        <div v-for="item in aiSuggestions" :key="item.id" class="card mb-2">
          <div class="card-body d-flex justify-content-between align-items-start">
            <div>
              <div><strong>Extrato:</strong> {{ item.memo || 'Sem descrição' }} — R$ {{ Math.abs(Number(item.amount)).toFixed(2) }}</div>
              <div><strong>Sugestão:</strong> {{ item.transaction?.description }} — R$ {{ Number(item.transaction?.netAmount).toFixed(2) }}</div>
              <div class="text-muted small">
                Confiança: {{ item.matchConfidence }}% — {{ item.aiReasoning }}
              </div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-success" @click="confirmMatch(item)">Confirmar</button>
              <button class="btn btn-sm btn-outline-danger" @click="rejectMatch(item)">Rejeitar</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ReconciliationDrawer
      v-model="drawerOpen"
      :item="drawerItem"
      @reconciled="onReconciled"
    />
  </div>
</template>

<script>
import api from '../../api';
import SelectInput from '../../components/form/select/SelectInput.vue';
import ReconciliationDrawer from '../../components/financial/ReconciliationDrawer.vue';

export default {
  name: 'FinancialOFX',
  components: { SelectInput, ReconciliationDrawer },
  data() {
    return {
      accounts: [],
      imports: [],
      importAccountId: '',
      fileContent: null,
      fileName: '',
      importing: false,
      importResult: null,
      matchResults: null,
      selectedImport: null,
      items: [],
      aiSuggestions: [],
      itemFilter: '',
      drawerOpen: false,
      drawerItem: null,
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
      this.matchResults = null;
      try {
        const { data } = await api.post('/financial/ofx/import', {
          accountId: this.importAccountId,
          content: this.fileContent,
          fileName: this.fileName,
        });
        this.importResult = data;
        if (data.matchResults) {
          this.matchResults = data.matchResults;
        }
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
        this.aiSuggestions = data.filter(i => i.matchMethod === 'AI_SUGGESTED');
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
    async confirmMatch(item) {
      try {
        await api.put(`/financial/ofx/items/${item.id}/match`, {
          transactionId: item.transactionId,
          matchStatus: 'MATCHED',
        });
        this.aiSuggestions = this.aiSuggestions.filter(s => s.id !== item.id);
        await this.loadItems();
      } catch (e) {
        console.error(e);
      }
    },
    async rejectMatch(item) {
      try {
        await api.put(`/financial/ofx/items/${item.id}/match`, {
          transactionId: null,
          matchStatus: 'UNMATCHED',
        });
        this.aiSuggestions = this.aiSuggestions.filter(s => s.id !== item.id);
        await this.loadItems();
      } catch (e) {
        console.error(e);
      }
    },
    async reReconcile(importId) {
      try {
        const { data } = await api.post(`/financial/ofx/${importId}/reconcile`);
        this.matchResults = data;
        if (this.selectedImport && this.selectedImport.id === importId) {
          await this.loadItems();
        }
      } catch (e) {
        console.error(e);
      }
    },
    openDrawer(item) {
      this.drawerItem = item;
      this.drawerOpen = true;
    },
    async undoMatch(item) {
      try {
        await api.post(`/financial/ofx/items/${item.id}/match`, { action: 'undo' });
        await this.loadItems();
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao desfazer conciliação');
      }
    },
    onReconciled() {
      this.loadItems();
      this.loadImports();
    },
    statusLabel(status) {
      const map = {
        PENDING: 'Pendente',
        MATCHED: 'Conciliado',
        MANUAL: 'Conciliado (manual)',
        IGNORED: 'Ignorado',
        UNMATCHED: 'Sem correspondência',
      };
      return map[status] || status;
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
