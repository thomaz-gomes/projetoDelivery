<template>
  <div v-if="visible || embedded" :class="embedded ? '' : 'pos-overlay'">
    <div :class="embedded ? '' : 'pos-panel'">
      <div v-if="!embedded" class="d-flex justify-content-between align-items-center mb-3">
        <h5 class="fw-semibold m-0">Novo Pedido (PDV)</h5>
        <button class="btn btn-sm btn-outline-secondary" @click="close">Fechar</button>
      </div>

      <div v-if="step===1">
        <div v-if="customerSearchLoading" class="text-center py-4">
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Procurando...</span>
          </div>
          <div class="small mt-2 text-muted">Buscando cliente...</div>
        </div>
        <div v-else>
          <div v-if="foundCustomer" class="alert alert-success py-2 mb-3">
                    <strong>Cliente encontrado:</strong><br>
                    <span v-if="fetchingFullCustomer" class="spinner-border spinner-border-sm text-primary me-2" role="status" aria-hidden="true"></span>
                    {{ foundCustomer.fullName }} ({{ foundCustomer.whatsapp || foundCustomer.phone }})
                  </div>
          <div v-else-if="customerNotFound" class="alert alert-warning py-2 mb-3">Cliente não encontrado.</div>
          
          <label class="form-label small fw-semibold">Tipo do pedido</label>
          <SelectInput   v-model="orderType"  class="form-select mb-3">
            <option value="BALCAO">Balcão (retirada)</option>
            <option value="DELIVERY">Entrega</option>
          </SelectInput>

          <div v-if="orderType === 'DELIVERY' || !foundCustomer">
            <label class="form-label small">Nome do cliente {{ orderType === 'DELIVERY' ? '(obrigatório)' : '(opcional)' }}</label>
            <TextInput v-model="newCustomerName" placeholder="Nome completo" inputClass="form-control mb-3" />
          </div>

          <button class="btn btn-success" @click="confirmCustomer" :disabled="!canConfirmCustomer">Continuar</button>
        </div>
      </div>

      <div v-else-if="step===2">
        <h6 class="fw-semibold mb-3">Endereço de Entrega</h6>
        
        <!-- Lista de endereços salvos -->
        <div v-if="savedAddresses.length > 0" class="mb-3">
          <label class="form-label small fw-semibold">Endereços salvos</label>
          <ListGroup :items="savedAddresses" item-key="id" :selected-id="selectedAddressId" @select="selectSavedAddress" @edit="editSavedAddress" @remove="removeSavedAddress" />
        </div>

        <div class="small mb-2">
          <a href="#" @click.prevent="showNewAddressForm = !showNewAddressForm">
            {{ showNewAddressForm ? 'Ocultar formulário' : 'Cadastrar novo endereço' }}
          </a>
        </div>

        <!-- Formulário de novo endereço -->
        <div v-if="showNewAddressForm || savedAddresses.length === 0" class="mb-3">
          <div class="row g-2">
            <div class="col-8">
              <label class="form-label small">Rua</label>
              <TextInput v-model="addr.street" inputClass="form-control" />
            </div>
            <div class="col-4">
              <label class="form-label small">Número</label>
              <TextInput v-model="addr.number" inputClass="form-control" />
            </div>
            <div class="col-6">
              <label class="form-label small">Bairro</label>
              <SelectInput   v-model="addr.neighborhood"  class="form-select">
                <option value="">Selecione o bairro</option>
                <option v-for="n in neighborhoods" :key="n.id" :value="n.name">
                  {{ n.name }} - {{ isFreeDeliveryActive ? 'Grátis' : formatCurrency(n.deliveryFee) }}
                </option>
              </SelectInput>
            </div>
            <!-- cidade removida: todas as entregas na mesma cidade -->
            <div class="col-12">
              <label class="form-label small">Complemento</label>
              <TextInput v-model="addr.complement" inputClass="form-control" />
            </div>
            <div class="col-12">
              <label class="form-label small">Referência</label>
              <TextInput v-model="addr.reference" inputClass="form-control" />
            </div>
            <div class="col-12">
              <label class="form-label small">Observação</label>
              <TextInput v-model="addr.observation" inputClass="form-control" />
            </div>
          </div>
              <div class="mt-2 small">
            <div v-if="neighborhoodsLoading">Calculando taxa...</div>
            <div v-else-if="addr.neighborhood">
              <span v-if="isFreeDeliveryActive" class="text-success fw-semibold"><i class="bi bi-truck me-1"></i>Entrega grátis ativa!</span>
              <span v-else-if="matchedNeighborhood">Taxa: <strong>{{ formatCurrency(matchedNeighborhood.deliveryFee) }}</strong></span>
              <span v-else class="text-muted">Bairro sem taxa ({{ formatCurrency(0) }})</span>
            </div>
            <div v-if="freeDeliveryEnabled && freeDeliveryMinOrder != null && !isFreeDeliveryActive" class="text-muted mt-1">
              <i class="bi bi-truck me-1"></i>Falta {{ formatCurrency(freeDeliveryMinOrder - subtotal) }} para entrega grátis
            </div>
          </div>
        </div>

        <div class="d-flex justify-content-between mt-3">
          <button class="btn btn-outline-secondary" @click="prev">Voltar</button>
          <button class="btn btn-success" :disabled="!validAddress" @click="next">Continuar</button>
        </div>
      </div>

      <div v-else-if="step===3" class="products-step">
        <h6 class="fw-semibold mb-3">Produtos</h6>
        <div class="mb-3">
          <label class="form-label small">Cardápio atribuído</label>
          <div v-if="menusLoading" class="small text-muted">Carregando cardápios...</div>
          <div v-else>
            <SelectInput   v-model="selectedMenuId"  class="form-select">
              <option v-for="m in menus" :key="m.id" :value="m.id">{{ m.name }}</option>
            </SelectInput>
            <div v-if="menus.length===0" class="small text-muted mt-1">Nenhum cardápio disponível para atribuir.</div>
          </div>
        </div>
        <div v-if="menuLoading" class="small">Carregando menu...</div>
        <div v-else>
          <!-- Category pills -->
          <div class="category-pills mb-2">
            <button
              class="btn btn-sm pill-btn"
              :class="selectedCategory === null ? 'btn-primary' : 'btn-outline-secondary'"
              @click="selectedCategory = null; productSearch = ''"
            >Todos</button>
            <button
              v-for="cat in allProducts" :key="cat.id"
              class="btn btn-sm pill-btn"
              :class="selectedCategory === cat.id ? 'btn-primary' : 'btn-outline-secondary'"
              @click="selectedCategory = cat.id; productSearch = ''"
            >{{ cat.name }}</button>
          </div>
          <!-- Search -->
          <input
            v-model="productSearch"
            type="text"
            class="form-control form-control-sm mb-2"
            placeholder="Buscar produto..."
            autocomplete="off"
            @input="selectedCategory = null"
          />
          <div class="menu-scroll">
            <div v-if="filteredProducts.length === 0" class="small text-muted py-2 text-center">Nenhum produto encontrado.</div>
            <div v-for="cat in filteredProducts" :key="cat.id" class="mb-3">
              <div class="category-header">{{ cat.name }}</div>
              <div :class="['product-grid', { 'product-grid--compact': embedded }]">
                <button
                  v-for="p in cat.products"
                  :key="p.id"
                  type="button"
                  class="product-card"
                  @click="selectProduct(p)"
                >
                  <div class="product-card-thumb">
                    <img
                      v-if="p.image"
                      :src="assetUrl(thumbUrl(p.image))"
                      :alt="p.name"
                      loading="lazy"
                      @error="onThumbError($event, p.image)"
                    />
                    <i v-else class="bi bi-image"></i>
                  </div>
                  <div class="product-card-body">
                    <div class="product-card-name">{{ p.name }}</div>
                    <div class="product-card-price">{{ formatCurrency(effectiveProductPrice(p)) }}</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div><!-- end v-else (menu loaded) -->
        <div class="cart-box mt-3">
          <div v-if="!embedded" class="d-flex justify-content-between align-items-center mb-2">
            <div class="fw-semibold">Carrinho</div>
            <div class="small text-muted">Subtotal: {{ formatCurrency(subtotal) }}</div>
          </div>
          <!-- coupon summary / input (hidden in embedded mode — handled by parent footer) -->
          <div v-if="!embedded" class="mt-2">
            <div v-if="couponApplied" class="d-flex justify-content-between align-items-center mb-2 text-success">
              <div>Cupom ({{ couponInfo?.code || '' }})</div>
              <div class="d-flex align-items-center gap-2">
                <span>-{{ formatCurrency(couponDiscount) }}</span>
                <button class="btn btn-sm btn-outline-danger py-0 px-1 lh-1" @click="removeCoupon" title="Remover cupom">✕</button>
              </div>
            </div>
            <div v-else class="d-flex gap-2 align-items-center">
              <TextInput v-model="couponCode" placeholder="Código do cupom (opcional)" inputClass="form-control form-control-sm" />
              <button class="btn btn-sm btn-primary" @click="applyCoupon" :disabled="couponLoading">Aplicar</button>
            </div>
            <div v-if="couponError" class="small text-danger mt-1">{{ couponError }}</div>
          </div>
          <!-- manual discount / surcharge -->
          <div class="row g-2 mt-1">
            <div class="col-6">
              <label class="form-label small mb-0">Desconto (R$)</label>
              <CurrencyInput v-model="manualDiscount" inputClass="form-control form-control-sm" placeholder="0,00" />
            </div>
            <div class="col-6">
              <label class="form-label small mb-0">Acréscimo (R$)</label>
              <CurrencyInput v-model="surcharge" inputClass="form-control form-control-sm" placeholder="0,00" />
            </div>
          </div>
          <div v-if="cart.length===0" class="small text-muted">Nenhum item.</div>
          <div v-for="(it,idx) in cart" :key="idx" class="cart-item">
              <div class="d-flex justify-content-between">
              <div><strong>{{ it.quantity }}x</strong> {{ it.name }}</div>
              <div>{{ formatCurrency(it.price*it.quantity) }}</div>
            </div>
              <div v-if="it.options && it.options.length" class="small text-muted ms-2">
              <div v-for="(o,i2) in it.options" :key="i2">- {{ (o.quantity && Number(o.quantity) > 1) ? (o.quantity + 'x ') : '' }}{{ o.name }} ({{ formatCurrency(o.price) }})</div>
            </div>
            <div v-if="it.notes" class="small text-muted ms-2 fst-italic">📝 {{ it.notes }}</div>
            <div class="small d-flex gap-2 mt-1">
              <button class="btn btn-sm btn-outline-secondary" @click="it.quantity++; recalc()">+1</button>
              <button class="btn btn-sm btn-outline-secondary" @click="decQty(it)">-1</button>
              <button class="btn btn-sm btn-outline-secondary" @click="editItem(idx)">Editar</button>
              <button class="btn btn-sm btn-outline-danger" @click="removeItem(idx)">Remover</button>
            </div>
          </div>
          <div v-if="cart.length > 0 && !embedded" class="mt-2 small text-end text-muted border-top pt-2">
            <div v-if="couponDiscount > 0">Cupom: <span class="text-success">-{{ formatCurrency(couponDiscount) }}</span></div>
            <div v-if="manualDiscount > 0">Desconto: <span class="text-danger">-{{ formatCurrency(manualDiscount) }}</span></div>
            <div v-if="paymentDiscount > 0">Desconto pagamento: <span class="text-success">-{{ formatCurrency(paymentDiscount) }}</span></div>
            <div v-if="surcharge > 0">Acréscimo: <span class="text-primary">+{{ formatCurrency(surcharge) }}</span></div>
            <div v-if="orderType === 'DELIVERY'">Entrega: <span :class="isFreeDeliveryActive ? 'text-success' : ''">{{ isFreeDeliveryActive ? 'Grátis' : formatCurrency(deliveryFee) }}</span></div>
            <div class="fw-semibold text-dark">Total: {{ formatCurrency(totalWithDelivery) }}</div>
          </div>
          <div v-if="!embedded" class="mt-3 d-flex justify-content-between">
            <button class="btn btn-outline-secondary" @click="prev">Voltar</button>
            <button class="btn btn-success" :disabled="cart.length===0" @click="next">Escolher pagamento</button>
          </div>
        </div>
        <!-- Inline modal para opcionais (layout adapted from PublicMenu modal) -->
        <div v-if="showOptions" class="pos-options-overlay">
          <div class="pos-options-panel d-flex flex-column">
              <div class="pos-options-body" ref="optionsBodyRef">
              <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                  <h6 class="fw-semibold m-0">{{ activeProduct?.name }} <span class="text-muted small">{{ formatCurrency(activeProduct?.price) }}</span></h6>
                </div>
                <button class="btn btn-sm btn-outline-secondary d-sm-none" @click="closeOptions" aria-label="Fechar">✕</button>
              </div>

              <div class="mb-3">
                <label class="form-label small">Quantidade</label>
                <input type="number" min="1" v-model.number="optionQty" class="form-control" />
              </div>

                <div class="options-scroll">
                <div v-if="activeProduct?.optionGroups?.length">
                  <div v-for="g in activeProduct.optionGroups" :key="g.id" :id="'grp-'+g.id" class="option-section mb-3">
                    <div class="d-flex align-items-center justify-content-between option-section-header">
                      <span class="option-section-title">{{ g.name }}</span>
                      <span v-if="requiredWarnings[g.id]" class="badge bg-danger">OBRIGATÓRIO</span>
                      <span v-else-if="g.min > 0" class="badge bg-secondary">Obrigatório</span>
                    </div>
                    <div class="option-group-card">
                      <template v-if="g.max === 1">
                        <div v-for="opt in g.options" :key="opt.id" class="option-group-item">
                          <div class="d-flex justify-content-between align-items-center">
                            <div class="option-meta">
                              <div class="option-name">{{ opt.name }}</div>
                              <div class="option-price">{{ Number(opt.price) > 0 ? formatCurrency(opt.price) : 'Grátis' }}</div>
                            </div>
                            <input type="radio" :name="'grp-'+g.id" :id="'opt_'+g.id+'_'+opt.id" class="form-check-input" :checked="isOptionSelected(opt)" @change="selectRadio(g,opt)" />
                          </div>
                        </div>
                      </template>
                      <template v-else>
                        <div v-for="opt in g.options" :key="opt.id" class="option-group-item">
                          <div class="d-flex justify-content-between align-items-center">
                            <div class="option-meta">
                              <div class="option-name">{{ opt.name }}</div>
                              <div class="option-price">{{ Number(opt.price) > 0 ? formatCurrency(opt.price) : 'Grátis' }}</div>
                            </div>
                            <div style="min-width:110px;display:flex;justify-content:flex-end;align-items:center">
                              <div v-if="qtyFor(g.id,opt.id) === 0">
                                <button class="btn btn-sm btn-primary" @click.prevent="changeOptionQty(g,opt,1)">+</button>
                              </div>
                              <div v-else class="d-flex align-items-center gap-2">
                                <button class="btn btn-sm btn-outline-secondary" @click.prevent="changeOptionQty(g,opt,-1)">-</button>
                                <div class="fw-bold">{{ qtyFor(g.id,opt.id) }}</div>
                                <button class="btn btn-sm btn-primary" @click.prevent="changeOptionQty(g,opt,1)">+</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>

                <div v-if="!activeProduct?.optionGroups?.length && chosenOptions && chosenOptions.length">
                  <div class="small fw-semibold mb-2">Opcionais selecionados</div>
                  <ul class="list-unstyled small text-muted mb-2">
                    <li v-for="(opt, oi) in chosenOptions" :key="oi" class="d-flex justify-content-between align-items-center">
                      <div>{{ (opt.quantity && Number(opt.quantity) > 1) ? (opt.quantity + 'x ') : '' }}{{ opt.name }} <span class="text-muted">({{ formatCurrency(opt.price) }})</span></div>
                      <div>
                        <button class="btn btn-sm btn-outline-danger" @click.prevent="removeChosenOption(oi)">Remover</button>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>

              <div class="mt-3">
                <label class="form-label small mb-1">Observação</label>
                <textarea v-model="optionNote" class="form-control obs-textarea" rows="2" placeholder="Ex: sem cebola, bem passado..." maxlength="300"></textarea>
              </div>
            </div>

            <div class="pos-options-footer mt-3 d-flex justify-content-between align-items-center">
              <div class="fw-semibold">Total: {{ formatCurrency(optionModalTotal) }}</div>
              <div>
                <button class="btn btn-outline-secondary btn-sm me-2" @click="closeOptions">Cancelar</button>
                <button class="btn btn-success btn-sm" @click="confirmOptionsAdd">{{ editingIndex !== null ? 'Atualizar' : 'Adicionar' }}</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="step===4">
        <h6 class="fw-semibold mb-3">Pagamento</h6>

        <!-- Cashback (when enabled and customer found) -->
        <div v-if="cashbackEnabled && foundCustomer" class="mb-3 p-2 border rounded" :class="{ 'border-success bg-light-success': useCashback }">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <div class="small text-muted">Saldo de cashback do cliente</div>
              <div class="fw-bold">{{ formatCurrency(cashbackBalance) }}</div>
              <div v-if="!cashbackCanRedeem && cashbackLoaded" class="small text-muted">
                <span v-if="cashbackBalance <= 0">Cliente sem saldo disponível</span>
                <span v-else>Mínimo para resgate: {{ formatCurrency(cashbackMinRedeem) }}</span>
              </div>
            </div>
            <div class="form-check form-switch m-0">
              <input class="form-check-input" type="checkbox" role="switch" id="pos-use-cashback"
                :checked="useCashback" :disabled="!cashbackCanRedeem"
                @change="useCashback = $event.target.checked" />
              <label class="form-check-label small" for="pos-use-cashback">Usar cashback</label>
            </div>
          </div>
          <div v-if="useCashback" class="d-flex gap-2 mt-2 align-items-end">
            <div class="flex-grow-1">
              <label class="form-label small mb-0">Valor a usar</label>
              <CurrencyInput v-model="useCashbackAmount" :min="0" :max="Math.min(Number(cashbackBalance||0), Number(totalBeforeCashback||0))" inputClass="form-control form-control-sm" />
            </div>
            <button type="button" class="btn btn-outline-primary btn-sm"
              @click="useCashbackAmount = Math.min(Number(cashbackBalance||0), Number(totalBeforeCashback||0))">
              Máx
            </button>
          </div>
        </div>

        <div class="mb-2">
          <label class="form-label small">Forma</label>
          <ListGroup :items="paymentMethods" itemKey="code" :selectedId="paymentMethodCode" :showActions="false" @select="paymentMethodCode = $event">
            <template #primary="{ item }">
              <div><strong>{{ item.name }}</strong></div>
              <div v-if="paymentMethodSavings(item) > 0" class="small text-success fw-semibold">
                <i class="bi bi-tag-fill me-1"></i>Economize {{ formatCurrency(paymentMethodSavings(item)) }} pagando com {{ item.name }}
              </div>
              <div v-if="item.description" class="small text-muted">{{ item.description }}</div>
            </template>
          </ListGroup>
        </div>
        <div v-if="isCashPayment" class="mb-2">
          <CurrencyInput label="Troco para (opcional)" labelClass="form-label small" v-model="changeFor" inputClass="form-control" placeholder="Ex: 100" />
        </div>
        <div class="alert alert-light small">
          <div v-if="paymentDiscount > 0" class="d-flex justify-content-between text-success">
            <span>Desconto pagamento</span><span>-{{ formatCurrency(paymentDiscount) }}</span>
          </div>
          <div v-if="appliedCashback > 0" class="d-flex justify-content-between text-success">
            <span>Cashback aplicado</span><span>-{{ formatCurrency(appliedCashback) }}</span>
          </div>
          Total: <strong>{{ formatCurrency(totalWithDelivery) }}</strong>
          <span v-if="orderType === 'DELIVERY'">
            (Entrega: <span v-if="isFreeDeliveryActive" class="text-success fw-semibold">Grátis</span><span v-else>{{ formatCurrency(deliveryFee) }}</span>)
          </span>
        </div>
        <div v-if="!embedded" class="d-flex justify-content-between mt-3">
          <button class="btn btn-outline-secondary" @click="prev">Voltar</button>
          <button class="btn btn-success" :disabled="!paymentMethodCode" @click="finalize">Concluir pedido</button>
        </div>
        <div v-if="finalizing" class="small mt-2">Salvando...</div>
        <div v-if="finalizeError" class="alert alert-danger mt-2 py-1 small">{{ finalizeError }}</div>
      </div>

      <div v-else-if="step===5" class="text-center py-5">
        <h4 class="fw-semibold mb-3">Pedido criado!</h4>
        <div class="mb-2">Número: <strong>{{ createdOrderDisplay }}</strong></div>
        <button class="btn btn-primary" @click="resetWizard">Novo pedido</button>
        <button class="btn btn-outline-secondary ms-2" @click="close">Fechar</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import ListGroup from './form/list-group/ListGroup.vue';
