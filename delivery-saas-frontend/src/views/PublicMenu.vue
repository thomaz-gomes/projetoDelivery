<template>
  <div class="container-fluid px-0">
    <!-- Hero banner -->
  <div class="public-hero position-relative text-white" style="height:220px;overflow:hidden" ref="heroRef">
      <div class="hero-image" :style="{ backgroundImage: 'url(' + (company?.banner || '/public/default-banner.jpg') + ')' , backgroundSize: 'cover', backgroundPosition: 'center', filter: 'brightness(0.6)'}" style="position:absolute;inset:0"></div>
     
    </div>
    <!-- migration toast: shown when persisted cart was reconciled and items/options were removed -->
    <div v-if="showCartMigration" class="migration-toast" role="status" aria-live="polite">
      <strong>Atualização do carrinho:</strong>
      <div class="mt-1">Itens removidos/ajustados: {{ migrationSummary.join(', ') }}</div>
    </div>

    <!-- Overlapping white panel with company info, delivery toggle and calc box -->
    <div class="hero-panel container">
      <div class="d-flex align-items-start justify-content-between gap-3">
        <div class="d-flex align-items-start gap-3">
          <div class="company-logo-wrapper d-flex d-md-none d-lg-flex align-items-center justify-content-center">
            <img :src="company?.logo || '/default-logo.svg'" alt="logo" class="company-logo" />
          </div>
          <div>
            <h3 class="mb-1 company-name">{{ company?.name || 'Cardápio' }}</h3>
            <div class="small company-address text-muted">{{ company?.pickupInfo || company?.address || '' }}</div>
            <div class="small mt-1"><a href="#" class="text-muted">Mais informações</a></div>
            <div class="store-closed-panel mt-2"><strong>Loja Fechada no momento, abre hoje às {{ company?.opensAt || '10:30' }}</strong></div>
          </div>
        </div>
        <div class="d-flex align-items-start">
          <button class="btn btn-light-outline delivery-pickup-btn" @click.prevent="toggleOrderType">Entrega e Retirada</button>
        </div>
      </div>
      
    </div>
    <!-- Mobile compact cart bar (visible on small screens) -->
  <div v-if="cart.length > 0 && !cartModalOpen && !modalOpen" class="mobile-cart-bar d-lg-none d-flex justify-content-between align-items-center px-3 py-2" style="background:#fff; border-top:1px solid rgba(0,0,0,0.06); z-index:1070">
      <div>
        <strong>{{ formatCurrency(subtotal) }}</strong> / {{ cart.length }} item{{ cart.length>1 ? 's' : '' }}
        <div class="small text-muted">Total sem entrega</div>
      </div>
      <div>
        <button class="btn btn-primary" @click="openCartModal">Ver carrinho</button>
      </div>
    </div>

  <!-- Mobile bottom navigation (fixed) -->
  <nav class="mobile-bottom-nav d-lg-none" v-show="!modalOpen">
      <button class="nav-item" @click.prevent="goProfile" aria-label="Perfil">
        <i class="bi bi-person nav-icon" aria-hidden="true"></i>
        <div class="nav-label">Perfil</div>
      </button>
      <button class="nav-item" @click.prevent="goOrders" aria-label="Histórico de pedidos">
        <i class="bi bi-journal-text nav-icon" aria-hidden="true"></i>
        <div class="nav-label">Histórico</div>
      </button>
      <button class="nav-item" @click.prevent="openCartModal" aria-label="Carrinho">
        <div style="position:relative;display:inline-flex;align-items:center;">
          <i class="bi bi-cart-fill nav-icon" aria-hidden="true"></i>
          <span v-if="cart.length>0" class="cart-badge">{{ cart.length }}</span>
        </div>
        <div class="nav-label">Carrinho</div>
      </button>
    </nav>

    <div class="hero-panel mt-4 container py-4">

      <div v-if="loading" class="text-center py-5">
        <div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>
      </div>

      <div v-else>
      <!-- unified category pills (mobile + desktop) -->
      <div v-if="categories.length" class="mt-3">
        <ul ref="navRef" class="nav nav-pills overflow-auto" :class="{ stuck: isNavSticky }" style="gap:8px">
          <li class="nav-item" v-for="(cat, idx) in categories" :key="cat.id">
            <a :href="`#cat-${cat.id}`" class="nav-link" :class="{ active: activeCategoryId === (cat.id) }" @click.prevent="selectCategory(cat.id)">{{ cat.name }}</a>
          </li>
          <li class="nav-item">
            <a href="#products-start" class="nav-link" :class="{ active: activeCategoryId === null }" @click.prevent="selectCategory(null)">Todos</a>
          </li>
        </ul>
      </div>
        <div class="row">
        
          <div :class="cart.length > 0 ? 'col-12' : 'col-sm-12'">
            <!-- products list: category sections -->
            <div id="products-start"></div>
            <div v-for="cat in visibleCategories" :key="cat.id" :id="`cat-${cat.id}`" class="mb-4">
              <h5 class="mb-3">{{ cat.name }}</h5>
              <div class="row gx-3 gy-3">
                <div class="col-12 col-lg-6" v-for="p in cat.products" :key="p.id">
                  <div class="product-card d-flex justify-content-between align-items-start p-3" @click="openProductModal(p, true)" tabindex="0" @keydown.enter="openProductModal(p, true)">
                    <div class="product-card-body">
                      <h6 class="mb-1 product-title">{{ p.name }}</h6>
                      <div class="small text-muted product-desc">{{ p.description }}</div>
                      <div class="d-flex align-items-center gap-3">
                        <strong class="product-price">{{ formatCurrency(p.price) }}</strong>
                
                      </div>
                    </div>
                    <div class="product-card-media text-end">
                      <div>
                        <img v-if="p.image" :src="p.image" class="product-image" />
                        <div v-else class="bg-light product-image-placeholder"></div>
                      </div>
                      <div v-if="p.cashback" class="badge bg-success mt-2">{{ p.cashback }}% cashback</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- uncategorized products intentionally hidden from public menu -->
          </div>

          <!-- sidebar removed on purpose: cart is accessed via bottom bar/modal -->
        </div>

        <!-- mobile compact cart removed (we show a mobile cart bar above the bottom nav) -->

        <!-- desktop sticky bottom cart bar when there are items -->
  <div v-if="cart.length > 0 && !cartModalOpen" class="desktop-cart-bar d-none d-lg-flex justify-content-between align-items-center">
          <div class="cart-info">
            <strong>{{ formatCurrency(subtotal) }}</strong>
            <div class="small text-muted">/ {{ cart.length }} item{{ cart.length>1 ? 's' : '' }}</div>
          </div>
          <div class="cart-action">
            <button class="btn btn-advance" @click="openCartModal">Ver carrinho</button>
          </div>
        </div>
        
        <!-- Product options modal -->
        <div v-if="modalOpen" class="product-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:11000">
          <div class="modal-content bg-white rounded shadow p-0">
            <div class="modal-body p-4" ref="modalContentRef" @pointerdown="onPointerDown" style="overflow:auto;max-height:95vh;">
          <div class="row">
              <!-- product image hero inside modal -->
              <div class="col-12 col-sm-6">
                  <div v-if="selectedProduct?.image" class="modal-product-hero mb-3 position-relative">
                    <img :src="selectedProduct.image" alt="Imagem do produto" class="modal-product-img" />
                  <div class="hero-down">▾</div>
                  </div>
                  <div>
                  <h5 class="mb-1">{{ selectedProduct?.name }}</h5>
                  <div class="small text-muted">{{ selectedProduct?.description }}</div>
                </div>
              </div>
              <div class="col-12 col-sm-6 modal-options-scroll">
              <div class="d-flex justify-content-between align-items-start mb-3">
                    <!-- close control overlapping hero -->
              <button class="modal-share-mobile modal-close-mobile d-flex d-sm-none" @click="closeModal" aria-label="Fechar">✕</button>
                <div class="d-flex justify-content-between gap-4 w-100">
                   <input v-model="searchTerm" class="form-control" placeholder="Pesquise pelo nome" />
                  <button class="btn btn-sm btn-outline-secondary close-x d-none d-sm-flex" aria-label="Fechar" @click="closeModal">×</button>
                </div>
              </div>
                

              <div v-if="selectedProduct?.optionGroups && selectedProduct.optionGroups.length">
                <div v-for="g in selectedProduct.optionGroups" :key="g.id" :id="'grp-'+g.id" :class="['mb-3', requiredWarnings[g.id] ? 'required-fail' : '']">
                  <div class="d-flex justify-content-between align-items-center mb-2 group-header">
                    <div>
                      <strong>{{ g.name }}</strong>
                      <div class="small" :class="requiredWarnings[g.id] ? 'text-danger' : 'text-muted'">
                        <template v-if="requiredWarnings[g.id]">
                          {{ requiredMessages[g.id] || ('Escolha ' + (g.min || 0) + ' opções') }}
                        </template>
                        <template v-else>
                          Escolha entre {{ g.min || 0 }} a {{ g.max || '∞' }} itens
                        </template>
                      </div>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                      <span v-if="groupSelectedCount(g) > 0" class="badge bg-primary">Selecionado</span>
                      <template v-else-if="(g.min || 0) > 0">
                        <span :class="['badge', requiredWarnings[g.id] ? 'bg-danger' : 'bg-secondary']">OBRIGATÓRIO</span>
                        <span :class="['badge', requiredWarnings[g.id] ? 'bg-danger' : 'bg-secondary']">{{ groupSelectedCount(g) }} / {{ g.min || 0 }}</span>
                      </template>
                    </div>
                  </div>

                  <div>
                    <template v-if="g.max === 1 && (g.min || 0) > 0">
                      <div v-for="opt in filterOptions(g)" :key="opt.id" class="mb-2">
                        <div class="d-flex justify-content-between align-items-center" style="padding: 0px 16px;font-size: 14px;">
                          <div class="d-flex align-items-center gap-2" >
                            <img v-if="opt.image" :src="opt.image" style="width:40px;height:40px;object-fit:cover;border-radius:6px" />
                            <div>
                              <div>{{ opt.name }}</div>
                              <div class="small text-muted">{{ Number(opt.price) > 0 ? '' + formatCurrency(opt.price) : 'Grátis' }}</div>
                              <small v-if="opt.isAvailable === false" class="text-danger">Indisponível</small>
                            </div>
                          </div>
                          <div>
                            <input class="form-check-input" type="radio" :name="'grp-'+g.id" :id="'opt-'+opt.id" :checked="isOptionSelected(g,opt)" @change="selectRadio(g,opt)" :disabled="opt.isAvailable === false" :required="(g.min||0) > 0">
                          </div>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <div v-for="opt in filterOptions(g)" :key="opt.id" class="mb-2">
                        <div class="d-flex justify-content-between align-items-center" style="padding: 0px 16px;font-size: 14px;">
                          <div class="d-flex align-items-center gap-2 option-left">
                            <img v-if="opt.image" :src="opt.image" class="option-thumb" />
                            <div class="option-meta">
                              <div class="option-name">{{ opt.name }}</div>
                              <div class="small text-muted option-price">{{ Number(opt.price) > 0 ? formatCurrency(opt.price) : 'Grátis' }}</div>
                            </div>
                          </div>
                          <div style="min-width:96px;display:flex;justify-content:flex-end;align-items:center" >
                            <div v-if="qtyFor(g.id,opt.id) === 0">
                              <button class="btn btn-sm btn-primary" @pointerdown.prevent="startAutoChange(g,opt,1,$event)" @pointerup.prevent="stopAutoChange(g,opt,$event)" @pointerleave.prevent="stopAutoChange(g,opt,$event)">+</button>
                            </div>
                            <div v-else class="d-flex align-items-center gap-2">
                              <button class="btn btn-sm btn-outline-secondary" @pointerdown.prevent="startAutoChange(g,opt,-1,$event)" @pointerup.prevent="stopAutoChange(g,opt,$event)" @pointerleave.prevent="stopAutoChange(g,opt,$event)">-</button>
                              <div class="fw-bold">{{ qtyFor(g.id,opt.id) }}</div>
                              <button class="btn btn-sm btn-primary" @pointerdown.prevent="startAutoChange(g,opt,1,$event)" @pointerup.prevent="stopAutoChange(g,opt,$event)" @pointerleave.prevent="stopAutoChange(g,opt,$event)">+</button>
                            </div>
                          </div>
                        </div>
                        <div v-if="tipMessages[`${g.id}:${opt.id}`]" class="small text-danger mt-1">{{ tipMessages[`${g.id}:${opt.id}`] }}</div>
                      </div>
                    </template>
                    </div>
                  </div>
                </div>
              
              <div class="modal-footer">
                <div>
              <div v-if="modalError" class="alert alert-danger mt-3">{{ modalError }}</div>
              </div>
              <div class="d-flex justify-content-between align-items-center modal-actions-footer gap-4 w-100">
                <div class="d-flex align-items-center gap-2 qty-control">
                  <button class="btn btn-outline-secondary btn-qty" @pointerdown.prevent="startModalAutoChange(-1, $event)" @pointerup.prevent="stopModalAutoChange($event)" @pointerleave.prevent="stopModalAutoChange($event)">-</button>
                  <input type="number" v-model.number="modalQty" class="form-control text-center qty-input" style="width:80px" min="1" @blur="modalQty = Math.max(1, Math.floor(Number(modalQty) || 1))" />
                  <button class="btn btn-outline-secondary btn-qty" @pointerdown.prevent="startModalAutoChange(1, $event)" @pointerup.prevent="stopModalAutoChange($event)" @pointerleave.prevent="stopModalAutoChange($event)">+</button>
                </div>
                <div>
                  <button class="add-btn" @click="confirmAddFromModal" :style="{ '--accent': company?.primaryColor || '#0d6efd' }" aria-label="Adicionar ao carrinho">
                    <span class="add-label">Adicionar</span>
                    <span class="add-price">{{ formatCurrency(modalTotal) }}</span>
                  </button>
                </div>
              </div>
            </div>
              </div>
            </div>

            
          </div>
        </div>
        </div>

        <!-- Cart view: unified drawer is used for all screen sizes (replaces the old centered mobile modal) -->

  <!-- Unified slide-in drawer (used on desktop and mobile) -->
  <div class="drawer-backdrop" v-if="cartModalOpen && cart.length > 0" @click="closeCartModal"></div>
  <aside class="cart-drawer" :class="{ open: cartModalOpen && cart.length > 0 }" aria-hidden="!cartModalOpen" role="dialog" aria-label="Carrinho">
          <div class="drawer-header d-flex justify-content-between align-items-center p-3 border-bottom">
            <h5 class="m-0">Sua sacola</h5>
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-sm btn-outline-secondary close-x" @click="closeCartModal" aria-label="Fechar">&times;</button>
            </div>
          </div>
          <div class="drawer-body p-3" style="overflow:auto;">
            <div v-if="cart.length===0" class="text-muted">Sua sacola está vazia.</div>
            <ul v-else class="list-group mb-3">
              <li class="list-group-item py-3" v-for="(it, i) in cart" :key="it.lineId">
                <div class="d-flex align-items-start gap-3">
                  <div style="flex:1">
                    <div class="d-flex justify-content-between align-items-start">
                      <div>
                        <div><strong>{{ it.quantity }}x {{ it.name }}</strong></div>
                        <div v-if="it.options && it.options.length" class="small text-muted mt-1">
                          <div v-for="(opt, oi) in it.options" :key="opt.id || oi" class="option-line">
                            <div class="option-name">
                              {{ opt.name }} — <span class="option-unit">{{ formatCurrency(Number(opt.price || 0)) }}</span>
                              <span v-if="Number(it.quantity || 1) > 1" class="text-muted"> (x{{ it.quantity }} = {{ formatCurrency(Number(opt.price || 0) * Number(it.quantity || 1)) }})</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div class="text-end">
                        <div class="fw-bold">{{ formatCurrency(it.price * it.quantity) }}</div>
                      </div>
                    </div>
                    <div class="mt-2">
                      <button class="btn btn-link p-0 me-3 text-danger" @click="editCartItem(i)">Editar</button>
                      <button class="btn btn-link p-0 text-muted" @click="removeItem(i)">Remover</button>
                    </div>
                  </div>
                  <div style="width:84px;flex-shrink:0">
                    <img v-if="it.image || (it.options && it.options[0] && it.options[0].image)" :src="it.image || (it.options && it.options[0] && it.options[0].image)" class="cart-thumb" />
                  </div>
                </div>
              </li>
            </ul>

            <!-- summary and coupon area -->
            <div class="cart-summary p-3 border-top">
                        <div class="d-flex justify-content-between mb-2"><div>Subtotal</div><div>{{ formatCurrency(subtotal) }}</div></div>
                        <div class="d-flex justify-content-between mb-2"><div>Taxa de entrega</div><div>{{ formatCurrency(deliveryFee) }}</div></div>
                        <hr />
                        <div class="d-flex justify-content-between fw-bold mb-2"><div>Total</div><div>{{ formatCurrency(subtotal + deliveryFee) }}</div></div>

              <div class="coupon-block mt-3">
                <div class="d-flex justify-content-between align-items-center">
                  <div class="small">Tem um cupom? Clique e insira o código</div>
                  <button class="btn btn-sm btn-outline-secondary" @click="openCoupon = !openCoupon">›</button>
                </div>
                <div v-show="openCoupon" class="mt-2">
                  <div class="input-group">
                    <input v-model="couponCode" class="form-control" placeholder="Código do cupom" />
                    <button class="btn btn-primary" @click="applyCoupon">Aplicar</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="drawer-footer p-3 border-top d-flex justify-content-end align-items-center">
            <div class="d-flex flex-column gap-2 w-100">
              <button class="btn btn-outline-secondary w-100" @click="closeCartModal">Continuar comprando</button>
              <button class="btn btn-primary d-flex align-items-center w-100" style="justify-content: space-between;align-items: center;" :disabled="cart.length===0 || submitting || !isOpen" @click="proceedFromCart">
                <div class="d-flex flex-column align-items-end me-3" >
                  <strong>{{ formatCurrency(subtotal) }}</strong>
                  <small class="text-white">{{ cart.length }} item{{ cart.length>1 ? 's' : '' }}</small>
                </div>
                <span>Avançar</span>
              </button>
            </div>
          </div>
        </aside>
        
        <!-- Multi-step checkout modal -->
  <div v-if="checkoutModalOpen" class="product-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:11000">
          <div class="bg-white rounded shadow p-4" style="width:720px;max-width:96%;max-height:90vh;overflow:auto">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="m-0">Checkout — {{ checkoutStep }}</h5>
              <div><button class="btn btn-sm btn-outline-secondary close-x" @click="closeCheckout" aria-label="Fechar">&times;</button></div>
            </div>

            <div v-if="checkoutStep === 'customer'">
              <div class="mb-2"><label class="form-label">Nome</label><input v-model="customer.name" class="form-control" /></div>
              <div class="mb-2"><label class="form-label">WhatsApp / Telefone</label><input v-model="customer.contact" class="form-control" /></div>
              <div class="d-flex justify-content-end gap-2">
                <button class="btn btn-secondary" @click="closeCheckout">Cancelar</button>
                <button class="btn btn-primary" @click="nextFromCustomer">Próximo</button>
              </div>
            </div>

            <div v-if="checkoutStep === 'delivery'">
              <div class="mb-2">
                <div class="form-check form-check-inline">
                  <input class="form-check-input" type="radio" id="modalOrderTypeDelivery" value="DELIVERY" v-model="orderType">
                  <label class="form-check-label" for="modalOrderTypeDelivery">Entrega</label>
                </div>
                <div class="form-check form-check-inline">
                  <input class="form-check-input" type="radio" id="modalOrderTypePickup" value="PICKUP" v-model="orderType">
                  <label class="form-check-label" for="modalOrderTypePickup">Retirada</label>
                </div>
              </div>

              <div v-if="orderType === 'DELIVERY'">
                <!-- No saved addresses: show the inline address form so the user can
                     enter an address and continue without having to persist it. -->
                <div v-if="addresses.length === 0">
                  <div class="mb-3 border p-2">
                    <h6 class="mb-2">Endereço</h6>
                    <div class="mb-2"><input v-model="_newAddrFormatted" placeholder="Endereço completo" class="form-control" /></div>
                      <div class="mb-2">
                        <label class="form-label small">Bairro</label>
                        <select v-model="_newAddrNeighborhood" class="form-select">
                          <option value="" disabled>Escolha um bairro...</option>
                          <option v-for="n in neighborhoodsList" :key="n.id" :value="n.name">{{ n.name }} — {{ formatCurrency(n.deliveryFee) }}</option>
                        </select>
                      </div>
                      <div class="mb-2"><input v-model="_newAddrReference" placeholder="Referência (ex: Apt 4, próximo ao mercado)" class="form-control" /></div>
                    <!-- Buttons removed: advancing will save and proceed; clear removed per UX request -->
                  </div>
                  <div class="mt-2">
                    <button class="btn btn-sm btn-outline-primary" @click="useMyLocation" :disabled="_locating">{{ _locating ? 'Localizando...' : 'Usar minha localização' }}</button>
                  </div>
                </div>

                <!-- User has saved addresses: show selector + small shortcut to reveal the "new address" form -->
                <div v-else>
                  <ul class="list-group mb-2">
                    <li class="list-group-item d-flex justify-content-between align-items-center" v-for="a in addresses" :key="a.id">
                      <div>
                        <div><strong>{{ a.label || a.formattedAddress }}</strong></div>
                        <div class="small text-muted" :title="a.fullDisplay || a.formattedAddress">{{ a.formattedAddress }} — {{ a.neighborhood }}</div>
                      </div>
                      <div class="d-flex align-items-center gap-2">
                        <input type="radio" :value="a.id" v-model="selectedAddressId" />
                        <button class="btn btn-sm btn-outline-secondary" @click="editAddress(a.id)">Editar</button>
                        <button class="btn btn-sm btn-outline-danger" @click="removeAddress(a.id)">Remover</button>
                      </div>
                    </li>
                  </ul>

                  <div class="small mb-2"><a href="#" @click.prevent="showNewAddressForm = !showNewAddressForm">Cadastrar novo endereço</a></div>

                  <div v-if="showNewAddressForm" class="mb-3 border p-2" style="border-radius: 16px;">
                    <h6 class="mb-2">Adicionar novo endereço</h6>
                    <div class="mb-2"><input v-model="_newAddrFormatted" placeholder="Endereço completo" class="form-control" /></div>
                    <div class="mb-2">
                      <label class="form-label small">Bairro</label>
                      <select v-model="_newAddrNeighborhood" class="form-select">
                        <option value="" disabled>Escolha um bairro...</option>
                        <option v-for="n in neighborhoodsList" :key="n.id" :value="n.name">{{ n.name }} — {{ formatCurrency(n.deliveryFee) }}</option>
                      </select>
                    </div>
                    <div class="mb-2"><input v-model="_newAddrReference" placeholder="Referência (ex: Apt 4, próximo ao mercado)" class="form-control" /></div>
                    <div class="d-flex gap-2">
                      <button v-if="!editingAddressId" class="btn btn-sm btn-primary" @click="addNewAddress">Adicionar</button>
                      <button v-else class="btn btn-sm btn-success" @click="saveEditedAddress">Salvar</button>
                      <button v-if="editingAddressId" class="btn btn-sm btn-outline-secondary" @click="cancelEdit">Cancelar</button>
                    </div>
                  </div>

                  <div class="mt-2">
                    <button v-if="showNewAddressForm" class="btn btn-sm btn-outline-primary" @click="useMyLocation" :disabled="_locating">{{ _locating ? 'Localizando...' : 'Usar minha localização' }}</button>
                  </div>
                </div>
                <!-- end else (has addresses) -->
              </div>

              <div class="d-flex justify-content-between mt-3">
                <button class="btn btn-outline-secondary" @click="goToCustomer">Voltar</button>
                <button class="btn btn-primary" @click="nextFromDelivery">Próximo</button>
              </div>
            </div>

            <div v-if="checkoutStep === 'payment'">
              <div class="mb-2"><label class="form-label">Forma de pagamento</label>
                <select v-model="paymentMethod" class="form-select">
                  <option v-for="m in paymentMethods" :key="m.code" :value="m.code">{{ m.name }}</option>
                </select>
              </div>
              <div class="d-flex justify-content-between mt-3">
                <button class="btn btn-outline-secondary" @click="goToDelivery">Voltar</button>
                <button class="btn btn-primary" @click="goToReview">Próximo</button>
              </div>
            </div>

            <div v-if="checkoutStep === 'review'">
              <h6>Resumo</h6>
              <ul class="list-group mb-2">
                <li class="list-group-item" v-for="it in cart" :key="it.lineId">
                  <div class="d-flex justify-content-between align-items-start">
                    <div>
                      <div>{{ it.quantity }} x {{ it.name }}</div>
                      <div v-if="it.options && it.options.length" class="small text-muted mt-1">
                        <div v-for="(opt, oi) in it.options" :key="opt.id || oi" class="option-line">
                          <div class="option-name">
                            {{ opt.name }} — <span class="option-unit">{{ formatCurrency(Number(opt.price || 0)) }}</span>
                            <span v-if="Number(it.quantity || 1) > 1" class="text-muted"> (x{{ it.quantity }} = {{ formatCurrency(Number(opt.price || 0) * Number(it.quantity || 1)) }})</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div class="text-end">{{ formatCurrency(it.price * it.quantity) }}</div>
                  </div>
                </li>
              </ul>
              <div class="checkout-totals mb-2" style="max-width:420px">
                <div class="d-flex justify-content-between"><div class="text-muted">Subtotal</div><div>{{ formatCurrency(subtotal) }}</div></div>
                <div v-if="orderType==='DELIVERY'">
                  <div class="d-flex justify-content-between"><div class="text-muted">Taxa de entrega</div><div>{{ formatCurrency(deliveryFee) }}</div></div>
                  <div class="d-flex justify-content-between fw-bold mt-2"><div>Total</div><div>{{ formatCurrency(subtotal + deliveryFee) }}</div></div>
                </div>
                <div v-else class="d-flex justify-content-between fw-bold mt-2"><div>Total</div><div>{{ formatCurrency(subtotal) }}</div></div>
              </div>
              <div v-if="orderType==='DELIVERY'">
                <div class="mb-2"><strong>Endereço de entrega:</strong></div>
                <div class="small mb-2">{{ (addresses.find(a=>a.id===selectedAddressId) || {}).formattedAddress }} — {{ (addresses.find(a=>a.id===selectedAddressId) || {}).neighborhood }}</div>
                <div class="mb-2"><strong>Pagamento:</strong> {{ (paymentMethods.find(m=>m.code===paymentMethod) || {}).name }}</div>
              </div>
                <div class="d-flex justify-content-between mt-3">
                <button class="btn btn-outline-secondary" @click="backFromReview">Voltar</button>
                <button class="btn btn-success" @click="performOrderFromModal">Confirmar pedido</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, reactive, watch } from 'vue';
