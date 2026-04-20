# Conciliação Manual OFX — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar drawer de conciliação manual com candidatos sugeridos, busca, criação de lançamentos e ação de desfazer match na tela de conciliação OFX.

**Architecture:** Nova rota backend para buscar candidatos (reutiliza scoring do ofxProcessor), nova rota para criar lançamento + vincular, action `undo` na rota existente. Frontend: drawer lateral com 3 áreas (candidatos, busca, formulário de criação). Todos os textos em português.

**Tech Stack:** Express.js + Prisma (backend), Vue 3 + Bootstrap 5 + design system components (frontend)

---

### Task 1: Backend — rota de candidatos

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/ofx.js`

**Step 1: Adicionar rota GET /financial/ofx/items/:id/candidates**

Adicionar antes do `export default router;` em `ofx.js`:

```js
// GET /financial/ofx/items/:id/candidates - buscar lançamentos candidatos para conciliação manual
router.get('/items/:id/candidates', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const item = await prisma.ofxReconciliationItem.findFirst({
      where: { id: req.params.id },
      include: { import: { select: { companyId: true } } },
    });
    if (!item || item.import.companyId !== companyId) {
      return res.status(404).json({ message: 'Item não encontrado' });
    }

    const { search } = req.query;
    const ofxDate = new Date(item.ofxDate);
    const ofxAmount = Math.abs(Number(item.amount));
    const isCredit = Number(item.amount) > 0;

    const daysBefore = new Date(ofxDate);
    daysBefore.setDate(daysBefore.getDate() - 7);
    const daysAfter = new Date(ofxDate);
    daysAfter.setDate(daysAfter.getDate() + 7);

    const where = {
      companyId,
      type: isCredit ? 'RECEIVABLE' : 'PAYABLE',
      status: { in: ['PENDING', 'CONFIRMED', 'PAID'] },
    };

    if (search) {
      where.description = { contains: search, mode: 'insensitive' };
    } else {
      where.dueDate = { gte: daysBefore, lte: daysAfter };
    }

    const candidates = await prisma.financialTransaction.findMany({
      where,
      include: {
        costCenter: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    });

    // Calcular score para cada candidato
    const scored = candidates.map(c => {
      const candidateAmount = Math.abs(Number(c.netAmount));
      const valueDiff = Math.abs(ofxAmount - candidateAmount);
      const valueScore = valueDiff <= 0.05 ? 1.0 : valueDiff <= 1.0 ? 0.8 : valueDiff <= 5.0 ? 0.5 : 0;

      const dateDiff = Math.abs(ofxDate.getTime() - new Date(c.dueDate).getTime()) / (1000 * 60 * 60 * 24);
      const dateScore = dateDiff <= 0 ? 1.0 : dateDiff <= 1 ? 0.9 : dateDiff <= 3 ? 0.6 : 0.3;

      let descScore = 0;
      if (item.memo && c.description) {
        const memoLower = (item.memo || '').toLowerCase();
        const descLower = (c.description || '').toLowerCase();
        if (memoLower.includes(descLower) || descLower.includes(memoLower)) descScore = 1.0;
        else {
          const memoWords = memoLower.split(/\s+/).filter(w => w.length > 3);
          const descWords = descLower.split(/\s+/).filter(w => w.length > 3);
          const commonWords = memoWords.filter(w => descWords.some(d => d.includes(w) || w.includes(d)));
          descScore = memoWords.length > 0 ? commonWords.length / memoWords.length : 0;
        }
      }

      const score = (valueScore * 0.5) + (dateScore * 0.3) + (descScore * 0.2);
      return {
        id: c.id,
        description: c.description,
        grossAmount: c.grossAmount,
        netAmount: c.netAmount,
        dueDate: c.dueDate,
        status: c.status,
        costCenter: c.costCenter,
        score: Math.round(score * 100),
      };
    });

    // Ordenar por score desc
    scored.sort((a, b) => b.score - a.score);

    res.json(scored);
  } catch (e) {
    console.error('GET /financial/ofx/items/:id/candidates error:', e);
    res.status(500).json({ message: 'Erro ao buscar candidatos', error: e?.message });
  }
});
```

**Step 2: Testar manualmente**

```bash
# Com o backend rodando, testar via curl (substituir IDs reais):
curl -H "Authorization: Bearer TOKEN" http://localhost:3000/financial/ofx/items/ITEM_ID/candidates
```

**Step 3: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/ofx.js
git commit -m "feat(ofx): add candidates endpoint for manual reconciliation"
```

