<template>
  <div v-if="visible" class="pos-overlay">
    <div class="pos-panel">
      <div class="d-flex justify-content-between align-items-center mb-3">
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
            {{ foundCustomer.fullName }} ({{ foundCustomer.whatsapp || foundCustomer.phone }})
          </div>
          <div v-else-if="customerNotFound" class="alert alert-warning py-2 mb-3">Cliente não encontrado.</div>
          
          <label class="form-label small fw-semibold">Tipo do pedido</label>
          <select v-model="orderType" class="form-select mb-3">
            <option value="BALCAO">Balcão (retirada)</option>
            <option value="DELIVERY">Entrega</option>
          </select>

          <div v-if="orderType === 'DELIVERY' || !foundCustomer">
            <label class="form-label small">Nome do cliente {{ orderType === 'DELIVERY' ? '(obrigatório)' : '(opcional)' }}</label>
            <input v-model="newCustomerName" class="form-control mb-3" placeholder="Nome completo" />
          </div>

          <button class="btn btn-success" @click="confirmCustomer" :disabled="!canConfirmCustomer">Continuar</button>
        </div>
      </div>

      <div v-else-if="step===2">
        <h6 class="fw-semibold mb-3">Endereço de Entrega</h6>
        
        <!-- Lista de endereços salvos -->
        <div v-if="savedAddresses.length > 0" class="mb-3">
          <label class="form-label small fw-semibold">Endereços salvos</label>
          <ul class="list-unstyled">
            <li v-for="a in savedAddresses" :key="a.id" class="border rounded p-2 mb-2" :class="{'border-primary bg-light': selectedAddressId === a.id}">
              <div class="d-flex justify-content-between align-items-start gap-2">
                <div class="flex-grow-1">
                  <div class="fw-semibold">{{ a.formatted || [a.street, a.number].filter(Boolean).join(', ') || 'Endereço sem rua' }}</div>
                  <div class="small text-muted">
                    {{ a.neighborhood || 'Sem bairro' }}{{ a.city ? (' - ' + a.city) : '' }}
                  </div>
                  <div v-if="a.complement" class="small text-muted">{{ a.complement }}</div>
                </div>
                <input type="radio" :value="a.id" v-model="selectedAddressId" @change="selectSavedAddress(a)" />
              </div>
            </li>
          </ul>
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
              <input v-model="addr.street" class="form-control" />
            </div>
            <div class="col-4">
              <label class="form-label small">Número</label>
              <input v-model="addr.number" class="form-control" />
            </div>
            <div class="col-6">
              <label class="form-label small">Bairro</label>
              <select v-model="addr.neighborhood" class="form-select">
                <option value="">Selecione o bairro</option>
                <option v-for="n in neighborhoods" :key="n.id" :value="n.name">
                  {{ n.name }} - R$ {{ Number(n.deliveryFee||0).toFixed(2) }}
                </option>
              </select>
            </div>
            <div class="col-6">
              <label class="form-label small">Cidade</label>
              <input v-model="addr.city" class="form-control" />
            </div>
            <div class="col-12">
              <label class="form-label small">Complemento</label>
              <input v-model="addr.complement" class="form-control" />
            </div>
          </div>
          <div class="mt-2 small">
            <div v-if="neighborhoodsLoading">Calculando taxa...</div>
            <div v-else-if="addr.neighborhood">
              <span v-if="matchedNeighborhood">Taxa: <strong>R$ {{ Number(matchedNeighborhood.deliveryFee||0).toFixed(2) }}</strong></span>
              <span v-else class="text-muted">Bairro sem taxa (R$ 0,00)</span>
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
          <label class="form-label small">Loja atribuída</label>
          <div v-if="storesLoading" class="small text-muted">Carregando lojas...</div>
          <div v-else>
            <select v-model="selectedStoreId" class="form-select">
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <div v-if="stores.length===0" class="small text-muted mt-1">Nenhuma loja disponível para atribuir.</div>
          </div>
        </div>
        <div v-if="menuLoading" class="small">Carregando menu...</div>
        <div v-else class="menu-scroll">
          <div v-for="cat in allProducts" :key="cat.id" class="mb-3">
            <div class="fw-semibold mb-1">{{ cat.name }}</div>
            <div class="d-flex flex-column gap-1">
              <button v-for="p in cat.products" :key="p.id" class="btn btn-light text-start position-relative" @click="selectProduct(p)">
                <div class="d-flex justify-content-between">
                  <span>{{ p.name }}</span>
                  <span class="small text-muted">R$ {{ Number(p.price||0).toFixed(2) }}</span>
                </div>
              </button>
            </div>
          </div>
        </div>
        <div class="cart-box mt-3">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="fw-semibold">Carrinho</div>
            <div class="small text-muted">Subtotal: R$ {{ subtotal.toFixed(2) }}</div>
          </div>
          <div v-if="cart.length===0" class="small text-muted">Nenhum item.</div>
          <div v-for="(it,idx) in cart" :key="idx" class="cart-item">
            <div class="d-flex justify-content-between">
              <div><strong>{{ it.quantity }}x</strong> {{ it.name }}</div>
              <div>R$ {{ (it.price*it.quantity).toFixed(2) }}</div>
            </div>
            <div v-if="it.options && it.options.length" class="small text-muted ms-2">
              <div v-for="(o,i2) in it.options" :key="i2">- {{ o.name }} (R$ {{ Number(o.price||0).toFixed(2) }})</div>
            </div>
            <div class="small d-flex gap-2 mt-1">
              <button class="btn btn-sm btn-outline-secondary" @click="it.quantity++; recalc()">+1</button>
              <button class="btn btn-sm btn-outline-secondary" @click="decQty(it)">-1</button>
              <button class="btn btn-sm btn-outline-secondary" @click="editItem(idx)">Editar</button>
              <button class="btn btn-sm btn-outline-danger" @click="removeItem(idx)">Remover</button>
            </div>
          </div>
          <div class="mt-3 d-flex justify-content-between">
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
                  <h6 class="fw-semibold m-0">{{ activeProduct?.name }} <span class="text-muted small">R$ {{ Number(activeProduct?.price||0).toFixed(2) }}</span></h6>
                  <div class="small text-muted">{{ activeProduct?.description }}</div>
                </div>
                <button class="btn btn-sm btn-outline-secondary d-sm-none" @click="closeOptions" aria-label="Fechar">✕</button>
              </div>

              <div class="mb-3">
                <label class="form-label small">Quantidade</label>
                <input type="number" min="1" v-model.number="optionQty" class="form-control" />
              </div>

                <div class="options-scroll" style="max-height:320px; overflow:auto;">
                <div v-if="activeProduct?.optionGroups?.length">
                  <div class="small fw-semibold mb-2">Opcionais</div>
                  <div v-for="g in activeProduct.optionGroups" :key="g.id" :id="'grp-'+g.id" class="mb-3">
                    <div class="d-flex align-items-center justify-content-between mb-1">
                      <div class="small text-muted">{{ g.name }}</div>
                      <div v-if="requiredWarnings[g.id]" class="badge bg-danger ms-2">OBRIGATÓRIO</div>
                    </div>
                      <div>
                        <template v-if="g.max === 1">
                          <div v-for="opt in g.options" :key="opt.id" class="mb-2">
                            <div class="d-flex justify-content-between align-items-center option-row">
                              <div class="d-flex align-items-center gap-2 option-left">
                                <div class="option-meta">
                                  <div class="option-name">{{ opt.name }}</div>
                                  <div class="small text-muted option-price">{{ Number(opt.price) > 0 ? formatCurrency(opt.price) : 'Grátis' }}</div>
                                </div>
                              </div>
                              <div style="min-width:96px;display:flex;justify-content:flex-end;align-items:center">
                                <input type="radio" :name="'grp-'+g.id" :id="'opt_'+g.id+'_'+opt.id" class="form-check-input" :checked="isOptionSelected(opt)" @change="selectRadio(g,opt)" />
                              </div>
                            </div>
                          </div>
                        </template>
                        <template v-else>
                          <div v-for="opt in g.options" :key="opt.id" class="mb-2">
                            <div class="d-flex justify-content-between align-items-center option-row">
                              <div class="d-flex align-items-center gap-2 option-left">
                                <div class="option-meta">
                                  <div class="option-name">{{ opt.name }}</div>
                                  <div class="small text-muted option-price">{{ Number(opt.price) > 0 ? formatCurrency(opt.price) : 'Grátis' }}</div>
                                </div>
                              </div>
                              <div style="min-width:120px;display:flex;justify-content:flex-end;align-items:center" >
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
                      <div>{{ opt.name }} <span class="text-muted">(R$ {{ Number(opt.price||0).toFixed(2) }})</span></div>
                      <div>
                        <button class="btn btn-sm btn-outline-danger" @click.prevent="removeChosenOption(oi)">Remover</button>
                      </div>
                    </li>
                  </ul>
                </div>
              </div>

              
            </div>

            <div class="pos-options-footer mt-3 d-flex justify-content-between align-items-center">
              <div class="fw-semibold">Total: R$ {{ optionModalTotal.toFixed(2) }}</div>
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
        <div class="mb-2">
          <label class="form-label small">Forma</label>
          <select v-model="paymentMethodCode" class="form-select">
            <option v-for="pm in paymentMethods" :key="pm.id" :value="pm.code || pm.name">{{ pm.name }}</option>
          </select>
        </div>
        <div v-if="isCashPayment" class="mb-2">
          <label class="form-label small">Troco para (opcional)</label>
          <input v-model.number="changeFor" type="number" class="form-control" placeholder="Ex: 100" />
        </div>
        <div class="alert alert-light small">Total: <strong>R$ {{ totalWithDelivery.toFixed(2) }}</strong> (Entrega: R$ {{ deliveryFee.toFixed(2) }})</div>
        <div class="d-flex justify-content-between mt-3">
          <button class="btn btn-outline-secondary" @click="prev">Voltar</button>
          <button class="btn btn-success" :disabled="!paymentMethodCode" @click="finalize">Concluir pedido</button>
        </div>
        <div v-if="finalizing" class="small mt-2">Salvando...</div>
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
import { ref, computed, watch, nextTick } from 'vue';
import api from '../api';
import { useAuthStore } from '../stores/auth';

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
  return null;
}
function formatCurrency(v){
  try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)); }catch(e){ return 'R$ ' + (Number(v||0).toFixed(2)); }
}
const props = defineProps({ 
  visible: { type: Boolean, default: false },
  initialPhone: { type: String, default: '' },
  preset: { type: Object, default: null }
});
const emit = defineEmits(['update:visible','created']);