import { bindLoading } from '../state/globalLoading.js';
import api from '../api';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const companyId = route.params.companyId || '1';

const loading = ref(true);
bindLoading(loading);
const categories = ref([]);
const uncategorized = ref([]);
const paymentMethods = ref([]);
const company = ref(null)
const orderType = ref('DELIVERY') // 'DELIVERY' or 'PICKUP'

// Sticky categories bar state
const heroRef = ref(null)
const navRef = ref(null)
const isNavSticky = ref(false)
let rafId = null
function handleScroll() {
  try{
    if(!heroRef.value) return
    const navEl = navRef.value || document.querySelector('.nav-pills')
    if(!navEl) return
    const heroRect = heroRef.value.getBoundingClientRect()
    const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
    const shouldStick = heroRect.bottom <= headerH

    if(isNavSticky.value !== shouldStick){
      isNavSticky.value = shouldStick
      if(shouldStick){
        // compute nav position and constrain it to nearest .container (avoid full-width fixed)
        const navRect = navEl.getBoundingClientRect()
        const containerEl = (navEl.closest && navEl.closest('.container')) || document.querySelector('.container') || document.body
        const containerRect = containerEl ? containerEl.getBoundingClientRect() : { left: 0, width: navRect.width }

        // prepare animated entrance using transform (slide down) with tuned easing/duration
        try{
          navEl.style.transition = 'transform 260ms cubic-bezier(.2,.9,.2,1), box-shadow 260ms ease'
          navEl.style.transform = 'translateY(-10px)'
        }catch(e){}
        navEl.style.position = 'fixed'
        navEl.style.top = `${headerH}px`
        // constrain to container left/width so the sticky isn't full-viewport width
        navEl.style.left = `${containerRect.left}px`
        navEl.style.width = `${containerRect.width}px`
        navEl.style.zIndex = '1075'
        // trigger slide-in and subtle shadow
        requestAnimationFrame(()=>{ try{ navEl.style.transform = 'translateY(0)'; navEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)'; }catch(e){} })
      } else {
        // animate slide-out with slightly different easing/delay for extra polish, then restore
        try{ navEl.style.transition = 'transform 220ms cubic-bezier(.4,0,.2,1), box-shadow 180ms ease'; navEl.style.transform = 'translateY(-10px)'; navEl.style.boxShadow = '' }catch(e){}
        setTimeout(()=>{
          try{
            navEl.style.position = ''
            navEl.style.top = ''
            navEl.style.left = ''
            navEl.style.width = ''
            navEl.style.zIndex = ''
            navEl.style.transition = ''
            navEl.style.transform = ''
          }catch(e){}
        }, 260)
      }
    } else {
      // if already sticky, update top/left/width on scroll (handles header resize/resize while pinned)
      if(isNavSticky.value){
        const headerEl2 = document.querySelector('header, .site-header, .navbar, .app-header')
        const headerH2 = headerEl2 ? headerEl2.getBoundingClientRect().height : 0
        // keep pinned width aligned to nearest container if available
        const containerEl2 = (navEl.closest && navEl.closest('.container')) || document.querySelector('.container') || null
        if(containerEl2){
          const containerRect2 = containerEl2.getBoundingClientRect()
          navEl.style.top = `${headerH2}px`
          navEl.style.left = `${containerRect2.left}px`
          navEl.style.width = `${containerRect2.width}px`
        } else {
          const navRect2 = navEl.getBoundingClientRect()
          navEl.style.top = `${headerH2}px`
          navEl.style.left = `${navRect2.left}px`
          navEl.style.width = `${navRect2.width}px`
        }
      }
    }
  }catch(e){ console.warn('handleScroll err', e) }
}

// Integrate scrollspy into handleScroll by calling updateActiveCategory

onMounted(()=>{
  const onScroll = () => {
    if(rafId) cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(()=>{ handleScroll(); updateActiveCategory(); })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  // init
  handleScroll()
  updateActiveCategory()
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    if(rafId) cancelAnimationFrame(rafId)
    // ensure styles cleared
    try{ if(navRef.value){ navRef.value.style.position=''; navRef.value.style.top=''; navRef.value.style.left=''; navRef.value.style.width=''; navRef.value.style.zIndex=''; } }catch(e){}
  })
})

function toggleOrderType(){
  orderType.value = orderType.value === 'DELIVERY' ? 'PICKUP' : 'DELIVERY'
}
// checkout modal state (multi-step)
const checkoutModalOpen = ref(false)
const checkoutStep = ref('customer') // 'customer' | 'delivery' | 'payment' | 'review'
// persist customer and addresses in localStorage for convenience
const LOCAL_CUSTOMER_KEY = `public_customer_${companyId}`
const LOCAL_ADDR_KEY = `public_addresses_${companyId}`
// load persisted customer/address
const addresses = ref(JSON.parse(localStorage.getItem(LOCAL_ADDR_KEY) || '[]'))
const selectedAddressId = ref(addresses.value.length ? addresses.value[0].id : null)

function openCheckout(){
  checkoutModalOpen.value = true
  checkoutStep.value = 'customer'
}
function closeCheckout(){ checkoutModalOpen.value = false }

function saveCustomerToLocal(){
  localStorage.setItem(LOCAL_CUSTOMER_KEY, JSON.stringify({ name: customer.value.name, contact: customer.value.contact }))
}

function addAddress(addr){
  // addr: { label, formattedAddress, neighborhood }
  const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2,8)
  // allow optional latitude/longitude
  const a = { id, ...addr }
  // ensure label is present; default to the formatted address for identification
  try{ a.label = String(a.label || a.formattedAddress || '').trim() }catch(e){ a.label = String(a.formattedAddress || '') }
  addresses.value.push(a)
  selectedAddressId.value = id
  localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value))
}