---

### Task 2: Backend — rota criar lançamento + vincular

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/ofx.js`

**Step 1: Adicionar rota POST /financial/ofx/items/:id/create-and-match**

Adicionar após a rota de candidates:

```js
// POST /financial/ofx/items/:id/create-and-match - criar lançamento e vincular ao item OFX
router.post('/items/:id/create-and-match', async (req, res) => {
  try {
    const companyId = req.user.companyId;
    const item = await prisma.ofxReconciliationItem.findFirst({
      where: { id: req.params.id },
      include: { import: { select: { companyId: true, accountId: true } } },
    });
    if (!item || item.import.companyId !== companyId) {
      return res.status(404).json({ message: 'Item não encontrado' });
    }

    const {
      type, description, grossAmount, feeAmount = 0,
      issueDate, dueDate, costCenterId, notes,
    } = req.body;

    if (!type || !description || grossAmount == null || !dueDate) {
      return res.status(400).json({ message: 'type, description, grossAmount e dueDate são obrigatórios' });
    }

    const netAmount = Number(grossAmount) - Number(feeAmount);

    const result = await prisma.$transaction(async (tx) => {
      // Criar lançamento
      const transaction = await tx.financialTransaction.create({
        data: {
          companyId,
          type,
          status: 'PAID',
          description,
          accountId: item.import.accountId,
          costCenterId: costCenterId || null,
          grossAmount: Number(grossAmount),
          feeAmount: Number(feeAmount),
          netAmount,
          issueDate: new Date(issueDate || item.ofxDate),
          dueDate: new Date(dueDate),
          paidAt: new Date(item.ofxDate),
          paidAmount: netAmount,
          sourceType: 'MANUAL',
          createdBy: req.user.id,
          notes: notes || null,
        },
      });

      // Vincular ao item OFX
      const updated = await tx.ofxReconciliationItem.update({
        where: { id: item.id },
        data: {
          matchStatus: 'MANUAL',
          transactionId: transaction.id,
          matchConfidence: 1.0,
          matchMethod: 'MANUAL',
          resolvedBy: req.user.id,
          resolvedAt: new Date(),
          matchNotes: 'Lançamento criado e vinculado manualmente',
        },
        include: {
          transaction: { select: { id: true, description: true, grossAmount: true, dueDate: true } },
        },
      });

      return updated;
    });

    res.status(201).json(result);
  } catch (e) {
    console.error('POST /financial/ofx/items/:id/create-and-match error:', e);
    res.status(500).json({ message: 'Erro ao criar e vincular lançamento', error: e?.message });
  }
});
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/ofx.js
git commit -m "feat(ofx): add create-and-match endpoint for new transactions from OFX items"
```

---

### Task 3: Backend — action undo na rota de match

**Files:**
- Modify: `delivery-saas-backend/src/routes/financial/ofx.js`

**Step 1: Adicionar action `undo` no handler POST /items/:id/match**

No handler existente `POST /items/:id/match` (linha 143), adicionar logo após o bloco `if (action === 'ignore')`:

```js
    if (action === 'undo') {
      const updated = await prisma.ofxReconciliationItem.update({
        where: { id: req.params.id },
        data: {
          matchStatus: 'PENDING',
          transactionId: null,
          cashFlowEntryId: null,
          matchConfidence: null,
          matchMethod: null,
          resolvedBy: null,
          resolvedAt: null,
          matchNotes: null,
          aiReasoning: null,
        },
      });
      return res.json(updated);
    }