import api from '../api';
import Swal from 'sweetalert2';
import { useAuthStore } from '../stores/auth';
import { formatCurrency } from '../utils/formatters.js';
import { assetUrl, thumbUrl } from '../utils/assetUrl.js';

const auth = useAuthStore();
async function resolveCompanyId(){
  // Prefer already hydrated store
  if(auth.user && auth.user.companyId) return auth.user.companyId;
  // Attempt to hydrate via /auth/me if token present
  try {
    if(auth.token){
      const r = await api.get('/auth/me');
      const u = r.data?.user;
      if(u){ auth.user = u; return u.companyId; }
    }
  } catch(e){ console.warn('PDV: falha ao hidratar /auth/me', e); }
  // Fallback: allow PDV to operate using a developer/local companyId saved in localStorage
  try {
    const fromStorage = localStorage.getItem('companyId');
    if(fromStorage) return fromStorage;
  } catch(e){}
  // final fallback to company 1 for local dev/public menus
  return '1';
}
// use shared `formatCurrency` helper from `src/utils/formatters.js`
const props = defineProps({
  visible: { type: Boolean, default: false },
  initialPhone: { type: String, default: '' },
  preset: { type: Object, default: null },
  embedded: { type: Boolean, default: false },
  forceStep: { type: Number, default: null },
});
const emit = defineEmits(['update:visible', 'created', 'cart-update']);