function removeAddress(id){
  const idx = addresses.value.findIndex(a=>a.id===id)
  if(idx>=0) addresses.value.splice(idx,1)
  if(selectedAddressId.value===id) selectedAddressId.value = addresses.value.length ? addresses.value[0].id : null
  localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value))
}

const activeCategoryId = ref(null)

// update active category based on scroll position (scrollspy)
function updateActiveCategory(){
  try{
    if(!categories.value || !categories.value.length) { activeCategoryId.value = null; return }
    const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
    const offsets = []
    for(const c of categories.value){
      const el = document.getElementById(`cat-${c.id}`)
      if(!el) continue
      const top = el.getBoundingClientRect().top - headerH
      offsets.push({ id: c.id, top })
    }
    if(!offsets.length){ activeCategoryId.value = null; return }
    // determine if we're above the first category
    const firstTop = offsets[0].top
    if(window.scrollY === 0 || firstTop > 80){ activeCategoryId.value = null; return }
    // choose the category whose top is the largest <= 80px (closest to header)
    const candidates = offsets.filter(o => o.top <= 80)
    if(candidates.length){
      candidates.sort((a,b) => b.top - a.top)
      activeCategoryId.value = candidates[0].id
      return
    }
    // fallback: pick the first
    activeCategoryId.value = offsets[0].id
  }catch(e){ console.warn('updateActiveCategory err', e) }
}