```

**Step 2: Commit**

```bash
git add delivery-saas-backend/src/routes/financial/ofx.js
git commit -m "feat(ofx): add undo action to revert reconciliation to pending"
```

---

### Task 4: Frontend — drawer de conciliação (componente)

**Files:**
- Create: `delivery-saas-frontend/src/components/financial/ReconciliationDrawer.vue`

**Step 1: Criar o componente do drawer**

```vue
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="drawer-overlay" @click.self="close">
      <div class="drawer-panel">
        <!-- Cabeçalho com dados do OFX -->
        <div class="drawer-header">
          <div class="d-flex justify-content-between align-items-start mb-3">
            <h5 class="mb-0">Conciliar Item</h5>
            <button class="btn-close" @click="close"></button>
          </div>
          <div class="card bg-light border-0 mb-3">
            <div class="card-body py-2">
              <div class="small text-muted">Extrato bancário</div>
              <div class="fw-semibold">{{ item?.memo || 'Sem descrição' }}</div>
              <div class="d-flex gap-3 mt-1">
                <span class="fw-bold" :class="Number(item?.amount) >= 0 ? 'text-success' : 'text-danger'" style="font-size: 1.25rem">
                  {{ formatCurrency(item?.amount) }}
                </span>
                <span class="text-muted align-self-center">{{ formatDate(item?.ofxDate) }}</span>
              </div>
              <div class="text-muted small mt-1">FITID: {{ item?.fitId || '-' }}</div>
            </div>
          </div>
        </div>

        <div class="drawer-body">
          <!-- Área 1: Candidatos sugeridos -->
          <div class="mb-4">
            <h6 class="text-muted mb-2"><i class="bi-lightning me-1"></i>Candidatos sugeridos</h6>
            <div v-if="loadingCandidates" class="text-center py-3">
              <div class="spinner-border spinner-border-sm text-primary"></div>
              <span class="ms-2 text-muted small">Buscando...</span>
            </div>
            <div v-else-if="candidates.length === 0" class="text-muted small py-2">
              Nenhum lançamento compatível encontrado.
            </div>
            <div v-else class="d-flex flex-column gap-2">
              <div v-for="c in candidates" :key="c.id" class="card candidate-card" @click="matchWith(c)">
                <div class="card-body py-2 px-3 d-flex justify-content-between align-items-center">
                  <div>
                    <div class="fw-semibold small">{{ c.description }}</div>
                    <div class="d-flex gap-2 mt-1">
                      <span class="small">{{ formatCurrency(c.netAmount) }}</span>
                      <span class="text-muted small">{{ formatDate(c.dueDate) }}</span>
                      <span v-if="c.costCenter" class="text-muted small">{{ c.costCenter.name }}</span>
                    </div>
                  </div>
                  <div class="d-flex align-items-center gap-2">
                    <span class="badge" :class="scoreBadgeClass(c.score)">{{ c.score }}%</span>
                    <button class="btn btn-sm btn-outline-primary" @click.stop="matchWith(c)">Vincular</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Área 2: Busca manual -->
          <div class="mb-4">
            <h6 class="text-muted mb-2"><i class="bi-search me-1"></i>Buscar lançamento</h6>
            <div class="input-group input-group-sm mb-2">
              <input type="text" class="form-control" v-model="searchQuery" placeholder="Buscar por descrição..."
                     @keyup.enter="searchCandidates">
              <button class="btn btn-outline-primary" @click="searchCandidates" :disabled="!searchQuery.trim()">
                <i class="bi-search"></i>
              </button>
            </div>
            <div v-if="searchResults.length" class="d-flex flex-column gap-2">
              <div v-for="c in searchResults" :key="c.id" class="card candidate-card" @click="matchWith(c)">
                <div class="card-body py-2 px-3 d-flex justify-content-between align-items-center">
                  <div>
                    <div class="fw-semibold small">{{ c.description }}</div>
                    <div class="d-flex gap-2 mt-1">
                      <span class="small">{{ formatCurrency(c.netAmount) }}</span>
                      <span class="text-muted small">{{ formatDate(c.dueDate) }}</span>
                    </div>
                  </div>
                  <button class="btn btn-sm btn-outline-primary" @click.stop="matchWith(c)">Vincular</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Área 3: Criar novo lançamento -->
          <div>
            <button class="btn btn-sm btn-outline-secondary w-100 mb-3" @click="showCreateForm = !showCreateForm">
              <i class="bi-plus-circle me-1"></i>
              {{ showCreateForm ? 'Fechar formulário' : 'Criar novo lançamento' }}
            </button>

            <div v-if="showCreateForm" class="create-form">
              <div class="mb-3">
                <SelectInput v-model="newTx.type" label="Tipo" :options="typeOptions" />
              </div>
              <div class="mb-3">
                <TextInput v-model="newTx.description" label="Descrição" />
              </div>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <CurrencyInput v-model="newTx.grossAmount" label="Valor bruto" />
                </div>
                <div class="col-6">
                  <CurrencyInput v-model="newTx.feeAmount" label="Taxa" />
                </div>
              </div>
              <div class="mb-2">
                <small class="text-muted">Valor líquido: <strong>{{ formatCurrency(netAmount) }}</strong></small>
              </div>
              <div class="row g-2 mb-3">
                <div class="col-6">
                  <DateInput v-model="newTx.issueDate" label="Emissão" />
                </div>
                <div class="col-6">
                  <DateInput v-model="newTx.dueDate" label="Vencimento" />
                </div>
              </div>
              <div class="mb-3">
                <SelectInput v-model="newTx.costCenterId" label="Centro de custo"
                  :options="costCenters" optionValueKey="id" optionLabelKey="name"
                  placeholder="Selecionar..." />
              </div>
              <div class="mb-3">
                <TextareaInput v-model="newTx.notes" label="Observações" rows="2" />
              </div>
              <BaseButton variant="primary" block :loading="creating" @click="createAndMatch">
                Criar e Vincular
              </BaseButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import api from '../../api';