const step = ref(1);
const phoneInput = ref('');
const foundCustomer = ref(null);
const customerNotFound = ref(false);
const customerSearchLoading = ref(false);
const newCustomerName = ref('');
const orderType = ref('BALCAO');
const addr = ref({ street:'', number:'', neighborhood:'', complement:'', formatted:'', city:'', state:'' });
const companyDefaults = ref({ city:'', state:'' });

const menuLoading = ref(false);
const allProducts = ref([]);
const productSearch = ref('');
const selectedCategory = ref(null);
const filteredProducts = computed(() => {
  const q = productSearch.value.trim().toLowerCase();
  let cats = allProducts.value;
  if (selectedCategory.value !== null) {
    cats = cats.filter(c => c.id === selectedCategory.value);
  }
  if (!q) return cats;
  return cats
    .map(cat => ({ ...cat, products: cat.products.filter(p => p.name.toLowerCase().includes(q)) }))
    .filter(cat => cat.products.length > 0);
});
const stores = ref([]);
const storesLoading = ref(false);
const selectedStoreId = ref(null);
const menus = ref([]);
const menusLoading = ref(false);
const selectedMenuId = ref(null);
const paymentMethods = ref([]);
const cart = ref([]);
const paymentMethodCode = ref('');
const changeFor = ref(null);
const finalizing = ref(false);
const finalizeError = ref('');
const createdOrderDisplay = ref('');

const showOptions = ref(false);
const activeProduct = ref(null);
const optionQty = ref(1);
const optionNote = ref('');
const chosenOptions = ref([]);
const editingIndex = ref(null);
const requiredWarnings = ref({});
const optionsBodyRef = ref(null);
const neighborhoods = ref([]);
const neighborhoodsLoading = ref(false);
const freeDeliveryEnabled = ref(false);
const freeDeliveryMinOrder = ref(null);
const savedAddresses = ref([]);
const selectedAddressId = ref(null);
const showNewAddressForm = ref(false);

function close(){ emit('update:visible', false); }

const phoneDigits = computed(()=> {
  // Remove tudo que não é dígito
  const digits = phoneInput.value.replace(/\D/g,'');
  // Remove DDI 55 se presente, pega últimos 11 dígitos
  return digits.length > 11 ? digits.slice(-11) : digits;
});
const fetchingFullCustomer = ref(false);
async function searchCustomer(){
  if(!phoneDigits.value) return;
  customerSearchLoading.value = true;
  foundCustomer.value = null; customerNotFound.value = false;
  // clear any previously loaded addresses to avoid showing stale data
  savedAddresses.value = [];
  selectedAddressId.value = null;
  console.log('Buscando cliente com telefone:', phoneDigits.value);
  try {
    const r = await api.get(`/customers?q=${encodeURIComponent(phoneDigits.value)}`);
    const rows = r.data?.rows || [];
    console.log('Resultados da busca:', rows.length, rows);
    // Normaliza telefones removendo não-dígitos e pegando últimos 11
    const normalizePhone = (p) => {
      const d = String(p||'').replace(/\D/g,'');
      return d.length > 11 ? d.slice(-11) : d;
    };
    const match = rows.find(c => normalizePhone(c.whatsapp)===phoneDigits.value || normalizePhone(c.phone)===phoneDigits.value);
    console.log('Cliente encontrado:', match);
    if(match){ 
      // fetch full customer record to ensure we have all addresses and latest data
      fetchingFullCustomer.value = true;
      try{
        const full = await api.get(`/customers/${match.id}`);
        foundCustomer.value = full.data || match;
        savedAddresses.value = (full.data && full.data.addresses) ? full.data.addresses : (match.addresses || []);
      }catch(fetchErr){
        // fallback to match if full fetch fails
        console.warn('Falha ao buscar cliente completo, usando resultado parcial', fetchErr);
        foundCustomer.value = match;
        savedAddresses.value = match.addresses || [];
      } finally {
        fetchingFullCustomer.value = false;
      }
      newCustomerName.value = foundCustomer.value.fullName;
      console.log('Endereços do cliente:', savedAddresses.value);
    } else {
      customerNotFound.value = true;
    }
  } catch(e){
    console.error('Erro na busca:', e);
    customerNotFound.value = true;
  } finally {
    customerSearchLoading.value=false;
  }
}