const cart = ref([]);
// storage key per company so different menus don't clash
const CART_STORAGE_KEY = `public_cart_${companyId}`
// try to restore cart from localStorage (keep numeric types safe)
try{
  const raw = localStorage.getItem(CART_STORAGE_KEY)
  if(raw){
    const parsed = JSON.parse(raw)
    if(Array.isArray(parsed)){
      // ensure numbers are numbers
      cart.value = parsed.map(item => ({
        lineId: String(item.lineId || _makeLineId()),
        productId: item.productId,
        name: item.name,
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 0),
        options: Array.isArray(item.options) ? item.options.map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0) })) : []
      }))
    }
  }
}catch(e){ console.warn('restore cart from localStorage failed', e) }
const customer = ref({ name: '', contact: '', address: { formattedAddress: '', neighborhood: '' } });
// load persisted customer if any (after customer is defined)
const savedCustomer = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || 'null')
if(savedCustomer) {
  // merge with default shape to ensure nested fields (like address) exist
  customer.value = {
    name: String(savedCustomer.name || ''),
    contact: String(savedCustomer.contact || ''),
    address: (customer.value && customer.value.address) ? { ...customer.value.address } : { formattedAddress: '', neighborhood: '' }
  }
}
const neighborhood = ref('');
// list of neighborhoods (public) for this company
const neighborhoodsList = ref([])

const deliveryFee = computed(() => {
  try{
    const n = (neighborhoodsList.value || []).find(x => String(x.name || '').trim().toLowerCase() === String((neighborhood.value || '')).trim().toLowerCase())
    return Number(n?.deliveryFee || 0)
  }catch(e){ return 0 }
})
const paymentMethod = ref('CASH');
const submitting = ref(false);
const serverError = ref('');
const clientError = ref('');
const orderResponse = ref(null);

const visibleCategories = computed(() => {
  // show all categories — navigation is handled via anchors now
  return categories.value || []
})

// compute if company is open (client-side check)
const isOpen = computed(() => {
  const c = company.value
  if(!c) return true
  if(c.alwaysOpen) return true
  const parseHM = (s) => {
    if(!s) return null
    const parts = String(s).split(':').map(x=>Number(x))
    if(parts.length<2) return null
    const [hh, mm] = parts
    if(Number.isNaN(hh) || Number.isNaN(mm)) return null
    return { hh, mm }
  }
  const from = parseHM(c.openFrom)
  const to = parseHM(c.openTo)
  if(!from || !to) return false

  // compute current time in store timezone if provided using Intl
  let nowParts
  try{
    if(c.timezone){
      const fmt = new Intl.DateTimeFormat(undefined, { timeZone: c.timezone, hour12: false, hour: '2-digit', minute: '2-digit' })
      if(fmt.formatToParts){
        const parts = fmt.formatToParts(new Date())
        const hh = Number(parts.find(p=>p.type==='hour')?.value)
        const mm = Number(parts.find(p=>p.type==='minute')?.value)
        nowParts = { hh, mm }
      } else {
        const str = fmt.format(new Date())
        const [hh, mm] = str.split(':').map(x=>Number(x))
        nowParts = { hh, mm }
      }
    } else {
      const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() }
    }
  }catch(e){
    console.warn('Timezone parse failed on client, falling back to local time', e)
    const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() }
  }

  const toMinutes = (p) => p.hh*60 + p.mm
  const nowM = toMinutes(nowParts)
  const fromM = toMinutes(from)
  const toM = toMinutes(to)
  if(fromM <= toM){
    return nowM >= fromM && nowM <= toM
  }
  return (nowM >= fromM) || (nowM <= toM)
})

const companyHoursText = computed(() => {
  const c = company.value
  if(!c) return ''
  if(c.alwaysOpen) return '24h'
  return `${c.openFrom || '--:--'} — ${c.openTo || '--:--'}`
})

// product options modal state
const modalOpen = ref(false)
const selectedProduct = ref(null)
const modalQty = ref(1)
const optionSelections = ref({}) // map groupId -> Set(optionId)
const modalError = ref('')
const searchTerm = ref('')
// option groups are always expanded — no collapse state needed
const tipMessages = reactive({}) // map key -> message for transient tips
// map groupId -> boolean indicating the group failed validation after an add attempt
const requiredWarnings = reactive({})
// human messages for group warnings (e.g. 'Escolha 2 opções')
const requiredMessages = reactive({})
// auto-change timers for press-and-hold
const _autoTimers = {}

function showTip(key, msg, ms = 1400){
  try{
    tipMessages[key] = msg
    setTimeout(()=>{ try{ delete tipMessages[key] }catch(e){} }, ms)
  }catch(e){ console.error('showTip', e) }
}
// swipe-down-to-close support (mobile)
const modalContentRef = ref(null)
let _dragging = false
let _startY = 0
let _lastY = 0
let _lastTime = 0



function onPointerDown(e){
  try{
    if(window.innerWidth > 767) return
    const el = modalContentRef.value
    if(!el) return
    // only start drag if scrollTop is at the top (so scrolling doesn't conflict)
    if(el.scrollTop > 0) return
    _dragging = true
    _startY = e.clientY
    _lastY = e.clientY
    _lastTime = Date.now()
    // disable transition while dragging
    el.style.transition = 'none'
    // capture pointer if supported
    try{ e.target && e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId) }catch(err){}
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }catch(err){ console.error('onPointerDown error', err) }
}

function onPointerMove(e){
  if(!_dragging) return
  const el = modalContentRef.value
  if(!el) return
  const dy = Math.max(0, e.clientY - _startY)
  // apply a slight resistance beyond 200px
  const translate = dy > 200 ? 200 + (dy - 200) * 0.2 : dy
  el.style.transform = `translateY(${translate}px)`
  // record last for velocity
  _lastY = e.clientY
  _lastTime = Date.now()
}

function onPointerUp(e){
  if(!_dragging) return
  const el = modalContentRef.value
  if(!el) return
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  const dy = Math.max(0, e.clientY - _startY)
  const dt = Math.max(1, Date.now() - _lastTime)
  const vy = (e.clientY - _lastY) / dt
  _dragging = false
  // restore transition for animation
  el.style.transition = 'transform .18s ease'
  // close threshold: dragged enough or flicked fast
  if(dy > 120 || vy > 0.7){
    // animate out then close
    el.style.transform = `translateY(100%)`
    setTimeout(()=>{
      // reset transform and close
      try{ el.style.transition = ''; el.style.transform = '' }catch(e){}
      closeModal()
    }, 180)
  } else {
    // revert
    el.style.transform = 'translateY(0)'
    setTimeout(()=>{ try{ el.style.transition = ''; }catch(e){} }, 180)
  }
}
// cart modal (view-only) so users can inspect the bag without entering data
// restore persisted modal state and auto-open preference
const persistedCartModal = localStorage.getItem('public_cart_modal_open')
const cartModalOpen = ref(persistedCartModal === null ? false : persistedCartModal === 'true')

// migration notice state: used when persisted cart is reconciled against a newer menu
const migrationSummary = ref([])
const showCartMigration = ref(false)
function showMigrationNotice(items){
  try{
    if(!items || !items.length) return
    migrationSummary.value = items.slice(0, 8) // limit to a reasonable number
    showCartMigration.value = true
    // auto-hide after 7s
    setTimeout(() => { try{ showCartMigration.value = false }catch(e){} }, 7000)
  }catch(e){ console.warn('showMigrationNotice err', e) }
}

/* cart auto-open preference removed — feature deprecated */

function openCartModal(){ cartModalOpen.value = true }
function closeCartModal(){ cartModalOpen.value = false }
function proceedFromCart(){ closeCartModal(); openCheckout() }

// when user picks a saved address, update current neighborhood (this drives delivery fee calculation)
watch(selectedAddressId, (v) => {
  try{
    const a = addresses.value.find(x => x.id === v)
    neighborhood.value = a ? (a.neighborhood || '') : ''
  }catch(e){ console.warn('watch selectedAddressId', e) }
})

// body scroll lock removed: avoid changing document.body styles here

// persist preferences and modal open state
watch(cartModalOpen, v => {
  try{ localStorage.setItem('public_cart_modal_open', v ? 'true' : 'false') }catch(e){}
})
// persist cart to localStorage on every change
watch(cart, (v) => {
  try{ localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(v || [])) }catch(e){ console.warn('persist cart failed', e) }
}, { deep: true })
// Note: automatic opening of the cart when items are added was removed.

function formatCurrency(v){
  try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)); }catch(e){ return v; }
}

function _makeLineId(){ return String(Date.now()) + '-' + Math.random().toString(36).slice(2,9) }

function _optionsKey(opts){ try{ return JSON.stringify((opts||[]).map(o=>({ id: o.id }))) }catch(e){ return '' } }

function findCartIndex(productId, options){
  const key = _optionsKey(options)
  return cart.value.findIndex(i => i.productId === productId && _optionsKey(i.options) === key)
}

// Validate the persisted cart against the loaded menu.
// - remove items whose product no longer exists
// - remove options that don't exist anymore
// - recalculate unit price (product base + options) and ensure quantity >= 1
function validatePersistedCart(){
  try{
    if(!cart.value || !cart.value.length) return
    // collect all products from categories + uncategorized
    const allProducts = []
    for(const c of categories.value || []){
      if(Array.isArray(c.products)) allProducts.push(...c.products)
    }
    if(Array.isArray(uncategorized.value)) allProducts.push(...uncategorized.value)

    const newCart = []
    let changed = false
    const removedItems = []
    for(const it of cart.value){
      const p = allProducts.find(x => x.id === it.productId)
      if(!p){ changed = true; removedItems.push(it.name || String(it.productId)); continue } // product removed from menu

      // build option map from product definition
      const optMap = {}
      if(p.optionGroups && Array.isArray(p.optionGroups)){
        for(const g of p.optionGroups){
          for(const o of (g.options || [])) optMap[o.id] = { id: o.id, name: o.name, price: Number(o.price || 0) }
        }
      }

      const validatedOptions = []
      let optionsTotal = 0
      let optionDropped = false
      if(Array.isArray(it.options)){
        for(const oo of it.options){
          const oid = oo && (oo.id || oo)
          if(oid && optMap[oid]){
            validatedOptions.push({ id: optMap[oid].id, name: optMap[oid].name, price: Number(optMap[oid].price) })
            optionsTotal += Number(optMap[oid].price)
          } else {
            // option missing -> drop it
            changed = true
            optionDropped = true
          }
        }
      }

      const unit = Number(p.price || 0) + optionsTotal
      const qty = Math.max(1, Number(it.quantity || 1))
      newCart.push({ lineId: it.lineId || _makeLineId(), productId: p.id, name: p.name, price: unit, quantity: qty, options: validatedOptions, image: it.image })
      if(optionDropped) removedItems.push(`${it.name} (opções removidas)`)
    }

    if(changed || newCart.length !== cart.value.length){
      cart.value = newCart
      if(removedItems.length) showMigrationNotice(removedItems)
    }
  }catch(e){ console.warn('validatePersistedCart error', e) }
}

function addToCart(p, options = []){
  // add/merge considering selected options
  const idx = findCartIndex(p.id, options)
  if(idx >= 0){ cart.value[idx].quantity += 1 }
  else {
    cart.value.push({ lineId: _makeLineId(), productId: p.id, name: p.name, price: Number(p.price), quantity: 1, options: options || [] })
  }
}

function addToCartWithOptions(p, selections, qty=1){
  // selections: { groupId: [optionIds] }
  // compute options total price
  let optionsTotal = 0
  const selectedOptions = []
  if(p.optionGroups && p.optionGroups.length){
    for(const g of p.optionGroups){
      const sel = selections[g.id] || []
      for(const oid of sel){
        const opt = (g.options||[]).find(o=>o.id===oid)
        if(opt){ optionsTotal += Number(opt.price||0); selectedOptions.push({ id: opt.id, name: opt.name, price: Number(opt.price||0) }) }
      }
    }
  }
  const unitPrice = Number(p.price||0) + optionsTotal
  // try to merge with existing line that has same productId+options
  const idx = findCartIndex(p.id, selectedOptions)
  if(idx >= 0){ cart.value[idx].quantity += qty }
  else { cart.value.push({ lineId: _makeLineId(), productId: p.id, name: p.name, price: unitPrice, quantity: qty, options: selectedOptions }) }
}

