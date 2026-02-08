<template>
  <div id="mainMenu" class="container-fluid px-0">
    <!-- Hero banner -->
  <div class="public-hero position-relative text-white" ref="heroRef">
    <div class="hero-image" :style="{ backgroundImage: 'url(' + heroBannerUrl + ')' , backgroundSize: 'cover', backgroundPosition: 'center', filter: 'brightness(0.6)'}" style="position:absolute;inset:0"></div>
    <!-- Top navigation overlay (desktop + mobile) -->
    <header class="top-public-nav position-absolute w-100" style="top:0;left:0;z-index:1015">
      <div class="container d-flex justify-content-end align-items-center p-4">
        <div class="row">
          <div class="col-12">

              <div class="nav-actions d-flex align-items-center gap-3 text-white">
                <a href="#" class="d-none d-md-inline text-white small me-3" @click.prevent="openRegister">Entre ou Cadastre-se</a>
                <button class="btn btn-link text-white p-0 d-flex align-items-center" @click.prevent="goProfile" aria-label="Perfil"><i class="bi bi-person" aria-hidden="true"></i></button>
                <button class="btn btn-link text-white p-0 d-flex align-items-center position-relative" @click.prevent="openCartModal" aria-label="Carrinho">
                  <i class="bi bi-cart-fill" aria-hidden="true"></i>
                  <span v-if="cart.length>0" class="cart-badge-top badge bg-danger rounded-pill">{{ cart.length }}</span>
                </button>
                <button class="btn btn-link text-white p-0 d-lg-none" @click.prevent="toggleMobileMenu" aria-label="Menu"><i class="bi bi-list"></i></button>
              </div>


          </div>
        </div>
        
      </div>
      
    </header>
    </div>

    <!-- Mobile Offcanvas Menu -->
    <div class="offcanvas-backdrop" :class="{ show: mobileMenuOpen }" @click="toggleMobileMenu"></div>
    <div class="offcanvas offcanvas-end" :class="{ show: mobileMenuOpen }" tabindex="-1" aria-labelledby="mobileMenuLabel">
      <div class="offcanvas-header">
        <h5 class="offcanvas-title" id="mobileMenuLabel">Menu</h5>
        <button type="button" class="btn-close" @click="toggleMobileMenu" aria-label="Fechar"></button>
      </div>
      <div class="offcanvas-body">
        <nav class="d-flex flex-column gap-3">
          <a href="#" class="offcanvas-link" @click.prevent="goProfile(); toggleMobileMenu()">
            <i class="bi bi-person me-2"></i> Perfil
          </a>
          <a href="#" class="offcanvas-link" @click.prevent="goOrders(); toggleMobileMenu()">
            <i class="bi bi-journal-text me-2"></i> Histórico
          </a>
          <a href="#" class="offcanvas-link" @click.prevent="openRegister(); toggleMobileMenu()">
            <i class="bi bi-box-arrow-in-right me-2"></i> Entrar / Cadastrar
          </a>
        </nav>
      </div>
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
            <img :src="assetUrl(menu?.logo || company?.logo || 'default-logo.svg')" alt="logo" class="company-logo" />
          </div>
          <div>
            <h3 class="company-name">{{ displayName }}</h3>
            <div class="small company-address text-muted">{{ displayPickup || '' }}</div>
            <div class="small"><a href="#" class="text-muted more-information" @click.prevent="openInfoModal">Mais informações</a></div>
              <div class="d-flex align-items-center gap-2 mb-1">
                      <div class="store-closed-panel d-flex align-items-center">
                        <span v-if="isOpen" class="badge bg-primary">{{ openUntilText || ('Aberto — Horário: ' + companyHoursText) }}</span>
                        <span v-else class="badge bg-secondary bg-danger">Fechado no momento{{ nextOpenText ? (', ' + nextOpenText) : '' }}</span>
                    
                      </div>
              <div>
           
          </div>

        </div>

        <div class="d-flex align-items-center gap-2">
            <span v-if="(menu?.allowDelivery ?? true)" class="badge bg-secondary me-1">Entrega</span>
            <span v-if="(menu?.allowPickup ?? true)" class="badge bg-secondary">Retirada</span>
            </div>

          </div>
        </div>
        
      </div>
      
    </div>
    <!-- Mobile compact cart bar (visible on small screens) -->
  <div v-if="cart.length > 0 && !cartModalOpen && !modalOpen && !checkoutModalOpen" class="mobile-cart-bar d-lg-none d-flex justify-content-between align-items-center px-3 py-2" style="background:#fff; border-top:1px solid rgba(0,0,0,0.06); z-index:1070">
      <div>
        <strong>{{ formatCurrency(subtotal) }}</strong> / {{ cart.length }} item{{ cart.length>1 ? 's' : '' }}
        <div class="small text-muted">Total sem entrega</div>
      </div>
      <div>
        <template v-if="isOpen">
          <button class="btn btn-primary btn-sm" @click="openCartModal">Ver carrinho</button>
        </template>
        <template v-else>
          <div class="text-muted small">Fora do horário de atendimento</div>
        </template>
      </div>
    </div>

  <!-- Mobile bottom navigation (fixed) -->
  <nav class="mobile-bottom-nav d-lg-none" v-show="!modalOpen && !cartModalOpen && !checkoutModalOpen">
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

    <div class="hero-panel mt-3 container py-3">

      <div v-if="loading" class="text-center py-5">
        <div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>
      </div>

      <div v-else>
      <!-- Campo de busca -->
      <div class="search-categories-container mb-3">
        <!-- unified category pills (mobile + desktop) -->
        <div v-if="categories.length" class="categories-pills" :class="{ 'search-active': searchExpanded }">
          <ul ref="navRef" class="nav nav-pills overflow-auto" :class="{ stuck: isNavSticky }" style="gap:2px;">
            <li class="nav-item" v-for="(cat, idx) in categories" :key="cat.id">
              <a :href="`#cat-${cat.id}`" class="nav-link" :class="{ active: activeCategoryId === (cat.id) }" @click.prevent="selectCategory(cat.id)">{{ cat.name }}</a>
            </li>
            <li class="nav-item">
              <a href="#products-start" class="nav-link" :class="{ active: activeCategoryId === null }" @click.prevent="selectCategory(null)">Todos</a>
            </li>
          </ul>
        </div>
        
        <!-- Search box -->
        <div class="search-box" :class="{ expanded: searchExpanded }">
          <!-- Ícone de busca clicável em mobile -->
          <button 
            class="search-toggle-btn d-lg-none"
            :class="{ hidden: searchExpanded }"
            @click="toggleSearch"
            aria-label="Abrir busca"
          >
            <i class="bi bi-search"></i>
          </button>
          
          <!-- Container do input (sempre visível em desktop, expansível em mobile) -->
          <div class="search-input-container" :class="{ show: searchExpanded }">
            <i class="bi bi-search search-icon d-none d-lg-inline"></i>
            <input 
              ref="searchInputRef"
              v-model="productSearchTerm" 
              type="text" 
              class="form-control search-input" 
              placeholder="Buscar produtos..." 
              @input="handleProductSearch"
            />
            <!-- Botão X para fechar em mobile ou limpar em desktop -->
            <button 
              v-if="searchExpanded || productSearchTerm"
              class="btn btn-link search-clear" 
              @click="searchExpanded ? closeSearch() : clearProductSearch()"
              :aria-label="searchExpanded ? 'Fechar busca' : 'Limpar busca'"
            >
              <i class="bi bi-x-circle"></i>
            </button>
          </div>
        </div>
      </div>
      
        <div class="row">
        
          <div :class="cart.length > 0 ? 'col-12' : 'col-sm-12'">
            <!-- products list: category sections -->
            <div id="products-start"></div>
            
            <!-- Mensagem quando nenhum produto é encontrado -->
            <div v-if="productSearchTerm && visibleCategories.length === 0" class="text-center py-5">
              <i class="bi bi-search" style="font-size: 3rem; color: #dee2e6;"></i>
              <p class="text-muted mt-3">Nenhum produto encontrado para "{{ productSearchTerm }}"</p>
              <button class="btn btn-outline-primary btn-sm" @click="clearProductSearch">Limpar busca</button>
            </div>
            
            <div v-for="cat in visibleCategories" :key="cat.id" :id="`cat-${cat.id}`" class="mb-4">
              <h5 class="mb-3">{{ cat.name }}</h5>
              <div class="row gx-3 gy-3">
                <div class="col-12 col-lg-6" v-for="p in cat.products" :key="p.id">
                  <div class="product-card d-flex justify-content-between align-items-start p-3" @click="openProductModal(p)" tabindex="0" @keydown.enter="openProductModal(p)">
                    <div class="product-card-body d-flex flex-column justify-content-between">
                      <div>
                      <h6 class="mb-1 product-title">{{ p.name }}</h6>
                      <div class="small text-muted product-desc">{{ p.description }}</div>
                      </div>
                      <div>
                      <div class="d-flex align-items-center gap-3">
                        <strong class="product-price">
                          <span v-if="getStartingPrice(p) > Number(p.price || 0)"><small>A partir de</small> {{ formatCurrency(getStartingPrice(p)) }}</span>
                          <span v-else>{{ formatCurrency(p.price) }}</span>
                        </strong>
                        <div v-if="(p.cashback || p.cashbackPercent) && Number(p.cashback || p.cashbackPercent) > 0" class="badge bg-success">{{ Number(p.cashback || p.cashbackPercent) }}% cashback</div>
                      </div>
                      </div>
                    </div>
                    <div class="product-card-media text-end">
                      <div class="add-to-card-plus"><i class="bi bi-cart-plus"></i></div>
                      <div>
                        <img v-if="p.image" :src="assetUrl(p.image)" class="product-image" />
                        <div v-else class="bg-light product-image-placeholder"></div>
                      </div>
                      
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
            <strong>{{ formatCurrency(finalTotal) }}</strong>
            <div class="small text-muted">/ {{ cart.length }} item{{ cart.length>1 ? 's' : '' }}</div>
          </div>
          <div class="cart-action">
            <template v-if="isOpen">
              <button class="btn btn-advance" @click="openCartModal">Ver carrinho</button>
            </template>
            <template v-else>
              <div class="text-muted small">Fora do horário de atendimento</div>
            </template>
          </div>
        </div>
        
        <!-- Product options modal -->
        <div v-if="modalOpen" class="product-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:11000">
          <div class="modal-content bg-white rounded shadow p-0">
            <div class="modal-body p-4" ref="modalContentRef" @pointerdown="onPointerDown" style="overflow:auto;max-height:100vh;padding-bottom:90px !important;">
          <div class="row">
              <!-- product image hero inside modal -->
              <div class="col-12 col-sm-6">
                  <div v-if="selectedProduct?.image" class="modal-product-hero mb-3 position-relative">
                    <img :src="assetUrl(selectedProduct.image)" alt="Imagem do produto" class="modal-product-img" />
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
                   <TextInput v-model="searchTerm" placeholder="Pesquise pelo nome" inputClass="form-control" />
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
                        <div class="d-flex justify-content-between align-items-center option-row">
                          <div class="d-flex align-items-center gap-2" >
                            <img v-if="opt.image" :src="optionThumbUrl(opt)" @error="onOptionThumbError($event,opt)" style="width:40px;height:40px;object-fit:cover;border-radius:6px" />
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
                        <div class="d-flex justify-content-between align-items-center option-row">
                          <div class="d-flex align-items-center gap-2 option-left">
                            <img v-if="opt.image" :src="optionThumbUrl(opt)" @error="onOptionThumbError($event,opt)" class="option-thumb" />
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
                  <input type="number" v-model.number="modalQty" class="form-control text-center qty-input" style="width:60px" min="1" @blur="modalQty = Math.max(1, Math.floor(Number(modalQty) || 1))" />
                  <button class="btn btn-outline-secondary btn-qty" @pointerdown.prevent="startModalAutoChange(1, $event)" @pointerup.prevent="stopModalAutoChange($event)" @pointerleave.prevent="stopModalAutoChange($event)">+</button>
                </div>
                <div class="w-100">
                  <button class="add-btn btn-primary w-100" @click="confirmAddFromModal" :style="{ '--accent': company?.primaryColor || '#0d6efd' }" aria-label="Adicionar ao carrinho">
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
       

        <!-- Cart view: unified drawer is used for all screen sizes (replaces the old centered mobile modal) -->

  
        
  <!-- Multi-step checkout modal -->
  
      </div>
      <div v-if="checkoutModalOpen" class="product-modal checkout-modal full-mobile" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:11000">
  <div :class="['modal-content','bg-white','rounded','shadow','modal-content-padding']">
    <div class="d-flex align-items-center justify-content-between mb-3 checkout-header">
      <div class="step-back">
        <button v-if="stepIndex > 0" class="btn btn-outline-secondary btn-sm close-x" @click="goBackFromStep"><i class="bi bi-chevron-left"></i></button>
      </div>
      <div class="modal-title text-center flex-fill">
        <h5 class="m-0">{{ stepLabels[checkoutStep] }}</h5>
      </div>
      <div class="step-close">
        <button class="btn btn-sm btn-outline-secondary close-x" @click="closeCheckout" aria-label="Fechar">&times;</button>
      </div>
        </div>
        <div class="checkout-body">
          <div class="d-flex justify-content-between align-items-center mb-4">
              <div class="checkout-stepper w-100">
                <div v-for="(s, idx) in stepOrder" :key="s" :class="['step', { completed: idx < stepIndex, active: idx === stepIndex }]">
                  <div class="step-icon" aria-hidden="true">
                    <i :class="['bi', stepIcons[s]]"></i>
                  </div>
                  <div class="step-label">{{ stepLabels[s] }}</div>
                </div>
              </div>
            </div>

            <div v-if="checkoutStep === 'customer'">
              <!-- Match spacing and rhythm used in the review step -->
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <div class="d-flex align-items-center">
                    <i class="bi bi-person me-2 text-muted" aria-hidden="true"></i>
                    <div>
                      <div class="fw-bold">Cliente</div>
                      <div class="small text-muted">Preencha seu nome e WhatsApp para prosseguir</div>
                    </div>
                  </div>
                </div>

                <div class="mb-2">
                  <TextInput label="WhatsApp / Telefone" labelClass="form-label" v-model="customer.contact" inputClass="form-control" placeholder="(00) 9 0000-0000" maxlength="16" @input="handleContactInput" />
                  <div class="small mt-1" :class="customerPhoneValid ? 'text-success' : 'text-danger'">
                    <template v-if="customer.contact && customer.contact.length">
                      <span v-if="customerPhoneValid">Número válido</span>
                      <span v-else>Formato inválido — inclua DDD (ex: (11) 9 9123-4567)</span>
                    </template>
                  </div>
                </div>
                <div class="mb-2">
                  <TextInput v-if="!accountHasPassword" label="Nome" labelClass="form-label" v-model="customer.name" inputClass="form-control" />
                  <TextInput v-else type="password" label="Senha" labelClass="form-label" v-model="customerPassword" inputClass="form-control" autocomplete="current-password" />
                  <div v-if="accountCheckLoading" class="small text-muted mt-1">Verificando conta...</div>
                </div>
                <div class="small mt-2">
                  <a v-if="!accountHasPassword" href="#" @click.prevent="openRegister">Não tem conta? Criar conta</a>
                  <span v-if="accountExists && !accountHasPassword" class="text-muted ms-2">Conta encontrada sem senha</span>
                </div>
              </div>

              <div class="d-flex justify-content-between mt-3">
                <button class="btn btn-outline-secondary" @click="closeCheckout">Cancelar</button>
                <button class="btn btn-primary btn-confirm" @click="nextFromCustomer" :disabled="accountHasPassword ? (!customerPhoneValid || !customerPassword) : (!customer.name || !customerPhoneValid)">Próximo</button>
              </div>
            </div>

            <div v-if="checkoutStep === 'delivery'">
              <!-- Mirror review spacing: group controls and content into tidy vertical rhythm -->
              <div class="mb-3">
                <div class="order-type-toggle d-flex gap-3">
                  <label :class="['ot-btn', { active: orderType === 'DELIVERY' }]">
                    <input type="radio" id="modalOrderTypeDelivery" value="DELIVERY" v-model="orderType" />
                    <span class="ot-circle" aria-hidden="true"></span>
                    <span class="ot-label">Entrega</span>
                  </label>
                  <label :class="['ot-btn', { active: orderType === 'PICKUP' }]">
                    <input type="radio" id="modalOrderTypePickup" value="PICKUP" v-model="orderType" />
                    <span class="ot-circle" aria-hidden="true"></span>
                    <span class="ot-label">Retirada</span>
                  </label>
                </div>
              </div>

              <div v-if="orderType === 'DELIVERY'">
                <!-- Banner for logged-in public customer: quick account actions -->
                <div v-if="publicCustomerConnected" class="mb-3">
                  <div class="alert alert-light d-flex justify-content-between align-items-center" style="border-radius:12px;">
                    <div><small>Conectado como:  <div class="fw-bold">{{ publicCustomerConnected.name || publicCustomerConnected.contact }}</div></small>
                    </div>
                    <div class="d-flex gap-2">
                      <button class="btn btn-sm btn-outline-secondary btn-action" @click.prevent="switchAccount"><i class="bi bi-arrow-down-up"></i></button>
                      <button class="btn btn-sm btn-outline-danger btn-delete" @click.prevent="logoutPublicCustomer">Sair</button>
                    </div>
                  </div>
                </div>
                <!-- No saved addresses: show the inline address form so the user can
                     enter an address and continue without having to persist it. -->
                <div v-if="addresses.length === 0">
                  <div class="mb-3 border p-2">
                    <h6 class="mb-2">Endereço</h6>
                    <div class="row mb-2">
                      <div class="col-8"><TextInput v-model="_newAddrFormatted" placeholder="Endereço (rua, avenida)" inputClass="form-control" /></div>
                      <div class="col-4"><TextInput v-model="_newAddrNumber" placeholder="Número" inputClass="form-control" /></div>
                    </div>
                    <div class="mb-2"><TextInput v-model="_newAddrComplement" placeholder="Complemento (apto, bloco, etc)" inputClass="form-control" /></div>
                    <div class="mb-2"><TextInput v-model="_newAddrReference" placeholder="Referência (ex: Apt 4, próximo ao mercado)" inputClass="form-control" /></div>
                    <div class="mb-2"><TextInput v-model="_newAddrObservation" placeholder="Observação (ex: deixar na portaria)" inputClass="form-control" /></div>
                      <div class="mb-2">
                        <label class="form-label small">Bairro</label>
                        <SelectInput   v-model="_newAddrNeighborhood"  class="form-select">
                          <option value="" disabled>Escolha um bairro...</option>
                          <option v-for="n in neighborhoodsList" :key="n.id" :value="n.name">{{ n.name }} — {{ formatCurrency(n.deliveryFee) }}</option>
                        </SelectInput>
                      </div>
                    <!-- Buttons removed: advancing will save and proceed; clear removed per UX request -->
                  </div>
                  <div class="mt-2">
                    <button class="btn btn-sm btn-outline-primary" @click="useMyLocation" :disabled="_locating">{{ _locating ? 'Localizando...' : 'Usar minha localização' }}</button>
                  </div>
                </div>

                <!-- User has saved addresses: show selector + small shortcut to reveal the "new address" form -->
                <div v-else>
                  <ListGroup :items="addresses" item-key="id" :selected-id="selectedAddressId" @select="selectedAddressId = $event" @edit="editAddress" @remove="removeAddress" />

                  <div class="small mb-2"><a href="#" @click.prevent="showNewAddressForm = !showNewAddressForm">Cadastrar novo endereço</a></div>

                  <div v-if="showNewAddressForm" class="mb-3 border p-3" style="border-radius: 12px;">
                    <h6 class="mb-2"><strong>Endereço</strong></h6>
                    <div class="row mb-2">
                      <div class="col-8">
                        <TextInput v-model="_newAddrFormatted" placeholder="Endereço (rua, avenida)" inputClass="form-control" />
                      </div>
                      <div class="col-4">
                        <TextInput v-model="_newAddrNumber" placeholder="Número" inputClass="form-control" />
                      </div>
                    </div>
                    <div class="mb-2">
                      <TextInput v-model="_newAddrComplement" placeholder="Complemento (apto, bloco, etc)" inputClass="form-control" />
                    </div>
                    <div class="mb-2">
                      <label class="form-label small">Bairro</label>
                      <SelectInput   v-model="_newAddrNeighborhood"  class="form-select">
                        <option value="" disabled>Escolha um bairro...</option>
                        <option v-for="n in neighborhoodsList" :key="n.id" :value="n.name">{{ n.name }} — {{ formatCurrency(n.deliveryFee) }}</option>
                      </SelectInput>
                    </div>
                    <div class="mb-2"><TextInput v-model="_newAddrReference" placeholder="Referência (ex: próximo ao mercado)" inputClass="form-control" /></div>
                    <div class="mb-2"><TextInput v-model="_newAddrObservation" placeholder="Observação (ex: deixar na portaria)" inputClass="form-control" /></div>
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
                <button class="btn btn-primary btn-next d-none d-sm-block" @click="nextFromDelivery">Próximo <i class="bi bi-chevron-right"></i></button>
              </div>
            </div>

            <div v-if="checkoutStep === 'payment'">
              <div class="alert alert-light flex-column d-flex justify-content-between align-items-center mb-3 p-2">
                

                <div class="coupon-block" style="width:100%">
                  <div class="d-flex justify-content-between align-items-center">
                     <div class="summary-icon"><i class="bi bi-ticket-perforated"></i></div>
                    <div class="small">Tem um cupom? Clique e insira o código</div>
                    <button class="btn btn-sm btn-outline-secondary" @click.prevent="openCoupon = !openCoupon">›</button>
                  </div>

                  <div v-show="openCoupon" class="mt-2" style="width:100%">
                    <div v-if="couponApplied" class="d-flex align-items-center justify-content-between mb-2">
                      <div>
                        <div class="small text-success">Cupom aplicado: <strong>{{ couponInfo?.code }}</strong></div>
                        <div class="small text-success">Desconto: {{ formatCurrency(couponDiscount) }}</div>
                      </div>
                      <div class="d-flex gap-2">
                        <button class="btn btn-sm btn-outline-secondary" @click="removeCoupon">Remover</button>
                        <button class="btn btn-sm btn-outline-secondary" @click.prevent="openCoupon = true">Editar</button>
                      </div>
                    </div>
                    <div v-else>
                      <div class="d-flex gap-2">
                        <TextInput v-model="couponCode" placeholder="Código do cupom" inputClass="form-control" />
                        <button class="btn btn-primary btn-sm" @click="applyCoupon" :disabled="couponLoading">
                          <span v-if="couponLoading" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                          Aplicar
                        </button>
                        </div>
                      <div v-if="tipMessages['coupon']" class="small text-danger mt-1">{{ tipMessages['coupon'] }}</div>
                    </div>
                  </div>
                </div>
              </div>
                <div v-if="cashbackEnabled" class="mt-3 alert alert-light p-2" :class="{ 'use-cashback': publicCustomerConnected, 'use-cashback--active': useCashback }"
                  role="button"
                  tabindex="0"
                  @click="publicCustomerConnected ? (useCashback = !useCashback) : null"
                  @keydown.enter.prevent="publicCustomerConnected ? (useCashback = !useCashback) : null">
                <div   class="d-flex justify-content-between align-items-center">
                  <div class="d-flex align-items-center gap-2">
                    <div class="summary-icon"><i class="bi bi-cash-stack"></i></div>
                    <div>
                      <div class="small">Saldo de cashback</div>
                      <div class="fw-bold">{{ walletLoaded ? new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(wallet.balance||0)) : '—' }}</div>
                    </div>
                  </div>
                  <div>
                    <template v-if="publicCustomerConnected">
                      <div class="d-flex align-items-center">
                        <button
                          type="button"
                          class="btn btn-primary btn-sm cashback-toggle"
                          :class="{ active: useCashback }"
                          @click.stop="useCashback = !useCashback"
                          :aria-pressed="String(useCashback)"
                        >
                          Usar cashback
                        </button>
                      </div>
                    </template>
                    <template v-else>
                      <small class="text-muted">Conecte-se para usar cashback</small>
                    </template>
                  </div>
                </div>
                <div v-if="useCashback" class="mt-2">
                  <div class="d-flex" style="gap: 8px;">
                      <CurrencyInput v-model="useCashbackAmount" :min="0" :max="Math.min(Number(wallet.balance||0), Number(finalTotal))" inputClass="form-control" @click.stop @pointerdown.stop />
                    <button class="btn btn-primary btn-sm" type="button" @click.stop="useCashbackAmount = Math.min(Number(wallet.balance||0), Number(finalTotal))">Máx</button>

                  </div>
                  
                  <div class="small text-muted mt-1">Máx. {{ formatCurrency(Math.min(Number(wallet.balance||0), Number(finalTotal))) }}</div>
                </div>
              </div>
                  <ListGroup :items="paymentMethods" itemKey="code" :selectedId="paymentMethod" :showActions="false" @select="paymentMethod = $event">
                    <template #primary="{ item }">
                      <div><strong>{{ item.name }}</strong></div>
                      <div v-if="item.description" class="small text-muted">{{ item.description }}</div>
                    </template>
                  </ListGroup>

                  <div v-if="paymentMethod === 'CASH'" class="mt-2">
                      <div class="input-group">
                      <span class="input-group-text">R$</span>
                      <CurrencyInput labelClass="form-label" v-model="changeFor" :min="0" inputClass="form-control" placeholder="Troco para..."/>
                    </div>
                  </div>
                
                
                
                
              <div class="d-flex justify-content-between mt-3">
                <button class="btn btn-primary btn-next d-none d-sm-block" @click="goToReview">Próximo <i class="bi bi-chevron-right"></i></button>
              </div>
            </div>

            <div v-if="checkoutStep === 'review'">

              <!-- Customer & Address quick-edit rows (matches drawer spacing) -->
              <div class="mb-3">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <div class="d-flex align-items-center">
                    <div class="summary-icon"><i class="bi bi-person text-muted" aria-hidden="true"></i></div>
                    <div>
                      <div class="fw-bold">{{ customer.name || '' }}</div>
                      <div class="small text-muted">{{ customer.contact || '' }}</div>
                    </div>
                  </div>
                  <button class="btn btn-link btn-summary" @click="checkoutStep = 'customer'" aria-label="Editar cliente"><i class="bi bi-pencil"></i></button>
                </div>

                <div class="d-flex justify-content-between align-items-start">
                  <div class="d-flex align-items-center">
                    <div class="summary-icon"><i class="bi bi-geo-alt text-muted" aria-hidden="true"></i></div>
                    <div>
                      <template v-if="orderType === 'PICKUP'">
                        <div class="fw-bold">Retirar pedido em:</div>
                        <div class="fw-bold">{{ displayPickup || 'Endereço não cadastrado' }}</div>
                      </template>
                      <template v-else>
                        <div class="fw-bold">{{ (addresses.find(a=>a.id===selectedAddressId) || {}).formattedAddress || '' }}<span v-if="(addresses.find(a=>a.id===selectedAddressId) || {}).number">, {{ (addresses.find(a=>a.id===selectedAddressId) || {}).number }}</span></div>
                        <div class="small text-muted">{{ (addresses.find(a=>a.id===selectedAddressId) || {}).neighborhood || '' }}</div>
                        <div v-if="(addresses.find(a=>a.id===selectedAddressId) || {}).complement" class="small text-muted">Comp.: {{ (addresses.find(a=>a.id===selectedAddressId) || {}).complement }}</div>
                        <div v-if="(addresses.find(a=>a.id===selectedAddressId) || {}).reference" class="small text-muted">Ref.: {{ (addresses.find(a=>a.id===selectedAddressId) || {}).reference }}</div>
                        <div v-if="(addresses.find(a=>a.id===selectedAddressId) || {}).observation" class="small text-muted">Obs.: {{ (addresses.find(a=>a.id===selectedAddressId) || {}).observation }}</div>
                      </template>
                    </div>
                  </div>
                  <template v-if="orderType !== 'PICKUP'">
                    <button class="btn btn-link btn-summary" @click="checkoutStep = 'delivery'" aria-label="Editar endereço"><i class="bi bi-pencil"></i></button>
                  </template>
                  <!-- icon removed for pickup mode -->
                </div>
              </div>

              <!-- Cart items: single-line, qty badge, name + wrapped options, price on right -->
              <ul class="list-group mb-2">
                <li class="list-group-item py-2 cart-line" v-for="(it, i) in cart" :key="it.lineId">
                  <div class="d-flex align-items-start">
                    <div class="cart-item-qty text-muted me-3">{{ it.quantity }}x</div>
                    <div class="cart-item-name flex-fill me-3" style="min-width:0">
                      <div class="product-name">{{ it.name }}</div>
                      <div v-if="it.options && it.options.length" class="small text-muted option-summary drawer-wrap">{{ optionsSummaryNoPrice(it) }}</div>
                      <div v-for="(e, idx) in getLineDiscountEntries(it)" :key="idx" class="small text-success mt-1">{{ e.description }}: -{{ formatCurrency(e.amount) }}</div>
                    </div>
                    <div class="cart-item-price text-end">
                      <template v-if="computeLineDiscount(it) > 0">
                        <div class="small text-muted text-decoration-line-through">{{ formatCurrency(it.price * it.quantity) }}</div>
                        <div class="fw-bold">{{ formatCurrency((it.price * it.quantity) - computeLineDiscount(it)) }}</div>
                      </template>
                      <template v-else>
                        {{ formatCurrency(it.price * it.quantity) }}
                      </template>
                    </div>
                    <div class="cart-item-actions d-flex align-items-center ms-3">
                      <button class="btn btn-sm btn-outline-secondary me-2" @click="editCartItem(i)" aria-label="Editar item"><i class="bi bi-pencil"></i></button>
                      <button class="btn btn-sm btn-outline-danger" @click="removeItem(i)" aria-label="Remover item"><i class="bi bi-trash"></i></button>
                    </div>
                  </div>
                </li>
              </ul>

              <!-- Totals (use same spacing as drawer) -->
              <div class="checkout-totals mb-2" style="max-width:420px">
                <div class="d-flex justify-content-between"><div class="text-muted">Subtotal</div><div>{{ formatCurrency(subtotal) }}</div></div>
                <div v-if="couponApplied" class="d-flex justify-content-between text-success"><div>Cupom</div><div>-{{ formatCurrency(couponDiscount) }}</div></div>
                <div v-if="discountsTotal > 0" class="d-flex justify-content-between text-success"><div>Descontos</div><div>-{{ formatCurrency(discountsTotal) }}</div></div>
                <div v-if="orderType==='DELIVERY'">
                  <div class="d-flex justify-content-between"><div class="text-muted">Taxa de entrega</div><div>{{ Number(currentDeliveryFee) === 0 ? 'Grátis' : formatCurrency(currentDeliveryFee) }}</div></div>
                </div>
                <div v-if="useCashback && Number(useCashbackAmount) > 0" class="d-flex justify-content-between text-success"><div>Cashback usado</div><div>-{{ formatCurrency(useCashbackAmount) }}</div></div>
                <div class="d-flex justify-content-between fw-bold mt-2"><div>Total</div><div>{{ formatCurrency(finalTotal) }}</div></div>
              </div>

              <!-- Payment row with quick edit -->
              <div class="d-flex justify-content-between align-items-center mt-3">
                <div class="d-flex align-items-center">
                  <div class="summary-icon"><i class="bi bi-credit-card text-muted" aria-hidden="true"></i></div>
                  <div>
                    <div class="fw-bold">Pagamento</div>
                    <div class="small text-muted">{{ (paymentMethods.find(m=>m.code===paymentMethod) || {}).name }}</div>
                    <div class="small text-muted" v-if="Number(changeFor) > 0">Troco para: {{ formatCurrency(Number(changeFor) || 0) }}</div>
                  </div>
                </div>
                <button class="btn btn-link btn-summary" @click="checkoutStep = 'payment'" aria-label="Editar pagamento"><i class="bi bi-pencil"></i></button>
              </div>

              <div class="d-flex justify-content-between mt-3">
                <button class="btn btn-success btn-next d-none d-sm-block" @click="performOrderFromModal">Confirmar pedido</button>
              </div>
            </div>
          </div>
    </div>

    <!-- Mobile fixed footer for checkout actions (visible only on small screens) -->
    <div class="checkout-footer d-flex d-lg-none justify-content-between align-items-center">
      <!-- <button class="btn btn-outline-secondary flex-fill me-2" @click="stepIndex > 0 ? goBackFromStep() : closeCheckout()">{{ stepIndex > 0 ? 'Voltar' : 'Cancelar' }}</button>
      <div style="width:12px"></div>-->
      <button v-if="checkoutStep === 'review'" class="btn btn-success flex-fill btn-next" @click="performOrderFromModal">Confirmar pedido</button>
      <button v-else-if="checkoutStep === 'customer'" class="btn btn-primary flex-fill btn-next" :disabled="!customer.name || !customerPhoneValid" @click="nextFromCustomer">Próximo</button>
      <button v-else-if="checkoutStep === 'delivery'" class="btn btn-primary flex-fill btn-next" @click="nextFromDelivery">Próximo</button>
      <button v-else-if="checkoutStep === 'payment'" class="btn btn-primary flex-fill btn-next" @click="goToReview">Próximo</button>
    </div>

          </div>
        </div>
    </div>
  </div>
   <!-- Unified slide-in drawer (used on desktop and mobile) -->
  <div class="drawer-backdrop" v-if="cartModalOpen && cart.length > 0" @click="closeCartModal"></div>
  <aside class="cart-drawer" :class="{ open: cartModalOpen && cart.length > 0 }" :aria-hidden="!cartModalOpen" role="dialog" aria-label="Carrinho">
          <div class="drawer-header d-flex justify-content-between align-items-center p-3 border-bottom">
            <h5 class="m-0">Sua sacola</h5>
            <div class="d-flex align-items-center gap-2">
              <button class="btn btn-sm btn-outline-secondary close-x" @click="closeCartModal" aria-label="Fechar">&times;</button>
            </div>
          </div>
          <div class="drawer-body p-3" style="overflow:auto;">
            <div v-if="cart.length===0" class="text-muted">Sua sacola está vazia.</div>
            <ul v-else class="list-group mb-3">
              <li class="list-group-item cart-line" v-for="(it, i) in cart" :key="it.lineId">
                <div class="d-flex align-items-start">
                  <div class="cart-item-qty text-muted me-3">{{ it.quantity }}x</div>
                  <div class="d-flex flex-column w-100">
                  <div class="d-flex w-100">
                  <div class="cart-item-name flex-fill me-3" style="min-width:0">
                    <div class="product-name">{{ it.name }}</div>
                    <div v-for="(e, idx) in getLineDiscountEntries(it)" :key="'d2-'+idx" class="small text-success mt-1">{{ e.description }}: -{{ formatCurrency(e.amount) }}</div>
                  </div>
                  <div class="cart-item-price text-end me-3">
                    <template v-if="computeLineDiscount(it) > 0">
                      <div class="small text-muted text-decoration-line-through">{{ formatCurrency(it.price * it.quantity) }}</div>
                      <div class="fw-bold">{{ formatCurrency((it.price * it.quantity) - computeLineDiscount(it)) }}</div>
                    </template>
                    <template v-else>
                      {{ formatCurrency(it.price * it.quantity) }}
                    </template>
                  </div>
                  </div>
                  <div class="d-flex w-100 justify-content-between align-items-center">
                    <div class="small text-muted option-summary drawer-wrap">{{ optionsSummaryNoPrice(it) }}</div>
                    <div class="cart-item-actions d-flex align-items-center ms-3">
                      <button class="btn btn-sm btn-outline-secondary me-2" @click="editCartItem(i)" aria-label="Editar item"><i class="bi bi-pencil"></i></button>
                      <button class="btn btn-sm btn-outline-danger" @click="removeItem(i)" aria-label="Remover item"><i class="bi bi-trash"></i></button>
                    </div>
                  </div>
                </div>
              </div>
              </li>
            </ul>

            <!-- summary and coupon area -->
            <div class="cart-summary p-3 border-top">
                        <div class="d-flex justify-content-between mb-2"><div>Subtotal</div><div>{{ formatCurrency(subtotal) }}</div></div>
                        <div class="d-flex justify-content-between mb-2"><div>Taxa de entrega</div><div>
                          <template v-if="orderType==='DELIVERY'">
                            <template v-if="neighborhood && String(neighborhood).trim() !== ''">
                              {{ Number(currentDeliveryFee) === 0 ? 'Grátis' : formatCurrency(currentDeliveryFee) }}
                            </template>
                            <template v-else>
                              Será calculada após escolher o endereço
                            </template>
                          </template>
                          <template v-else>
                            —
                          </template>
                        </div></div>
                        <hr />
                        <div v-if="couponApplied" class="d-flex justify-content-between mb-2 text-success"><div>Cupom ({{ couponInfo?.code || '' }})</div><div>-{{ formatCurrency(couponDiscount) }}</div></div>
                        <div v-if="discountsList.length>0" class="d-flex justify-content-between mb-2 text-success"><div>Desconto(s)</div><div>-{{ formatCurrency(discountsTotal) }}</div></div>
                        <div class="d-flex justify-content-between fw-bold mb-2"><div>Total</div><div>{{ formatCurrency(Math.max(0, subtotal - (couponDiscount || 0) - (discountsTotal || 0)) + currentDeliveryFee) }}</div></div>

              <div class="coupon-block mt-3">
                <div class="d-flex justify-content-between align-items-center">
                  <div class="small">Tem um cupom? Clique e insira o código</div>
                  <button class="btn btn-sm btn-outline-secondary" @click="openCoupon = !openCoupon">›</button>
                </div>
                <div v-show="openCoupon" class="mt-2">
                  <div class="input-group">
                    <TextInput v-model="couponCode" placeholder="Código do cupom" inputClass="form-control" />
                    <button class="btn btn-primary" @click="applyCoupon" :disabled="couponLoading">
                      <span v-if="couponLoading" class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Aplicar
                    </button>
                  </div>
                  <div class="mt-2">
                    <div v-if="tipMessages['coupon']" class="small text-danger">{{ tipMessages['coupon'] }}</div>
                    <div v-if="tipMessages['coupon-success']" class="small text-success">{{ tipMessages['coupon-success'] }}</div>
                    <div v-if="couponApplied" class="mt-2 d-flex align-items-center gap-2">
                      <small class="text-success">Cupom aplicado: <strong>{{ couponInfo?.code }} — {{ formatCurrency(couponDiscount) }}</strong></small>
                      <button class="btn btn-sm btn-outline-secondary" @click="removeCoupon">Remover</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="drawer-footer p-3 border-top d-flex justify-content-end align-items-center">
            <div class="d-flex gap-2 w-100">
              <button class="btn btn-outline-secondary flex-fill" @click="closeCartModal">Continuar comprando</button>
              <button class="btn btn-primary flex-fill d-flex align-items-center justify-content-center" :disabled="cart.length===0 || submitting || !isOpen" @click="proceedFromCart">
                <div class="d-flex flex-column align-items-end me-3" style="line-height:1">
                  <strong style="display:block">{{ formatCurrency(finalTotal) }}</strong>
                  <small class="text-white" style="display:block">{{ cart.length }} item{{ cart.length>1 ? 's' : '' }}</small>
                </div>
                <span>Avançar</span>
              </button>
            </div>
          </div>
        </aside>
        <!-- Simple info modal (opened from 'Mais informações') with tabs -->
        <div v-if="infoModalOpen" class="product-modal" style="position:fixed;inset:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:11100">
          <div class="modal-content bg-white rounded shadow p-3" style="width:520px;max-width:94%;">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h5 class="m-0">Informações da loja</h5>
              <div><button class="btn btn-sm btn-outline-secondary close-x" @click="closeInfoModal" aria-label="Fechar">&times;</button></div>
            </div>
            <div class="modal-body p-2" style="max-height:60vh;overflow:auto">
              <ul class="nav nav-tabs mb-3" role="tablist">
                <li class="nav-item" role="presentation"><button type="button" :class="['nav-link', infoTab === 'hours' ? 'active' : '']" @click="infoTab = 'hours'">Horário</button></li>
                <li class="nav-item" role="presentation"><button type="button" :class="['nav-link', infoTab === 'contacts' ? 'active' : '']" @click="infoTab = 'contacts'">Contatos</button></li>
                <li class="nav-item" role="presentation"><button type="button" :class="['nav-link', infoTab === 'payments' ? 'active' : '']" @click="infoTab = 'payments'">Formas de pagamento</button></li>
              </ul>

              <div v-show="infoTab === 'hours'">
                <div class="mb-2">
                  <strong>Horário</strong>
                  <div v-if="scheduleList && scheduleList.length">
                    <ul class="list-unstyled small mb-0">
                      <li v-for="d in scheduleList" :key="d.day" :class="{ 'fw-bold': isTodaySchedule(d) }">
                        <span>{{ weekDayNames[Number(d.day) || 0] }} - </span>
                        <span v-if="d.enabled">Abre {{ d.from || '--:--' }} fecha {{ d.to || '--:--' }}</span>
                        <span v-else class="text-muted">Fechado</span>
                      </li>
                    </ul>
                    <div class="mt-2">
                      <div v-if="isOpen" class="small text-success">{{ openUntilText }}</div>
                      <div v-else class="small text-muted">{{ nextOpenText }}</div>
                    </div>
                  </div>
                  <div v-else>
                    <div class="small text-muted">{{ companyHoursText }}</div>
                    <div v-if="isOpen" class="small text-success">{{ openUntilText }}</div>
                    <div v-else class="small text-muted">{{ nextOpenText }}</div>
                  </div>
                </div>
              </div>

              <div v-show="infoTab === 'contacts'">
                <div class="mb-2">
                  <strong>Contatos</strong>
                  <div class="small text-muted" v-if="company?.phone">Telefone: {{ company.phone }}</div>
                  <div class="small text-muted" v-if="company?.email">E-mail: {{ company.email }}</div>
                  <div v-if="company?.contacts && company.contacts.length">
                    <div v-for="c in company.contacts" :key="c.type" class="small text-muted">{{ c.type }}: {{ c.value }}</div>
                  </div>
                  <div v-if="!company?.phone && !company?.email && !(company?.contacts && company.contacts.length)" class="small text-muted">Nenhum contato disponível</div>
                </div>
              </div>

              <div v-show="infoTab === 'payments'">
                <div class="mb-2">
                  <strong>Formas de pagamento</strong>
                  <div v-if="paymentMethods && paymentMethods.length">
                    <ul class="list-unstyled mb-0 mt-2">
                      <li v-for="m in paymentMethods" :key="m.code" class="small text-muted">{{ m.name }} <span v-if="m.description">— <em class="text-muted">{{ m.description }}</em></span></li>
                    </ul>
                  </div>
                  <div v-else class="small text-muted">Dinheiro</div>
                </div>
              </div>

            </div>
            <div class="modal-footer p-2" style="border-top: none;">
              <button class="btn btn-secondary" @click="closeInfoModal">Fechar</button>
            </div>
          </div>
        </div>

        <!-- Info modal removed -->
      </template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, reactive, watch, nextTick, onUnmounted } from 'vue';