function selectSavedAddress(addressOrId){
  console.log('Endereço selecionado (raw):', addressOrId);
  // support either an address object or an id emitted by ListGroup
  let address = null
  try{
    if(addressOrId && typeof addressOrId === 'object') address = addressOrId
    else address = savedAddresses.value.find(s => String(s.id) === String(addressOrId))
  }catch(e){ address = null }
  if(!address){
    // still set selected id if we received a primitive id
    try{ selectedAddressId.value = addressOrId }catch(e){}
    return
  }
  // ensure selected id sync
  selectedAddressId.value = address.id

  // Extrai dados do endereço (pode estar em formatted ou campos separados)
  let street = address.street || '';
  let number = address.number || '';
  let neighborhood = address.neighborhood || '';
  let complement = address.complement || '';
  let reference = address.reference || '';
  let observation = address.observation || '';
  
  // Se não tem campos separados mas tem formatted, tenta extrair do formatted
  if(!street && address.formatted){
    const parts = address.formatted.split(',');
    if(parts.length > 0) street = parts[0].trim();
    if(parts.length > 1) number = parts[1].trim();
  }
  
  addr.value = {
    street,
    number,
    neighborhood,
    complement,
    reference,
    observation,
    formatted: address.formatted || ''
  };
  showNewAddressForm.value = false;
  console.log('Campos preenchidos:', addr.value);
}
function editSavedAddress(id){
  const a = savedAddresses.value.find(s => s.id === id);
  if(!a) return;
  addr.value = {
    street: a.street || '',
    number: a.number || '',
    neighborhood: a.neighborhood || '',
    complement: a.complement || '',
    reference: a.reference || '',
    observation: a.observation || '',
    formatted: a.formatted || ''
  };
  showNewAddressForm.value = true;
  selectedAddressId.value = id;
}

function removeSavedAddress(id){
  savedAddresses.value = savedAddresses.value.filter(s => s.id !== id);
  if(selectedAddressId.value === id) selectedAddressId.value = null;
}
const canConfirmCustomer = computed(()=> {
  // DELIVERY exige nome preenchido
  if(orderType.value === 'DELIVERY') {
    return newCustomerName.value.trim().length > 1;
  }
  // BALCAO permite continuar sem nome (cliente não identificado)
  return true;
});
async function confirmCustomer(){
  if(!canConfirmCustomer.value) return;
  if(orderType.value==='DELIVERY') { 
    // Carrega bairros primeiro, depois avança
    if(neighborhoods.value.length===0) await loadNeighborhoods();
    // Se não tem endereços salvos, mostra formulário
    showNewAddressForm.value = savedAddresses.value.length === 0;
    step.value=2; 
  } else { 
    loadMenu(); 
    step.value=3; 
  }
}

const validAddress = computed(()=> {
  // Se selecionou endereço salvo, está válido
  if(selectedAddressId.value && savedAddresses.value.length > 0) return true;
  // Se está preenchendo novo, valida campos
  return !!addr.value.street && !!addr.value.neighborhood;
});
function next(){ step.value++; if(step.value===3) loadMenu(); }
function prev(){ step.value--; }

function selectProduct(p){ activeProduct.value = p; showOptions.value = true; optionQty.value=1; chosenOptions.value=[]; optionNote.value=''; }

// Fallback: alguns produtos antigos só têm o arquivo original (.jpg/.png),
// sem a variante _thumb.webp. Quando o thumb falha, troca para a URL bruta.
function onThumbError(evt, originalUrl){
  try{
    if(!evt || !evt.target || !originalUrl) return
    try{ evt.target.onerror = null }catch(e){}
    evt.target.src = assetUrl(originalUrl)
  }catch(e){ /* ignore */ }
}
function addToCart(payload){
  // persist product id when available so future edits can locate full product
  if(activeProduct.value && activeProduct.value.id) payload.productId = activeProduct.value.id;
  cart.value.push(payload);
  showOptions.value=false;
  recalc();
}
function editItem(idx){
  const it = cart.value[idx];
  if(!it) return;
  // prepare modal in edit mode with current item data
  editingIndex.value = idx;
  optionQty.value = Number(it.quantity || 1);
  optionNote.value = it.notes || '';

  // try to find the original product by id or name in loaded menu so we can show optionGroups
  let found = null;
  if(it.productId){
    for(const c of allProducts.value){
      found = (c.products || []).find(p => String(p.id) === String(it.productId));
      if(found) break;
    }
  }
  if(!found){
    // fallback: match by name
    for(const c of allProducts.value){
      found = (c.products || []).find(p => String(p.name) === String(it.name));
      if(found) break;
    }
  }

  if(found){
    activeProduct.value = found;
    // map existing chosen options to the product's option objects when possible (match by id or name)
    const mapped = [];
    const flatOpts = (found.optionGroups || []).reduce((acc,g)=> acc.concat(g.options || []), []);
    (it.options || []).forEach(o => {
      const qty = Number(o.quantity ?? o.qty ?? 1) || 1;
      const m = flatOpts.find(po => (po.id && String(po.id) === String(o.id)) || String(po.name) === String(o.name));
      if(m) mapped.push(Object.assign({}, m, { quantity: qty }));
      else mapped.push({ name: o.name, price: o.price, id: o.id, quantity: qty });
    });
    chosenOptions.value = mapped;
  } else {
    // product not found in menu (perhaps menu not loaded) — open modal with minimal info
    activeProduct.value = { name: it.name, price: it.price };
    chosenOptions.value = (it.options || []).map(o => ({ ...o }));
  }

  showOptions.value = true;
}
function decQty(it){ if(it.quantity>1){ it.quantity--; recalc(); } }
function removeItem(idx){ cart.value.splice(idx,1); recalc(); }
function recalc(){ /* triggers computed */ }
// Toggle option by id or name so items edited from cart (which may not have full option objects)
function toggleOption(opt){
  try{
    if(!opt) return;
    const keyId = opt.id != null ? String(opt.id) : null;
    const idx = chosenOptions.value.findIndex(co => {
      if(keyId && co.id != null) return String(co.id) === keyId;
      return String(co.name) === String(opt.name);
    });
    if(idx === -1){
      // push a shallow copy and default quantity=1
      chosenOptions.value.push(Object.assign({}, opt, { quantity: 1 }));
    } else {
      chosenOptions.value.splice(idx, 1);
    }
  }catch(e){ console.warn('toggleOption failed', e); }
  // clear validation warnings when user interacts
  try{ requiredWarnings.value = {}; }catch(e){}
}

function isOptionSelected(opt){
  if(!opt) return false;
  const keyId = opt.id != null ? String(opt.id) : null;
  return chosenOptions.value.some(co => (keyId && co.id != null) ? String(co.id) === keyId : String(co.name) === String(opt.name));
}
// Price used by the wizard — falls back to the product's special takeout
// price when the order being created is a takeout/balcão one. Mirrors the
// PublicMenu helper of the same name.
function isTakeoutOrderTypePos(t) {
  const v = String(t || '').toUpperCase()
  return v === 'PICKUP' || v === 'TAKEOUT' || v === 'TAKE-OUT' || v === 'PICK-UP' || v === 'BALCAO' || v === 'BALCÃO' || v === 'INDOOR' || v === 'RETIRADA'
}
function effectiveProductPrice(p) {
  if (!p) return 0
  if (isTakeoutOrderTypePos(orderType.value) && p.specialTakeoutPrice != null && p.specialTakeoutPrice !== '') {
    const sto = Number(p.specialTakeoutPrice)
    // Zero is treated as "no special price" so a product accidentally saved
    // with 0 (toggle on, blank field) does not zero-out balcão receipts.
    if (Number.isFinite(sto) && sto > 0) return sto
  }
  return Number(p.price || 0)
}
const optionModalTotal = computed(()=> {
  const unitPrice = effectiveProductPrice(activeProduct.value);
  const optsPerUnit = chosenOptions.value.reduce((s,o)=> s + (Number(o.price||0) * (Number(o.quantity||1) || 1)),0);
  return (unitPrice + optsPerUnit) * (Number(optionQty.value) || 1);
});
// ensure editingIndex cleared when closing options without saving
function closeOptions(){ showOptions.value=false; editingIndex.value = null; requiredWarnings.value = {}; optionNote.value=''; }
function confirmOptionsAdd(){
  if(!activeProduct.value) return;
  // validate required groups before adding
  if(!validateOptionGroups()) return;
  const payload = { name: activeProduct.value.name, quantity: optionQty.value, price: effectiveProductPrice(activeProduct.value), productId: activeProduct.value?.id || null, notes: optionNote.value || null, options: chosenOptions.value.map(o=>({ id: o.id, name: o.name, price: Number(o.price||0), quantity: Number(o.quantity||1) })) };
  if(editingIndex.value !== null && typeof editingIndex.value !== 'undefined'){
    // update existing item
    cart.value.splice(editingIndex.value, 1, payload);
    editingIndex.value = null;
    showOptions.value = false;
    recalc();
    return;
  }
  addToCart(payload);
}

function removeChosenOption(optIdx){
  if(optIdx==null) return;
  chosenOptions.value.splice(optIdx,1);
}