function openProductModal(p, force = false){
  // If there are no option groups and not forcing the modal, quick-add directly to cart
  if(!force && (!p.optionGroups || !p.optionGroups.length)){
    addToCartWithOptions(p, {}, 1)
    return
  }

  selectedProduct.value = p
  modalQty.value = 1
  modalError.value = ''
  searchTerm.value = ''
  // initialize selections with defaults (empty)
  const map = {}
  if(p.optionGroups){
    for(const g of p.optionGroups){
      // If group allows only one selection and is mandatory, use radio-array shape
      if(g.max === 1 && (g.min || 0) > 0) map[g.id] = []
      else map[g.id] = {}
      // clear previous required warnings for this group's id when opening modal
      try{ delete requiredWarnings[g.id]; delete requiredMessages[g.id] }catch(e){}
    }
  }
  optionSelections.value = map
  modalOpen.value = true
}

function filterOptions(group){
  const q = (searchTerm.value || '').toLowerCase().trim()
  if(!q) return group.options || []
  // hide options that are explicitly marked unavailable (false). Treat undefined as available.
  const available = (group.options || []).filter(o => o.isAvailable !== false)
  return available.filter(o => (o.name||'').toLowerCase().includes(q))
}

function qtyFor(groupId, optionId){
  const gsel = optionSelections.value[groupId]
  if(!gsel) return 0
  // if array (radio), return 1 when selected
  if(Array.isArray(gsel)) return gsel.indexOf(optionId) >= 0 ? 1 : 0
  // otherwise object map of quantities
  return Number(gsel[optionId] || 0)
}

function setQty(group, option, value){
  try{
    if(option && option.isAvailable === false) return
    const gid = group.id
    const max = group.max || 99
    let v = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0
    if(v > max) v = max
    // compute current total excluding this option
    const gsel = optionSelections.value[gid] || {}
    let total = 0
    for(const k of Object.keys(gsel)){
      if(k === option.id) continue
      total += Number(gsel[k] || 0)
    }
    // remaining capacity
    const remaining = Math.max(0, max - total)
    const desired = v
    if(v > remaining) v = remaining
    if(desired > v){
      // inform user we clamped to remaining
      showTip(`${gid}:${option.id}`, `Máximo de ${max} atingido`) 
    }
    // set or delete
    const next = { ...(optionSelections.value[gid] && !Array.isArray(optionSelections.value[gid]) ? optionSelections.value[gid] : {}) }
    if(v > 0) next[option.id] = v
    else delete next[option.id]
    optionSelections.value[gid] = next
    // clear warning for this group if requirement now satisfied
    try{
      const minReq = group.min || 0
      let cur = 0
      for(const k of Object.keys(next)) cur += Number(next[k] || 0)
      if(cur >= minReq) { try{ delete requiredWarnings[gid]; delete requiredMessages[gid] }catch(e){} }
    }catch(e){}
  }catch(err){ console.error('setQty error', err) }
}

function adjustQty(group, option, delta){
  const cur = qtyFor(group.id, option.id)
  const desired = Math.max(0, cur + delta)
  setQty(group, option, desired)
  try{ if(window.navigator && window.navigator.vibrate) window.navigator.vibrate(8) }catch(e){}
}

function startAutoChange(group, option, delta, ev){
  const key = `${group.id}:${option.id}`
  // do immediate change
  adjustQty(group, option, delta)
  // if existing timer, clear
  stopAutoChange(group, option, ev)
  // start a timeout, then interval for rapid changes
  const t = {}
  // store the pressed element for visual state
  try{ t.el = ev && (ev.currentTarget || ev.target) }catch(e){}
  if(t.el) try{ t.el.classList && t.el.classList.add('pressed') }catch(e){}
  t.timeout = setTimeout(()=>{
    t.interval = setInterval(()=> adjustQty(group, option, delta), 120)
  }, 420)
  _autoTimers[key] = t
}

function stopAutoChange(group, option, ev){
  const key = `${group.id}:${option.id}`
  const t = _autoTimers[key]
  if(!t) return
  if(t.timeout) clearTimeout(t.timeout)
  if(t.interval) clearInterval(t.interval)
  // remove pressed class if present
  try{
    const el = (t && t.el) || (ev && (ev.currentTarget || ev.target))
    if(el && el.classList) el.classList.remove('pressed')
  }catch(e){}
  delete _autoTimers[key]
}

function selectRadio(group, option){
  if(option && option.isAvailable === false) return
  optionSelections.value[group.id] = [option.id]
  // radio selection satisfies min for the group if min>=1
  try{ if((group.min || 0) <= 1) { try{ delete requiredWarnings[group.id]; delete requiredMessages[group.id] }catch(e){} } }catch(e){}
}

function isOptionSelected(group, option){
  const sel = optionSelections.value[group.id] || []
  if(Array.isArray(sel)) return sel.indexOf(option.id) >= 0
  // object map: selected if qty>0
  return Number((sel && sel[option.id]) || 0) > 0
}

function confirmAddFromModal(){
  modalError.value = ''
  const p = selectedProduct.value
  const selectionsForCart = {}
  if(p && p.optionGroups){
    for(const g of p.optionGroups){
      const raw = optionSelections.value[g.id]
      let total = 0
      if(Array.isArray(raw)){
        total = raw.length
        selectionsForCart[g.id] = raw.slice()
      } else {
        // raw is a map optionId->qty
        const arr = []
        for(const oid of Object.keys(raw || {})){
          const q = Math.max(0, Number(raw[oid] || 0))
          total += q
          for(let i=0;i<q;i++) arr.push(oid)
        }
        selectionsForCart[g.id] = arr
      }
      if((g.min || 0) > total){ 
        // mark warning for this group and keep checking others
        requiredWarnings[g.id] = true
        requiredMessages[g.id] = `Escolha ${g.min || 0} opção(s)`
      } else {
        // clear any previous warning for this group
        try{ delete requiredWarnings[g.id]; delete requiredMessages[g.id] }catch(e){}
      }
      if(g.max && total > g.max){ 
        // max violation - keep using modalError for this case
        modalError.value = `Máximo ${g.max} opção(ões) permitido para "${g.name}"`; return 
      }
    }
    }
    // if any required warnings present, do not proceed and remove modal alert
    const failing = Object.keys(requiredWarnings).length > 0
    if(failing){
      try{
        const first = Object.keys(requiredWarnings)[0]
        const el = document.getElementById('grp-' + first)
        if(el){
          // prefer scrolling inside the modal options column when available
          const modalCol = el.closest('.modal-options-scroll') || document.querySelector('.modal-options-scroll')
          if(modalCol){
            // compute offset of element relative to the scroll container
            const elRect = el.getBoundingClientRect()
            const contRect = modalCol.getBoundingClientRect()
            const offset = (elRect.top - contRect.top) + modalCol.scrollTop - 12
            modalCol.scrollTo({ top: offset, behavior: 'smooth' })
          } else {
            // fallback: scroll the window as before (account for header)
            const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
            const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
            const top = el.getBoundingClientRect().top + window.pageYOffset - headerH - 12
            window.scrollTo({ top, behavior: 'smooth' })
          }
          try{
            // add a temporary pulse highlight class to draw attention
            el.classList.add('required-pulse')
            // remove after animation completes
            setTimeout(()=>{ try{ el.classList.remove('required-pulse') }catch(e){} }, 900)
          }catch(e){}
        }
      }catch(e){ console.warn('scroll to required group failed', e) }
      return
    }
    // no required warnings -> proceed
    addToCartWithOptions(p, selectionsForCart, modalQty.value)
    modalOpen.value = false
}

function groupSelectedCount(g){
  const raw = optionSelections.value[g.id]
  if(!raw) return 0
  if(Array.isArray(raw)) return raw.length
  let s = 0
  for(const k of Object.keys(raw)) s += Number(raw[k] || 0)
  return s
}

function closeModal(){ modalOpen.value = false; modalError.value = '' }

function shareStub(){
  // placeholder for native share / copy link — no-op for now
  try{ if(navigator && navigator.share){ navigator.share({ title: selectedProduct.value?.name || '', url: window.location.href }) } }
  catch(e){ /* ignore */ }
}
// modal quantity auto-change (press-and-hold) support — mirrors option qty UI
let _modalAutoTimer = null
function adjustModalQty(delta){
  try{
    const cur = Number.isFinite(Number(modalQty.value)) ? Math.floor(Number(modalQty.value)) : 1
    modalQty.value = Math.max(1, cur + delta)
    try{ if(window.navigator && window.navigator.vibrate) window.navigator.vibrate(8) }catch(e){}
  }catch(e){ console.error('adjustModalQty', e) }
}

function startModalAutoChange(delta, ev){
  // immediate change
  adjustModalQty(delta)
  // clear existing
  stopModalAutoChange()
  const t = {}
  try{ t.el = ev && (ev.currentTarget || ev.target) }catch(e){}
  if(t.el) try{ t.el.classList && t.el.classList.add('pressed') }catch(e){}
  t.timeout = setTimeout(()=>{ t.interval = setInterval(()=> adjustModalQty(delta), 120) }, 420)
  _modalAutoTimer = t
}

function stopModalAutoChange(ev){
  const t = _modalAutoTimer
  if(!t) return
  if(t.timeout) clearTimeout(t.timeout)
  if(t.interval) clearInterval(t.interval)
  try{
    const el = (t && t.el) || (ev && (ev.currentTarget || ev.target))
    if(el && el.classList) el.classList.remove('pressed')
  }catch(e){}
  _modalAutoTimer = null
}
function incQuantity(i){ cart.value[i].quantity += 1; }
function decQuantity(i){ cart.value[i].quantity = Math.max(1, cart.value[i].quantity - 1); }
function removeItem(i){ cart.value.splice(i,1); }

function incrementProduct(p){
  // Always open the product modal to force selection (even for products without option groups)
  openProductModal(p, true)
}

function decrementProduct(p){
  // prefer decrementing a line with no options first
  let idx = findCartIndex(p.id, []);
  if(idx >= 0){
    if(cart.value[idx].quantity > 1) cart.value[idx].quantity -= 1;
    else cart.value.splice(idx,1);
    return;
  }

  // otherwise decrement the first matching line for that product (any options)
  idx = cart.value.findIndex(i=>i.productId===p.id);
  if(idx>=0){
    if(cart.value[idx].quantity>1) cart.value[idx].quantity -= 1;
    else cart.value.splice(idx,1);
  }
}
function getCartQty(productId){
  return cart.value.filter(i=>i.productId===productId).reduce((s,it)=>s+it.quantity,0)
}

const subtotal = computed(()=> cart.value.reduce((s,it)=> s + (it.price * it.quantity),0));

const openCoupon = ref(false)
const couponCode = ref('')

function applyCoupon(){
  // placeholder: just close the coupon input for now
  try{ if(couponCode.value && couponCode.value.trim()){
    // TODO: validate coupon with API
    openCoupon.value = false
  } else {
    // empty: keep open or show tip
    showTip('coupon','Insira um código válido',1200)
  }}catch(e){ console.warn('applyCoupon', e) }
}