import { bindLoading } from '../state/globalLoading.js';
import api from '../api';
import { useRoute, useRouter } from 'vue-router';
import { assetUrl } from '../utils/assetUrl.js';
import { applyPhoneMask, removePhoneMask } from '../utils/phoneMask';
import ListGroup from '../components/form/list-group/ListGroup.vue';
import { io } from 'socket.io-client'
import { SOCKET_URL } from '@/config'

let route;
let router;
try {
  route = useRoute();
  router = useRouter();
} catch (e) {
  // When this component is executed outside of a router-aware context
  // gracefully fall back to safe defaults to avoid runtime errors
  route = { params: {}, query: {} };
  router = { push: () => {} };
}
const companyId = (route && route.params && route.params.companyId) ? route.params.companyId : '1';
// support store-scoped and menu-scoped public views via query params
// persist storeId in localStorage per company so selection survives navigation
const storeStorageKey = `public_store_${companyId}`
const storeId = ref(route.query.storeId || localStorage.getItem(storeStorageKey) || null);
// persist menuId similarly so the selected menu survives navigation
const menuStorageKey = `public_menu_${companyId}`
const menuId = ref(route.query.menuId || localStorage.getItem(menuStorageKey) || null);

// Hero banner URL: if backend provides a banner use it; otherwise
// fallback to non-/public path /:companyId/default-banner.jpg as requested.
const heroBannerUrl = computed(() => {
  try {
    const b = menu.value?.banner || company.value?.banner;
    if(b) return assetUrl(b);
    // fallback path without /public prefix
    return assetUrl('/' + companyId + '/default-banner.jpg');
  } catch(e){ return assetUrl('/' + companyId + '/default-banner.jpg'); }
});

