<template>
  <div class="container py-3">
    <h3 class="mb-3">DRE - Demonstrativo de Resultado</h3>

    <!-- Filtros de período -->
    <div class="card mb-3">
      <div class="card-body">
        <div class="row g-2 align-items-end">
          <div class="col-md-3">
            <label class="form-label">Período de</label>
            <input type="date" class="form-control" v-model="dateFrom">
          </div>
          <div class="col-md-3">
            <label class="form-label">Período até</label>
            <input type="date" class="form-control" v-model="dateTo">
          </div>
          <div class="col-md-3" v-if="stores.length > 1">
            <label class="form-label">Loja</label>
            <select class="form-select" v-model="selectedStoreId" @change="load">
              <option value="">Todas as lojas</option>
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div class="col-md-3">
            <button class="btn btn-primary" @click="load" :disabled="loading">
              <span v-if="loading" class="spinner-border spinner-border-sm me-1"></span>
              Gerar DRE
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- DRE Result -->
    <div v-if="dre">

      <!-- Warning: centros não classificados -->
      <div v-if="dre.hasUnclassified" class="alert alert-warning d-flex align-items-start gap-2 mb-3">
        <i class="bi bi-exclamation-triangle-fill flex-shrink-0 mt-1"></i>
        <div>
          <strong>Centros de custo não classificados:</strong>
          {{ dre.unclassifiedCenters.join(', ') }}.
          <router-link to="/financial/cost-centers" class="alert-link ms-1">Classificar agora →</router-link>
        </div>
      </div>

      <!-- Cabeçalho + badges de margem -->
      <div class="card mb-3">
        <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <strong>DRE — {{ formatDate(dre.period?.from) }} a {{ formatDate(dre.period?.to) }}</strong>
          <div class="d-flex gap-2 flex-wrap">
            <span class="badge bg-primary">Margem Bruta: {{ dre.margins?.grossMargin }}</span>
            <span class="badge bg-info text-dark">Margem Operacional: {{ dre.margins?.operatingMargin }}</span>
            <span class="badge" :class="dre.resultadoLiquido >= 0 ? 'bg-success' : 'bg-danger'">
              Margem Líquida: {{ dre.margins?.netMargin }}
            </span>
          </div>
        </div>

        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead class="table-light">
              <tr>
                <th class="ps-3">Descrição</th>
                <th class="text-end pe-3" style="width:160px">Valor</th>
                <th class="text-end pe-3" style="width:80px">%RB</th>
              </tr>
            </thead>
            <tbody>

              <!-- RECEITA BRUTA -->
              <tr class="fw-bold">
                <td class="ps-3 text-success">(+) Receita Bruta</td>
                <td class="text-end pe-3 text-success">{{ fmt(dre.receitaBruta) }}</td>
                <td class="text-end pe-3 text-muted">100%</td>
              </tr>
              <tr v-for="item in dre.groups?.REVENUE?.items" :key="item.costCenterId" class="text-muted small">
                <td class="ps-5">{{ item.code }} – {{ item.name }}</td>
                <td class="text-end pe-3">{{ fmt(item.total) }}</td>
                <td class="text-end pe-3">{{ pct(item.total, dre.receitaBruta) }}</td>
              </tr>

              <!-- DEDUÇÕES -->
              <tr class="fw-bold">
                <td class="ps-3 text-danger">(-) Deduções de Receita</td>
                <td class="text-end pe-3 text-danger">{{ fmt(dre.deducoes) }}</td>
                <td class="text-end pe-3 text-muted">{{ pct(dre.deducoes, dre.receitaBruta) }}</td>
              </tr>
              <tr v-for="item in dre.groups?.DEDUCTIONS?.items" :key="item.costCenterId" class="text-muted small">
                <td class="ps-5">{{ item.code }} – {{ item.name }}</td>
                <td class="text-end pe-3">{{ fmt(item.total) }}</td>
                <td class="text-end pe-3">{{ pct(item.total, dre.receitaBruta) }}</td>
              </tr>

              <!-- RECEITA LÍQUIDA -->
              <tr class="table-secondary fw-bold border-top border-2">
                <td class="ps-3">(=) Receita Líquida</td>
                <td class="text-end pe-3" :class="dre.receitaLiquida >= 0 ? 'text-success' : 'text-danger'">
                  {{ fmt(dre.receitaLiquida) }}
                </td>
                <td class="text-end pe-3 text-muted">{{ pct(dre.receitaLiquida, dre.receitaBruta) }}</td>
              </tr>

              <!-- CUSTOS VARIÁVEIS -->
              <tr class="fw-bold">
                <td class="ps-3 text-danger">(-) Custos e Despesas Variáveis</td>
                <td class="text-end pe-3 text-danger">{{ fmt(dre.custosVariaveis) }}</td>
                <td class="text-end pe-3 text-muted">{{ pct(dre.custosVariaveis, dre.receitaBruta) }}</td>
              </tr>
              <tr v-for="item in dre.groups?.VARIAVEL?.items" :key="item.costCenterId" class="text-muted small">
                <td class="ps-5">{{ item.code }} – {{ item.name }}</td>
                <td class="text-end pe-3">{{ fmt(item.total) }}</td>
                <td class="text-end pe-3">{{ pct(item.total, dre.receitaBruta) }}</td>
              </tr>

              <!-- MARGEM DE CONTRIBUIÇÃO -->
              <tr class="table-primary fw-bold fs-6 border-top border-2">
                <td class="ps-3">&#9733; (=) Margem de Contribuição</td>
                <td class="text-end pe-3" :class="dre.margemContribuicao >= 0 ? 'text-success' : 'text-danger'">
                  {{ fmt(dre.margemContribuicao) }}
                </td>
                <td class="text-end pe-3 fw-semibold">
                  {{ dre.margemContribuicaoPct != null ? dre.margemContribuicaoPct.toFixed(1) + '%' : '-' }}
                </td>
              </tr>

              <!-- DESPESAS FIXAS -->
              <tr class="fw-bold">
                <td class="ps-3 text-danger">(-) Despesas Fixas</td>
                <td class="text-end pe-3 text-danger">{{ fmt(dre.despesasFixas) }}</td>
                <td class="text-end pe-3 text-muted">{{ pct(dre.despesasFixas, dre.receitaBruta) }}</td>
              </tr>
              <tr v-for="item in dre.groups?.FIXA?.items" :key="item.costCenterId" class="text-muted small">
                <td class="ps-5">{{ item.code }} – {{ item.name }}</td>
                <td class="text-end pe-3">{{ fmt(item.total) }}</td>
                <td class="text-end pe-3">{{ pct(item.total, dre.receitaBruta) }}</td>
              </tr>

              <!-- RESULTADO OPERACIONAL -->
              <tr class="table-secondary fw-bold border-top border-2">
                <td class="ps-3">(=) Resultado Operacional (EBITDA)</td>
                <td class="text-end pe-3" :class="dre.resultadoOperacional >= 0 ? 'text-success' : 'text-danger'">
                  {{ fmt(dre.resultadoOperacional) }}
                </td>
                <td class="text-end pe-3 text-muted">{{ pct(dre.resultadoOperacional, dre.receitaBruta) }}</td>
              </tr>

              <!-- RESULTADO FINANCEIRO -->
              <tr class="fw-bold">
                <td class="ps-3">(+/-) Resultado Financeiro</td>
                <td class="text-end pe-3" :class="dre.resultadoFinanceiro >= 0 ? 'text-success' : 'text-danger'">
                  {{ fmt(dre.resultadoFinanceiro) }}
                </td>
                <td class="text-end pe-3 text-muted">{{ pct(dre.resultadoFinanceiro, dre.receitaBruta) }}</td>
              </tr>
              <tr v-for="item in dre.groups?.FINANCIAL?.items" :key="item.costCenterId" class="text-muted small">
                <td class="ps-5">{{ item.code }} – {{ item.name }}</td>
                <td class="text-end pe-3">{{ fmt(item.total) }}</td>
                <td class="text-end pe-3">{{ pct(item.total, dre.receitaBruta) }}</td>
              </tr>

              <!-- RESULTADO LÍQUIDO -->
              <tr class="table-dark fw-bold fs-5 border-top border-3">
                <td class="ps-3">(=) Resultado Líquido</td>
                <td class="text-end pe-3" :class="dre.resultadoLiquido >= 0 ? 'text-success' : 'text-danger'">
                  {{ fmt(dre.resultadoLiquido) }}
                </td>
                <td class="text-end pe-3" :class="dre.resultadoLiquido >= 0 ? 'text-success' : 'text-danger'">
                  {{ pct(dre.resultadoLiquido, dre.receitaBruta) }}
                </td>
              </tr>

            </tbody>
          </table>
        </div>
      </div>

      <!-- Ponto de Equilíbrio -->
      <div v-if="dre.pontoEquilibrio" class="row g-3 mb-3">
        <div class="col-md-4">
          <div class="card text-center h-100">
            <div class="card-body">
              <div class="text-muted small mb-1">Margem de Contribuição</div>
              <div class="fw-bold fs-4" :class="dre.margemContribuicaoPct >= 0 ? 'text-success' : 'text-danger'">
                {{ dre.margemContribuicaoPct != null ? dre.margemContribuicaoPct.toFixed(1) + '%' : '-' }}
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card text-center h-100 border-primary">
            <div class="card-body">
              <div class="text-muted small mb-1">&#9733; Ponto de Equilíbrio</div>
              <div class="fw-bold fs-4 text-primary">{{ fmt(dre.pontoEquilibrio) }}</div>
              <div class="text-muted" style="font-size:0.75rem">faturamento mínimo para cobrir fixos</div>
            </div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="card text-center h-100">
            <div class="card-body">
              <div class="text-muted small mb-1">Margem Líquida</div>
              <div class="fw-bold fs-4"
                   :class="dre.resultadoLiquido >= 0 ? 'text-success' : 'text-danger'">
                {{ pct(dre.resultadoLiquido, dre.receitaBruta) }}
              </div>
            </div>
          </div>
        </div>
      </div>

    </div><!-- /v-if="dre" -->

    <div v-if="!dre && !loading" class="text-center py-5 text-muted">
      Selecione o período e clique em "Gerar DRE".
    </div>
  </div>
</template>

<script>
import api from '../../api';

export default {
  name: 'FinancialDRE',
  data() {
    const now = new Date();
    return {
      dateFrom: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
      dateTo: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0],
      dre: null,
      loading: false,
      stores: [],
      selectedStoreId: '',
    };
  },
  async mounted() {
    try {
      const { data } = await api.get('/stores');
      this.stores = data;
    } catch (e) { console.error(e); }
  },
  methods: {
    async load() {
      this.loading = true;
      try {
        const params = { dateFrom: this.dateFrom, dateTo: this.dateTo };
        if (this.selectedStoreId) params.storeId = this.selectedStoreId;
        const { data } = await api.get('/financial/reports/dre', { params });
        this.dre = data;
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao gerar DRE');
      } finally {
        this.loading = false;
      }
    },
    fmt(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    pct(value, total) {
      if (!total || total === 0) return '-';
      return ((value / total) * 100).toFixed(1) + '%';
    },
    formatDate(d) {
      if (!d) return '';
      return new Date(d).toLocaleDateString('pt-BR');
    },
  },
};
</script>