const step = ref(1);
const phoneInput = ref('');
const foundCustomer = ref(null);
const customerNotFound = ref(false);
const customerSearchLoading = ref(false);
const newCustomerName = ref('');
const orderType = ref('BALCAO');
const addr = ref({ street:'', number:'', neighborhood:'', city:'', complement:'', formatted:'' });

const menuLoading = ref(false);
const allProducts = ref([]);
const stores = ref([]);
const storesLoading = ref(false);
const selectedStoreId = ref(null);
const paymentMethods = ref([]);
const cart = ref([]);
const paymentMethodCode = ref('');
const changeFor = ref(null);
const finalizing = ref(false);
const createdOrderDisplay = ref('');

const showOptions = ref(false);
const activeProduct = ref(null);
const optionQty = ref(1);
const chosenOptions = ref([]);
const editingIndex = ref(null);
const requiredWarnings = ref({});
const optionsBodyRef = ref(null);
const neighborhoods = ref([]);
const neighborhoodsLoading = ref(false);
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
function searchCustomer(){
  if(!phoneDigits.value) return;
  customerSearchLoading.value = true;
  foundCustomer.value = null; customerNotFound.value = false;
  console.log('Buscando cliente com telefone:', phoneDigits.value);
  api.get(`/customers?q=${encodeURIComponent(phoneDigits.value)}`).then(r=>{
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
      foundCustomer.value = match; 
      newCustomerName.value = match.fullName; 
      orderType.value='BALCAO';
      // Carrega endereços salvos do cliente
      savedAddresses.value = match.addresses || [];
      console.log('Endereços do cliente:', savedAddresses.value);
    }
    else { customerNotFound.value = true; }
  }).catch(e=>{ console.error('Erro na busca:', e); customerNotFound.value = true; }).finally(()=> customerSearchLoading.value=false);
}