const loading = ref(true);
bindLoading(loading);
const categories = ref([]);
const uncategorized = ref([]);
const paymentMethods = ref([]);
const company = ref(null)
const menu = ref(null)
const orderType = ref('DELIVERY') // 'DELIVERY' or 'PICKUP'
const productSearchTerm = ref('')
const searchExpanded = ref(false)
const searchInputRef = ref(null)

// Derived display values: prefer the menu name (cardápio title), then fall back
// to store name or company name. This ensures the page heading shows the
// currently selected menu instead of the store name.
const displayName = computed(() => {
  try {
    const menuName = menu.value?.name?.toString().trim();
    const storeName = company.value?.store?.name?.toString().trim();
    const companyName = company.value?.name?.toString().trim();
    return menuName || storeName || companyName || 'Cardápio';
  } catch (e) { return 'Cardápio' }
});

const displayPickup = computed(() => {
  // Prefer menu-level contact/address when available, then store-level, then company-level.
  try{
    const menuAddr = (menu.value && (menu.value.address || menu.value.phone || menu.value.whatsapp)) ? ((menu.value.address || '') + (menu.value.phone ? (' — ' + menu.value.phone) : '') + (menu.value.whatsapp ? (' — ' + menu.value.whatsapp) : '')) : ''
    if(menuAddr && String(menuAddr).trim()) return String(menuAddr).trim()
    const storeAddr = (company.value?.store?.address || '').toString().trim();
    const companyAddr = (company.value?.address || '').toString().trim();
    // prefer pickupInfo from printer settings if available
    const pickup = (company.value && company.value.pickupInfo) ? String(company.value.pickupInfo).trim() : ''
    return storeAddr || pickup || companyAddr || ''
  }catch(e){ return '' }
});

// Helper: produce an effective settings object that prefers menu-level meta
function effectiveSettings(){
  try{
    // prefer top-level company fields but also include nested `store` settings
    // (some API versions store schedule fields under company.store)
    const base = company.value ? { ...company.value, ...(company.value.store || {}) } : {}
    // menu-level direct fields (menu may store open24Hours, weeklySchedule, timezone, openFrom/openTo)
    const menuMeta = menu.value ? { ...menu.value, ...(menu.value.store || {}) } : {}
    // also support company.value.menus[menuId] (menu-specific meta stored under store settings)
    try{
      const menusMap = company.value && company.value.menus ? company.value.menus : null
      if(menuId.value && menusMap && menusMap[String(menuId.value)]){
        Object.assign(menuMeta, menusMap[String(menuId.value)])
      }
    }catch(e){}
    return { ...base, ...menuMeta }
  }catch(e){ return company.value || {} }
}

// Normalize different names used across API versions for the "always open / 24h" flag
function isAlwaysOpenFlag(c){
  try{
    return !!(c && (c.alwaysOpen || c.open24Hours || c.open24 || c.always_open))
  }catch(e){ return false }
}

// Sticky categories bar state
const heroRef = ref(null)
const navRef = ref(null)
const isNavSticky = ref(false)
// mobile top menu state
const mobileMenuOpen = ref(false)
function toggleMobileMenu(){ mobileMenuOpen.value = !mobileMenuOpen.value }
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
        navEl.style.top = `0px`
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
          navEl.style.top = `0px`
          navEl.style.left = `${containerRect2.left}px`
          navEl.style.width = `${containerRect2.width}px`
        } else {
          const navRect2 = navEl.getBoundingClientRect()
         /* navEl.style.top = `${headerH2}px`*/
           navEl.style.top = `0px`
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
    // listen for login events so we can fetch server-side customer data when token is set
    const onAppUserLoggedIn = (ev) => { try{ tokenRef.value = (ev && ev.detail && ev.detail.token) ? ev.detail.token : (localStorage.getItem('token') || null); fetchProfileAndAddresses() }catch(e){} }
    try{ window.addEventListener('app:user-logged-in', onAppUserLoggedIn) }catch(e){}
    // listen for addresses updates from other views (e.g., PublicAddresses) and refresh local addresses
    const onAddressesUpdated = (ev) => {
      try{
        const arr = (ev && ev.detail && ev.detail.addresses) ? ev.detail.addresses : null
        if(Array.isArray(arr) && arr.length){
          try{ addresses.value = arr }catch(e){}
          try{ selectedAddressId.value = addresses.value.length ? addresses.value[0].id : selectedAddressId.value }catch(e){}
          try{ localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value)) }catch(e){}
          try{ console.debug('[debug] addresses updated via event', { addresses: addresses.value, selectedAddressId: selectedAddressId.value }) }catch(e){}
          try{ refreshDeliveryFee() }catch(e){}
        }
      }catch(e){}
    }
    try{ window.addEventListener('app:addresses-updated', onAddressesUpdated) }catch(e){}
  // init
  handleScroll()
  updateActiveCategory()
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
      try{ window.removeEventListener('app:user-logged-in', onAppUserLoggedIn) }catch(e){}
      try{ window.removeEventListener('app:addresses-updated', onAddressesUpdated) }catch(e){}
    if(rafId) cancelAnimationFrame(rafId)
    try{ if(_discountsDebounce) clearTimeout(_discountsDebounce) }catch(e){}
    // ensure styles cleared
    try{ if(navRef.value){ navRef.value.style.position=''; navRef.value.style.top=''; navRef.value.style.left=''; navRef.value.style.width=''; navRef.value.style.zIndex=''; } }catch(e){}
  })

  })

const scheduleList = computed(() => {
  const c = effectiveSettings()
  if(!c) return null
  if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length) return c.weeklySchedule
  return null
})

// Display-friendly weekday names (Portuguese), match indices 0=Domingo..6=Sábado
const weekDayNames = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado']