function editCartItem(i){
  try{
    const it = cart.value[i]
    if(!it) return
    // find product in categories or uncategorized
    let p = null
    for(const c of categories.value){
      p = (c.products || []).find(x=>x.id === it.productId)
      if(p) break
    }
    if(!p){ p = (uncategorized.value || []).find(x=>x.id === it.productId) }
    if(!p) return
    // open modal and prefill selections
    selectedProduct.value = p
    modalQty.value = Number(it.quantity || 1)
    modalError.value = ''
    const map = {}
    if(p.optionGroups){
      for(const g of p.optionGroups){
        if(g.max === 1 && (g.min || 0) > 0) map[g.id] = []
        else map[g.id] = {}
      }
    }
    // apply options from cart item
    if(it.options && it.options.length && p.optionGroups){
      for(const opt of it.options){
        for(const g of p.optionGroups){
          const found = (g.options||[]).find(o=>o.id === opt.id)
          if(found){
            if(Array.isArray(map[g.id])) map[g.id].push(opt.id)
            else map[g.id][opt.id] = (map[g.id][opt.id] || 0) + 1
            break
          }
        }
      }
    }
    optionSelections.value = map
    modalOpen.value = true
  }catch(e){ console.error('editCartItem', e) }
}

// modal total: product price + selected options (per unit) multiplied by quantity
const modalTotal = computed(() => {
  try{
    const p = selectedProduct.value
    if(!p) return 0
    let optionsTotalPerUnit = 0
    if(p.optionGroups && p.optionGroups.length){
      for(const g of p.optionGroups){
        const raw = optionSelections.value[g.id]
        if(!raw) continue
        if(Array.isArray(raw)){
          for(const oid of raw){
            const opt = (g.options||[]).find(o=>o.id === oid)
            if(opt) optionsTotalPerUnit += Number(opt.price || 0)
          }
        } else {
          // map of optionId -> qty
          for(const oid of Object.keys(raw || {})){
            const q = Math.max(0, Number(raw[oid] || 0))
            if(q <= 0) continue
            const opt = (g.options||[]).find(o=>o.id === oid)
            if(opt) optionsTotalPerUnit += Number(opt.price || 0) * q
          }
        }
      }
    }
    const unit = Number(p.price || 0) + optionsTotalPerUnit
    const qty = Math.max(1, Number.isFinite(Number(modalQty.value)) ? Math.floor(Number(modalQty.value)) : 1)
    return unit * qty
  }catch(e){ return 0 }
})

// transient inputs for adding/editing a new address in modal
const _newAddrLabel = ref('')
const _newAddrFormatted = ref('')
const _newAddrNeighborhood = ref('')
const _newAddrReference = ref('')
const _newAddrLat = ref(null)
const _newAddrLon = ref(null)
const _newAddrFull = ref('') // store full display_name from reverse geocode if available
const _locating = ref(false)
const editingAddressId = ref(null)

// control visibility of the "new address" form inside checkout delivery step
// If the user has no saved addresses, we show the form by default so they can
// enter an address and continue without having to save it. If they have saved
// addresses, we show the selector and a small shortcut "Cadastrar novo endereço"
// to reveal the form.
const showNewAddressForm = ref(addresses.value.length === 0)
function clearNewAddress(){
  _newAddrLabel.value = ''
  _newAddrFormatted.value = ''
  _newAddrNeighborhood.value = ''
  _newAddrReference.value = ''
  _newAddrLat.value = null
  _newAddrLon.value = null
  _newAddrFull.value = ''
  editingAddressId.value = null
}

async function performOrderFromModal(){
  // populate customer/address from modal selections and call submitOrder
  if(orderType.value === 'DELIVERY'){
    // prefer a selected saved address, but allow a temporary address entered in the
    // flow (customer.value.address) when the user didn't save it.
    const a = addresses.value.find(x=>x.id===selectedAddressId.value)
    if(a){
      if(!customer.value.address) customer.value.address = { formattedAddress: '', neighborhood: '' }
      customer.value.address.formattedAddress = a.formattedAddress
      customer.value.address.neighborhood = a.neighborhood || ''
      customer.value.address.reference = a.reference || ''
      neighborhood.value = a.neighborhood || ''
    } else if(customer.value.address && customer.value.address.formattedAddress){
      // already filled via inline "Usar para este pedido" or nextFromDelivery copy
      neighborhood.value = customer.value.address.neighborhood || ''
      // ensure reference is present when user filled inline fields
      customer.value.address.reference = customer.value.address.reference || _newAddrReference.value || ''
    } else {
      clientError.value = 'Selecione um endereço'; return
    }
  } else {
    // pickup: clear address
    if(customer.value.address) {
      customer.value.address.formattedAddress = ''
      customer.value.address.neighborhood = ''
    }
    neighborhood.value = ''
  }
  // persist customer
  saveCustomerToLocal()
  // call existing submitOrder
  await submitOrder()
  // if success (orderResponse set), close modal
  if(orderResponse.value){ closeCheckout() }
}

function nextFromCustomer(){
  clientError.value = ''
  if(!customer.value || !customer.value.name || !customer.value.contact){
    clientError.value = 'Preencha nome e WhatsApp'
    return
  }
  saveCustomerToLocal()
  checkoutStep.value = 'delivery'
}

function addNewAddress(){
  clientError.value = ''
  if(!_newAddrFormatted.value || !_newAddrNeighborhood.value){
    clientError.value = 'Preencha endereço e bairro'
    return
  }
  // ensure selected neighborhood exists in canonical list
  try{
    const found = (neighborhoodsList.value || []).find(n => String(n.name || '').trim().toLowerCase() === String(_newAddrNeighborhood.value || '').trim().toLowerCase())
    if(!found){
      clientError.value = 'Bairro não encontrado na lista. Selecione um bairro válido.'
      return
    }
  }catch(e){ /* ignore matching errors */ }
  // if editing, update existing address
  if(editingAddressId.value){
    const idx = addresses.value.findIndex(a=>a.id===editingAddressId.value)
    if(idx >= 0){
      const upd = { ...addresses.value[idx], label: (_newAddrLabel.value || _newAddrFormatted.value), formattedAddress: _newAddrFormatted.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, reference: _newAddrReference.value }
      if(_newAddrFull.value) upd.fullDisplay = _newAddrFull.value
      addresses.value.splice(idx, 1, upd)
      localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value))
      selectedAddressId.value = upd.id
    }
    clearNewAddress()
    return
  }

  addAddress({ label: _newAddrLabel.value, formattedAddress: _newAddrFormatted.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, fullDisplay: _newAddrFull.value, reference: _newAddrReference.value })
  clearNewAddress()
}

// Temporary-use functions removed — advancing will now persist the address when needed