import TextInput from '../form/text/TextInput.vue';
import TextareaInput from '../form/text/TextareaInput.vue';
import SelectInput from '../form/select/SelectInput.vue';
import CurrencyInput from '../form/currency/CurrencyInput.vue';
import DateInput from '../form/date/DateInput.vue';
import BaseButton from '../ui/BaseButton.vue';

export default {
  name: 'ReconciliationDrawer',
  components: { TextInput, TextareaInput, SelectInput, CurrencyInput, DateInput, BaseButton },
  props: {
    modelValue: { type: Boolean, default: false },
    item: { type: Object, default: null },
  },
  emits: ['update:modelValue', 'reconciled'],
  data() {
    return {
      candidates: [],
      loadingCandidates: false,
      searchQuery: '',
      searchResults: [],
      showCreateForm: false,
      creating: false,
      costCenters: [],
      newTx: this.defaultNewTx(),
      typeOptions: [
        { id: 'PAYABLE', name: 'A pagar' },
        { id: 'RECEIVABLE', name: 'A receber' },
      ],
    };
  },
  computed: {
    netAmount() {
      return (Number(this.newTx.grossAmount) || 0) - (Number(this.newTx.feeAmount) || 0);
    },
  },
  watch: {
    item(val) {
      if (val) {
        this.resetState();
        this.loadCandidates();
        this.loadCostCenters();
        this.prefillForm();
      }
    },
  },
  methods: {
    defaultNewTx() {
      return {
        type: 'PAYABLE',
        description: '',
        grossAmount: 0,
        feeAmount: 0,
        issueDate: '',
        dueDate: '',
        costCenterId: '',
        notes: '',
      };
    },
    resetState() {
      this.candidates = [];
      this.searchQuery = '';
      this.searchResults = [];
      this.showCreateForm = false;
      this.creating = false;
    },
    prefillForm() {
      if (!this.item) return;
      const amount = Math.abs(Number(this.item.amount));
      const isCredit = Number(this.item.amount) > 0;
      const dateStr = this.item.ofxDate ? new Date(this.item.ofxDate).toISOString().split('T')[0] : '';
      this.newTx = {
        type: isCredit ? 'RECEIVABLE' : 'PAYABLE',
        description: this.item.memo || '',
        grossAmount: amount,
        feeAmount: 0,
        issueDate: dateStr,
        dueDate: dateStr,
        costCenterId: '',
        notes: '',
      };
    },
    async loadCandidates() {
      this.loadingCandidates = true;
      try {
        const { data } = await api.get(`/financial/ofx/items/${this.item.id}/candidates`);
        this.candidates = data;
      } catch (e) {
        console.error('Erro ao buscar candidatos:', e);
      } finally {
        this.loadingCandidates = false;
      }
    },
    async loadCostCenters() {
      try {
        const { data } = await api.get('/financial/cost-centers');
        this.costCenters = data;
      } catch (e) { /* ignore */ }
    },
    async searchCandidates() {
      if (!this.searchQuery.trim()) return;
      try {
        const { data } = await api.get(`/financial/ofx/items/${this.item.id}/candidates`, {
          params: { search: this.searchQuery },
        });
        this.searchResults = data;
      } catch (e) {
        console.error('Erro na busca:', e);
      }
    },
    async matchWith(candidate) {
      try {
        await api.post(`/financial/ofx/items/${this.item.id}/match`, {
          transactionId: candidate.id,
          notes: 'Conciliado manualmente',
        });
        this.$emit('reconciled');
        this.close();
      } catch (e) {
        console.error('Erro ao vincular:', e);
      }
    },
    async createAndMatch() {
      this.creating = true;
      try {
        await api.post(`/financial/ofx/items/${this.item.id}/create-and-match`, {
          type: this.newTx.type,
          description: this.newTx.description,
          grossAmount: this.newTx.grossAmount,
          feeAmount: this.newTx.feeAmount,
          issueDate: this.newTx.issueDate,
          dueDate: this.newTx.dueDate,
          costCenterId: this.newTx.costCenterId || null,
          notes: this.newTx.notes || null,
        });
        this.$emit('reconciled');
        this.close();
      } catch (e) {
        console.error('Erro ao criar lançamento:', e);
      } finally {
        this.creating = false;
      }
    },
    close() {
      this.$emit('update:modelValue', false);
    },
    scoreBadgeClass(score) {
      if (score >= 80) return 'bg-success';
      if (score >= 50) return 'bg-warning text-dark';
      return 'bg-secondary';
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

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 1050;
  display: flex;
  justify-content: flex-end;
}
.drawer-panel {
  width: 450px;
  max-width: 90vw;
  background: var(--bg-card, #fff);
  height: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-dropdown, 0 0.5rem 1.5rem rgba(0,0,0,0.1));
}
.drawer-header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--border-color-soft, rgba(0,0,0,0.06));
}
.drawer-body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}
.candidate-card {
  cursor: pointer;
  transition: box-shadow 0.15s;
}
.candidate-card:hover {
  box-shadow: var(--shadow-hover, 0 4px 12px rgba(0,0,0,0.08));
}
.create-form {
  border-top: 1px solid var(--border-color-soft, rgba(0,0,0,0.06));
  padding-top: 1rem;
}
</style>
```

**Step 2: Commit**

```bash
git add delivery-saas-frontend/src/components/financial/ReconciliationDrawer.vue
git commit -m "feat(ofx): add ReconciliationDrawer component for manual matching"
```

---

### Task 5: Frontend — atualizar FinancialOFX.vue

**Files:**
- Modify: `delivery-saas-frontend/src/views/financial/FinancialOFX.vue`

**Step 1: Importar drawer e adicionar mapa de tradução**

No `<script>`, adicionar import:

```js
import ReconciliationDrawer from '../../components/financial/ReconciliationDrawer.vue';
```

Registrar no `components`:

```js
components: { SelectInput, ReconciliationDrawer },
```

Adicionar ao `data()`:

```js
drawerOpen: false,
drawerItem: null,
```

Adicionar helper method `statusLabel`:

```js
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
```

Adicionar métodos `openDrawer` e `undoMatch`:

```js
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
```

**Step 2: Atualizar coluna Match na tabela e botões de ação**

Substituir o bloco `<tbody>` da tabela de itens (linhas 101-118) por:

```html
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
```

**Step 3: Adicionar o componente drawer no template**

Logo antes do `</div>` final do template (antes de `</template>`), adicionar:

```html
<ReconciliationDrawer
  v-model="drawerOpen"
  :item="drawerItem"
  @reconciled="onReconciled"