// Compute current weekday index in the store timezone (0=Sunday..6=Saturday)
const currentWeekDayIndex = computed(() => {
  try{
    const c = effectiveSettings() || {}
    const tz = c.timezone || 'America/Sao_Paulo'
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const parts = fmt.split('/')
    if(parts.length !== 3) return new Date().getDay()
    const [dayStr, monthStr, yearStr] = parts
    const tzDate = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00Z`)
    return tzDate.getUTCDay()
  }catch(e){ return new Date().getDay() }
})

function isTodaySchedule(d){
  try{
    const idx = Number(d && d.day) || 0
    return idx === Number(currentWeekDayIndex.value)
  }catch(e){ return false }
}


function toggleOrderType(){
  orderType.value = orderType.value === 'DELIVERY' ? 'PICKUP' : 'DELIVERY'
}
// checkout modal state (multi-step)
const checkoutModalOpen = ref(false)
const checkoutStep = ref('customer') // 'customer' | 'delivery' | 'payment' | 'review'
// Stepper configuration for checkout modal
const stepOrder = ['customer','delivery','payment','review']
const stepLabels = { customer: 'Cliente', delivery: 'Entrega', payment: 'Pagamento', review: 'Resumo' }
const stepIcons = { customer: 'bi-person', delivery: 'bi-geo-alt', payment: 'bi-credit-card', review: 'bi-list-check' }
const stepIndex = computed(() => Math.max(0, stepOrder.indexOf(checkoutStep.value)))
// simple info modal state (opened by 'Mais informações')
// simple info modal state (opened by 'Mais informações')
const infoModalOpen = ref(false)
// which tab inside the info modal is active: 'hours' | 'contacts' | 'payments'
const infoTab = ref('hours')

function openInfoModal(){ infoModalOpen.value = true; infoTab.value = 'hours' }
function closeInfoModal(){ infoModalOpen.value = false }
// persist customer and addresses in localStorage for convenience
// namespace localStorage by company + optional store + optional menu so carts don't collide
const PUBLIC_NS = [companyId, storeId.value || '', menuId.value || ''].filter(Boolean).join('_') || companyId
const LOCAL_CUSTOMER_KEY = `public_customer_${PUBLIC_NS}`
const LOCAL_ADDR_KEY = `public_addresses_${companyId}`
// load persisted customer/address
const addresses = ref(JSON.parse(localStorage.getItem(LOCAL_ADDR_KEY) || '[]'))
const selectedAddressId = ref(addresses.value.length ? addresses.value[0].id : null)
  // if user is authenticated via public profile, prefill addresses and select first
  try{
    const token = localStorage.getItem('token')
    const stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null')
    if(token && stored && stored.addresses && Array.isArray(stored.addresses) && stored.addresses.length){
      addresses.value = stored.addresses.map(a => ({
        id: a.id || String(Date.now()) + Math.random().toString(36).slice(2,8),
        label: a.label || a.formatted || '',
        formattedAddress: a.formatted || a.formattedAddress || '',
        number: a.number || a.numero || '',
        complement: a.complement || a.complemento || '',
        neighborhood: a.neighborhood || a.neigh || '',
        reference: a.reference || a.ref || '',
        observation: a.observation || a.observacao || '',
        postalCode: a.postalCode || a.postal_code || a.zip || '',
        city: a.city || '',
        state: a.state || '',
        country: a.country || '',
        latitude: a.latitude || a.lat || null,
        longitude: a.longitude || a.lon || a.lng || null,
        fullDisplay: a.fullDisplay || a.display_name || ''
      }))
      selectedAddressId.value = addresses.value.length ? addresses.value[0].id : selectedAddressId.value
      // debug: log loaded addresses and selection for troubleshooting delivery fee
      try{ console.debug('[debug] loaded stored public customer addresses', { addresses: addresses.value, selectedAddressId: selectedAddressId.value }) }catch(e){}
      // ensure delivery fee is computed for the pre-selected address
      try{ refreshDeliveryFee() }catch(e){}
    } else if (token && !stored) {
          // token exists but we have no cached customer info — try to fetch profile and addresses from server
          try{ fetchProfileAndAddresses() }catch(e){}
    }
  }catch(e){ /* ignore */ }

async function openCheckout(){
  checkoutModalOpen.value = true
  // if a public customer is already authenticated (token + stored customer), skip customer step
  try{
    const token = localStorage.getItem('token')
    // ensure we try to fetch server-side profile/addresses when opening checkout
    if(token){
      try{
        // if we have no addresses yet, wait a short time for the fetch to complete
        if(!addresses.value.length){
          const p = fetchProfileAndAddresses()
          const timeout = new Promise(r => setTimeout(r, 800))
          await Promise.race([p, timeout])
        } else {
          try{ fetchProfileAndAddresses() }catch(e){}
        }
      }catch(e){}
    }
    const stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null')
    if(token && stored){
      checkoutStep.value = 'delivery'
      // compute delivery fee immediately even if the selected address was already set
      try{ refreshDeliveryFee() }catch(e){}
      return
    }
  }catch(e){ /* ignore parse errors */ }
  checkoutStep.value = 'customer'
}
function closeCheckout(){ checkoutModalOpen.value = false }

function goBackFromStep(){
  const idx = stepOrder.indexOf(checkoutStep.value)
  if(idx > 0){ checkoutStep.value = stepOrder[idx - 1] }
  else { closeCheckout() }
}

function openRegister(){
  router.push({ path: `/public/${companyId}/profile`, query: { tab: 'register' } })
}

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
  try{ a.reference = a.reference || a.ref || '' }catch(e){}
  try{ a.observation = a.observation || a.observacao || '' }catch(e){}
  try{ a.number = a.number || a.num || '' }catch(e){}
  try{ a.complement = a.complement || a.complemento || '' }catch(e){}
  try{ a.latitude = a.latitude || a.lat || null }catch(e){}
  try{ a.longitude = a.longitude || a.lon || a.lng || null }catch(e){}
  try{ a.postalCode = a.postalCode || a.postal_code || a.zip || '' }catch(e){}
  try{ a.city = a.city || '' }catch(e){}
  try{ a.state = a.state || '' }catch(e){}
  try{ a.country = a.country || '' }catch(e){}
  try{ a.fullDisplay = a.fullDisplay || a.display_name || '' }catch(e){}
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

// Fetch server-side public profile and addresses when we have a token but no cached customer
async function fetchProfileAndAddresses(){
  let storedContact = null
  let prof = null
  try{
    // safely parse stored customer (may be malformed)
    let stored = null
    try{ stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null') }catch(e){ stored = null }
    storedContact = stored && (stored.contact || stored.whatsapp || stored.phone) ? (stored.contact || stored.whatsapp || stored.phone) : null
    const cfg = {}
    if(storedContact) cfg.headers = { 'x-public-phone': storedContact }

    try {
      const p = await api.get(`/public/${companyId}/profile`, cfg)
      prof = p && p.data ? p.data : null
      if(prof){
        try{ localStorage.setItem(LOCAL_CUSTOMER_KEY, JSON.stringify(prof)) }catch(e){}
        // also populate runtime `customer` so `publicCustomerConnected` becomes available
        try{
          const resolvedName = String(prof.name || prof.fullName || prof.customerName || (prof.customer && (prof.customer.fullName || prof.customer.name)) || '')
          const resolvedContact = String(prof.contact || prof.whatsapp || prof.phone || (prof.customer && (prof.customer.whatsapp || prof.customer.phone)) || '')
          customer.value = {
            name: resolvedName,
            contact: resolvedContact,
            address: (prof.addresses && prof.addresses.length && prof.addresses[0]) ? {
              formattedAddress: prof.addresses[0].formatted || prof.addresses[0].formattedAddress || '',
              number: prof.addresses[0].number || prof.addresses[0].numero || '',
              complement: prof.addresses[0].complement || prof.addresses[0].complemento || '',
              neighborhood: prof.addresses[0].neighborhood || prof.addresses[0].neigh || '',
              reference: prof.addresses[0].reference || prof.addresses[0].ref || '',
              observation: prof.addresses[0].observation || prof.addresses[0].observacao || '',
              latitude: prof.addresses[0].latitude || prof.addresses[0].lat || null,
              longitude: prof.addresses[0].longitude || prof.addresses[0].lon || prof.addresses[0].lng || null,
              fullDisplay: prof.addresses[0].fullDisplay || prof.addresses[0].display_name || ''
            } : (customer.value && customer.value.address) ? { ...customer.value.address } : { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' }
          }
          // if profile includes addresses, populate addresses list so callers don't need a separate request
          try{
            if(Array.isArray(prof.addresses) && prof.addresses.length){
              addresses.value = prof.addresses.map(a => ({
                id: a.id || String(Date.now()) + Math.random().toString(36).slice(2,8),
                label: a.label || a.formatted || '',
                formattedAddress: a.formatted || a.formattedAddress || '',
                number: a.number || a.numero || '',
                complement: a.complement || a.complemento || '',
                neighborhood: a.neighborhood || a.neigh || '',
                reference: a.reference || a.ref || '',
                observation: a.observation || a.observacao || '',
                postalCode: a.postalCode || a.postal_code || a.zip || '',
                city: a.city || '',
                state: a.state || '',
                country: a.country || '',
                latitude: a.latitude || a.lat || null,
                longitude: a.longitude || a.lon || a.lng || null,
                fullDisplay: a.fullDisplay || a.display_name || '',
                isDefault: !!a.isDefault
              }))
              const def = addresses.value.find(a => a.isDefault)
              selectedAddressId.value = def ? def.id : (addresses.value.length ? addresses.value[0].id : selectedAddressId.value)
              try{ localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value)) }catch(e){}
              try{ refreshDeliveryFee() }catch(e){}
            }
          }catch(e){}

          // refresh discounts now that we have customer context
          try{ scheduleEvaluateDiscounts() }catch(e){}
        }catch(e){}
      }
    } catch (err) {
      try{
        if (err && err.response && err.response.status === 403) localStorage.removeItem('token')
      }catch(e){}
      prof = null
    }
  }catch(e){ /* ignore profile fetch errors */ }

  try{
    const cfg2 = {}
    if(storedContact) cfg2.headers = { 'x-public-phone': storedContact }
    try{
      const r = await api.get(`/public/${companyId}/addresses`, cfg2)
      let addrData = (r && r.data) ? (Array.isArray(r.data) ? r.data : r.data.addresses || []) : []
      // fallback to profile addresses when the addresses endpoint returns empty
      if((!Array.isArray(addrData) || !addrData.length) && prof && Array.isArray(prof.addresses) && prof.addresses.length){
        addrData = prof.addresses
      }
      if(Array.isArray(addrData) && addrData.length){
        addresses.value = addrData.map(a => ({
          id: a.id || String(Date.now()) + Math.random().toString(36).slice(2,8),
          label: a.label || a.formatted || '',
          formattedAddress: a.formatted || a.formattedAddress || '',
          number: a.number || a.numero || '',
          complement: a.complement || a.complemento || '',
          neighborhood: a.neighborhood || a.neigh || '',
          reference: a.reference || a.ref || '',
          observation: a.observation || a.observacao || '',
          postalCode: a.postalCode || a.postal_code || a.zip || '',
          city: a.city || '',
          state: a.state || '',
          country: a.country || '',
          latitude: a.latitude || a.lat || null,
          longitude: a.longitude || a.lon || a.lng || null,
          fullDisplay: a.fullDisplay || a.display_name || '',
          isDefault: !!a.isDefault
        }))
        // prefer address marked as default when available
        const def = addresses.value.find(a => a.isDefault)
        selectedAddressId.value = def ? def.id : (addresses.value.length ? addresses.value[0].id : selectedAddressId.value)
        try{ localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value)) }catch(e){}
        try{ console.debug('[debug] fetched server addresses for logged-in customer', { addresses: addresses.value, selectedAddressId: selectedAddressId.value }) }catch(e){}
        try{ refreshDeliveryFee() }catch(e){}
      }
    }catch(e){
      // if addresses endpoint fails, but we have profile addresses, ensure they are used
      try{
        if(prof && Array.isArray(prof.addresses) && prof.addresses.length && (!addresses.value || !addresses.value.length)){
          addresses.value = prof.addresses.map(a => ({
            id: a.id || String(Date.now()) + Math.random().toString(36).slice(2,8),
            label: a.label || a.formatted || '',
            formattedAddress: a.formatted || a.formattedAddress || '',
            number: a.number || a.numero || '',
            complement: a.complement || a.complemento || '',
            neighborhood: a.neighborhood || a.neigh || '',
            reference: a.reference || a.ref || '',
            observation: a.observation || a.observacao || '',
            postalCode: a.postalCode || a.postal_code || a.zip || '',
            city: a.city || '',
            state: a.state || '',
            country: a.country || '',
            latitude: a.latitude || a.lat || null,
            longitude: a.longitude || a.lon || a.lng || null,
            fullDisplay: a.fullDisplay || a.display_name || '',
            isDefault: !!a.isDefault
          }))
          const def = addresses.value.find(a => a.isDefault)
          selectedAddressId.value = def ? def.id : (addresses.value.length ? addresses.value[0].id : selectedAddressId.value)
          try{ localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value)) }catch(e){}
          try{ refreshDeliveryFee() }catch(e){}
        }
      }catch(_){ }
    }
  }catch(e){ /* ignore addresses fetch errors */ }

  return { profile: prof, addresses: addresses.value }
}

const activeCategoryId = ref(null);

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
const subtotal = computed(()=> cart.value.reduce((s,it)=> s + (it.price * it.quantity),0));
// storage key per company so different menus don't clash
const CART_STORAGE_KEY = `public_cart_${PUBLIC_NS}`
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
const customer = ref({ name: '', contact: '', address: { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' } });
// reactive token so UI recomputes when login sets/removes token
const tokenRef = ref(localStorage.getItem('token') || null)
const accountExists = ref(false)
const accountHasPassword = ref(false)
const customerPassword = ref('')
const accountCheckLoading = ref(false)
const lastCheckedPhone = ref('')
// load persisted customer if any (after customer is defined)
const savedCustomerRaw = localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || null
const savedCustomer = JSON.parse(savedCustomerRaw || 'null')
if(savedCustomer) {
  // merge with default shape to ensure nested fields (like address) exist
  // Support multiple customer shapes returned by backend: { name, contact } or { fullName, whatsapp } or nested 'customer' object
  const resolvedName = String(savedCustomer.name || savedCustomer.fullName || savedCustomer.customerName || (savedCustomer.customer && (savedCustomer.customer.fullName || savedCustomer.customer.name)) || '')
  const resolvedContact = String(savedCustomer.contact || savedCustomer.whatsapp || savedCustomer.phone || (savedCustomer.customer && (savedCustomer.customer.whatsapp || savedCustomer.customer.phone)) || '')
  customer.value = {
    name: resolvedName,
    contact: resolvedContact,
    address: (customer.value && customer.value.address) ? { ...customer.value.address } : { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' }
  }
}
const neighborhood = ref('');
// list of neighborhoods (public) for this company
const neighborhoodsList = ref([])

const deliveryFee = computed(() => {
  try{
    // robust matching: try exact, id match, alias, and accent-insensitive match
    const normalize = (s) => {
      try{ return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g,'') }catch(e){ return String(s||'').trim().toLowerCase() }
    }
    const needleRaw = String(neighborhood.value || '')
    const needle = normalize(needleRaw)
    let found = null
    for(const x of (neighborhoodsList.value || [])){
      if(!x) continue
      // match by id directly
      if(String(x.id) === String(needleRaw)) { found = x; break }
      // exact name (case-insensitive)
      if(String(x.name || '').trim().toLowerCase() === String(needleRaw).trim().toLowerCase()){ found = x; break }
      // alias match
      if(Array.isArray(x.aliases) && x.aliases.some(a => String(a||'').trim().toLowerCase() === String(needleRaw).trim().toLowerCase())){ found = x; break }
      // normalized match to ignore accents/spaces/punctuation
      if(normalize(x.name) === needle) { found = x; break }
      if(Array.isArray(x.aliases) && x.aliases.some(a => normalize(a) === needle)){ found = x; break }
    }
    // dev-only debug info to diagnose why fee may appear as 0
    try{
      if(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV){
        console.debug('[debug] deliveryFee lookup:', { needleRaw, found, neighborhoodsCount: (neighborhoodsList.value||[]).length })
      }
    }catch(e){}
    return Number(found?.deliveryFee || 0)
  }catch(e){ return 0 }
})
// explicit delivery fee used by UI/totals to ensure fee is calculated
const currentDeliveryFee = ref(0)

function refreshDeliveryFee(){
  try{
    const normalize = (s) => {
      try{ return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g,'') }catch(e){ return String(s||'').trim().toLowerCase() }
    }
    // allow neighborhood to be an object (from some address shapes)
    let needleRaw = neighborhood.value || ''
    try{ if(needleRaw && typeof needleRaw === 'object') needleRaw = needleRaw.name || needleRaw.id || String(needleRaw) }catch(e){}
    needleRaw = String(needleRaw || '')
    const needle = normalize(needleRaw)
    let found = null
    for(const x of (neighborhoodsList.value || [])){
      if(!x) continue
      if(String(x.id) === String(needleRaw)) { found = x; break }
      if(String(x.name || '').trim().toLowerCase() === String(needleRaw).trim().toLowerCase()){ found = x; break }
      if(Array.isArray(x.aliases) && x.aliases.some(a => String(a||'').trim().toLowerCase() === String(needleRaw).trim().toLowerCase())){ found = x; break }
      if(normalize(x.name) === needle) { found = x; break }
      if(Array.isArray(x.aliases) && x.aliases.some(a => normalize(a) === needle)){ found = x; break }
    }
    currentDeliveryFee.value = Number(found?.deliveryFee || 0)
    if(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV){
      console.debug('[debug] refreshDeliveryFee ->', { neighborhood: neighborhood.value, currentDeliveryFee: currentDeliveryFee.value, found })
    }
  }catch(e){ currentDeliveryFee.value = 0 }
}
const paymentMethod = ref('CASH');
// when paying with cash, customer may provide a 'troco' amount
const changeFor = ref('');
// cashback state
const cashbackEnabled = ref(false)
const cashbackSettings = ref(null)
const wallet = ref({ balance: 0 })
const walletLoaded = ref(false)

// debug: log wallet changes to help trace why balance may be zero
try{
  watch([
    () => wallet.value,
    () => walletLoaded.value
  ], ([w, l]) => {
    try{ console.debug('[debug] wallet change', { wallet: w, walletLoaded: l, customer: (customer && customer.value) ? { name: customer.value.name, contact: customer.value.contact } : null }) }catch(e){}
  }, { deep: true })
}catch(e){}
const useCashback = ref(false)
const useCashbackAmount = ref(0)
// (info modal removed) handlers and visibility state deleted
const submitting = ref(false);
const serverError = ref('');
const clientError = ref('');
const orderResponse = ref(null);
const customerPhoneValid = computed(() => {
  try{
    const digits = removePhoneMask(customer.value.contact || '')
    return !!digits && (String(digits).length >= 10)
  }catch(e){ return false }
})
const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV

// compute whether a public customer is connected (token + stored customer)
const publicCustomerConnected = computed(() => {
  try{
    const token = tokenRef.value || localStorage.getItem('token')
    if(!token) return null
    if(!customer.value) return null
    return { name: customer.value.name || null, contact: customer.value.contact || null }
  }catch(e){ return null }
})

function logoutPublicCustomer(){
  try{
    localStorage.removeItem('token')
    tokenRef.value = null
    localStorage.removeItem(LOCAL_CUSTOMER_KEY)
    localStorage.removeItem(`public_customer_${companyId}`)
    try{ localStorage.removeItem(LOCAL_ADDR_KEY) }catch(e){}
    try{ localStorage.removeItem(CART_STORAGE_KEY) }catch(e){}
  }catch(e){}
  customer.value = { name: '', contact: '', address: { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' } }
  addresses.value = []
  selectedAddressId.value = null
  checkoutStep.value = 'customer'
}

function switchAccount(){
  router.push({ path: `/public/${companyId}/profile`, query: { tab: 'login' } })
}

// helper to build public API paths with optional storeId/menuId query params
function publicPath(path){
  try{
    const params = new URLSearchParams()
    if(storeId.value) params.set('storeId', storeId.value)
  if(menuId.value) params.set('menuId', menuId.value)
    const qs = params.toString()
    if(!qs) return path
    return `${path}${path.includes('?') ? '&' : '?'}${qs}`
  }catch(e){ return path }
}

const visibleCategories = computed(() => {
  // Se não há busca, mostra todas as categorias
  if (!productSearchTerm.value || !productSearchTerm.value.trim()) {
    return categories.value || []
  }
  
  // Filtra produtos baseado no termo de busca
  const searchLower = productSearchTerm.value.toLowerCase().trim()
  const filtered = []
  
  for (const cat of (categories.value || [])) {
    const matchingProducts = (cat.products || []).filter(product => {
      const nameMatch = (product.name || '').toLowerCase().includes(searchLower)
      const descMatch = (product.description || '').toLowerCase().includes(searchLower)
      return nameMatch || descMatch
    })
    
    // Só inclui categoria se tiver produtos que correspondem à busca
    if (matchingProducts.length > 0) {
      filtered.push({
        ...cat,
        products: matchingProducts
      })
    }
  }
  
  return filtered
})

// Handlers para busca de produtos
function handleProductSearch() {
  // Scroll para o início dos produtos quando começar a buscar
  if (productSearchTerm.value && productSearchTerm.value.trim()) {
    try {
      const productsStart = document.getElementById('products-start')
      if (productsStart) {
        productsStart.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } catch (e) {}
  }
}

function clearProductSearch() {
  productSearchTerm.value = ''
}

function toggleSearch() {
  searchExpanded.value = !searchExpanded.value
  if (searchExpanded.value) {
    // Focus no input após expansão
    nextTick(() => {
      if (searchInputRef.value) {
        searchInputRef.value.focus()
      }
    })
  }
}

function closeSearch() {
  searchExpanded.value = false
  productSearchTerm.value = ''
}

// map productId -> cashback percent (when provided on product object)
const productCashbackMap = computed(() => {
  const map = {}
  try{
    for(const c of (categories.value || [])){
      for(const p of (c.products || [])){
        if(p && (p.cashback || p.cashbackPercent)) map[String(p.id)] = Number(p.cashback || p.cashbackPercent || 0)
      }
    }
    for(const p of (uncategorized.value || [])){
      if(p && (p.cashback || p.cashbackPercent)) map[String(p.id)] = Number(p.cashback || p.cashbackPercent || 0)
    }
  }catch(e){}
  return map
})

// compute if company is open (client-side check)
const isOpen = computed(() => {
  const c = effectiveSettings()
  if(!c) return true
  // respect admin "force open" override when present (with optional expiry)
  try{
    if(c.forceOpen === true || c.force_open === true){
      const exp = c.forceOpenExpiresAt || c.force_open_expires_at
      if(!exp) return true
      const t = Date.parse(String(exp))
      if(!isNaN(t) && t > Date.now()) return true
    }
  }catch(e){}
  // respect manual activation flag on store/settings: if store explicitly deactivated, treat as closed
  try{
    if(c.isActive === false || c.active === false || c.isOpen === false || c.closed === true || c.isClosed === true || c.closedUntilNextShift === true || c.closed_until_next_shift === true) return false
  }catch(e){}
  // respect temporary pause flags persisted into store settings (pauseUntil / pausedUntil / pause_until)
  try{
    const pauseKeys = ['pauseUntil','pausedUntil','pause_until']
    for(const k of pauseKeys){
      if(c[k]){
        const t = Date.parse(String(c[k]))
        if(!isNaN(t) && t > Date.now()) return false
      }
    }
  }catch(e){}
  // Prefer detailed weeklySchedule when present — it should take precedence
  // over coarse always-open flags stored at company level.

  const parseHM = (s) => {
    if(!s) return null
    const parts = String(s).split(':').map(x=>Number(x))
    if(parts.length<2) return null
    const [hh, mm] = parts
    if(Number.isNaN(hh) || Number.isNaN(mm)) return null
    return { hh, mm }
  }

  // Prefer weeklySchedule when provided (more precise). weeklySchedule is an array with { day, from, to, enabled }
  try{
    if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
      const tz = c.timezone || 'America/Sao_Paulo'
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.format(new Date()).split('/')
      const [dd, mm, yyyy] = parts
      const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
      const weekDay = tzDate.getUTCDay()
      const today = c.weeklySchedule.find(d => Number(d?.day) === Number(weekDay))
      if(!today || !today.enabled) return false
      const from = parseHM(today.from)
      const to = parseHM(today.to)
      if(!from || !to) return false

      // compute current time in store timezone
      let nowParts
      try{
        const fmt2 = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
        if(fmt2.formatToParts){
          const p = fmt2.formatToParts(new Date())
          nowParts = { hh: Number(p.find(x=>x.type==='hour')?.value), mm: Number(p.find(x=>x.type==='minute')?.value) }
        } else {
          const s = fmt2.format(new Date())
          const [hh, mm] = s.split(':').map(x=>Number(x))
          nowParts = { hh, mm }
        }
      }catch(e){ const d = new Date(); nowParts = { hh: d.getHours(), mm: d.getMinutes() } }

      const toMinutes = (p) => p.hh*60 + p.mm
      const nowM = toMinutes(nowParts)
      const fromM = toMinutes(from)
      const toM = toMinutes(to)
      if(fromM <= toM) return nowM >= fromM && nowM <= toM
      return (nowM >= fromM) || (nowM <= toM)
    }
  }catch(e){ console.warn('weeklySchedule parse failed', e) }
  // If weeklySchedule not provided or invalid, check coarse always-open flag
  if(isAlwaysOpenFlag(c)) return true

  // fallback: use openFrom/openTo fields
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
  const c = effectiveSettings()
  if(!c) return ''
  // If weeklySchedule is present, prefer today's schedule range
  try{
    if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
      const tz = c.timezone || 'America/Sao_Paulo'
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.format(new Date()).split('/')
      const [dd, mm, yyyy] = parts
      const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
      const weekDay = tzDate.getUTCDay()
      const today = c.weeklySchedule.find(d => Number(d?.day) === Number(weekDay))
      if(today && today.enabled){
        return `${today.from || '--:--'} — ${today.to || '--:--'}`
      }
    }
  }catch(e){ /* ignore and fallback */ }
  // If no weekly schedule, fall back to coarse always-open flag or openFrom/openTo
  if(isAlwaysOpenFlag(c)) return '24h'
  return `${c.openFrom || '--:--'} — ${c.openTo || '--:--'}`
})

 

const nextOpenText = computed(() => {
  const c = effectiveSettings()
  if(!c) return ''
  // Prefer weeklySchedule when present

  const padTime = (s) => s || '--:--'
  const formatBadgeTime = (s) => {
    try{
      if(!s) return '--:--'
      const parts = String(s).split(':')
      const hh = parts[0] || '0'
      const mm = (parts[1] || '00')
      const h = String(Number(hh))
      return mm === '00' ? `${h}h` : `${h}h${mm}`
    }catch(e){ return s }
  }

  // If weeklySchedule present, find the next enabled day
  try{
    if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
      const tz = c.timezone || 'America/Sao_Paulo'
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      const parts = fmt.format(new Date()).split('/')
      const [dd, mm, yyyy] = parts
      const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
      const weekDay = tzDate.getUTCDay()
      const schedule = c.weeklySchedule
      // check today first, but only if 'from' is still in the future
      const today = schedule.find(d => Number(d?.day) === Number(weekDay))
      if(today && today.enabled){
        try{
          const parseHM = (s) => {
            if(!s) return null
            const parts = String(s).split(':').map(x=>Number(x))
            if(parts.length < 2) return null
            const [hh, mm] = parts
            if(Number.isNaN(hh) || Number.isNaN(mm)) return null
            return { hh, mm }
          }
          const from = parseHM(today.from)
          if(from){
            // compute now in store timezone
            const fmtNow = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
            let nowParts
            if(fmtNow.formatToParts){
              const p = fmtNow.formatToParts(new Date())
              nowParts = { hh: Number(p.find(x=>x.type==='hour')?.value), mm: Number(p.find(x=>x.type==='minute')?.value) }
            } else {
              const s = fmtNow.format(new Date())
              const [hh, mm] = s.split(':').map(x=>Number(x))
              nowParts = { hh, mm }
            }
            const toMinutes = (p) => p.hh*60 + p.mm
            if(toMinutes(nowParts) < toMinutes(from)){
              return `abre hoje as ${formatBadgeTime(today.from)}`
            }
          }
        }catch(e){ /* ignore and continue to search next enabled day */ }
      }
      // search next enabled day
      const names = ['domingo','segunda','terça','quarta','quinta','sexta','sábado']
      for(let i=1;i<7;i++){
        const idx = (weekDay + i) % 7
        const d = schedule.find(sch => Number(sch?.day) === Number(idx))
        if(d && d.enabled){
          if(i === 1) return `abre amanhã as ${formatBadgeTime(d.from)}`
          return `abre ${names[idx]} as ${formatBadgeTime(d.from)}`
        }
      }
    }
  }catch(e){ /* ignore */ }

    // fallback: when always open, don't show nextOpen text
    if(isAlwaysOpenFlag(c)) return ''
    // fallback: use openFrom if present
    if(c.openFrom) return `abre as ${formatBadgeTime(c.openFrom)}`
    return ''
})

// debug timestamp removed

  const openUntilText = computed(() => {
    // when store is open, return a friendly 'Aberto até as HH:MM' when possible
    try{
      const c = effectiveSettings()
      if(!c) return ''
      // if store is paused temporarily, show pause until time
      try{
        const pauseKeys = ['pauseUntil','pausedUntil','pause_until']
        for(const k of pauseKeys){
          if(c[k]){
            const t = Date.parse(String(c[k]))
            if(!isNaN(t) && t > Date.now()){
              const d = new Date(t)
              const hh = String(d.getHours()).padStart(2,'0')
              const mm = String(d.getMinutes()).padStart(2,'0')
              return `Fechado temporariamente — volta às ${hh}:${mm}`
            }
          }
        }
      }catch(e){}
      // closed until next shift flag
      try{
        if(c.closedUntilNextShift === true || c.closed_until_next_shift === true) return 'Fechado até o próximo expediente'
      }catch(e){}
        // prefer weeklySchedule today's 'to'
      if(Array.isArray(c.weeklySchedule) && c.weeklySchedule.length){
        const tz = c.timezone || 'America/Sao_Paulo'
        const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        const parts = fmt.format(new Date()).split('/')
        const [dd, mm, yyyy] = parts
        const tzDate = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`)
        const weekDay = tzDate.getUTCDay()
        const today = c.weeklySchedule.find(d => Number(d?.day) === Number(weekDay))
        if(today && today.enabled && today.to) return `Aberto até as ${today.to}`
      }
      // fallback to openTo or always-open
      if(c.openTo) return `Aberto até as ${c.openTo}`
      if(isAlwaysOpenFlag(c)) return 'Aberto — 24h'
      return ''
    }catch(e){ return '' }
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