async function useMyLocation(){
  clientError.value = ''
  if(!navigator.geolocation){ clientError.value = 'Geolocalização não suportada no seu navegador.'; return }
  _locating.value = true
  try{
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
    })
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude
    // use Nominatim reverse geocoding (OpenStreetMap) to get a human readable address
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'projetoDelivery/1.0 (example)' } })
    if(!r.ok) throw new Error('Falha ao consultar serviço de geocodificação')
    const j = await r.json()
    // compute a short, useful formatted address (keep full display_name too)
    const short = shortAddressFromNominatim(j) || j.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`
    _newAddrFormatted.value = short
    _newAddrFull.value = j.display_name || ''
    const addr = j.address || {}
    _newAddrNeighborhood.value = addr.suburb || addr.neighbourhood || addr.city_district || addr.village || addr.town || addr.city || ''
    if(!_newAddrNeighborhood.value && addr.county) _newAddrNeighborhood.value = addr.county
    _newAddrLat.value = lat
    _newAddrLon.value = lon
    // try to match the geocoded neighborhood to our canonical list via public match endpoint
    try{
      if(_newAddrNeighborhood.value && neighborhoodsList.value && neighborhoodsList.value.length){
        const mr = await api.post(`/public/${companyId}/neighborhoods/match`, { text: _newAddrNeighborhood.value })
        const md = mr && mr.data ? mr.data : null
        if(md && md.match){
          // use the canonical match name so select will resolve correctly
          _newAddrNeighborhood.value = md.match
          showTip('neighborhood', `Bairro identificado: ${md.match} (${formatCurrency(md.deliveryFee || 0)})`, 2500)
        } else {
          // no match found — hint the user to manually select
          showTip('neighborhood', 'Bairro não encontrado na lista. Selecione manualmente.', 3000)
        }
      }
    }catch(matchErr){
      console.warn('neighborhood match failed', matchErr)
    }

    // If the user already has saved addresses, auto-save this as a new address
    // (existing behavior). If there are no saved addresses, just populate the
    // transient form fields so the user can "Usar para este pedido" without
    // forcing a save.
    if(addresses.value && addresses.value.length){
      addAddress({ label: _newAddrLabel.value || 'Minha localização', formattedAddress: _newAddrFormatted.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, fullDisplay: _newAddrFull.value })
      // clear transient fields after saving
      clearNewAddress()
      // ensure the new-address form is hidden after auto-saving (keep UX tidy)
      showNewAddressForm.value = false
    } else {
      // keep the populated _newAddr* fields for the user to confirm and use
      showTip('neighborhood', 'Endereço preenchido. Clique em Avançar para salvar e continuar.', 2800)
      // show the new address form so they can see/edit the values
      showNewAddressForm.value = true
    }
  }catch(err){
    console.error('useMyLocation failed', err)
    clientError.value = 'Não foi possível obter localização: ' + (err.message || err)
  }finally{ _locating.value = false }
}

// helper: produce a short address from Nominatim result
function shortAddressFromNominatim(j){
  if(!j) return ''
  const a = j.address || {}
  // prefer road + house_number or pedestrian; then neighbourhood/suburb, then postcode, then country
  const parts = []
  if(a.house_number && a.road) parts.push(`${a.road}, ${a.house_number}`)
  else if(a.road) parts.push(a.road)
  else if(a.neighbourhood) parts.push(a.neighbourhood)
  else if(a.suburb) parts.push(a.suburb)
  // city / town
  if(a.city && !parts.includes(a.city)) parts.push(a.city)
  else if(a.town && !parts.includes(a.town)) parts.push(a.town)
  else if(a.village && !parts.includes(a.village)) parts.push(a.village)
  // postcode
  if(a.postcode) parts.push(a.postcode)
  // country
  if(a.country) parts.push(a.country)
  return parts.filter(Boolean).join(', ')
}

function editAddress(id){
  const a = addresses.value.find(x=>x.id===id)
  if(!a) return
  editingAddressId.value = id
  _newAddrLabel.value = a.label || ''
  _newAddrFormatted.value = a.formattedAddress || ''
  _newAddrNeighborhood.value = a.neighborhood || ''
  _newAddrLat.value = a.latitude || null
  _newAddrLon.value = a.longitude || null
  _newAddrFull.value = a.fullDisplay || ''
  selectedAddressId.value = id
}

function saveEditedAddress(){
  // reuse addNewAddress which handles editing flow
  addNewAddress()
}

function cancelEdit(){ clearNewAddress() }

function nextFromDelivery(){
  clientError.value = ''
  if(orderType.value === 'DELIVERY'){
    // allow proceeding when a saved address is selected OR when the user filled a
    // temporary address in the form (showNewAddressForm may be true when adding)
    const hasSaved = !!selectedAddressId.value
    const hasTemp = (customer.value.address && customer.value.address.formattedAddress) || (_newAddrFormatted.value && showNewAddressForm.value)
    if(!hasSaved && !hasTemp){
      clientError.value = 'Selecione um endereço'
      return
    }
    // if user filled the inline form without selecting a saved address, persist it
    if(!hasSaved && _newAddrFormatted.value){
      // attempt to add and persist the address (this will also set selectedAddressId)
      addNewAddress()
      if(clientError.value){
        // addNewAddress reports validation errors via clientError; stop progression
        return
      }
      // ensure neighborhood is synchronized from the newly saved address
      const a = addresses.value.find(x => x.id === selectedAddressId.value)
      if(a){ neighborhood.value = a.neighborhood || '' }
    }
  }
  checkoutStep.value = (orderType.value === 'DELIVERY' ? 'payment' : 'review')
}

function goToCustomer(){ checkoutStep.value = 'customer' }
function goToDelivery(){ checkoutStep.value = 'delivery' }
function goToReview(){ checkoutStep.value = 'review' }
function backFromReview(){ checkoutStep.value = (orderType.value === 'DELIVERY' ? 'payment' : 'delivery') }

onMounted(async ()=>{
  loading.value = true;
  try{
    const res = await api.get(`/public/${companyId}/menu`);
  const data = res.data || {};
  // filter out inactive categories and inactive products
  const rawCategories = data.categories || []
  categories.value = rawCategories.map(c => ({ ...c, products: (c.products || []).filter(p => p.isActive !== false) })).filter(c => c.isActive !== false)
  uncategorized.value = (data.uncategorized || []).filter(p => p.isActive !== false)
  // if a previously selected/active category is now inactive/absent, reset active state
  if(activeCategoryId.value && !categories.value.find(c => c.id === activeCategoryId.value)) activeCategoryId.value = null
  company.value = data.company || null
    // after menu loaded, validate any persisted cart to remove stale items/options
    try{ validatePersistedCart() }catch(e){ console.warn('validatePersistedCart failed', e) }
    // prefer payment methods provided by public endpoint if available
    if(company.value && Array.isArray(company.value.paymentMethods) && company.value.paymentMethods.length){
      paymentMethods.value = company.value.paymentMethods
      if(paymentMethods.value.length && !paymentMethods.value.find(m=>m.code===paymentMethod.value)) paymentMethod.value = paymentMethods.value[0].code
    } else {
      // payment methods for this company (public endpoints may not expose them; try admin endpoint fallback)
      try{
        const pm = await api.get(`/menu/payment-methods?companyId=${companyId}`);
        paymentMethods.value = pm.data || [];
        if(paymentMethods.value.length && !paymentMethods.value.find(m=>m.code===paymentMethod.value)){
          paymentMethod.value = paymentMethods.value[0].code;
        }
      }catch(e){
        // fallback: minimal default method
        paymentMethods.value = [{ code: 'CASH', name: 'Dinheiro' }];
        paymentMethod.value = 'CASH';
      }
    }
    // fetch public neighborhoods for this company (used to compute delivery fee)
    try{
      const nr = await api.get(`/public/${companyId}/neighborhoods`)
      neighborhoodsList.value = Array.isArray(nr.data) ? nr.data : []
    }catch(e){ console.warn('failed to load public neighborhoods', e) }
    
  }catch(e){
    console.error(e);
    serverError.value = 'Não foi possível carregar o cardápio.';
  }finally{ loading.value = false; }
});

function selectCategory(id){
  // scroll to a category section (or to products-start when id is null)
  try{
    if(id === null){
      const el = document.getElementById('products-start') || document.querySelector('.row')
      const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
      if(el){
        const top = el.getBoundingClientRect().top + window.pageYOffset - headerH - 8
        window.scrollTo({ top, behavior: 'smooth' })
        activeCategoryId.value = null
      }
      return
    }
    const el = document.getElementById(`cat-${id}`)
    const headerEl = document.querySelector('header, .site-header, .navbar, .app-header')
    const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0
    if(el){
      const top = el.getBoundingClientRect().top + window.pageYOffset - headerH - 8
      window.scrollTo({ top, behavior: 'smooth' })
      activeCategoryId.value = id
    }
  }catch(e){ console.warn('selectCategory err', e) }
}

function goHome(){ try{ router.push({ path: `/public/${companyId}` }) }catch(e){ console.warn('goHome', e) } }
function goOrders(){ try{ router.push({ path: `/public/${companyId}/orders` }) }catch(e){ console.warn('goOrders', e) } }
function goProfile(){ try{ router.push({ path: `/public/${companyId}/profile` }) }catch(e){ console.warn('goProfile', e) } }

function scrollToCheckout(){
  // scroll to checkout card (mobile) or to sidebar (desktop)
  const el = document.querySelector('.card.mt-4.d-lg-none') || document.querySelector('.position-sticky')
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function submitOrder(){
  serverError.value = '';
  clientError.value = '';
  submitting.value = true;
  orderResponse.value = null;
  try{
    if(!isOpen.value){
      clientError.value = 'Loja fechada no momento. Não é possível enviar pedidos fora do horário de funcionamento.'
      submitting.value = false
      return
    }
    // client-side validation
    if(!customer.value.name || !customer.value.contact){
      clientError.value = 'Preencha nome e telefone antes de enviar.';
      submitting.value = false
      return;
    }
    if(orderType.value === 'DELIVERY'){
      if(!customer.value.address?.formattedAddress || !neighborhood.value){
        clientError.value = 'Preencha endereço e bairro para entrega antes de enviar.';
        submitting.value = false
        return;
      }
    }
    if(cart.value.length===0){
      clientError.value = 'Adicione pelo menos um item ao carrinho.';
      submitting.value = false
      return;
    }
    // Build a plain JS payload (avoid sending reactive refs / proxies which cause cyclic errors)
    const payload = {
      customer: {
        name: String(customer.value.name || ''),
        contact: String(customer.value.contact || ''),
        address: {
          formattedAddress: String((customer.value.address && customer.value.address.formattedAddress) || ''),
          neighborhood: String(neighborhood.value || ''),
          reference: String((customer.value.address && customer.value.address.reference) || '')
        }
      },
      items: (cart.value || []).map(i => ({
        productId: i.productId,
        name: i.name,
        price: Number(i.price || 0),
        quantity: Number(i.quantity || 0),
        options: (i.options || []).map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0) }))
      })),
      payment: { methodCode: String(paymentMethod.value || ''), amount: Number(subtotal.value || 0) },
      neighborhood: String(neighborhood.value || ''),
      orderType: String(orderType.value || '')
    };

  const res = await api.post(`/public/${companyId}/orders`, payload);
  orderResponse.value = res.data;
  cart.value = [];
  // persist customer contact so user can view history/status later
  saveCustomerToLocal()
  // redirect to public order status page (include phone for verification)
  const phone = encodeURIComponent(String(customer.value.contact || ''))
  const oid = encodeURIComponent(String(res.data.id || ''))
  try { router.push({ path: `/public/${companyId}/order/${oid}`, query: { phone } }) } catch(e) { console.warn('Redirect failed', e) }
  }catch(err){
    console.error(err);
    serverError.value = err?.response?.data?.message || err.message || 'Erro ao enviar pedido';
  }finally{ submitting.value = false; }
}


</script>

<style scoped>
.public-hero { background: #222; color: #fff; }
.public-hero h3 { font-weight:700; color:#fff }
.nav-pills { position: sticky; top: 0; z-index: 5; padding-bottom: 8px; background: transparent; }
.nav-pills.stuck { background: #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.06); padding-top: 8px; padding-bottom: 8px; z-index: 1075; }

/* hero overlapping white panel */
.hero-panel { background: transparent; margin-top: -90px; padding: 18px; border-radius: 12px; max-width: 980px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); background: #fff; position: relative; z-index: 1046 }
.hero-panel .company-name { color: #111; }
.hero-panel .company-address { color: #666 }
.store-closed-panel { color: #d23a3a; }
.delivery-pickup-btn { background: #f1fbfd; color: #0d6efd; border: 1px solid rgba(13,110,253,0.12); border-radius: 10px; padding: 8px 12px; font-weight:600 }
.calc-delivery { background: #f8fafb; border: 1px solid #eef4f6; }
.list-group-item {
  border: 2px solid #DDD !important;
  margin-bottom: 6px;
  border-radius: 16px 16px 16px 16px !important;
  padding: 16px;
}/*
.list-group-item:last-child { border-bottom: none }*/
.hero-image { transition: transform .35s ease }
.public-hero:hover .hero-image { transform: scale(1.02) }

/* Product card styles to match mockups */
.product-card { background: #fff; border: 1px solid #eee; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
.product-card-body { flex: 1 1 auto; padding-right: 1rem; }
.product-title { font-size: 1.05rem; font-weight: 600; }
.product-desc { color: #666; font-size:12px; line-height:135%; max-height: 3em; overflow: hidden; text-overflow: ellipsis; }
.product-price { color: #0652ae; font-size: 1rem; }
.product-card-media { width: 110px; flex: 0 0 110px; }
.product-image { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; }
.product-image-placeholder { width: 96px; height: 96px; border-radius: 8px; }
.badge.bg-success { background-color: #dff3e9; color: #056937; font-weight:600; border-radius:8px; padding:4px 6px; font-size:0.8rem }

@media (max-width: 991px){
  .product-card { border-radius: 8px; }
  .product-card-media { width: 72px; flex: 0 0 72px; }
  .product-image { width: 64px; height: 64px; }
}

/* Desktop sticky cart bar */
.desktop-cart-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 1060; padding: 12px 20px; background: #fff; border-top: 1px solid rgba(0,0,0,0.06); box-shadow: 0 -6px 20px rgba(0,0,0,0.04); }
.desktop-cart-bar .cart-info { display:flex; flex-direction:column; gap:2px }
.desktop-cart-bar .cart-action { display:flex; align-items:center }
.btn-advance { background: linear-gradient(180deg,#d81b1b,#b81616); color: #fff; border: none; min-width: 300px; padding: 12px 28px; font-weight: 700; border-radius: 8px; box-shadow: 0 6px 18px rgba(216,27,27,0.16); }
.btn-advance:hover { filter: brightness(0.95); }

/* Close X button styling (match mocks) */
.close-x { width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; line-height: 1; color: #444; border-radius: 8px; border-color: rgba(0,0,0,0.08); }
.close-x:hover { background: rgba(0,0,0,0.04); color: #111; }

@media (max-width: 1199px){
  .btn-advance { min-width: 260px; padding: 10px 20px }
}

/* modal product hero */
.modal-product-hero { width:100%; height:220px; overflow:hidden; border-radius:8px; display:flex; align-items:center; justify-content:center; background:#f6f6f8 }
.modal-product-img { width:100%; height:100%; object-fit:cover; display:block; border-radius:6px }
.modal-back-mobile { display:flex; position:absolute; left:12px; top:12px; width:44px; height:44px; border-radius:50%; background:#fff; border:none; align-items:center; justify-content:center; font-size:22px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); z-index:22 }
  .modal-share-mobile { position:absolute; right:12px; top:12px; width:52px; height:52px; border-radius:50%; background:#fff; border:none; align-items:center; justify-content:center; font-size:20px; box-shadow: 0 6px 18px rgba(0,0,0,0.14); z-index:22 }
.hero-down { position:absolute; left:50%; transform:translateX(-50%); bottom:8px; font-size:20px; color:rgba(0,0,0,0.6); z-index:20 }
.option-thumb { width:48px; height:48px; object-fit:cover; border-radius:8px }
.option-meta .option-name { font-weight:600 }
.group-header{ background-color:#FAFAFA; padding:8px 16px; border-radius:16px; font-size:14px;}
.group-header .badge.bg-primary { background-color:#0d6efd; color:#fff }
/* highlight failing required group briefly */
.required-fail { box-shadow: 0 0 0 3px rgba(220,53,69,0.06); border-radius: 12px }
.badge.bg-danger { background-color: #d9534f !important }
/* pulse animation used when scrolling to a required group */
.required-pulse { animation: pulse 0.9s ease-out forwards }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(220,53,69,0.18); }
  50% { box-shadow: 0 0 0 10px rgba(220,53,69,0.06); }
  100% { box-shadow: 0 0 0 0 rgba(220,53,69,0); }
}

/* modal content sizing */
.product-modal .modal-content { width:920px; max-width:95%; max-height:90vh; overflow:auto }

/* enforce stacking: product modal should be above mobile nav and page content */
.product-modal { z-index: 11000 !important }

/* fullscreen modal on small screens */
@media (max-width: 767px){
  .modal-product-hero { height:160px }
  .product-modal { align-items:stretch }
  .product-modal .modal-content { width:100vw; height:100vh; max-height:100vh; border-radius:0; margin:0; padding:0 }
  .product-modal .modal-content { max-width: 100%; border-radius: 0px !important }
  /* slide up animation for mobile modal */
  @keyframes slideUpModal { from { transform: translateY(100%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
  .product-modal .modal-content { transform: translateY(100%); animation: slideUpModal .28s ease forwards }

  /* mobile floating close button styling */
  .modal-close-mobile { display:flex; position:absolute; top:12px; right:12px; width:44px; height:44px; border-radius:50%; background:#fff; border:none; align-items:center; justify-content:center; font-size:20px; line-height:1; box-shadow: 0 6px 18px rgba(0,0,0,0.14); z-index:20 }
  .modal-close-mobile:active { transform: scale(.98) }
  .modal-close-mobile:hover { background:#fafafa }

  /* ensure modal body reserves space for the fixed footer on small screens */
  .product-modal .modal-body { padding-bottom: 100px }

  /* desktop two-column modal grid */
  @media (min-width: 992px){
    /* keep default modal sizing on desktop */
    .product-modal .modal-footer { position:absolute;}
  }
}

/* quantity control tweaks */
/* unified qty visuals for buttons used across options, modal footer and cart */
.btn-qty { width:40px; height:40px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; transition: transform .12s ease, box-shadow .12s ease }
.btn-qty.pressed { transform: scale(0.92); box-shadow: 0 6px 18px rgba(0,0,0,0.12) }

/* cart drawer thumbnail */
.cart-thumb { width:72px; height:72px; object-fit:cover; border-radius:8px; }
.cart-summary .input-group .form-control { border-right: none }
.coupon-block .btn { min-width: 36px }
@media (min-width: 767px){
  
  .product-modal .modal-footer { position: absolute;}
}
@media (max-width: 767px){
  .btn-qty { width:36px; height:36px; border-color: #0d6efd;color:#0d6efd; }
  .qty-control input { font-size:1rem; padding:6px }
  .product-modal .modal-footer { position: fixed;}
}
/* numeric input matching qty visuals */
.qty-input { width:80px; border-radius:8px; padding:6px 10px; font-weight:600; text-align:center; }
/* hide native number spinners */
.qty-input::-webkit-outer-spin-button, .qty-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0 }
.qty-input { -moz-appearance: textfield; appearance: textfield }

/* modal footer fixed and centered to match modal width */
.product-modal .modal-footer {left: 0; transform: none; bottom: 0; width: 100%; max-width: 100%; padding: 12px; background: #fff; box-shadow:none; z-index: 30; display:flex; justify-content:space-between; align-items:center }
.product-modal .modal-body { max-height: calc(90vh - 120px); overflow:auto }

/* Add button inside modal footer: label left, price right */
.add-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 8px 8px;
  border-radius: 8px;
  background: #0d6efd;
  color: #fff;
  border: none;
  font-weight: 700;
  /* animations/transitions removed for a stable button appearance */
  position: relative;
  overflow: hidden;
}
.add-btn i { font-size: 1.05rem; display: inline-flex; align-items: center; margin-right: 6px; }
.add-btn .add-label { font-size:0.9rem; }
.add-btn .add-price { font-size:0.9rem; }
.add-btn:focus { outline: none; }

@media (max-width: 991px){
  .desktop-cart-bar { display: none !important }
}

/* small tweaks for options display inside cart and review */
.option-line { font-size: 0.92rem; margin-top: 4px; }
.option-name { color: #555 }
.option-price { color: #666; margin-left: 12px }
.option-unit { color: #666; margin-left: 6px }

/* Drawer styles for large screens */
.drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 1050 }
.cart-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 420px; max-width: 100%; background: #fff; z-index: 1060; transform: translateX(100%); transition: transform .28s ease; display:flex; flex-direction:column }
.cart-drawer.open { transform: translateX(0) }
.drawer-header { background: transparent }
.drawer-body { flex: 1 1 auto }
.drawer-footer { background: #fff }

@media (max-width: 1199px){
  .cart-drawer { width: 360px }
}

/* Mobile: use drawer as a bottom-sheet and adjust typography/sizing for readability */
@media (max-width: 767px){
  .drawer-backdrop { z-index: 1050 }
  .cart-drawer {
    /* bottom-sheet style */
    position: fixed;
    left: 0;
    right: 0;
    bottom: 64px;
    top: auto;
    height: 68vh;
    width: 100%;
    max-width: 100%;
    border-radius: 12px 12px 0 0;
    transform: translateY(100%);
    transition: transform .28s ease;
    box-shadow: 0 -12px 30px rgba(0,0,0,0.12);
    display: flex;
    flex-direction: column;
  }
  .cart-drawer.open { transform: translateY(0) }
  .cart-drawer .drawer-header { padding: 12px 16px }
  .cart-drawer .drawer-header h5 { font-size: 1.05rem }
  .cart-thumb { width:56px; height:56px }
  .list-group-item.py-3 { padding-top:10px; padding-bottom:10px }
  .cart-summary { font-size: 0.95rem }
  .cart-summary .fw-bold { font-size: 1rem }
  .drawer-footer .btn { font-size: 0.95rem; padding:10px 12px }
  /* ensure the drawer body scrolls inside the sheet and leaves room for footer */
  .drawer-body { overflow:auto; max-height: calc(68vh - 160px) }
  /* reduce cart bar conflicts: hide mobile-cart-bar when drawer is open */
  .mobile-cart-bar { bottom: calc(68vh + 8px) }
}

/* Mobile bottom nav */
.mobile-bottom-nav { display:flex; position:fixed; left:0; right:0; bottom:0; height:64px; background:#fff; border-top:1px solid rgba(0,0,0,0.06); z-index:10800; align-items:center; justify-content:space-around }
.mobile-bottom-nav .nav-item { background:transparent; border:none; padding:6px 8px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#333; position:relative }
.mobile-bottom-nav .nav-icon { font-size:20px; line-height:1 }
.mobile-bottom-nav .nav-label { font-size:12px; margin-top:4px }
.mobile-bottom-nav .cart-badge { background:#0d6efd; color:#fff; border-radius:10px; padding:2px 6px; font-size:11px; position:absolute; top:6px; right:12px; margin-left:0 }

/* make mobile cart bar fixed above the bottom nav so it's always visible while scrolling */
.mobile-cart-bar { position:fixed; left:0; right:0; bottom:64px; height:64px; z-index:1048; display:flex; align-items:center; justify-content:space-between; padding:8px 16px; background:#fff; border-top:1px solid rgba(0,0,0,0.06) }
.mobile-cart-bar .btn { margin:0 }

@media (max-width: 767px){
  /* add bottom padding so main content isn't hidden under the mobile cart bar + nav */
  .container.py-4 { padding-bottom: 150px }
}
body { padding-bottom: 110px; }

/* Header / hero customizations */
.company-logo-wrapper { width:96px; height:96px; background: #fff; border-radius:50%; overflow:hidden; box-shadow: 0 6px 18px rgba(0,0,0,0.14); flex: 0 0 96px }
.company-logo { width:100%; height:100%; object-fit:cover }
.company-name { font-size:1.8rem; margin-bottom:0; font-weight:800 }
.company-address { color: rgba(255,255,255,0.9); margin-bottom:4px }
.btn-light-outline { background: rgba(255,255,255,0.08); color: #fff; border: 1px solid rgba(255,255,255,0.12); }
.store-closed { background: rgba(255,255,255,0.06); }
.store-closed .text-danger { color: #ff4d4f !important }

@media (max-width: 767px){
  .company-logo-wrapper { display:none }
  .company-name { font-size:1.2rem }
}

/* Mobile overrides for hero panel */
@media (max-width: 767px){
  .hero-panel { margin-top: -56px; padding: 14px }
  .hero-panel .company-logo-wrapper { display:flex; width:72px; height:72px; flex: 0 0 72px }
  .hero-panel .company-name { font-size: 1.4rem }
  .nav-pills .nav-link { padding-bottom: 14px; position: relative }
  /* animated underline using pseudo-element */
  .nav-pills .nav-link::after { content: ''; position: absolute; left: 12%; right: 12%; height: 3px; bottom: 4px; background: #111; transform: scaleX(0); transform-origin: left center; transition: transform .18s ease; border-radius: 3px }
  .nav-pills .nav-link.active { background: transparent; color: #111; font-weight:700; border-radius:0 }
  .nav-pills .nav-link.active::after { transform: scaleX(1) }
}

/* Desktop/mobile animated underline and active styles handled by pseudo-element */
.nav-pills { --nav-underline-offset: 12%; display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity; scroll-padding-left: 12px }
.nav-pills .nav-item { flex: 0 0 auto; scroll-snap-align: start }
.nav-pills .nav-link { position: relative; white-space: nowrap }
.nav-pills .nav-link::after { content: ''; position: absolute; left: 12%; right: 12%; height: 3px; bottom: -2px; background: #111; transform: scaleX(0); transform-origin: left center; transition: transform .18s ease; border-radius: 3px }
.nav-pills .nav-link.active { background: transparent; color: #111; font-weight:700; border-radius:0 }
.nav-pills .nav-link.active::after { transform: scaleX(1) }

/* custom horizontal scrollbar for category pills */
.nav-pills::-webkit-scrollbar { height: 8px }
.nav-pills::-webkit-scrollbar-track { background: transparent }
.nav-pills::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.08); border-radius: 999px }
.nav-pills { scrollbar-width: thin; scrollbar-color: rgba(0,0,0,0.08) transparent }

/* Scroll styling for product modal options column */
.modal-options-scroll { max-height: 70vh; overflow-y: auto; padding-right: 8px }
.modal-options-scroll::-webkit-scrollbar { width: 10px }
.modal-options-scroll::-webkit-scrollbar-track { background: transparent }
.modal-options-scroll::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(13,110,253,0.18), rgba(13,110,253,0.12)); border-radius: 999px; border: 2px solid rgba(255,255,255,0.0) }
.modal-options-scroll::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(13,110,253,0.22), rgba(13,110,253,0.14)) }
.modal-options-scroll { scrollbar-width: thin; scrollbar-color: rgba(13,110,253,0.18) transparent }

@media (max-width: 767px){
  /* on small screens use native-like thin scrollbar or hide to maximize space */
  .modal-options-scroll { padding-right: 6px }
  .modal-options-scroll::-webkit-scrollbar { width: 6px }
  .modal-options-scroll::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(0,0,0,0.12) }
}

.form-check-input {
  width: 1.4em !important;
  height: 1.4em !important;
  border: 2px solid #CCC !important;
}

/* migration toast (small unobtrusive notice) */
.migration-toast {
  position: fixed;
  top: 16px;
  right: 16px;
  background: #0d6efd;
  color: #fff;
  padding: 12px 14px;
  border-radius: 10px;
  box-shadow: 0 8px 26px rgba(13,110,253,0.18);
  z-index: 12000;
  max-width: 88vw;
  font-size: 0.95rem;
}
.migration-toast .mt-1{ margin-top:6px }
</style>

