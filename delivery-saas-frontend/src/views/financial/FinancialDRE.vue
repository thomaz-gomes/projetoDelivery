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
          <div class="col-md-3">
            <button class="btn btn-primary" @click="load">Gerar DRE</button>
          </div>
        </div>
      </div>
    </div>

    <!-- DRE -->
    <div class="card" v-if="dre">
      <div class="card-header d-flex justify-content-between">
        <strong>DRE — {{ formatDate(dre.period?.from) }} a {{ formatDate(dre.period?.to) }}</strong>
        <div>
          <span class="badge bg-primary me-2">Margem Bruta: {{ dre.margins?.grossMargin }}</span>
          <span class="badge bg-info me-2">Margem Operacional: {{ dre.margins?.operatingMargin }}</span>
          <span class="badge bg-success">Margem Líquida: {{ dre.margins?.netMargin }}</span>
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-sm mb-0">
          <tbody>
            <tr v-for="(line, key) in dre.lines" :key="key"
                :class="{'table-primary fw-bold': isResult(key), 'border-top border-2': isResult(key)}">
              <td class="ps-3" :style="isResult(key) ? '' : 'padding-left: 2rem !important'">
                {{ line.label }}
                <button v-if="line.details && line.details.items && line.details.items.length"
                        class="btn btn-sm btn-link p-0 ms-2" @click="toggleDetails(key)">
                  {{ expandedDetails[key] ? 'ocultar' : 'detalhar' }}
                </button>
              </td>
              <td class="text-end pe-3" :class="Number(line.value) < 0 ? 'text-danger' : 'text-success'">
                {{ formatCurrency(line.value) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Detalhes expandidos -->
      <div v-for="(line, key) in dre.lines" :key="'detail-'+key">
        <div v-if="expandedDetails[key] && line.details && line.details.items" class="px-4 py-2 bg-light border-top">
          <small class="fw-bold text-muted">Detalhamento: {{ line.label }}</small>
          <table class="table table-sm table-borderless mt-1 mb-0">
            <tr v-for="item in line.details.items" :key="item.costCenterId">
              <td class="ps-4">{{ item.code }} - {{ item.name }}</td>
              <td class="text-end" :class="item.total < 0 ? 'text-danger' : 'text-success'">{{ formatCurrency(item.total) }}</td>
            </tr>
          </table>
        </div>
      </div>
    </div>

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
      expandedDetails: {},
    };
  },
  methods: {
    async load() {
      this.loading = true;
      try {
        const { data } = await api.get('/financial/reports/dre', {
          params: { dateFrom: this.dateFrom, dateTo: this.dateTo },
        });
        this.dre = data;
        this.expandedDetails = {};
      } catch (e) {
        alert(e.response?.data?.message || 'Erro ao gerar DRE');
      } finally {
        this.loading = false;
      }
    },
    toggleDetails(key) {
      this.expandedDetails = { ...this.expandedDetails, [key]: !this.expandedDetails[key] };
    },
    isResult(key) {
      return ['receitaLiquida', 'lucroBruto', 'resultadoOperacional', 'resultadoLiquido'].includes(key);
    },
    formatCurrency(value) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    },
    formatDate(d) {
      if (!d) return '';
      return new Date(d).toLocaleDateString('pt-BR');
    },
  },
};
</script>