// Helper to prefer a thumbnail URL for option images when available.
// Strategy: try the 'thumbs' subfolder variant first, fall back to the original
// image URL on error. This keeps frontend resilient regardless of backend
// thumbnail generation.
function optionThumbUrl(opt){
  try{
    if(!opt) return ''
    const s = String(opt.image || '')
    if(!s) return ''
    // If path contains '/public/uploads/options/', insert 'thumbs/' segment
    // Works for full absolute URLs and relative paths.
    if(s.includes('/public/uploads/options/')){
      return assetUrl(s.replace('/public/uploads/options/', '/public/uploads/options/thumbs/'))
    }
    // also handle when path starts with 'public/uploads/options/' (no leading slash)
    if(s.startsWith('public/uploads/options/')){
      return assetUrl(s.replace('public/uploads/options/', 'public/uploads/options/thumbs/'))
    }
    // fallback: return original image URL via assetUrl
    return assetUrl(s)
  }catch(e){ return assetUrl(opt.image) }
}

function onOptionThumbError(evt, opt){
  try{
    if(!evt || !evt.target) return
    // prevent infinite loop by clearing onerror before changing src
    try{ evt.target.onerror = null }catch(e){}
    // set to the original image (non-thumb) so browser will try that
    evt.target.src = assetUrl(opt && opt.image ? opt.image : '')
  }catch(e){ /* ignore */ }
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
    let n = a ? (a.neighborhood || '') : ''
    // normalize if neighborhood stored as object { id,name }
    try{ if(n && typeof n === 'object'){ n = n.name || n.title || n.id || String(n) } }catch(e){}
    neighborhood.value = n || ''
    // ensure delivery fee is refreshed when selected address changes
    try{
      console.debug('[debug] selectedAddressId changed ->', { v, neighborhood: neighborhood.value })
      refreshDeliveryFee()
    }catch(e){}
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

// re-evaluate customer-group discounts when cart or customer state changes
watch([
  () => cart.value.length,
  () => subtotal.value,
  () => publicCustomerConnected.value,
  () => (customer.value && customer.value.contact) ? String(customer.value.contact) : ''
], () => {
  try{ scheduleEvaluateDiscounts() }catch(e){}
}, { deep: true })

// refresh delivery fee when inline customer address changes
watch(() => (customer.value && customer.value.address && customer.value.address.formattedAddress) ? String(customer.value.address.formattedAddress) : '', (v) => {
  try{ refreshDeliveryFee() }catch(e){}
})
// Note: automatic opening of the cart when items are added was removed.

// re-evaluate discounts when order type changes (PICKUP/DELIVERY)
watch(orderType, (v) => { try{ scheduleEvaluateDiscounts() }catch(e){} })

const formatCurrency = (v) => {
  try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)); }catch(e){ return v; }
}

function _makeLineId(){ return String(Date.now()) + '-' + Math.random().toString(36).slice(2,9) }

function _optionsKey(opts){ try{ return JSON.stringify((opts||[]).map(o=>({ id: o.id }))) }catch(e){ return '' } }

function findCartIndex(productId, options){
  const key = _optionsKey(options)
  return cart.value.findIndex(i => i.productId === productId && _optionsKey(i.options) === key)
}

function optionsSummary(it){
  try{
    if(!it || !it.options || !it.options.length) return ''
    // group by option id to preserve distinct prices
    const map = {}
    for(const o of it.options){
      if(!o) continue
      const id = String(o.id || o.name || Math.random())
      const name = String(o.name || '').trim()
      const price = Number(o.price || 0)
      if(!map[id]) map[id] = { name, unitPrice: price, count: 0 }
      map[id].count += 1
    }
    const parts = []
    for(const k of Object.keys(map)){
      const entry = map[k]
      if(!entry.name) continue
      const cnt = entry.count
      if(entry.unitPrice && entry.unitPrice > 0){
        // show total price for the option group (count * unitPrice)
        const total = entry.unitPrice * cnt
        parts.push(cnt > 1 ? `${cnt}x ${entry.name} ${formatCurrency(total)}` : `${entry.name} ${formatCurrency(entry.unitPrice)}`)
      } else {
        parts.push(cnt > 1 ? `${cnt}x ${entry.name}` : entry.name)
      }
    }
    return parts.join(', ')
  }catch(e){ return '' }
}