function selectSavedAddress(address){
  console.log('Endereço selecionado:', address);
  // Extrai dados do endereço (pode estar em formatted ou campos separados)
  let street = address.street || '';
  let number = address.number || '';
  let neighborhood = address.neighborhood || '';
  let city = address.city || '';
  let complement = address.complement || '';
  
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
    city: city || 'Aracaju', // Default city se não tiver
    complement,
    formatted: address.formatted || ''
  };
  showNewAddressForm.value = false;
  console.log('Campos preenchidos:', addr.value);
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

function selectProduct(p){ activeProduct.value = p; showOptions.value = true; optionQty.value=1; chosenOptions.value=[]; }
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
const optionModalTotal = computed(()=> {
  const unitPrice = Number(activeProduct.value?.price||0) || 0;
  const optsPerUnit = chosenOptions.value.reduce((s,o)=> s + (Number(o.price||0) * (Number(o.quantity||1) || 1)),0);
  return (unitPrice + optsPerUnit) * (Number(optionQty.value) || 1);
});
// ensure editingIndex cleared when closing options without saving
function closeOptions(){ showOptions.value=false; editingIndex.value = null; requiredWarnings.value = {}; }
function confirmOptionsAdd(){
  if(!activeProduct.value) return;
  // validate required groups before adding
  if(!validateOptionGroups()) return;
  const payload = { name: activeProduct.value.name, quantity: optionQty.value, price: Number(activeProduct.value.price||0), productId: activeProduct.value?.id || null, options: chosenOptions.value.map(o=>({ id: o.id, name: o.name, price: Number(o.price||0), quantity: Number(o.quantity||1) })) };
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

const subtotal = computed(()=> cart.value.reduce((s,it)=> s + (Number(it.price||0)*Number(it.quantity||1) + (it.options||[]).reduce((so,o)=> so + (Number(o.price||0) * (Number(o.quantity||1) || 1)),0)),0));
const deliveryFee = computed(()=> orderType.value==='DELIVERY' ? estimateDeliveryFee() : 0);
const matchedNeighborhood = computed(()=>{
  if(orderType.value!=='DELIVERY') return null;
  const name = (addr.value.neighborhood||'').trim().toLowerCase();
  if(!name) return null;
  return neighborhoods.value.find(n => n.name.trim().toLowerCase() === name) || null;
});
function estimateDeliveryFee(){ return matchedNeighborhood.value ? Number(matchedNeighborhood.value.deliveryFee||0) : 0; }
const totalWithDelivery = computed(()=> subtotal.value + deliveryFee.value);

const isCashPayment = computed(()=> {
  if(!paymentMethodCode.value) return false;
  const pm = paymentMethods.value.find(m => (m.code || m.name) === paymentMethodCode.value);
  if(!pm) return false;
  const code = (pm.code || '').toUpperCase();
  const name = (pm.name || '').toLowerCase();
  return code === 'CASH' || /dinheiro/.test(name);
});
watch(paymentMethodCode, ()=> { if(!isCashPayment.value) changeFor.value = null; });

async function loadMenu(){
  if(menuLoading.value) return; menuLoading.value=true;
  try {
    const companyId = await resolveCompanyId();
    if(!companyId){ console.warn('PDV: companyId não encontrado'); return; }
    console.log('Carregando menu para companyId:', companyId);
    const { data } = await api.get(`/public/${companyId}/menu`);
    // merge categories + uncategorized
    const rawCats = data.categories || [];
    // filtra categorias e produtos inativos para evitar lixo no PDV
    const catsFiltered = rawCats.map(c => ({ ...c, products: (c.products||[]).filter(p => p.isActive !== false) })).filter(c => c.isActive !== false);
    const uncategorizedFiltered = (data.uncategorized || []).filter(p => p.isActive !== false);
    const cats = [...catsFiltered, { id:'uncat', name:'Outros', products: uncategorizedFiltered }];
    // each product ensure price property (fallback to first option price or 0)
    cats.forEach(c=> c.products.forEach(p=> { if(p.price==null) p.price = Number(p.basePrice||0); }));
    allProducts.value = cats;
    paymentMethods.value = data.company?.paymentMethods || [];
    // ensure stores are loaded so the user can assign a store before finalizing
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

async function loadNeighborhoods(){
  if(neighborhoodsLoading.value) return; neighborhoodsLoading.value=true;
  try {
    const companyId = await resolveCompanyId();
    if(!companyId){ console.warn('PDV: companyId não encontrado (bairros)'); return; }
    const { data } = await api.get(`/public/${companyId}/neighborhoods`);
    neighborhoods.value = Array.isArray(data) ? data : [];
    console.log('Bairros carregados:', neighborhoods.value);
  } catch(e){ console.error('Falha ao carregar bairros públicos para PDV', e); }
  finally{ neighborhoodsLoading.value=false; }
}

async function finalize(){
  finalizing.value = true;
  try {
    const itemsPayload = cart.value.map(it => ({ name: it.name, quantity: it.quantity, price: it.price, notes: it.notes||null, options: it.options||null }));
    // Para pedido balcão sem identificação, usa nome genérico
    const customerNameFinal = newCustomerName.value.trim() || (orderType.value === 'BALCAO' ? 'Cliente Balcão' : '');
    const body = { customerName: customerNameFinal, customerPhone: phoneDigits.value || null, orderType: orderType.value, address: orderType.value==='DELIVERY' ? addr.value : null, items: itemsPayload, payment: { methodCode: paymentMethodCode.value, amount: totalWithDelivery.value, changeFor: changeFor.value }, storeId: selectedStoreId.value };
    const { data } = await api.post('/orders', body);
    createdOrderDisplay.value = data.displaySimple || data.displayId || data.id?.slice(0,6) || '—';
    step.value = 5;
    emit('created', data);
  } catch(e){ console.error('Falha ao criar pedido PDV', e); }
  finally{ finalizing.value=false; }
}
function resetWizard(){ 
  step.value=1; 
  cart.value=[]; 
  foundCustomer.value=null; 
  customerNotFound.value=false; 
  newCustomerName.value=''; 
  paymentMethodCode.value=''; 
  changeFor.value=null;
  phoneInput.value = '';
}

watch(()=>props.visible, async (v)=>{ 
  if(v){ 
    resetWizard();
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


</script>

<style scoped>
.pos-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; justify-content:center; align-items:flex-start; padding:40px 20px; z-index:1050; overflow:auto; }
.pos-panel{ background:#fff; width:100%; max-width:760px; border-radius:14px; padding:20px 22px; box-shadow:0 6px 18px rgba(0,0,0,.15); }
.menu-scroll{ max-height:260px; overflow:auto; border:1px solid #eee; padding:8px 10px; border-radius:8px; }
.cart-box{ background:#f9fafb; border:1px solid #eceff3; border-radius:12px; padding:12px 14px; }
.cart-item{ border-bottom:1px solid #eceff3; padding:6px 0; }
.cart-item:last-child{ border-bottom:none; }
.pos-options-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; justify-content:center; align-items:center; z-index:1100; }
.pos-options-panel{ background:#fff; width:100%; max-width:520px; padding:18px 20px; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,.2); display:flex; flex-direction:column; }
.pos-options-panel .pos-options-body{  max-height: calc(80vh - 140px); }
.pos-options-panel .options-scroll{ padding-right:6px; padding-bottom:18px; overscroll-behavior:contain; }
.pos-options-panel .pos-options-body{ position:relative; }
.pos-options-panel .pos-options-footer{ flex:0 0 auto; }
.option-meta .small {
  font-weight: 300;
  font-size: 0.775rem;
  font-style: italic;
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

/* Highlight for required groups when validation fails (removed) */
.option-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  font-weight: bold;
}
/* .products-step estilos específicos podem ser adicionados futuramente */
</style>