/>
```

**Step 4: Commit**

```bash
git add delivery-saas-frontend/src/views/financial/FinancialOFX.vue
git commit -m "feat(ofx): integrate reconciliation drawer with match indicators and undo"
```

---

### Task 6: Testar fluxo completo

**Step 1: Verificar backend rodando**

```bash
docker compose up -d
```

**Step 2: Testar no navegador**

1. Abrir a tela de Conciliação OFX
2. Importar um arquivo OFX existente (ou usar uma importação já feita)
3. Clicar "Ver itens" numa importação
4. Verificar:
   - Status traduzidos (Pendente, Conciliado, etc.)
   - Coluna Match mostrando descrição + badge de confiança
   - Botão "Conciliar" aparece em itens Pendente/Sem correspondência
   - Botão "Desfazer" aparece em itens Conciliado
5. Clicar "Conciliar" num item pendente:
   - Drawer abre à direita com dados do OFX
   - Candidatos sugeridos aparecem com score
   - Busca manual funciona
   - Formulário de criar lançamento abre pré-preenchido
6. Vincular um candidato → item muda para "Conciliado (manual)"
7. Clicar "Desfazer" → item volta para "Pendente"
8. Criar novo lançamento → item vinculado automaticamente

**Step 3: Commit final se houver ajustes**

```bash
git add -A
git commit -m "fix(ofx): adjustments from manual testing"
```