function optionsSummaryNoPrice(it){
  try{
    if(!it || !it.options || !it.options.length) return ''
    const counts = {}
    for(const o of it.options){
      if(!o) continue
      const name = String(o.name || '').trim()
      if(!name) continue
      counts[name] = (counts[name] || 0) + 1
    }
    const parts = []
    for(const [name, cnt] of Object.entries(counts)){
      parts.push(cnt > 1 ? `${cnt}x ${name}` : name)
    }
    return parts.join(', ')
  }catch(e){ return '' }
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
      newCart.push({ lineId: it.lineId || _makeLineId(), productId: p.id, name: p.name, price: unit, quantity: qty, options: validatedOptions, image: it.image, categoryId: p.categoryId || null })
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
    cart.value.push({ lineId: _makeLineId(), productId: p.id, name: p.name, price: Number(p.price), quantity: 1, options: options || [], categoryId: p.categoryId || null })
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
  else { cart.value.push({ lineId: _makeLineId(), productId: p.id, name: p.name, price: unitPrice, quantity: qty, options: selectedOptions, categoryId: p.categoryId || null }) }
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

function computeLineDiscount(it){
  try{
    if(!it || !it.productId) return 0
    // aggregate total discount for this productId from discountsList
    const prodId = String(it.productId)
    const entries = (discountsList.value || []).filter(d => d.productId && String(d.productId) === prodId)
    if(!entries.length) return 0
    const totalForProduct = entries.reduce((s,e)=>s + Number(e.amount || 0), 0)
    // if multiple cart lines with same productId, distribute proportionally by line total
    const lines = (cart.value || []).filter(x => String(x.productId) === prodId)
    const productSum = lines.reduce((s,x)=> s + (Number(x.price||0) * Number(x.quantity||0)), 0)
    if(productSum <= 0) return 0
    const lineTotal = Number(it.price||0) * Number(it.quantity||0)
    const share = (lineTotal / productSum)
    const allocated = Math.round((totalForProduct * share) * 100) / 100
    return allocated
  }catch(e){ return 0 }
}

function getLineDiscountEntries(it){
  if(!it || !it.productId) return [];
  var prodId = String(it.productId);
  var entries = (discountsList.value || []).filter(function(d){ return d.productId && String(d.productId) === prodId; });
  if(!entries.length) return [];

  var groups = {};
  for(var i=0;i<entries.length;i++){
    var e = entries[i];
    var key = (e.ruleId || '') + '::' + (e.description || '');
    if(!groups[key]) groups[key] = { description: e.description || 'Desconto', amount: 0 };
    groups[key].amount += Number(e.amount || 0);
  }

  var lines = (cart.value || []).filter(function(x){ return String(x.productId) === prodId; });
  var productSum = lines.reduce(function(s,x){ return s + (Number(x.price || 0) * Number(x.quantity || 0)); }, 0);
  var lineTotal = Number(it.price || 0) * Number(it.quantity || 0);

  var out = [];
  var keys = Object.keys(groups);
  for(var j=0;j<keys.length;j++){
    var grp = groups[keys[j]];
    var allocated = grp.amount;
    if(productSum > 0){
      var share = lineTotal / productSum;
      allocated = Math.round((grp.amount * share) * 100) / 100;
    }
    if(allocated > 0){
      out.push({ description: String(grp.description || ''), amount: Number(allocated) });
    }
  }
  return out;
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

// Coupon and discounts state
const openCoupon = ref(false)
const couponCode = ref('')
const couponApplied = ref(false)
const couponDiscount = ref(0)
const couponInfo = ref(null)
const couponLoading = ref(false)

const discountsList = ref([])
const discountsTotal = ref(0)
const discountsLoading = ref(false)
let _discountsDebounce = null

async function evaluateDiscountsNow(){
  try{
    discountsLoading.value = true
    const items = cart.value.map(i=>({ productId: i.productId, categoryId: i.categoryId, price: i.price, quantity: i.quantity }))
    // only evaluate customer-group discounts for logged-in customers
    if(!publicCustomerConnected.value){
      discountsList.value = []
      discountsTotal.value = 0
      return
    }
    // include customer phone, order type and coupon state so backend can resolve the logged customer and delivery restrictions
    const payload = {
      items,
      subtotal: subtotal.value,
      customerPhone: (customer.value && customer.value.contact) ? customer.value.contact : undefined,
      orderType: orderType.value,
      couponApplied: couponApplied.value
    }
    const resp = await api.post(`/public/${companyId}/cart/discounts`, payload)
    discountsList.value = resp.data?.discounts || []
    discountsTotal.value = Number(resp.data?.totalDiscount || 0)
  }catch(e){
    discountsList.value = []
    discountsTotal.value = 0
  }finally{ discountsLoading.value = false }
}

function scheduleEvaluateDiscounts(){
  try{ if(_discountsDebounce) clearTimeout(_discountsDebounce) }catch(e){}
  _discountsDebounce = setTimeout(()=> evaluateDiscountsNow(), 300)
}

// Final total after coupon discount and customer-group discounts. Delivery fee is calculated only after the
// customer selects an address (neighborhood). The CTA and cart should not
// include delivery fee until a neighborhood is chosen.
const finalTotal = computed(() => {
  try{
    const base = Math.max(0, subtotal.value - (couponDiscount.value || 0) - (discountsTotal.value || 0))
    const includeDelivery = orderType.value === 'DELIVERY' && neighborhood.value && String(neighborhood.value).trim() !== ''
    // prefer explicit refreshed fee when available
    const fee = Number(currentDeliveryFee.value || 0) || Number(deliveryFee.value || 0)
    const beforeCashback = base + (includeDelivery ? fee : 0)
    const cashbackDeduction = Number(useCashbackAmount.value || 0)
    return Math.max(0, beforeCashback - cashbackDeduction)
  }catch(e){ return subtotal.value }
})

async function applyCoupon(){
    try{
      if(!couponCode.value || !couponCode.value.trim()){
        // show inline message under coupon input
        tipMessages['coupon'] = 'Insira um código válido'
        setTimeout(()=>{ try{ delete tipMessages['coupon'] }catch(e){} }, 1600)
        return
      }
      couponLoading.value = true
      // call public coupon validation endpoint
  const res = await api.post(publicPath(`/public/${companyId}/coupons/validate`), { code: couponCode.value.trim(), subtotal: subtotal.value, customerPhone: (customer.value && customer.value.contact) ? customer.value.contact : undefined })
      const data = res.data || {}
      if(data && data.valid){
        couponApplied.value = true
        couponDiscount.value = Number(data.discountAmount || 0)
        couponInfo.value = data.coupon || null
        openCoupon.value = false
          // re-evaluate customer-group discounts when a coupon is applied
          try{ scheduleEvaluateDiscounts() }catch(e){}
        tipMessages['coupon-success'] = `Cupom aplicado: -${formatCurrency(couponDiscount.value)}`
        setTimeout(()=>{ try{ delete tipMessages['coupon-success'] }catch(e){} }, 2000)
        return
      }
      tipMessages['coupon'] = 'Cupom inválido'
      setTimeout(()=>{ try{ delete tipMessages['coupon'] }catch(e){} }, 1600)
    }catch(e){
      const msg = e?.response?.data?.message || 'Erro ao validar cupom'
      tipMessages['coupon'] = msg
      setTimeout(()=>{ try{ delete tipMessages['coupon'] }catch(e){} }, 2000)
      console.warn('applyCoupon error', e)
    } finally {
      couponLoading.value = false
    }
}

function removeCoupon(){ couponApplied.value = false; couponDiscount.value = 0; couponInfo.value = null; try{ scheduleEvaluateDiscounts() }catch(e){} }

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
    // close the cart drawer so the product modal is visible
    try{ closeCartModal() }catch(e){}
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
    // compute product starting price considering required option groups
    function getStartingPrice(p){
      try{
        if(!p) return 0
        const base = Number(p.price || 0)
        let extra = 0
        if(p.optionGroups && p.optionGroups.length){
          for(const g of p.optionGroups){
            const minReq = Math.max(0, Number(g.min || 0))
            if(minReq <= 0) continue
            const prices = (g.options || []).map(o => Number(o.price || 0)).sort((a,b)=>a-b)
            if(!prices.length) continue
            for(let i=0;i<minReq && i<prices.length;i++){
              extra += prices[i]
            }
          }
        }
        return base + extra
      }catch(e){ return Number(p.price || 0) }
    }

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
const _newAddrNumber = ref('')
const _newAddrComplement = ref('')
const _newAddrNeighborhood = ref('')
const _newAddrReference = ref('')
const _newAddrObservation = ref('')
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
  _newAddrNumber.value = ''
  _newAddrComplement.value = ''
  _newAddrNeighborhood.value = ''
  _newAddrReference.value = ''
  _newAddrObservation.value = ''
  _newAddrLat.value = null
  _newAddrLon.value = null
  _newAddrFull.value = ''
  editingAddressId.value = null
  // hide the new-address form when user has saved addresses
  showNewAddressForm.value = addresses.value.length === 0
}

async function performOrderFromModal(){
  // populate customer/address from modal selections and call submitOrder
  if(orderType.value === 'DELIVERY'){
    // prefer a selected saved address, but allow a temporary address entered in the
    // flow (customer.value.address) when the user didn't save it.
    const a = addresses.value.find(x=>x.id===selectedAddressId.value)
    if(a){
      if(!customer.value.address) customer.value.address = { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' }
      customer.value.address.formattedAddress = a.formattedAddress
      customer.value.address.number = a.number || ''
      customer.value.address.complement = a.complement || ''
      customer.value.address.neighborhood = a.neighborhood || ''
      customer.value.address.reference = a.reference || ''
      customer.value.address.observation = a.observation || ''
      customer.value.address.fullDisplay = a.fullDisplay || ''
      // copy additional optional fields so payload contains full address shape
      try{ customer.value.address.postalCode = a.postalCode || a.postal_code || '' }catch(e){}
      try{ customer.value.address.city = a.city || '' }catch(e){}
      try{ customer.value.address.state = a.state || '' }catch(e){}
      try{ customer.value.address.country = a.country || '' }catch(e){}
      try{ customer.value.address.latitude = a.latitude ?? a.lat ?? null }catch(e){}
      try{ customer.value.address.longitude = a.longitude ?? a.lon ?? a.lng ?? null }catch(e){}
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

async function handleContactInput(e) {
  try{
    let raw = ''
    if(e && e.target && typeof e.target.value !== 'undefined') raw = e.target.value
    else if(typeof e === 'string' || typeof e === 'number') raw = String(e)
    customer.value.contact = applyPhoneMask(raw)

    // when user types a full phone (DDD + number) try to detect existing account
    try{
      const digits = removePhoneMask(customer.value.contact || '')
      if(digits && String(digits).length >= 10 && lastCheckedPhone.value !== String(digits)){
        lastCheckedPhone.value = String(digits)
        accountCheckLoading.value = true
        try{
          const resp = await api.get(`/public/${companyId}/account?phone=${digits}`)
          const data = resp && resp.data ? resp.data : {}
          accountExists.value = !!data.exists
          accountHasPassword.value = !!data.hasPassword
          if(accountHasPassword.value){ customerPassword.value = '' }
        }catch(err){
          accountExists.value = false
          accountHasPassword.value = false
        } finally { accountCheckLoading.value = false }
      }
    }catch(inner){ /* ignore */ }

  }catch(e){ console.warn('handleContactInput err', e) }
}

async function nextFromCustomer(){
  clientError.value = ''
  // basic contact validation
  if(!customer.value || !customer.value.contact){
    clientError.value = 'Preencha WhatsApp'
    return
  }
  try{
    const digits = removePhoneMask(customer.value.contact || '')
    if(!digits || String(digits).length < 10){
      clientError.value = 'Informe um número de WhatsApp válido (inclua DDD)'
      return
    }
    // if account requires password, validate and attempt login
    if(accountHasPassword.value){
      if(!customerPassword.value){ clientError.value = 'Informe a senha da conta existente'; return }
      try{
        const body = { whatsapp: digits, password: customerPassword.value }
        const res = await api.post(`/public/${companyId}/login`, body, { headers: { 'x-no-redirect': '1' } })
        if(res && res.data && res.data.token){
          try{ localStorage.setItem('token', res.data.token) }catch(e){}
          try{ tokenRef.value = res.data.token }catch(e){}
          if(res.data.customer) {
            try{ localStorage.setItem(LOCAL_CUSTOMER_KEY, JSON.stringify(res.data.customer)) }catch(e){}
            try{
              const prof = res.data.customer
              const resolvedName = String(prof.name || prof.fullName || prof.customerName || (prof.customer && (prof.customer.fullName || prof.customer.name)) || '')
              const resolvedContact = String(prof.contact || prof.whatsapp || prof.phone || (prof.customer && (prof.customer.whatsapp || prof.customer.phone)) || '')
              customer.value = {
                name: resolvedName,
                contact: resolvedContact,
                address: (prof.addresses && prof.addresses.length && prof.addresses[0]) ? {
                  formattedAddress: prof.addresses[0].formatted || prof.addresses[0].formattedAddress || '',
                  number: prof.addresses[0].number || prof.addresses[0].numero || '',
                  complement: prof.addresses[0].complement || prof.addresses[0].complemento || '',
                  neighborhood: prof.addresses[0].neighborhood || prof.addresses[0].neigh || '',
                  reference: prof.addresses[0].reference || prof.addresses[0].ref || '',
                  observation: prof.addresses[0].observation || prof.addresses[0].observacao || '',
                  latitude: prof.addresses[0].latitude || prof.addresses[0].lat || null,
                  longitude: prof.addresses[0].longitude || prof.addresses[0].lon || prof.addresses[0].lng || null,
                  fullDisplay: prof.addresses[0].fullDisplay || prof.addresses[0].display_name || ''
                } : (customer.value && customer.value.address) ? { ...customer.value.address } : { formattedAddress: '', number: '', complement: '', neighborhood: '', reference: '', observation: '', latitude: null, longitude: null, fullDisplay: '' }
              }
            }catch(e){}
          }
          try{
            // refresh profile/addresses in this component immediately so UI updates without reload
            try{ await fetchProfileAndAddresses() }catch(e){}
            window.dispatchEvent(new CustomEvent('app:user-logged-in'))
          }catch(e){}
        }
      }catch(err){
        clientError.value = err?.response?.data?.message || 'Falha ao autenticar. Verifique credenciais.'
        return
      }
    } else {
      // when no password required ensure name is present
      if(!customer.value.name){ clientError.value = 'Preencha nome e WhatsApp'; return }
    }
  }catch(e){ /* ignore */ }

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
      const upd = { ...addresses.value[idx], label: (_newAddrLabel.value || _newAddrFormatted.value), formattedAddress: _newAddrFormatted.value, number: _newAddrNumber.value, complement: _newAddrComplement.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, reference: _newAddrReference.value, observation: _newAddrObservation.value }
      if(_newAddrFull.value) upd.fullDisplay = _newAddrFull.value
      addresses.value.splice(idx, 1, upd)
      localStorage.setItem(LOCAL_ADDR_KEY, JSON.stringify(addresses.value))
      selectedAddressId.value = upd.id
    }
    clearNewAddress()
    return
  }

  addAddress({ label: _newAddrLabel.value, formattedAddress: _newAddrFormatted.value, number: _newAddrNumber.value, complement: _newAddrComplement.value, neighborhood: _newAddrNeighborhood.value, latitude: _newAddrLat.value, longitude: _newAddrLon.value, fullDisplay: _newAddrFull.value, reference: _newAddrReference.value, observation: _newAddrObservation.value })
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
  const mr = await api.post(publicPath(`/public/${companyId}/neighborhoods/match`), { text: _newAddrNeighborhood.value })
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
  _newAddrNumber.value = a.number || ''
  _newAddrComplement.value = a.complement || ''
  _newAddrNeighborhood.value = a.neighborhood || ''
  _newAddrLat.value = a.latitude || null
  _newAddrLon.value = a.longitude || null
  _newAddrFull.value = a.fullDisplay || ''
  _newAddrReference.value = a.reference || ''
  _newAddrObservation.value = a.observation || ''
  selectedAddressId.value = id
  // reveal the edit form so user can modify the address
  showNewAddressForm.value = true
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
    // if user provided a temporary inline address directly into customer.value.address
    // (not saved via _newAddrFormatted), ensure neighborhood is set so delivery fee displays
    if(!hasSaved && ! _newAddrFormatted.value && customer.value.address && customer.value.address.formattedAddress){
      let n = customer.value.address.neighborhood || _newAddrNeighborhood.value || ''
      try{ if(n && typeof n === 'object'){ n = n.name || n.id || String(n) } }catch(e){}
      neighborhood.value = n || ''
    }
  }
  // ensure delivery fee is refreshed before moving to next step
  try{ refreshDeliveryFee() }catch(e){}
  checkoutStep.value = (orderType.value === 'DELIVERY' ? 'payment' : 'review')
}

function goToCustomer(){ checkoutStep.value = 'customer' }
function goToDelivery(){ checkoutStep.value = 'delivery' }
function goToReview(){ checkoutStep.value = 'review' }
function backFromReview(){ checkoutStep.value = (orderType.value === 'DELIVERY' ? 'payment' : 'delivery') }

onMounted(async ()=>{
  loading.value = true;
  try{
    // TEMP LOG: indicate component mounted and parameters
    try{ console.log('[PublicMenu] mounted', { companyId: companyId, menuId: menuId && menuId.value, storeId: storeId && storeId.value }) }catch(e){}
  // build public menu path including optional menuId/storeId query hints
  const menuQuery = []
  if(menuId.value) menuQuery.push(`menuId=${encodeURIComponent(menuId.value)}`)
  if(storeId.value) menuQuery.push(`storeId=${encodeURIComponent(storeId.value)}`)
  const menuUrl = publicPath(`/public/${companyId}/menu${menuQuery.length ? ('?' + menuQuery.join('&')) : ''}`)
  const res = await api.get(menuUrl);
  const data = res.data || {};
  // store last-loaded storeId so updates can be applied selectively
  let _lastLoadedStoreId = storeId.value || (data.company && data.company.store && data.company.store.id) || null
    // TEMP LOG: inspect payload in browser console to debug schedule fields
    try{ console.log('[PublicMenu] payload', {
      company: data.company,
      company_store: data.company && data.company.store,
      company_menus: data.company && data.company.menus,
      menu: data.menu,
      raw: data
    }); }catch(e){}
    // expose payload for quick inspection from console
    try{ window.__PUBLIC_MENU_PAYLOAD = data }catch(e){}
    // If API returned no `menu` and we don't have a menuId, try to infer a menuId from the categories
    // (some public payloads include categories even when menu wasn't selected). Retry once with inferred menuId.
    try{
      if(!menuId.value && (!data.menu) && data.categories && data.categories.length){
        const found = data.categories.find(c => c && c.menuId)
        if(found && found.menuId){
          const inferred = String(found.menuId)
          try{ console.log('[PublicMenu] inferring menuId from categories', inferred) }catch(e){}
          menuId.value = inferred
          try{ localStorage.setItem(menuStorageKey, inferred) }catch(e){}
          // refetch using inferred menuId
          const menuUrl2 = publicPath(`/public/${companyId}/menu${menuQuery.length ? ('?' + menuQuery.join('&')) : ('?menuId=' + encodeURIComponent(inferred))}`)
          const res2 = await api.get(menuUrl2);
          const data2 = res2.data || {}
          try{ console.log('[PublicMenu] payload after inferring menuId', { menuId: inferred, company: data2.company, menu: data2.menu, raw: data2 }) }catch(e){}
          try{ window.__PUBLIC_MENU_MENU_INFERRED = data2 }catch(e){}
          // replace data with the refetched payload
          if(data2) {
            // overwrite locals below by reassigning data variable
            Object.assign(data, data2)
          }
        }
      }
    }catch(e){ console.warn('menuId inference failed', e) }
  // filter out inactive categories and inactive products
  const rawCategories = data.categories || []
  categories.value = rawCategories.map(c => ({ ...c, products: (c.products || []).filter(p => p.isActive !== false) })).filter(c => c.isActive !== false)
  uncategorized.value = (data.uncategorized || []).filter(p => p.isActive !== false)
  // if a previously selected/active category is now inactive/absent, reset active state
  if(activeCategoryId.value && !categories.value.find(c => c.id === activeCategoryId.value)) activeCategoryId.value = null
  company.value = data.company || null
  menu.value = data.menu || null
    try{
      if(menu.value){
        if(menu.value.allowDelivery === false && menu.value.allowPickup === true) orderType.value = 'PICKUP'
        else if(menu.value.allowDelivery === true && menu.value.allowPickup === false) orderType.value = 'DELIVERY'
      }
    }catch(e){}
    // set page title and social meta tags, prefer store name when available
    try{
      // Prefer the selected menu's name as the document title, then store name, then company name
      const title = (menu.value && menu.value.name) || (company.value && company.value.store && company.value.store.name) || (company.value && company.value.name) || 'Cardápio'
      try{ document.title = title }catch(e){}
      const setMeta = (prop, val, isProperty=false) => {
        try{
          if(!val) return
          const selector = isProperty ? `meta[property="${prop}"]` : `meta[name="${prop}"]`
          let m = document.querySelector(selector)
          if(!m){ m = document.createElement('meta'); if(isProperty) m.setAttribute('property', prop); else m.setAttribute('name', prop); document.getElementsByTagName('head')[0].appendChild(m) }
          m.setAttribute(isProperty ? 'content' : 'content', val)
        }catch(e){ }
      }
      setMeta('og:title', title, true)
      setMeta('twitter:title', title)
      // image: prefer menu banner, then store banner, then company banner
      try{
        const imgPath = (menu.value && menu.value.banner) || (company.value && company.value.store && company.value.store.banner) || (company.value && company.value.banner) || null
        if(imgPath){ setMeta('og:image', assetUrl(imgPath), true); setMeta('twitter:image', assetUrl(imgPath)) }
      }catch(e){}
    }catch(e){ /* ignore meta tag errors */ }
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
  const nr = await api.get(publicPath(`/public/${companyId}/neighborhoods`))
      neighborhoodsList.value = Array.isArray(nr.data) ? nr.data : []
      try{ refreshDeliveryFee() }catch(e){}
    }catch(e){ console.warn('failed to load public neighborhoods', e) }
    
    // initial evaluation of discounts for the persisted cart
    try{ scheduleEvaluateDiscounts() }catch(e){}
    // fetch cashback settings and wallet when menu/company loaded
    try{ fetchCashbackSettingsAndWallet() }catch(e){}
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

// listen for settings updates so public menu can refresh without full page reload
function onStoreSettingsUpdated(ev){
  try{
    const updatedStoreId = ev && ev.detail && ev.detail.storeId ? String(ev.detail.storeId) : null
    if(!updatedStoreId) return
    // if this public view is scoped to a particular store, only refresh when it matches
    const scopedStoreId = storeId.value || (company && company.store && company.store.id) || null
    if(scopedStoreId && String(scopedStoreId) !== String(updatedStoreId)) return
    // otherwise, reload the public menu data
    try{ console.log('[PublicMenu] detected settings update for store', updatedStoreId, ' — refreshing public payload') }catch(e){}
    // re-run the mounted fetch logic (simple approach: reload the page data)
    // minor optimization: call the same fetch path used on mount
    (async () => {
      try{
        const menuQuery = []
        if(menuId.value) menuQuery.push(`menuId=${encodeURIComponent(menuId.value)}`)
        if(storeId.value) menuQuery.push(`storeId=${encodeURIComponent(storeId.value)}`)
        const menuUrl = publicPath(`/public/${companyId}/menu${menuQuery.length ? ('?' + menuQuery.join('&')) : ''}`)
        const r = await api.get(menuUrl)
        const d = r.data || {}
        // update displayed data similar to initial mount flow
        categories.value = (d.categories || []).map(c => ({ ...c, products: (c.products || []).filter(p => p.isActive !== false) })).filter(c => c.isActive !== false)
        uncategorized.value = (d.uncategorized || []).filter(p => p.isActive !== false)
        company.value = d.company || company.value
        menu.value = d.menu || menu.value
        // recompute open state by reusing any existing logic (toggle any derived/computed values by touching reactive state)
        try{ /* trigger any watchers that depend on company/store data */ }catch(e){}
      }catch(e){ console.warn('[PublicMenu] failed to refresh after settings update', e) }
    })()
  }catch(e){ }
}

onMounted(()=>{ try{ window.addEventListener('store:settings-updated', onStoreSettingsUpdated); }catch(e){} })
onBeforeUnmount(()=>{ try{ window.removeEventListener('store:settings-updated', onStoreSettingsUpdated); }catch(e){} })

// storage event handler for cross-tab updates
function onStorageEvent(ev){
  try{
    if(!ev || !ev.key) return
    if(ev.key.startsWith('store_settings_updated_')){
      const sid = ev.key.replace('store_settings_updated_', '')
      try{ onStoreSettingsUpdated({ detail: { storeId: sid } }) }catch(e){}
    }
  }catch(e){}
}

onMounted(()=>{ try{ window.addEventListener('storage', onStorageEvent); }catch(e){} })
onBeforeUnmount(()=>{ try{ window.removeEventListener('storage', onStorageEvent); }catch(e){} })

// Socket listener to receive server-side broadcasts when store settings change.
let _publicMenuSocket = null
onMounted(() => {
  try {
    // If SOCKET_URL is undefined, io() will connect to same-origin which may
    // be proxied to the backend in dev. Use polling first for better reliability.
    // include companyId in handshake so server can add this socket to a company room
    _publicMenuSocket = io(SOCKET_URL, { auth: { companyId }, transports: ['polling', 'websocket'], reconnectionAttempts: Infinity, reconnectionDelay: 2000, timeout: 30000 })
    _publicMenuSocket.on('connect', () => { try{ console.log('[PublicMenu] socket connected', _publicMenuSocket.id) }catch(e){} })
    _publicMenuSocket.on('disconnect', (reason) => { try{ console.log('[PublicMenu] socket disconnected', reason) }catch(e){} })
    _publicMenuSocket.on('store-settings-updated', (payload) => {
      try{
        // Ensure payload is for our company (defensive) and only react when relevant keys changed
        const sid = payload && payload.storeId ? String(payload.storeId) : null
        const pid = payload && payload.companyId ? String(payload.companyId) : null
        const changed = Array.isArray(payload && payload.changedKeys) ? payload.changedKeys : []
        if (!sid) return
        if (pid && String(pid) !== String(companyId)) return

        // If the server provided a `meta` snapshot, apply it immediately to the in-memory
        // company/store objects so open/close UI updates instantly while we refresh.
        const meta = payload && payload.meta ? payload.meta : null
        if (meta) {
          try {
            // prefer store-scoped merge
            if (company.value && company.value.store && String(company.value.store.id) === String(sid)) {
              const storeObj = company.value.store
              if (typeof meta.isActive !== 'undefined') storeObj.isActive = meta.isActive
              if (typeof meta.open24Hours !== 'undefined') storeObj.open24Hours = meta.open24Hours
              if (meta.pauseUntil) storeObj.pauseUntil = meta.pauseUntil
              if (meta.pausedUntil) storeObj.pauseUntil = meta.pausedUntil
              if (meta.pause_until) storeObj.pauseUntil = meta.pause_until
              if (meta.closedUntilNextShift) storeObj.closedUntilNextShift = meta.closedUntilNextShift
              if (meta.closed_until_next_shift) storeObj.closedUntilNextShift = meta.closed_until_next_shift
              if (typeof meta.forceOpen !== 'undefined') storeObj.forceOpen = meta.forceOpen
              if (meta.forceOpenExpiresAt) storeObj.forceOpenExpiresAt = meta.forceOpenExpiresAt
              // reflect back to company.value so effectiveSettings() picks it up
              company.value = { ...(company.value || {}), store: storeObj }
            } else if (meta && typeof meta.isActive !== 'undefined') {
              // if store info not yet present, apply to company top-level as fallback
              company.value = { ...(company.value || {}), isActive: meta.isActive }
            }
            try{ console.log('[PublicMenu] applied settings meta from socket', meta) }catch(e){}
          } catch (e) { /* ignore meta apply errors */ }
        }

        // Only refresh when changed keys include things that affect public menu display
        const interesting = ['forceOpen','forceOpenExpiresAt','pauseUntil','pausedUntil','pause_until','closedUntilNextShift','closed_until_next_shift','isActive','menus','menuMeta','logo','banner', 'isActive']
        const intersect = changed.filter(k => interesting.includes(k))
        const metaRelevant = meta && (meta.forceOpen || meta.forceOpenExpiresAt || meta.pauseUntil || meta.pausedUntil || meta.pause_until || meta.closedUntilNextShift || meta.closed_until_next_shift || typeof meta.isActive !== 'undefined')
        if (changed.length && !intersect.length && !metaRelevant) {
          try{ console.debug('[PublicMenu] store-settings-updated received but no relevant keys changed', changed, meta) }catch(e){}
          return
        }

        // trigger full refresh to fetch canonical settings and other menu info
        onStoreSettingsUpdated({ detail: { storeId: sid } })
      }catch(e){}
    })
  } catch (e) {
    try{ console.warn('[PublicMenu] socket init failed', e) }catch(_){ }
  }
})
onBeforeUnmount(() => { try{ _publicMenuSocket && _publicMenuSocket.disconnect() }catch(e){} })

// Update favicon dynamically when logo changes
function updateFavicon(logoUrl) {
  try {
    if (!logoUrl) return;
    
    const url = assetUrl(logoUrl);
    
    // Remove existing favicon links
    const existingLinks = document.querySelectorAll("link[rel*='icon']");
    existingLinks.forEach(link => link.remove());
    
    // Create and append new favicon link
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/x-icon';
    link.href = url;
    document.head.appendChild(link);
    
    // Also add apple-touch-icon for iOS devices
    const appleTouchIcon = document.createElement('link');
    appleTouchIcon.rel = 'apple-touch-icon';
    appleTouchIcon.href = url;
    document.head.appendChild(appleTouchIcon);
  } catch (e) {
    console.warn('[PublicMenu] Failed to update favicon', e);
  }
}

// Watch for logo changes and update favicon
watch(() => menu.value?.logo || company.value?.logo, (newLogo) => {
  if (newLogo) {
    updateFavicon(newLogo);
  }
}, { immediate: true });

// fetch cashback settings for company and (if logged) the customer's wallet
async function fetchCashbackSettingsAndWallet(){
  try{
    // fetch settings (may require admin role). If forbidden, don't treat as fatal — continue to try wallet fetch.
    try{
      const r = await api.get(`/cashback/settings?companyId=${companyId}`)
      cashbackSettings.value = r.data || null
      cashbackEnabled.value = !!(cashbackSettings.value && (cashbackSettings.value.enabled || cashbackSettings.value.isEnabled))
    }catch(e){
      cashbackSettings.value = null
      try{ console.debug('[debug] cashback settings fetch failed', e?.response?.status || e) }catch(_){}
      // do not assume disabled here; continue and try to fetch wallet below
    }

    // fetch wallet for logged-in public customer when possible, or when we have a stored public customer id
    walletLoaded.value = false
    try{
      // try to derive clientId from stored profile (namespaced or legacy key)
      let stored = null
      try{ stored = JSON.parse(localStorage.getItem(LOCAL_CUSTOMER_KEY) || localStorage.getItem(`public_customer_${companyId}`) || 'null') }catch(e){ stored = null }
      let storedClientId = stored && (stored.id || stored.clientId || stored.customerId) ? (stored.id || stored.clientId || stored.customerId) : null

      // If we have a token but no stored client id, try to fetch the profile (server-resolved) to obtain id
      const token = localStorage.getItem('token')
      if(!storedClientId && token){
        try{
          const p = await api.get(`/public/${companyId}/profile`)
          const prof = p && p.data ? p.data : null
          if(prof){
            // persist legacy key for compatibility
            try{ localStorage.setItem(`public_customer_${companyId}`, JSON.stringify(prof)) }catch(e){}
            storedClientId = prof.id || prof.clientId || prof.customerId || null
          }
        }catch(e){ /* ignore profile fetch error */ }
      }

      const clientIdToUse = storedClientId || null
      if(clientIdToUse){
        try{
          const w = await api.get(`/cashback/wallet?clientId=${encodeURIComponent(clientIdToUse)}&companyId=${companyId}`)
          try{ console.debug('[debug] fetchCashbackSettingsAndWallet -> wallet response', w && w.data) }catch(e){}
          wallet.value = w.data || { balance: 0 }
          // if wallet exists, enable cashback UI even if settings endpoint was not accessible
          if(wallet.value && (wallet.value.balance !== undefined || (Array.isArray(wallet.value.transactions) && wallet.value.transactions.length > 0))){
            cashbackEnabled.value = true
          }
        }catch(e){ console.debug('[debug] fetchCashbackSettingsAndWallet -> wallet fetch error', e); wallet.value = { balance: 0 } }
      } else {
        wallet.value = { balance: 0 }
      }
    }catch(e){ console.debug('[debug] fetchCashbackSettingsAndWallet -> derive client id error', e); wallet.value = { balance: 0 } }
    walletLoaded.value = true
  }catch(e){ console.debug('[debug] fetchCashbackSettingsAndWallet -> outer error', e); walletLoaded.value = true }
}

// refresh wallet when user logs in/out
watch(() => publicCustomerConnected.value, (v) => {
  try{ if(v) fetchCashbackSettingsAndWallet(); else { wallet.value = { balance: 0 }; walletLoaded.value = true; useCashback.value = false; useCashbackAmount.value = 0 } }catch(e){}
})

// clamp cashback amount to allowable range
watch(() => useCashbackAmount.value, (v) => {
  try{
    let val = Number(v || 0)
    const max = Math.min(Number(wallet.value?.balance || 0), Number(finalTotal))
    if(Number.isNaN(val) || val < 0) val = 0
    if(val > max) val = max
    if(val !== v) useCashbackAmount.value = Number(Math.round(val * 100) / 100)
  }catch(e){}
})

function _publicNavigate(pathSuffix, extraQuery = {}){
  try{
    // preserve the current route params (companyId is treated as the slug)
    const base = `/public/${route.params.companyId || companyId}`;
    // merge existing query params so we don't lose the slug-scoped store/menu identification
    const mergedQuery = Object.assign({}, route.query || {}, extraQuery || {});
    // ensure we include persisted storeId when present
  if (storeId.value && !mergedQuery.storeId) mergedQuery.storeId = storeId.value
  if (menuId.value && !mergedQuery.menuId) mergedQuery.menuId = menuId.value
    // remove undefined values to keep the URL clean
    Object.keys(mergedQuery).forEach(k => { if (mergedQuery[k] === undefined) delete mergedQuery[k]; });
    router.push({ path: `${base}${pathSuffix || ''}`, query: mergedQuery });
  }catch(e){ console.warn('_publicNavigate', e) }
}

function goHome(){ _publicNavigate('', { storeId: storeId.value || undefined, menuId: menuId.value || undefined }) }
function goOrders(){ _publicNavigate('/orders', { storeId: storeId.value || undefined, menuId: menuId.value || undefined }) }
function goProfile(){ _publicNavigate('/profile', { storeId: storeId.value || undefined, menuId: menuId.value || undefined }) }

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
    // Ensure discounts are up-to-date with current orderType/coupon before building payload
    try{ await evaluateDiscountsNow() }catch(e){}

    // Build a plain JS payload (avoid sending reactive refs / proxies which cause cyclic errors)
    const payload = {
      customer: {
        name: String(customer.value.name || ''),
        contact: String(customer.value.contact || ''),
        address: {
          formattedAddress: String((customer.value.address && customer.value.address.formattedAddress) || ''),
          number: String((customer.value.address && customer.value.address.number) || ''),
          complement: String((customer.value.address && customer.value.address.complement) || ''),
          neighborhood: String(neighborhood.value || ''),
            reference: String((customer.value.address && customer.value.address.reference) || ''),
            observation: String((customer.value.address && customer.value.address.observation) || ''),
            postalCode: String((customer.value.address && (customer.value.address.postalCode || customer.value.address.postal_code)) || ''),
            city: String((customer.value.address && customer.value.address.city) || ''),
            state: String((customer.value.address && customer.value.address.state) || ''),
            country: String((customer.value.address && customer.value.address.country) || ''),
            coordinates: (customer.value.address && (customer.value.address.latitude != null || customer.value.address.longitude != null)) ? { latitude: customer.value.address.latitude || null, longitude: customer.value.address.longitude || null } : null
        }
      },
      items: (cart.value || []).map(i => ({
        productId: i.productId,
        name: i.name,
        price: Number(i.price || 0),
        quantity: Number(i.quantity || 0),
        options: (i.options || []).map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0) }))
      })),
  // payment.amount should reflect the final total (subtotal minus coupon + delivery)
  // we'll attach a payment object right after creating the payload to include optional troco information
      neighborhood: String(neighborhood.value || ''),
      orderType: String(orderType.value || '')
    };

    // Ensure we include the structured delivery address in shapes the backend may expect
    try{
      const structuredAddr = {
        formattedAddress: String((customer.value.address && customer.value.address.formattedAddress) || ''),
        number: String((customer.value.address && customer.value.address.number) || ''),
        complement: String((customer.value.address && customer.value.address.complement) || ''),
        neighborhood: String((customer.value.address && customer.value.address.neighborhood) || neighborhood.value || ''),
        reference: String((customer.value.address && customer.value.address.reference) || ''),
        observation: String((customer.value.address && customer.value.address.observation) || ''),
        postalCode: String((customer.value.address && (customer.value.address.postalCode || customer.value.address.postal_code)) || ''),
        city: String((customer.value.address && customer.value.address.city) || ''),
        state: String((customer.value.address && customer.value.address.state) || ''),
        country: String((customer.value.address && customer.value.address.country) || ''),
        coordinates: (customer.value.address && (customer.value.address.latitude != null || customer.value.address.longitude != null)) ? { latitude: customer.value.address.latitude || null, longitude: customer.value.address.longitude || null } : null
      }
      // attach in multiple places for compatibility with older/newer backend shapes
      payload.customer = payload.customer || {}
      payload.customer.address = payload.customer.address || structuredAddr
      payload.delivery = payload.delivery || {}
      payload.delivery.deliveryAddress = structuredAddr
      payload.deliveryAddress = structuredAddr
    }catch(e){ /* ignore */ }

  // build payment object and include optional 'changeFor' when customer requested troco
  try{
    const paymentObj = {
      methodCode: String(paymentMethod.value || ''),
      // also include the human-friendly method name when available so backend
      // can prefer/store the name without relying only on codes
      method: (paymentMethods.value || []).find(m => m.code === paymentMethod.value)?.name || null,
      // include customer-group discounts in the final amount calculation
      amount: Number(Math.max(0, subtotal.value - (couponDiscount.value || 0) - (discountsTotal.value || 0)) + Number(deliveryFee.value || 0)) - Number(useCashbackAmount.value || 0)
    };
    if (Number(changeFor.value) > 0) paymentObj.changeFor = Number(changeFor.value);
    payload.payment = paymentObj;
  }catch(e){ /* ignore */ }

  // include coupon information when applied so backend can persist and track usage
  if (couponApplied.value && couponInfo.value) {
    payload.coupon = { code: couponInfo.value.code, discountAmount: Number(couponDiscount.value || 0) }
  }

  // include customer-group discounts (if any) so backend can persist and reflect in order totals
  if (discountsList.value && discountsList.value.length) {
    payload.discounts = discountsList.value
    payload.discountsTotal = Number(discountsTotal.value || 0)
  }

  // Include canonical store/menu identifiers when present so the backend
  // can persist the relation and the Orders board will show the store name.
  if (storeId.value) {
    try {
      // keep both forms for compatibility: payload.store (object) and payload.storeId (flat)
      payload.store = { id: String(storeId.value) }
      payload.storeId = String(storeId.value)
    } catch(e) { /* ignore */ }
  }
  if (menuId.value) {
    try { payload.menuId = String(menuId.value) } catch(e) { /* ignore */ }
  }

  // If the page didn't include storeId/menuId query params, try to derive them
  // from the loaded `menu` or `company` objects returned by the public menu API.
  try {
    // prefer existing payload values; only set when missing
    if (!payload.menuId && menu && menu.value && menu.value.id) {
      payload.menuId = String(menu.value.id)
      // persist derived menuId for session continuity
      try { menuId.value = String(menu.value.id); localStorage.setItem(menuStorageKey, String(menu.value.id)) } catch(e){}
    }
    // menu may include menu.value.storeId linking it to a store
    if (!payload.storeId && menu && menu.value && menu.value.storeId) {
      payload.storeId = String(menu.value.storeId)
      payload.store = payload.store || { id: String(menu.value.storeId) }
      // persist derived storeId for session continuity
      try { storeId.value = String(menu.value.storeId); localStorage.setItem(storeStorageKey, String(menu.value.storeId)) } catch(e){}
    }
    // as a last resort, if the public API returned a store in company context, use it
    if (!payload.storeId && company && company.value && company.value.store && company.value.store.id) {
      payload.storeId = String(company.value.store.id)
      payload.store = payload.store || { id: String(company.value.store.id) }
      try { storeId.value = String(company.value.store.id); localStorage.setItem(storeStorageKey, String(company.value.store.id)) } catch(e){}
    }
    // If we have a store id and the loaded company/menu returned a store name,
    // attach the canonical store name to the payload for deterministic display.
    try {
      const storeNameFromMenu = menu && menu.value && menu.value.store && menu.value.store.name;
      const storeNameFromCompany = company && company.value && company.value.store && company.value.store.name;
      const candidateName = storeNameFromMenu || storeNameFromCompany || null;
      if (candidateName && payload.storeId) {
        payload.store = payload.store || { id: String(payload.storeId) };
        payload.store.name = String(candidateName);
      }
    } catch (e) { /* ignore */ }
  } catch(e) { /* ignore derivation errors */ }