// return quantity selected for option (per product unit)
function qtyFor(groupId, optId){
  try{
    if(!chosenOptions.value || !chosenOptions.value.length) return 0;
    const key = optId != null ? String(optId) : null;
    const found = chosenOptions.value.find(co => (key && co.id != null) ? String(co.id) === key : String(co.name) === String(optId));
    return found ? (Number(found.quantity) || 0) : 0;
  }catch(e){ return 0; }
}

// change option quantity by delta. If resulting qty <=0 remove option.
function changeOptionQty(group, opt, delta){
  try{
    if(!opt) return;
    const keyId = opt.id != null ? String(opt.id) : null;
    const idx = chosenOptions.value.findIndex(co => (keyId && co.id != null) ? String(co.id) === keyId : String(co.name) === String(opt.name));
    if(idx === -1){
      if(delta > 0){
        chosenOptions.value.push({ id: opt.id, name: opt.name, price: Number(opt.price||0), quantity: Math.max(1, delta) });
      }
      return;
    }
    const current = Number(chosenOptions.value[idx].quantity || 0);
    const next = current + delta;
    if(next <= 0){ chosenOptions.value.splice(idx,1); }
    else { chosenOptions.value.splice(idx,1, Object.assign({}, chosenOptions.value[idx], { quantity: next })); }
  // clear validation warnings when user interacts
  try{ requiredWarnings.value = {}; }catch(e){}
  }catch(e){ console.warn('changeOptionQty failed', e); }
}

// select a single option for a group (radio behaviour)
function selectRadio(group, opt){
  try{
    if(!group || !opt) return;
    // remove any chosen options that are part of this group
    const ids = (group.options || []).map(o => o.id != null ? String(o.id) : null);
    chosenOptions.value = chosenOptions.value.filter(co => {
      if(co.id != null && ids.includes(String(co.id))) return false;
      // fallback by name
      if(typeof co.name === 'string' && (group.options || []).some(o => String(o.name) === String(co.name))) return false;
      return true;
    });
    // push selected with qty=1
    chosenOptions.value.push({ id: opt.id, name: opt.name, price: Number(opt.price||0), quantity: 1 });
  }catch(e){ console.warn('selectRadio failed', e); }
  try{ requiredWarnings.value = {}; }catch(e){}
}

function selectedCountForGroup(g){
  try{
    if(!g) return 0;
    const ids = (g.options || []).map(o => o.id != null ? String(o.id) : null);
    let cnt = 0;
    for(const co of chosenOptions.value){
      if(co == null) continue;
      if(co.id != null && ids.includes(String(co.id))) cnt += Number(co.quantity || 1) || 1;
      else if(typeof co.name === 'string' && (g.options||[]).some(o => String(o.name) === String(co.name))) cnt += Number(co.quantity || 1) || 1;
    }
    return cnt;
  }catch(e){ return 0; }
}