// persist store/menu ids when route query provides them (keep storage updated)
try{
  if(route.query && route.query.storeId){ localStorage.setItem(storeStorageKey, String(route.query.storeId)) }
  if(route.query && route.query.menuId){ localStorage.setItem(menuStorageKey, String(route.query.menuId)) }
}catch(e){}

  // debug: log outgoing payload to help diagnose server-side validation errors (400)
  try { console.debug && console.debug('Submitting public order payload', payload) } catch(e){}
  // include applied cashback for backend processing when present
  try{ payload.appliedCashback = Number(useCashback && Number(useCashbackAmount) > 0 ? Number(useCashbackAmount) : 0) }catch(e){ payload.appliedCashback = 0 }
  const res = await api.post(publicPath(`/public/${companyId}/orders`), payload);
  orderResponse.value = res.data;
  cart.value = [];
  // persist customer contact so user can view history/status later
  saveCustomerToLocal()
  // redirect to public order status page (include digits-only phone for verification)
  // Use removePhoneMask to ensure formatting differences don't prevent server-side matching
  const phone = removePhoneMask(String(customer.value.contact || ''))
  const oid = encodeURIComponent(String(res.data.id || ''))
  try { _publicNavigate(`/order/${oid}`, { phone, storeId: storeId.value || undefined, menuId: menuId.value || undefined }) } catch(e) { console.warn('Redirect failed', e) }
  }catch(err){
    console.error(err);
    // surface server response body and status to browser console for debugging
    try { console.error('Order create response data:', err?.response?.data) } catch (e) {}
    try { console.error('Order create response status:', err?.response?.status) } catch (e) {}
    serverError.value = err?.response?.data?.message || err.message || 'Erro ao enviar pedido';
  }finally{ submitting.value = false; }
}

// Dev helper removed: sendDevTestOrder has been removed to avoid accidental test orders

</script>