function validateOptionGroups(){
  try{
    requiredWarnings.value = {};
    const groups = activeProduct.value?.optionGroups || [];
    let ok = true;
    let firstFailId = null;
    for(const g of groups){
      const min = Number(g.min || 0) || 0;
      if(min > 0){
        const cnt = selectedCountForGroup(g);
        if(cnt < min){
          requiredWarnings.value[g.id] = true;
          ok = false;
          if(!firstFailId) firstFailId = g.id;
        }
      }
    }
    if(!ok && firstFailId){
      // scroll first failing group into view inside the options body
      nextTick(() => {
        try{
          const root = optionsBodyRef.value || document;
          const el = root.querySelector ? root.querySelector('#grp-' + firstFailId) : null;
          if(el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }catch(e){}
      });
    }
    return ok;
  }catch(e){ console.warn('validateOptionGroups failed', e); return true; }
}

const subtotal = computed(()=> cart.value.reduce((s,it)=> {
  const qty = Number(it.quantity || 1) || 1;
  const unit = Number(it.price || 0) || 0;
  const optsPerUnit = (it.options || []).reduce((so,o)=> so + (Number(o.price || 0) * (Number(o.quantity || 1) || 1)), 0);
  return s + (unit + optsPerUnit) * qty;
}, 0));
const isFreeDeliveryActive = computed(()=> freeDeliveryEnabled.value && freeDeliveryMinOrder.value != null && subtotal.value >= freeDeliveryMinOrder.value);
const deliveryFee = computed(()=> orderType.value==='DELIVERY' ? estimateDeliveryFee() : 0);
const matchedNeighborhood = computed(()=>{
  if(orderType.value!=='DELIVERY') return null;
  const name = (addr.value.neighborhood||'').trim().toLowerCase();
  if(!name) return null;
  return neighborhoods.value.find(n => n.name.trim().toLowerCase() === name) || null;
});
function estimateDeliveryFee(){
  const base = matchedNeighborhood.value ? Number(matchedNeighborhood.value.deliveryFee||0) : 0;
  if(base > 0 && isFreeDeliveryActive.value) return 0;
  return base;
}
// account for coupon discount when computing final total
const couponCode = ref('');
const couponApplied = ref(false);
const couponDiscount = ref(0);
const couponInfo = ref(null);
const couponLoading = ref(false);
const couponError = ref('');
const manualDiscount = ref(0);
const surcharge = ref(0);

// Payment-method discount preview (mirrors public checkout)
const paymentDiscount = ref(0);
const paymentDiscountInfo = ref({ removesCoupon: false, blocksCashback: false });
let _posPreviousPaymentMethod = paymentMethodCode.value;
let _posPaymentPreviewSeq = 0;
let _posPaymentDiscountModalOpen = false;

// Returns the BRL savings amount for the given payment method against the
// current cart subtotal. Returns 0 when the rule does not apply.
function paymentMethodSavings(pm) {
  if (!pm || !pm.discountEnabled) return 0
  const allowed = Array.isArray(pm.allowedOrderTypes) ? pm.allowedOrderTypes : []
  if (allowed.length > 0) {
    const norm = (t) => {
      const u = String(t || '').toUpperCase()
      if (u === 'DELIVERY') return 'DELIVERY'
      if (u === 'BALCAO' || u === 'BALCÃO' || u === 'INDOOR') return 'BALCAO'
      return 'TAKEOUT'
    }
    if (!allowed.map(norm).includes(norm(orderType.value))) return 0
  }
  const sub = Number(subtotal.value) || 0
  const pct = pm.discountPercent != null && pm.discountPercent !== '' ? Number(pm.discountPercent) : null
  if (pct != null && Number.isFinite(pct) && pct > 0) {
    return Math.min(sub, Math.round(sub * pct) / 100)
  }
  const fix = pm.discountFixed != null && pm.discountFixed !== '' ? Number(pm.discountFixed) : null
  if (fix != null && Number.isFinite(fix) && fix > 0) {
    return Math.min(sub, fix)
  }
  return 0
}

async function recalcPaymentDiscount() {
  const mySeq = ++_posPaymentPreviewSeq;
  paymentDiscount.value = 0;
  paymentDiscountInfo.value = { removesCoupon: false, blocksCashback: false };
  if (!paymentMethodCode.value) return;
  const pm = paymentMethods.value.find(m => (m.code || m.name) === paymentMethodCode.value);
  if (!pm || !pm.discountEnabled) return;
  try {
    const res = await api.post('/menu/payment-preview', {
      paymentMethodCode: paymentMethodCode.value,
      orderType: orderType.value,
      subtotal: subtotal.value,
    });
    if (mySeq !== _posPaymentPreviewSeq) return;
    const data = res.data || {};
    if (data.applies) {
      paymentDiscount.value = Number(data.amount || 0);
      paymentDiscountInfo.value = {
        removesCoupon: !!data.removesCoupon,
        blocksCashback: !!data.blocksCashback,
      };
      if (data.removesCoupon && couponDiscount.value > 0) {
        if (_posPaymentDiscountModalOpen) return;
        _posPaymentDiscountModalOpen = true;
        try {
          const ok = await Swal.fire({
            icon: 'warning',
            title: 'Cupom não cumulativo',
            text: 'Este método de pagamento remove o cupom aplicado. Deseja continuar?',
            showCancelButton: true,
            confirmButtonText: 'Sim, manter este método',
            cancelButtonText: 'Cancelar',
          });
          if (!ok.isConfirmed) {
            paymentMethodCode.value = _posPreviousPaymentMethod;
            return;
          }
          // user confirmed — clear coupon
          try { removeCoupon(); } catch (e) {
            couponApplied.value = false;
            couponDiscount.value = 0;
            couponCode.value = '';
            couponInfo.value = null;
          }
        } finally {
          _posPaymentDiscountModalOpen = false;
        }
      }
    }
  } catch (e) {
    console.warn('Failed to preview payment discount', e);
  } finally {
    if (mySeq === _posPaymentPreviewSeq) _posPreviousPaymentMethod = paymentMethodCode.value;
  }
}

// Cashback (mirrors PublicMenu): customer-bound credit applied before payment.
const cashbackEnabled = ref(false);
const cashbackMinRedeem = ref(0);
const cashbackBalance = ref(0);
const cashbackLoaded = ref(false);
const useCashback = ref(false);
const useCashbackAmount = ref(0);

const cashbackCanRedeem = computed(() => {
  if (!cashbackEnabled.value || !foundCustomer.value) return false;
  const min = Number(cashbackMinRedeem.value || 0);
  return cashbackBalance.value > 0 && (min === 0 || cashbackBalance.value >= min);
});

const totalBeforeCashback = computed(() => {
  try {
    const base = Math.max(0, subtotal.value - Number(couponDiscount.value || 0) - Number(manualDiscount.value || 0) - Number(paymentDiscount.value || 0) + Number(surcharge.value || 0));
    return base + Number(deliveryFee.value || 0);
  } catch (e) { return subtotal.value + deliveryFee.value; }
});

const appliedCashback = computed(() => {
  if (!useCashback.value) return 0;
  const max = Math.min(Number(cashbackBalance.value || 0), Number(totalBeforeCashback.value || 0));
  const requested = Number(useCashbackAmount.value || 0);
  return Math.max(0, Math.min(requested, max));
});

const totalWithDelivery = computed(() => {
  return Math.max(0, totalBeforeCashback.value - appliedCashback.value);
});

watch(useCashback, (v) => {
  if (v) {
    // default to max usable when toggled on
    useCashbackAmount.value = Math.min(Number(cashbackBalance.value || 0), Number(totalBeforeCashback.value || 0));
  } else {
    useCashbackAmount.value = 0;
  }
});

async function loadCashbackSettings() {
  try {
    const companyId = await resolveCompanyId();
    const { data } = await api.get(`/public/${companyId}/cashback-settings`);
    cashbackEnabled.value = Boolean(data?.enabled);
    cashbackMinRedeem.value = Number(data?.minRedeemValue || 0);
  } catch (e) {
    cashbackEnabled.value = false;
  }
}

async function loadCustomerCashbackWallet() {
  cashbackLoaded.value = false;
  cashbackBalance.value = 0;
  if (!foundCustomer.value || !cashbackEnabled.value) return;
  try {
    const { data } = await api.get('/cashback/wallet', { params: { clientId: foundCustomer.value.id } });
    cashbackBalance.value = Number(data?.balance || 0);
    cashbackLoaded.value = true;
  } catch (e) {
    console.warn('PDV: falha ao carregar carteira de cashback', e?.response?.data || e?.message);
    cashbackBalance.value = 0;
    cashbackLoaded.value = true;
  }
}

watch(foundCustomer, () => {
  // Reset cashback choice when customer changes
  useCashback.value = false;
  useCashbackAmount.value = 0;
  loadCustomerCashbackWallet();
});

const isCashPayment = computed(()=> {
  if(!paymentMethodCode.value) return false;
  const pm = paymentMethods.value.find(m => (m.code || m.name) === paymentMethodCode.value);
  if(!pm) return false;
  const code = (pm.code || '').toUpperCase();
  const name = (pm.name || '').toLowerCase();
  return code === 'CASH' || /dinheiro/.test(name);
});
watch(paymentMethodCode, ()=> { if(!isCashPayment.value) changeFor.value = null; });
watch(paymentMethodCode, () => { recalcPaymentDiscount(); });
watch(orderType, () => { recalcPaymentDiscount(); }, { flush: 'post' });
watch(subtotal, () => { recalcPaymentDiscount(); });

async function loadMenu(){
  if(menuLoading.value) return; menuLoading.value=true;
  try {
    let companyId = await resolveCompanyId();
    console.log('PDV: resolved companyId initial=', companyId);
    // Ensure stores are loaded so we can request a store-scoped public menu when possible
    if(!stores.value || stores.value.length === 0) {
      try { await loadStores(); } catch(e) { console.warn('PDV: loadStores failed', e); }
    }
    console.log('PDV: stores count=', (stores.value || []).length, 'selectedStoreId=', selectedStoreId.value);
    // if stores available but no selection, pick the first as default to fetch store-scoped menu
    if((stores.value || []).length > 0 && !selectedStoreId.value) selectedStoreId.value = stores.value[0].id;
    // If we have a selected store, prefer its companyId for public menu requests
    try{
      const storeObj = (stores.value || []).find(s => String(s.id) === String(selectedStoreId.value));
      if(storeObj && storeObj.companyId){
        companyId = storeObj.companyId;
        console.log('PDV: using store.companyId for menu request=', companyId);
      }
    }catch(e){ console.warn('PDV: error resolving store.companyId', e); }
    const params = {};
    // storeId is intentionally NOT sent here — it would filter to the store's linked menu
    // and hide categories not assigned to that menu. The store is used only on order creation.
    console.log('PDV: requesting public menu with params=', params);
    let resp;
    try {
      resp = await api.get(`/public/${companyId}/menu`, { params });
      console.log('PDV: menu request status=', resp.status);
    } catch (err) {
      console.error('PDV: menu request failed', err?.response?.status, err?.response?.data || err);
      throw err;
    }
    const data = resp.data || {};
    console.log('PDV: /public/' + companyId + '/menu response:', data);
    // merge categories + uncategorized
    const rawCats = data.categories || [];
    // filtra categorias e produtos inativos para evitar lixo no PDV
    const catsFiltered = rawCats.map(c => ({ ...c, products: (c.products||[]).filter(p => p.isActive !== false) })).filter(c => c.isActive !== false);
    const uncategorizedFiltered = (data.uncategorized || []).filter(p => p.isActive !== false);
    const cats = [...catsFiltered, { id:'uncat', name:'Outros', products: uncategorizedFiltered }];
    // each product ensure price property (fallback to first option price or 0)
    cats.forEach(c=> c.products.forEach(p=> { if(p.price==null) p.price = Number(p.basePrice||0); }));
    allProducts.value = cats;
    console.log('PDV: processed categories count=', cats.length, 'uncategorized count=', (data.uncategorized || []).length);
    if(cats && cats.length > 0){
      console.log('PDV: first category sample=', cats[0]);
      console.log('PDV: first product sample=', (cats[0].products || [])[0] || null);
    }
    paymentMethods.value = data.company?.paymentMethods || [];
    nextTick(() => { recalcPaymentDiscount(); });
    // ensure menus are loaded so the user can assign a menu before finalizing
    if(!menus.value || menus.value.length===0) await loadMenus();
    // stores ainda são carregadas como fallback (compat com fluxos antigos)
    if(!stores.value || stores.value.length===0) await loadStores();
  } catch(e){ console.error('Falha ao carregar menu público para PDV', e); }
  finally{ menuLoading.value=false; }
}

async function loadStores(){
  if(storesLoading.value) return;
  storesLoading.value = true;
  try{
    // admin endpoint returns company stores for the authenticated user
    const { data } = await api.get('/stores');
    stores.value = Array.isArray(data) ? data : [];
    if(!selectedStoreId.value && stores.value.length>0) selectedStoreId.value = stores.value[0].id;
  }catch(e){ console.error('PDV: falha ao carregar lojas', e); }
  finally{ storesLoading.value = false; }
}

async function loadMenus(){
  if(menusLoading.value) return;
  menusLoading.value = true;
  try{
    const { data } = await api.get('/menu/menus');
    menus.value = Array.isArray(data) ? data : (data?.items || []);
    if(!selectedMenuId.value && menus.value.length>0) selectedMenuId.value = menus.value[0].id;
  }catch(e){ console.error('PDV: falha ao carregar cardápios', e); }
  finally{ menusLoading.value = false; }
}

async function loadNeighborhoods(){
  if(neighborhoodsLoading.value) return; neighborhoodsLoading.value=true;
  try {
    const companyId = await resolveCompanyId();
    if(!companyId){ console.warn('PDV: companyId não encontrado (bairros)'); return; }
    const { data } = await api.get(`/public/${companyId}/neighborhoods`);
    if(data && Array.isArray(data.neighborhoods)){
      neighborhoods.value = data.neighborhoods;
      freeDeliveryEnabled.value = data.freeDeliveryEnabled ?? false;
      freeDeliveryMinOrder.value = data.freeDeliveryMinOrder ?? null;
    } else {
      neighborhoods.value = Array.isArray(data) ? data : [];
    }
    console.log('Bairros carregados:', neighborhoods.value);
    // Load company defaults (city/state) for address pre-fill
    if (!companyDefaults.value.city) {
      try {
        const { data: menuData } = await api.get(`/public/${companyId}/menu`);
        if (menuData?.company) {
          companyDefaults.value.city = menuData.company.city || '';
          companyDefaults.value.state = menuData.company.state || '';
        }
      } catch(e) { /* ignore */ }
    }
  } catch(e){ console.error('Falha ao carregar bairros públicos para PDV', e); }
  finally{ neighborhoodsLoading.value=false; }
}

async function applyCoupon(){
  try{
    couponError.value = '';
    if(!couponCode.value || !couponCode.value.trim()){
      couponError.value = 'Insira um código válido';
      return;
    }
    couponLoading.value = true;
    const companyId = await resolveCompanyId();
    if(!companyId){ couponError.value = 'Empresa não encontrada'; return; }
    const res = await api.post(`/public/${companyId}/coupons/validate`, { code: couponCode.value.trim(), subtotal: subtotal.value, customerPhone: phoneDigits.value || undefined });
    const data = res.data || {};
    if(data && data.valid){
      couponApplied.value = true;
      couponDiscount.value = Number(data.discountAmount || 0);
      couponInfo.value = data.coupon || null;
      couponError.value = '';
      return;
    }
    couponError.value = 'Cupom inválido';
  }catch(e){
    couponError.value = e?.response?.data?.message || 'Erro ao validar cupom';
    console.warn('applyCoupon error', e);
  } finally { couponLoading.value = false; }
}

function removeCoupon(){ couponApplied.value = false; couponDiscount.value = 0; couponInfo.value = null; couponCode.value = ''; couponError.value = ''; }

async function applyCouponWithCode(code) {
  couponCode.value = code;
  await applyCoupon();
}

defineExpose({ applyCouponWithCode, removeCoupon, finalize, finalizing });

async function finalize(){
  finalizing.value = true;
  finalizeError.value = '';
  try {
    const itemsPayload = cart.value.map(it => ({ productId: it.productId || null, name: it.name, quantity: it.quantity, price: it.price, notes: it.notes||null, options: it.options||null }));
    // Para pedido balcão sem identificação, usa nome genérico
    const customerNameFinal = newCustomerName.value.trim() || (orderType.value === 'BALCAO' ? 'Cliente Balcão' : '');
    const body = { customerName: customerNameFinal, customerPhone: phoneDigits.value || null, orderType: orderType.value, address: orderType.value==='DELIVERY' ? addr.value : null, items: itemsPayload, payment: { methodCode: paymentMethodCode.value, amount: totalWithDelivery.value, changeFor: changeFor.value }, menuId: selectedMenuId.value || undefined, storeId: selectedStoreId.value || undefined, discountMerchant: manualDiscount.value > 0 ? manualDiscount.value : undefined, additionalFees: surcharge.value > 0 ? surcharge.value : undefined, appliedCashback: appliedCashback.value > 0 ? appliedCashback.value : undefined };
    // Always send customerId when we already know who the customer is. The
    // backend's findOrCreateCustomer would otherwise fall back to matching
    // by name when phone is blank — and pick a different customer with the
    // same first name, sending the order notification to a stranger.
    if (foundCustomer.value?.id) body.customerId = foundCustomer.value.id;
    // If customer was found and we're using a new address (not selecting existing), persist address to customer first
    try{
      if(orderType.value === 'DELIVERY' && !selectedAddressId.value && foundCustomer.value){
        const formatted = addr.value.formatted || [addr.value.street, addr.value.number].filter(Boolean).join(', ');
        const payload = {
          street: addr.value.street || null,
          number: addr.value.number || null,
          complement: addr.value.complement || null,
          neighborhood: addr.value.neighborhood || null,
          reference: addr.value.reference || null,
          observation: addr.value.observation || null,
          city: addr.value.city || companyDefaults.value.city || null,
          state: addr.value.state || companyDefaults.value.state || null,
          formatted: formatted || null
        };
        // create address on customer and set customerId on order body so backend uses existing customer
        await api.post(`/customers/${foundCustomer.value.id}/addresses`, payload);
        body.customerId = foundCustomer.value.id;
        // ensure order.address is the formatted string
        if(formatted) body.address = formatted;
      }
    }catch(addrErr){ console.warn('Falha ao persistir endereço no cliente:', addrErr); }
    // include coupon information when applied so backend can persist and track usage
    try{
      if(couponApplied.value && couponInfo.value){
        body.coupon = { code: couponInfo.value.code || couponCode.value.trim(), discountAmount: Number(couponDiscount.value || 0) };
      }
    }catch(e){ /* ignore */ }
    const { data } = await api.post('/orders', body);
    createdOrderDisplay.value = data.displaySimple || data.displayId || data.id?.slice(0,6) || '—';
    step.value = 5;
    emit('created', data);
  } catch(e){
    console.error('Falha ao criar pedido PDV', e);
    finalizeError.value = e?.response?.data?.message || 'Erro ao criar pedido. Tente novamente.';
  }
  finally{ finalizing.value=false; }
}
function resetWizard(){
  step.value=1;
  productSearch.value = '';
  selectedCategory.value = null;
  cart.value=[];
  foundCustomer.value=null;
  customerNotFound.value=false;
  newCustomerName.value='';
  paymentMethodCode.value='';
  changeFor.value=null;
  phoneInput.value = '';
  manualDiscount.value = 0;
  surcharge.value = 0;
  useCashback.value = false;
  useCashbackAmount.value = 0;
  cashbackBalance.value = 0;
  cashbackLoaded.value = false;
  // clear addresses and address form state to avoid reusing previous customer's data
  savedAddresses.value = [];
  selectedAddressId.value = null;
  showNewAddressForm.value = false;
  addr.value = { street:'', number:'', neighborhood:'', complement:'', formatted:'', reference:'', observation:'', city: companyDefaults.value.city || '', state: companyDefaults.value.state || '' };
}

watch(()=>props.visible, async (v)=>{
  if(v){
    resetWizard();
    // Load cashback program settings (best-effort; ignored if disabled)
    loadCashbackSettings();
    // Carrega bairros ao abrir o modal para garantir que estejam disponíveis
    if(neighborhoods.value.length===0) {
      console.log('Carregando bairros ao abrir wizard...');
      await loadNeighborhoods();
    }
    // If a preset was provided (e.g. Pedido balcão), apply it and skip steps as appropriate
    if(props.preset){
      try{
        if(props.preset.customerName) newCustomerName.value = props.preset.customerName;
        // support preset.orderType values like 'RETIRADA' or 'BALCAO' or 'DELIVERY'
        if(props.preset.orderType){
          const ot = String(props.preset.orderType).toUpperCase();
          if(ot === 'RETIRADA' || ot === 'BALCAO' || ot === 'BALCÃO') orderType.value = 'BALCAO';
          else orderType.value = ot;
        }
        // if preset requests a start step (e.g. autoStep: 2 -> address selection)
        if(props.preset.autoStep){
          const s = Number(props.preset.autoStep) || 1;
          step.value = s;
          if(s === 2){
            if(neighborhoods.value.length === 0) await loadNeighborhoods();
          } else if(s === 3){
            await loadMenu();
            return;
          }
        }
        // if preset indicates skipAddress or it's a balcão/retirada, jump to products
        if(props.preset.skipAddress || orderType.value === 'BALCAO'){
          await loadMenu();
          step.value = 3;
          return;
        }
      }catch(e){ console.warn('Failed to apply PDV preset', e); }
    }
    // Se há telefone inicial, preenche e busca automaticamente
    if(props.initialPhone) {
      phoneInput.value = props.initialPhone;
      // Aguarda nextTick para garantir que phoneInput foi atualizado
      setTimeout(() => searchCustomer(), 100);
    }
  } 
});
watch(()=>orderType.value,(v)=>{ if(v==='DELIVERY' && neighborhoods.value.length===0) loadNeighborhoods(); });

// Sync external step control (embedded mode)
watch(() => props.forceStep, (v) => {
  if (props.embedded && v != null) step.value = v;
}, { immediate: true });

// Emit cart state to parent so footer can show totals without needing to read internals
const cartState = computed(() => ({
  subtotal: subtotal.value,
  deliveryFee: deliveryFee.value,
  totalWithDelivery: totalWithDelivery.value,
  couponApplied: couponApplied.value,
  couponDiscount: couponDiscount.value,
  couponInfo: couponInfo.value ? { code: couponInfo.value.code } : null,
  couponError: couponError.value,
  couponLoading: couponLoading.value,
  cartLength: cart.value.length,
  paymentMethodCode: paymentMethodCode.value,
  // Items propagados pro parent montar mensagens (ex: ContactPanel envia
  // resumo do pedido pro cliente). Cada item: { name, quantity, price,
  // notes, options: [{ name, price, quantity }] }.
  items: cart.value.map((it) => ({
    name: it.name,
    quantity: Number(it.quantity || 1),
    price: Number(it.price || 0),
    notes: it.notes || null,
    options: Array.isArray(it.options) ? it.options.map((o) => ({
      name: o.name,
      price: Number(o.price || 0),
      quantity: Number(o.quantity || 1),
    })) : [],
  })),
}));
watch(cartState, (val) => { emit('cart-update', val); }, { deep: true, immediate: true });

// Always load cashback program settings on mount (works for both modal and embedded modes).
onMounted(() => { loadCashbackSettings(); });

// Embedded mode: skip customer/address steps and go directly to products
let embeddedInitialized = false;

// Map any takeout-equivalent label coming from the parent ('TAKEOUT', 'PICKUP',
// 'TAKE-OUT', 'PICK-UP', 'RETIRADA', 'BALCAO', 'BALCÃO', 'INDOOR') to BALCAO so
// the rest of this wizard — which only branches on 'DELIVERY' vs everything
// else — never falls into the delivery code path for a takeout order.
function normalizeOrderType(raw) {
  if (!raw) return null;
  const ot = String(raw).toUpperCase();
  const TAKEOUT_LIKE = ['RETIRADA', 'TAKEOUT', 'TAKE-OUT', 'PICKUP', 'PICK-UP', 'BALCAO', 'BALCÃO', 'INDOOR'];
  if (TAKEOUT_LIKE.includes(ot)) return 'BALCAO';
  return ot;
}

watch(() => props.preset, async (val) => {
  if (!props.embedded || !val?.skipCustomer) return;
  try {
    // Keep orderType in sync with the parent's selection on every preset
    // change (the customer can flip Entrega ↔ Balcão mid-flow). Locking it
    // behind embeddedInitialized — as the original code did — caused the
    // wizard to ship the order with address: addr.value while orderType was
    // already BALCAO in the parent, triggering the backend's address-required
    // validation only for late switches.
    if (val.orderType) {
      const next = normalizeOrderType(val.orderType);
      if (next && next !== orderType.value) orderType.value = next;
    }

    // Initialize customer/address/menu only once per wizard instance
    if (!embeddedInitialized) {
      // Set customer from preset
      if (val.customerId) {
        try {
          const { data } = await api.get(`/customers/${val.customerId}`);
          foundCustomer.value = data;
          savedAddresses.value = data.addresses || [];
          if (val.customerName) newCustomerName.value = val.customerName;
          // Hydrate the phone input from the loaded customer so phoneDigits
          // (computed from phoneInput) is populated. Without this the order
          // body submits customerPhone: null and the backend's
          // findOrCreateCustomer falls back to matching by name — which can
          // pick a different customer with the same first name and route
          // the notification to the wrong WhatsApp number.
          const ph = data?.whatsapp || data?.phone || '';
          if (ph) phoneInput.value = String(ph);
        } catch (e) { console.warn('Failed to load preset customer:', e); }
      } else if (val.customerName) {
        newCustomerName.value = val.customerName;
      }
      // Set address from preset
      if (val.address) {
        const a = val.address;
        addr.value = { street: a.street || '', number: a.number || '', complement: a.complement || '', neighborhood: a.neighborhood || '', reference: a.reference || '', observation: a.observation || '', city: a.city || '', state: a.state || '' };
        if (a.id) selectedAddressId.value = a.id;
      }
      // Pre-select the menu/store that owns the conversation BEFORE loadMenu()
      // runs, so loadStores/loadMenus see a populated selectedXId and skip the
      // "fall back to first item" default. In the inbox this lands the operator
      // on the same cardápio the customer is chatting from.
      if (val.menuId) selectedMenuId.value = val.menuId;
      if (val.storeId) selectedStoreId.value = val.storeId;
      // Go directly to products
      await loadMenu();
      // After loadMenu() the menus list is hydrated. If the preset's menuId
      // isn't in the result (e.g. operator no longer has access), gracefully
      // fall back to the first available menu — otherwise the dropdown would
      // show nothing selected.
      if (val.menuId && (menus.value || []).every(m => String(m.id) !== String(val.menuId))) {
        selectedMenuId.value = (menus.value || [])[0]?.id || null;
      }
      step.value = 3;
      embeddedInitialized = true;
    }

    // Prefill/replace cart from preset.items (supports re-prefill on "repetir" click)
    if (Array.isArray(val.items) && val.items.length) {
      try {
        cart.value = val.items.map(it => ({
          productId: it.productId || null,
          name: it.name,
          quantity: Number(it.quantity) || 1,
          price: Number(it.price) || 0,
          options: Array.isArray(it.options) ? it.options : [],
          notes: it.notes || null,
        }));
        recalc();
      } catch (e) { console.warn('Failed to prefill cart from preset.items', e); }
    }
  } catch (e) { console.warn('Failed to initialize embedded POSOrderWizard', e); }
}, { immediate: true, deep: true });


</script>

<style scoped>
.pos-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; justify-content:center; align-items:flex-start; padding:40px 20px; z-index:1050; overflow:auto; }
.pos-panel{ background:#fff; width:100%; max-width:760px; border-radius:14px; padding:20px 22px; box-shadow:0 6px 18px rgba(0,0,0,.15); }
.menu-scroll{ max-height:480px; overflow-y:auto; border:1px solid #eee; padding:10px 12px; border-radius:8px; }
.category-pills{ display:flex; gap:6px; overflow-x:auto; padding-bottom:4px; scrollbar-width:none; }
.category-pills::-webkit-scrollbar{ display:none; }
.pill-btn{ white-space:nowrap; flex-shrink:0; font-size:0.75rem; padding:2px 10px; border-radius:20px; }
.category-header{ font-weight:600; font-size:0.85rem; padding:6px 0 4px; border-bottom:1px solid #eee; margin-bottom:8px; color:#555; text-transform:uppercase; letter-spacing:0.04em; }
.product-btn{ font-size:0.85rem; padding:5px 8px; }

/* PDV product grid */
.product-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));
  gap:10px;
}
/* Inbox embed: cards menores (mais largura ocupada pela sidebar do chat) */
.product-grid--compact{
  grid-template-columns:repeat(auto-fill, minmax(100px, 1fr));
}
.product-card{
  display:flex;
  flex-direction:column;
  background:#fff;
  border:1px solid #e6e6e6;
  border-radius:10px;
  padding:0;
  overflow:hidden;
  cursor:pointer;
  transition:transform .12s ease, box-shadow .12s ease, border-color .12s ease;
  text-align:left;
}
.product-card:hover{
  transform:translateY(-2px);
  box-shadow:0 4px 10px rgba(0,0,0,.08);
  border-color:#cfd6dd;
}
.product-card:active{
  transform:translateY(0);
}
.product-card-thumb{
  width:100%;
  aspect-ratio:1;
  background:#f5f6f7;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
}
.product-card-thumb img{
  width:100%; height:100%; object-fit:cover; display:block;
}
.product-card-thumb .bi-image{
  font-size:2rem;
  color:#c8cdd2;
}
.product-card-body{
  display:flex;
  flex-direction:column;
  gap:2px;
  padding:8px 10px 10px;
  flex:1;
}
.product-card-name{
  font-size:0.82rem;
  font-weight:500;
  line-height:1.2;
  color:#222;
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
}
.product-card-price{
  font-size:0.8rem;
  font-weight:600;
  color:var(--primary, #105784);
  margin-top:2px;
}
@media (max-width: 480px) {
  .product-grid{ grid-template-columns:repeat(2, 1fr); gap:8px; }
  .product-card-name{ font-size:0.78rem; }
}
.cart-box{ background:#f9fafb; border:1px solid #eceff3; border-radius:12px; padding:12px 14px; }
.cart-item{ border-bottom:1px solid #eceff3; padding:6px 0; }
.cart-item:last-child{ border-bottom:none; }
.pos-options-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; justify-content:center; align-items:center; z-index:1100; }
.pos-options-panel{ background:#fff; width:100%; max-width:520px; padding:18px 20px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,.2); display:flex; flex-direction:column; }
.pos-options-panel .pos-options-body{  max-height: calc(80vh - 140px); }
.pos-options-panel .options-scroll{ max-height:260px; overflow-y:auto; padding-right:6px; padding-bottom:4px; overscroll-behavior:contain; }
.pos-options-panel .pos-options-body{ position:relative; }
.pos-options-panel .pos-options-footer{ flex:0 0 auto; }
/* Option group section */
.option-section-header {
  margin-bottom: 6px;
}
.option-section-title {
  font-size: 0.78rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c757d;
}
.option-group-card {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  overflow: hidden;
}
.option-group-item {
  padding: 9px 12px;
  border-bottom: 1px solid #e9ecef;
  transition: background 0.1s;
}
.option-group-item:last-child {
  border-bottom: none;
}
.option-group-item:hover {
  background: #eff1f3;
}
.option-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.option-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #212529;
}
.option-price {
  font-size: 0.775rem;
  color: #6c757d;
  font-style: italic;
}
.obs-textarea {
  resize: none;
  font-size: 0.875rem;
  border-radius: 8px;
}
/* Custom scrollbars */
.pos-options-panel .options-scroll{
  scrollbar-width: thin;
  scrollbar-color: rgba(0,0,0,0.12) transparent;
}
.pos-options-panel .options-scroll::-webkit-scrollbar{ width:10px; height:10px; }
.pos-options-panel .options-scroll::-webkit-scrollbar-track{ background: transparent; border-radius:8px; }
.pos-options-panel .options-scroll::-webkit-scrollbar-thumb{ background: rgba(0,0,0,0.12); border-radius:8px; border: 2px solid transparent; background-clip: padding-box; }
.pos-options-panel .options-scroll::-webkit-scrollbar-thumb:hover{ background: rgba(0,0,0,0.18); }
/* .products-step estilos específicos podem ser adicionados futuramente */
</style>