<style scoped>
 #mainMenu{padding-bottom:140px;}
 .h5, h5 {
    font-size: 1rem;
    font-weight: 600;
    text-align: center;
}
 .public-hero { background: #222; color: #fff; height: 220px; overflow: hidden; }
.public-hero h3 { font-weight:700; color:#fff }
.top-public-nav .nav-actions a, .top-public-nav .nav-actions button { color: #fff; opacity: .95 }
.top-public-nav .nav-actions a:hover, .top-public-nav .nav-actions button:hover { opacity: 1 }
.cart-badge-top { font-size: 11px; position: absolute; top: -6px; right: -8px; padding: 3px 6px; }

/* Offcanvas Mobile Menu */
.offcanvas-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1049;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}
.offcanvas-backdrop.show {
  opacity: 1;
  visibility: visible;
}
.offcanvas {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: 280px;
  max-width: 85vw;
  background: #fff;
  z-index: 1050;
  transform: translateX(100%);
  transition: transform 0.3s ease;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
  overflow-y: auto;
}
.offcanvas.show {
  transform: translateX(0);
}
.offcanvas-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #dee2e6;
}
.offcanvas-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
.offcanvas-body {
  padding: 1.5rem;
}
.offcanvas-link {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  color: #212529;
  text-decoration: none;
  border-radius: 8px;
  transition: background-color 0.2s ease;
  font-size: 1rem;
}
.offcanvas-link:hover {
  background-color: #f8f9fa;
  color: #0d6efd;
}
.offcanvas-link i {
  font-size: 1.25rem;
}
.btn-close {
  background: transparent url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='%23000'%3e%3cpath d='M.293.293a1 1 0 011.414 0L8 6.586 14.293.293a1 1 0 111.414 1.414L9.414 8l6.293 6.293a1 1 0 01-1.414 1.414L8 9.414l-6.293 6.293a1 1 0 01-1.414-1.414L6.586 8 .293 1.707a1 1 0 010-1.414z'/%3e%3c/svg%3e") center/1em auto no-repeat;
  border: 0;
  width: 1em;
  height: 1em;
  padding: 0.25em;
  opacity: 0.5;
  cursor: pointer;
}
.btn-close:hover {
  opacity: 0.75;
}

.nav-pills { position: sticky; top: 0; z-index: 5; padding-bottom: 8px; background: transparent; }
.nav-pills.stuck { background: #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.06); padding-top: 8px; padding-bottom: 8px; z-index: 1040; }

/* hero overlapping white panel */
.hero-panel { background: transparent; margin-top: -90px; padding: 18px; border-radius: 12px; max-width: 980px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); background: #fff; position: relative; z-index: 1046 }
.hero-panel .company-name { color: #111; }
.hero-panel .company-address { color: #666; font-size:0.8rem; font-style: italic; }
.hero-panel .more-information{ color: var(--brand-dark) !important;}
.store-closed-panel { color: #d23a3a; }
.delivery-pickup-btn { background: #f1fbfd; color: #0d6efd; border: 1px solid rgba(13,110,253,0.12); border-radius: 10px; padding: 8px 12px; font-weight:600 }
.calc-delivery { background: #f8fafb; border: 1px solid #eef4f6; }
.list-group-item, .payment-method {
  border: 2px solid #DDD !important;
  margin-bottom: 6px;
  border-radius: 12px !important;
  padding: 8px;
}/*

.list-group-item:last-child { border-bottom: none }*/
li.list-group-item.selected, .payment-method.selected {
    border-color: #8cbf62 !important;
    background-color: #d6ffb3 !important;
    color: rgb(66, 114, 26) !important;
}
.payment-method.selected {
  font-weight: 600;
}
.hero-image { transition: transform .35s ease }
.public-hero:hover .hero-image { transform: scale(1.02) }

.product-card { background: #fff; border-radius: 18px; position: relative; padding:12px !important;}
.product-card-body { flex: 1 1 auto; padding-right: 1rem; min-height:100px; }
.product-title { font-size: 1.05rem; font-weight: 600; }
.product-desc { color: #666; font-size:12px; line-height:135%; max-height: 3em; overflow: hidden; text-overflow: ellipsis; }
.product-price {
  line-height: 100%;
  font-size: .9rem;
  font-weight: 600;
  color: var(--brand-dark);
}
.product-price small{font-size: 0.6rem; line-height: 95%;}
.product-card-media { width: 110px; flex: 0 0 110px; position:relative}
.product-image { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; }
.product-image-placeholder { width: 96px; height: 96px; border-radius: 8px; }
.badge.bg-success[data-v-85b00978] {
    background-color: var(--brand-lightest) !important;
    color: var(--brand-dark);
    font-weight: 600;
    border-radius: 19px;
    padding: 5px 8px;
    font-size: 0.8rem;
}

/* Cashback badge shown on product cards */
.cashback-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: linear-gradient(180deg,#e6f9ef,#c8f1dc);
  color: #056937;
  font-weight:700;
  padding:6px 8px;
  border-radius:10px;
  font-size:0.85rem;
  box-shadow: 0 4px 10px rgba(0,0,0,0.06);
  z-index: 5;
}

@media (max-width: 991px){
  .product-card { border-radius: 8px; }
  .product-card-media { width: 110px; flex: 0 0 110px; }
  .product-image { width: 110px; height: 110px; }
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
/* replace inline padding used in option rows */
.option-row { padding: 0 16px; font-size: 14px }
.group-header .badge.bg-primary { background-color:#0d6efd; color:#fff }
/* highlight failing required group briefly */
.badge.bg-danger { background-color: #d9534f !important }
/* pulse animation used when scrolling to a required group */
.required-pulse { animation: pulse 0.9s ease-out forwards }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(220,53,69,0.18); }
  50% { box-shadow: 0 0 0 10px rgba(220,53,69,0.06); }
  100% { box-shadow: 0 0 0 0 rgba(220,53,69,0); }
}

/* modal sizing: centered on desktop, fullscreen on small screens */
.product-modal { z-index: 11000 !important }
.product-modal .modal-content {
  /* centered desktop modal */
  width: 920px;
  max-width: 95%;
  max-height: 90vh;
  overflow: auto;
  border-radius: 12px;
  margin: 0 auto;
  padding: 0;
}

/* checkout modal: use a slightly narrower width on desktop but remain fullscreen on mobile
   (mobile fullscreen is handled by the existing @media (max-width: 767px) rules) */
.product-modal.checkout-modal .modal-content {
  width: 720px;
  max-width: 96%;
  max-height: 90vh;
  overflow: auto;
  border-radius: 12px;
  margin: 0 auto;
  padding: 0;
}

/* slide up animation for mobile modal entrance */
@keyframes slideUpModal { from { transform: translateY(100%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }

/* mobile: make modals fullscreen and use slide-up animation */
@media (max-width: 767px) {
  .product-modal { align-items: stretch }
  .product-modal .modal-content {
    width: 100vw;
    height: 100vh;
    max-width: 100%;
    max-height: 100vh;
    overflow: auto;
    border-radius: 0 !important;
    margin: 0;
    padding: 0;
    transform: translateY(100%);
    animation: slideUpModal .28s ease forwards;
  }

  /* mobile floating close button styling */
  .modal-close-mobile { display:flex; position:absolute; top:12px; right:12px; width:44px; height:44px; border-radius:50%; background:#fff; border:none; align-items:center; justify-content:center; font-size:20px; line-height:1; box-shadow: 0 6px 18px rgba(0,0,0,0.14); z-index:20 }
  .modal-close-mobile:active { transform: scale(.98) }
  .modal-close-mobile:hover { background:#fafafa }

  /* ensure modal body reserves space for the fixed footer on small screens */
  .product-modal .modal-body { padding-bottom: 100px }
  .product-modal .modal-footer { position: fixed }
}

/* Ensure the checkout steps (customer, delivery, payment) are forced fullscreen on small screens.
   This overrides any narrower desktop rules that might otherwise apply. */
@media (max-width: 767px) {
  .product-modal.checkout-modal.full-mobile {
    align-items: stretch !important;
    justify-content: flex-start !important;
  }
  .product-modal.checkout-modal.full-mobile .modal-content {
    width: 100vw !important;
    height: 100vh !important;
    max-width: 100% !important;
    max-height: 100vh !important;
    overflow: auto !important;
    border-radius: 0 !important;
    margin: 0 !important;
    /* match drawer padding for visual parity */
    padding: 16px !important;
    transform: translateY(0) !important;
    animation: slideUpModal .28s ease forwards !important;
  }
  /* ensure modal body reserves space for fixed footer and uses drawer-like inner padding */
  .product-modal.checkout-modal.full-mobile .modal-body {
    padding: 0 0 100px 0 !important; /* footer space reserved; header uses modal-content padding */
  }

  /* Title/header spacing: make the checkout modal header match the drawer spacing
     (reduce the mb-3 gap and match h5 size/weight) */
 /* .product-modal.checkout-modal.full-mobile .modal-content .d-flex.justify-content-between.align-items-center.mb-3 {
    margin-bottom: 8px !important; /* drawer uses tighter spacing 
    padding-top: 0 !important;
  }*/
  .product-modal.checkout-modal.full-mobile .modal-content h5 {
    font-size: 1.05rem !important;
    font-weight: 700 !important;
    margin: 0 0 4px 0 !important;
    line-height: 1.1 !important;
  }
}

/* Checkout review (centered) spacing adjustments to match drawer visual rhythm
   Make the review header, item spacing and totals align with drawer styling. */
.product-modal.checkout-modal.not-full-mobile .modal-content .d-flex.justify-content-between.align-items-center.mb-3 {
  margin-bottom: 8px !important;
  padding-top: 0 !important;
}
.product-modal.checkout-modal.not-full-mobile .modal-content h6,
.product-modal.checkout-modal.not-full-mobile .modal-content h5 {
  font-size: 1rem !important;
  font-weight: 700 !important;
  margin: 0 0 6px 0 !important;
  line-height: 1.12 !important;
}
.product-modal.checkout-modal.not-full-mobile .modal-content .checkout-totals { max-width: 420px; padding-top: 6px }
.product-modal.checkout-modal.not-full-mobile .modal-content .list-group-item { padding: 10px 12px !important }
.product-modal.checkout-modal.not-full-mobile .modal-content .cart-item-price { width: 100px }

/* Ensure centered review modal visually matches drawer: padding, footer inside modal and reserved space */
.product-modal.checkout-modal.not-full-mobile .modal-content {
  padding: 16px !important; /* match drawer inner padding */
}
.product-modal.checkout-modal.not-full-mobile .modal-body {
  padding-bottom: 92px !important; /* reserve space for footer inside modal */
  max-height: calc(90vh - 120px) !important;
}
/* put footer inside modal content for review so it's part of the flow (not fixed) */
.product-modal.checkout-modal.not-full-mobile .modal-footer {
  position: relative !important;
  box-shadow: none !important;
  margin-top: 12px !important;
}

/* If checkout modal is open but on 'review', keep it centered on mobile.
   For steps customer/delivery/payment the modal should be fullscreen. */
@media (max-width: 767px) {
  .product-modal.checkout-modal.not-full-mobile .modal-content {
    width: auto !important;
    height: auto !important;
    max-height: 90vh !important;
    overflow: auto !important;
    border-radius: 12px !important;
    margin: 0 auto !important;
    transform: none !important;
    animation: none !important;
  }
  .product-modal.checkout-modal.not-full-mobile { align-items: center !important; justify-content: center !important; }
}

/* keep modal footer fixed at bottom inside modal */
.product-modal .modal-footer { left: 0; transform: none; bottom: 0; width: 100%; max-width: 100%; padding: 12px; background: #fff; box-shadow:none; z-index: 30; display:flex; justify-content:space-between; align-items:center }

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
.qty-input { width:60px; border-radius:8px; padding:6px 10px; font-weight:600; text-align:center; }
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

/* Compact single-line cart item in review */
.cart-item-row .cart-item-name .text-truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.cart-item-row { gap: 8px }
.cart-item-actions .btn { padding: 6px 8px; line-height: 1 }
.cart-line { padding-top: 8px; padding-bottom: 8px }
.icon-only { width:32px; height:32px; padding:0; display:inline-flex; align-items:center; justify-content:center; border-radius:8px }
.icon-only .bi { font-size: 16px; line-height:1 }
.option-summary { font-size: 0.82rem; color: #666 }
/* ensure truncation works inside the drawer context too */
.cart-drawer .cart-item-name .text-truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }

/* Drawer specific tweaks to match provided mock */
.cart-drawer .cart-item-qty { width:40px; height:40px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid rgba(0,0,0,0.06); background:#fafafa; font-weight:700; margin-right:12px }
.cart-drawer .product-name { font-size:0.95rem; font-weight:700 }
.cart-drawer .option-summary { font-size:0.82rem; color: #6c757d; margin-top:4px; line-height:1.3 }
.cart-drawer .drawer-wrap { white-space: normal }
.cart-drawer .cart-item-price { font-weight:600; font-size:0.9rem }
.cart-drawer .cart-item-actions { min-width:64px }
.cart-drawer .cart-item-actions .btn { padding: 6px 4px !important; margin-bottom: 2px;}

@media (max-width: 767px){
  .cart-drawer .product-name { font-size:0.9rem }
  .cart-drawer .option-summary { font-size:0.75rem }
  .cart-drawer .cart-item-qty { width:36px; height:36px }
}

/* hide thumbnails inside drawer (photos not required) */
.cart-drawer .cart-thumb, .cart-drawer img { display: none !important }

/* slightly tighten list-group item paddings to match mock */
.cart-drawer .list-group-item { padding: 12px; border-radius: 10px; }

/* Action button responsive: show text on small screens, icons on larger screens */
.action-btn { color: inherit }
.action-btn .action-icon { display: inline-block; margin-right: 6px; vertical-align: middle }
.action-btn .action-text { display: none !important }

@media (min-width: 768px){
  .action-btn .action-icon { display: inline-block }
}

/* micro-typography: spacing and weight for action links */
.cart-item-actions .action-btn { line-height: 1.08; margin-bottom: 4px }
.action-btn.edit .action-text, .action-btn.edit .action-icon { color: #b81b1b !important; font-weight: 800 }
/* slightly lighter grey for "Remover" to match mock */
.action-btn.remove .action-text, .action-btn.remove .action-icon { color: #9aa0a6 !important }

/* small adjustment to option summary line spacing */
.option-summary { line-height: 1.35 }

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
    /* bottom-sheet style by default; on small screens we'll switch to full-screen */
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
  .list-group-item.py-3 { padding-top:8px; padding-bottom:8px }
  .cart-drawer .list-group-item { padding: 10px }
  .icon-only { width:28px; height:28px }
  .cart-summary { font-size: 0.92rem }
  .cart-summary .fw-bold { font-size: 0.98rem }
  .drawer-footer .btn { font-size: 0.9rem; padding:8px 10px }
  .cart-drawer .drawer-header h5 { font-size: 1rem }
  /* make drawer full screen on mobile when opened */
  .cart-drawer {
    top: 0;
    bottom: 0;
    height: 100vh;
    border-radius: 0;
    transform: translateY(100%);
  }
  .cart-drawer.open { transform: translateY(0) }
  .drawer-body { overflow:auto; max-height: calc(100vh - 140px) }
  /* reduce cart bar conflicts: hide mobile-cart-bar when drawer is open */
  .mobile-cart-bar { bottom: calc(68vh + 8px); font-size:12px; bottom:60px; height:60px;}
}

/* Mobile bottom nav */
.mobile-bottom-nav { display:flex; position:fixed; left:0; right:0; bottom:0; height:64px; background:#fff; border-top:1px solid rgba(0,0,0,0.06); z-index:10800; align-items:center; justify-content:space-around }
.mobile-bottom-nav .nav-item { background:transparent; border:none; padding:6px 8px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#333; position:relative }
.mobile-bottom-nav .nav-icon { font-size:20px; line-height:1 }
.mobile-bottom-nav .nav-label { font-size:12px; margin-top:4px }
.mobile-bottom-nav .cart-badge { background:#0d6efd; color:#fff; border-radius:10px; padding:2px 6px; font-size:11px; position:absolute; top:6px; right:12px; margin-left:0 }
.mobile-bottom-nav .nav-item.active, .mobile-bottom-nav .nav-item.active .nav-label, .mobile-bottom-nav .nav-item.active .nav-icon{ color: rgb(255 147 7) !important }

/* make mobile cart bar fixed above the bottom nav so it's always visible while scrolling */
.mobile-cart-bar { position:fixed; left:0; right:0;  z-index:1048; display:flex; align-items:center; justify-content:space-between; padding:8px 16px; background:#fff; border-top:1px solid rgba(0,0,0,0.06) }
.mobile-cart-bar .btn { margin:0 }

@media (max-width: 767px){
  /* add bottom padding so main content isn't hidden under the mobile cart bar + nav */
  .container.py-4 { padding-bottom: 150px }
}
body { padding-bottom: 110px; }

/* Header / hero customizations */
.company-logo-wrapper { width:96px; height:96px; background: #fff; border-radius:12px; overflow:hidden; box-shadow: 0 6px 18px rgba(0,0,0,0.14); flex: 0 0 96px }
.company-logo { width:100%; height:100%; object-fit:cover }
.company-name { font-size:1.6rem; margin-bottom:0; font-weight:800 }
.company-address { color: rgba(255,255,255,0.9);}
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
  .hero-panel .company-name { font-size: 1.1rem }
  .nav-pills .nav-link { color:#000; font-size:12px; padding-bottom: 8px; position: relative }
  /* animated underline using pseudo-element */
  .nav-pills .nav-link::after { content: '';
    position: absolute;
    left: 15px;
    right: 20%;
    height: 3px;
    bottom: -2px;
    background: #42721a;
    transform: scaleX(0);
    transform-origin: left center;
    transition: transform .18s ease; }
  .nav-pills .nav-link.active { background: transparent; color: #111; font-weight:700; border-radius:0 }
  .nav-pills .nav-link.active::after { transform: scaleX(1) }
}
.nav-item:first-child a {
  padding-left: 10px;
  margin-left: 0px;
}
/* Reduce hero height on small screens for better vertical space */
@media (max-width: 767px){
  .public-hero { height: 125px }
}

/* Desktop/mobile animated underline and active styles handled by pseudo-element */
.nav-pills { --nav-underline-offset: 12%; display: flex; flex-wrap: nowrap; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity; scroll-padding-left: 12px }
.nav-pills .nav-item { flex: 0 0 auto; scroll-snap-align: start }
.nav-pills .nav-link { position: relative; white-space: nowrap; 
    color: #000 !important;
    font-size: 14px;
    font-weight: 600; }
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
.form-check-input:checked {
    background-color: var(--brand) !important;
    border-color: var(--brand) !important;
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

/* Checkout modal / review styling to match drawer visual */
.product-modal .cart-item-qty { width:40px; height:40px; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid rgba(0,0,0,0.06); background:#fafafa; font-weight:700; margin-right:12px }
.product-modal .product-name { font-size:0.95rem; font-weight:700 }
.product-modal .option-summary { font-size:0.82rem; color:#6c757d; margin-top:4px; line-height:1.3; white-space:normal }
.product-modal .cart-item-price { width:110px; font-weight:700; font-size:1rem }
.product-modal .cart-item-actions { min-width:64px }
/*.product-modal .cart-item-actions .btn { padding:0; margin:0; text-decoration:none }*/
/*.product-modal img, .product-modal .cart-thumb { display:none !important }*/
.product-modal .list-group-item { padding: 12px; border-radius: 10px }

@media (max-width:767px){
  .product-modal .product-name { font-size:0.95rem }
  .product-modal .option-summary { font-size:0.8rem }
  .product-modal .cart-item-qty { width:36px; height:36px }
}
/* Tabs inside the info modal: visual tweaks to match the app style */
.modal-content .nav-tabs { border-bottom: none; padding-bottom: 6px; display:flex; gap:6px; }
.modal-content .nav-tabs .nav-item { margin-bottom: 0 }
.modal-content .nav-tabs .nav-link {
  border: none;
  padding: 8px 12px;
  color: #444;
  background: transparent;
  border-radius: 10px;
  transition: background .12s ease, box-shadow .12s ease, color .12s ease;
}
.modal-content .nav-tabs .nav-link.active {
  background: rgba(13,110,253,0.06);
  color: #0d6efd;
  font-weight: 700;
  box-shadow: 0 6px 18px rgba(13,110,253,0.06);
  border: 1px solid rgba(13,110,253,0.08);
}
@media (max-width:480px){
  .modal-content .nav-tabs .nav-link { padding: 8px 10px; font-size: 0.95rem }
}
.btn-delete{
  background: #f8d7da;
  color: #842029;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 600;
}
.btn-action{ 
  background: #e2e6ea;
  color: #333;
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 600;
}
.form-check-inline{
  border:2px solid #DDD !important;
  border-radius:12px !important;
}
/* Checkout stepper */
.checkout-stepper{ display:flex; gap:12px; align-items:center; position:relative }
.checkout-stepper .step{ flex:1 1 0; display:flex; flex-direction:column; align-items:center; position:relative; text-align:center; padding:6px 8px }
.checkout-stepper .step::after{ content: '';
    position: absolute;
    right: -45%;
    top: 17px;
    width: 73%;
    height: 4px;
    background: #eef2f5;
    z-index: 0;
    margin: 0 auto;
    border-radius: 88px;
   }
.checkout-stepper .step:last-child::after{ display:none }
.checkout-stepper .step .step-icon{ width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#f3f5f7; border:2px solid #e0e6ea; z-index:2 }
.checkout-stepper .step .step-icon .bi{ font-size:0.7rem }
.checkout-stepper .step .step-label{ font-size:0.6rem; margin-top:6px; color:#556 }
.checkout-stepper .step.completed .step-icon{ background:#8cbf62; border-color:#8cbf62; color:#fff }
.checkout-stepper .step.completed::after{ background:#c9e9a8 }
.checkout-stepper .step.active .step-icon{ background:rgb(66, 114, 26) !important; border-color:rgb(66, 114, 26) !important; color:#fff }
.checkout-stepper .step.active .step-label{ font-weight:700; color:rgb(66, 114, 26) !important}
.checkout-stepper .step-close{ position: absolute; right: 8px; top: 6px; z-index:3 }


.summary-icon{
    padding: 5px 10px;
    background-color: var(--brand-lightest);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    margin-right: 8px;
}
/* Search box styles */
.search-categories-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.categories-pills {
  flex: 1;
  min-width: 0;
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/* Desktop: busca sempre visível */
@media (min-width: 992px) {
  .search-input-container {
    display: flex;
    align-items: center;
    position: relative;
    width: 280px;
  }
  
  .search-box .search-icon {
    position: absolute;
    left: 12px;
    color: #6c757d;
    pointer-events: none;
    z-index: 1;
  }
  
  .search-box .search-input {
    width: 100%;
    padding-left: 40px;
    padding-right: 40px;
    border-radius: 12px;
    border: 2px solid #e9ecef;
    transition: all 0.2s ease;
  }
  
  .search-toggle-btn {
    display: none !important;
  }
}

/* Mobile: busca com expansão */
@media (max-width: 991px) {
  .search-categories-container {
    flex-wrap: nowrap;
  }
  
  .categories-pills {
    max-width: calc(100% - 50px);
    position:relative;
  }
  .categories-pills::after {
    content: '';
    background: linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 1) 100%) !important;
    position: absolute;
    height: 38px;
    width: 63px;
    right: 0px;
    top: 0;
    z-index: 73;
}
  
  .categories-pills.search-active {
    opacity: 0;
    transform: translateX(-20px);
    pointer-events: none;
  }
  
  .search-box {
    position: relative;
  }
  
  .search-toggle-btn {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    border: 2px solid #e9ecef;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
  }
  
  .search-toggle-btn:hover {
    border-color: #0d6efd;
    background: #f8f9fa;
  }
  
  .search-toggle-btn i {
    font-size: 1.2rem;
    color: #6c757d;
  }
  
  .search-toggle-btn.hidden {
    display: none;
  }
  
  .search-input-container {
    position: absolute;
    right: 0;
    top: 0;
    width: 0;
    opacity: 0;
    overflow: hidden;
    transition: all 0.3s ease;
    display: flex;
    align-items: center;
  }
  
  .search-input-container.show {
    width: calc(100vw - 48px);
    max-width: 500px;
    opacity: 1;
  }
  
  .search-box.expanded .search-input-container {
    position: relative;
  }
  
  .search-input-container .search-input {
    width: 100%;
    padding-left: 16px;
    padding-right: 40px;
    border-radius: 12px;
    border: 2px solid #e9ecef;
    transition: all 0.2s ease;
  }
}

/* Estilos comuns */
.search-box .search-input:focus {
  border-color: #0d6efd;
  box-shadow: 0 0 0 0.2rem rgba(13, 110, 253, 0.15);
  outline: none;
}

.search-box .search-clear {
  position: absolute;
  right: 8px;
  padding: 4px 8px;
  color: #6c757d;
  text-decoration: none;
  z-index: 2;
}

.search-box .search-clear:hover {
  color: #495057;
}

.search-box .search-clear i {
  font-size: 1.1rem;
}
    

  .summary-icon i{
    color: #42721a !important;
    }
    .btn-summary{    
      background-color: #e5e5e5 !important;;
      color: #7b7b7b !important;
      padding: 4px 8px !important;
      border-radius: 8px !important;
    }
  .btn-next{
    background-color: var(--brand);
    width: 100%;
    border: 2px solid var(--brand);
    font-weight: bold;
    font-size: 1.1rem;
    border-radius: 12px;
  }
   .btn-confirm{
    background-color: var(--brand);
    border: 2px solid var(--brand);
    font-size: 1.1rem;
    border-radius: 12px;
  }
  .add-to-card-plus {
    background-color: var(--brand);
    color: #FFF;
    display: flex;
    text-align: center;
    width: 0px;
    height: 0px;
    justify-content: center;
    align-items: center;
    border-radius: 150px;
    position: absolute;
    left: 23px;
    transition: all 0.3s ease-in-out;
    opacity: 0;
}
.product-card:hover{
    cursor:pointer;
  }
.product-card:hover .add-to-card-plus {
    animation: bounce 2s infinite;
    opacity: .9;    
    width: 50px;
    height: 50px;
  }
@keyframes bounce {
  0%, 20%, 50%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-15px);
  }
  60% {
    transform: translateY(-8px);
  }
}

</style>