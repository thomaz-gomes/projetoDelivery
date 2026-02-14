<template>
  <div class="container py-4">
  <h2>Cardápio (Admin) <small v-if="menuInfo">- {{ menuInfo.name }}</small></h2>

    <div class="row">
      <div class="col-12">
        <div class="mb-3 d-flex justify-content-between align-items-center">
          <div class="w-50 d-flex">
            <TextInput v-model="search" placeholder="Buscar um item" inputClass="form-control me-2" />
            <button class="btn btn-sm btn-outline-secondary me-2" :class="{ active: compactMode }" @click="toggleCompact"><i class="bi bi-list"></i> {{ compactMode ? 'Denso' : 'Normal' }}</button>
          </div>
          <div>
            <button class="btn btn-outline-secondary me-2" @click="goNewCategory">Adicionar categoria</button>
            <button class="btn btn-primary" @click="goNewProduct">Adicionar produto</button>
          </div>
        </div>

        <div v-if="loading" class="text-center py-3">Carregando...</div>
        <div v-else>
          <div class="category-box" v-for="cat in groupedCategories" :key="cat.id">
            <div :id="'cat-header-'+cat.id" class="category-header d-flex align-items-center justify-content-between" @click="toggleCategory(cat.id)">
              <div class="d-flex align-items-center">
                <div class="form-check form-switch me-2">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :id="'cat-active-'+cat.id"
                    :checked="(findCategoryById(cat.id)?.isActive) ?? false"
                    role="switch"
                    :aria-checked="(findCategoryById(cat.id)?.isActive) ?? false"
                    :aria-label="`Ativar categoria ${cat.name || ''}`"
                    :disabled="togglingCategoryIds.includes(cat.id)"
                    @change.stop.prevent="toggleCategoryActive(cat)"
                  />
                </div>
                <button class="btn btn-sm btn-light me-3 category-toggle" @click.stop="toggleCategory(cat.id)" :aria-expanded="!collapsed[cat.id]" :aria-controls="'category-body-'+cat.id">
                  <i class="bi bi-chevron-down chevron-icon" :class="{ 'rotated': collapsed[cat.id] }"></i>
                </button>
                <div>
                  <div class="category-title">{{ cat.name || 'Sem categoria' }}</div>
                  <div class="small text-muted">{{ cat.products.length }} itens</div>
                </div>
              </div>

                <div class="category-actions">
                  <button class="btn btn-sm btn-outline-secondary me-2" @click.stop.prevent="editCategory(cat)" :aria-label="`Editar categoria ${cat.name || ''}`"><i class="bi bi-pencil me-1"></i>Editar</button>
                  <button class="btn btn-sm btn-primary me-2" @click.stop.prevent="newProductForCategory(cat)" :aria-label="`Novo produto para ${cat.name || ''}`"><i class="bi bi-plus-circle me-1"></i>Novo produto</button>
                  <button class="btn btn-sm btn-outline-secondary me-2" @click.stop.prevent="duplicateCategory(cat)" :aria-label="`Duplicar categoria ${cat.name || ''}`"><i class="bi bi-files me-1"></i></button>
                  <button class="btn btn-sm btn-danger" @click.stop.prevent="deleteCategory(cat)" :aria-label="`Excluir categoria ${cat.name || ''}`"><i class="bi bi-trash me-1"></i></button>
                </div>
            </div>

            <transition name="collapse">
              <div class="category-body" v-if="!collapsed[cat.id]" :id="'category-body-'+cat.id" role="region" :aria-labelledby="'cat-header-'+cat.id">
              <div :class="['product-card mb-2 d-flex align-items-start', { compact: compactMode, inactive: !p.isActive }]" v-for="p in cat.products" :key="p.id">
                <div class="product-switch me-3 d-flex align-items-start">
                  <div class="form-check form-switch">
                    <input
                      class="form-check-input"
                      type="checkbox"
                      :id="'prod-active-'+p.id"
                      v-model="p.isActive"
                      :aria-checked="p.isActive"
                      :disabled="togglingIds.includes(p.id)"
                      @change.stop="toggleActive(p)"
                    />
                  </div>
                </div>

                <div class="product-thumb me-3">
                  <div v-if="p.image" class="admin-product-image-wrapper" role="button" tabindex="0" @click.stop.prevent="openMediaFor(p)" @keydown.enter.stop.prevent="openMediaFor(p)" aria-label="Substituir imagem do produto">
                    <img :src="assetUrl(p.image)" class="admin-product-image" loading="lazy" />
                    <div class="admin-image-overlay">
                      <i class="bi bi-camera" style="font-size:18px"></i>
                      <div style="font-size:11px;margin-top:2px">TROCAR</div>
                    </div>
                  </div>
                  <div v-else class="bg-light admin-product-image-placeholder d-flex align-items-center justify-content-center" role="button" tabindex="0" @click.stop.prevent="openMediaFor(p)" @keydown.enter.stop.prevent="openMediaFor(p)" aria-label="Adicionar imagem para produto">
                    <i class="bi bi-camera" style="font-size:20px;color:#6c6c6c"></i>
                  </div>
                </div>

                <div class="product-card-body">
                  <h6 class="mb-1 product-title">{{ p.name }}</h6>
                  <div class="small text-muted product-desc">{{ p.description }}</div>
                </div>

                <div class="product-card-media d-flex align-items-center">
                  <div class="me-3 d-flex flex-column align-items-end">
                    <div class="price-pill">{{ formatCurrency(p.price) }}</div>
                  </div>
                  <div class="product-actions d-flex align-items-center" style="gap:8px">
                    <button class="btn btn-sm btn-outline-primary" @click="edit(p)" :aria-label="`Editar ${p.name || 'produto'}`"><i class="bi bi-pencil me-1"></i></button>
                    <button class="btn btn-sm btn-danger" @click="remove(p)" :aria-label="`Remover ${p.name || 'produto'}`"><i class="bi bi-trash me-1"></i></button>
                  </div>
                </div>
              </div>
              </div>
            </transition>
          </div>
        </div>
      </div>
    </div>


  </div>
</template>

<script setup>
import { ref, onMounted, computed, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import api from '../api'
import { assetUrl } from '../utils/assetUrl.js'
import { bindLoading } from '../state/globalLoading.js'
import { useMediaLibrary } from '../composables/useMediaLibrary.js'

const loading = ref(false)
bindLoading(loading)
const products = ref([])
const categoriesList = ref([])
const collapsed = reactive({})
const compactMode = ref(false)
const search = ref('')
const groups = ref([])
const togglingIds = ref([])
const togglingCategoryIds = ref([])
const error = ref('')
const route = useRoute()
const menuId = computed(() => route.query.menuId || null)
const menuInfo = ref(null)

// Media Library for product image selection
const { openFor } = useMediaLibrary()

function openMediaFor(prod) {
  openFor(`product-image-${prod.id}`, async (url) => {
    try {
      await api.patch(`/menu/products/${prod.id}`, { image: url })
      prod.image = url
    } catch (e) {
      console.warn('Failed to update product image', e)
    }
  })
}

async function load(){
  loading.value = true
  try{
    const params = {}
    if(menuId.value) params.menuId = menuId.value
    const res = await api.get('/menu/products', { params })
    products.value = res.data || []
    // load option groups for assignment UI
    try{ const gr = await api.get('/menu/options', { params }); groups.value = gr.data || [] }catch(e){ groups.value = [] }
    // load categories for grouping and names
    try{ const cr = await api.get('/menu/categories', { params }); categoriesList.value = cr.data || [] }catch(e){ categoriesList.value = [] }
    // if menuId provided, fetch menu info
    if(menuId.value){
      try{ const mi = await api.get(`/menu/menus/${menuId.value}`); menuInfo.value = mi.data }catch(e){ menuInfo.value = null }
    } else { menuInfo.value = null }
    // initialize collapsed state for categories (expanded by default)
    // try to restore from localStorage
    try{
      const raw = localStorage.getItem('menu_admin_collapsed')
      const parsed = raw ? JSON.parse(raw) : null
      const ids = categoriesList.value.map(c=>c.id).filter(Boolean)
      ids.forEach(id => { collapsed[id] = parsed && parsed[id] !== undefined ? parsed[id] : false })
    }catch(e){
      const ids = categoriesList.value.map(c=>c.id).filter(Boolean)
      ids.forEach(id => { if(collapsed[id] === undefined) collapsed[id] = false })
    }
    // compact mode from localStorage
    try{ compactMode.value = JSON.parse(localStorage.getItem('menu_admin_compact') || 'false') }catch(e){ compactMode.value = false }
  }catch(e){
    console.error(e); error.value = 'Falha ao carregar produtos'
  }finally{ loading.value = false }
}
const router = useRouter()
function edit(p){
  // navigate to product edit page
  router.push({ path: `/menu/products/${p.id}` })
}

function goNewProduct(){
  const q = {}
  if(menuId.value) q.menuId = menuId.value
  router.push({ path: '/menu/products/new', query: q })
}
function goNewCategory(){
  const q = {}
  if(menuId.value) q.menuId = menuId.value
  router.push({ path: '/menu/categories/new', query: q })
}
// Product create/edit functionality moved to separate ProductForm view

import Swal from 'sweetalert2'

async function remove(p){
  const res = await Swal.fire({
    title: 'Remover produto?',
    text: `Deseja remover "${p.name}"? Esta ação é irreversível.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sim, remover',
    cancelButtonText: 'Cancelar'
  })
  if(!res.isConfirmed) return
  try{
    await api.delete(`/menu/products/${p.id}`)
    await load()
    Swal.fire({ icon: 'success', text: 'Produto removido' })
  }catch(e){ console.error(e); Swal.fire({ icon: 'error', text: 'Falha ao remover' }) }
}

async function toggleActive(p){
  // the checkbox uses v-model so p.isActive already contains the new value
  const prev = p.isActive === undefined ? false : p.isActive
  const newVal = p.isActive
  // mark as toggling (disable the input while request is in flight)
  togglingIds.value.push(p.id)
  try{
    await api.patch(`/menu/products/${p.id}`, { isActive: newVal })
    Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500, icon: 'success', title: newVal ? 'Produto ativado' : 'Produto desativado' })
  }catch(e){
    console.error('Failed to toggle product active', e)
    // revert UI state
    p.isActive = !newVal
    await Swal.fire({ icon: 'error', text: 'Falha ao atualizar status do produto' })
  }finally{
    togglingIds.value = togglingIds.value.filter(id => id !== p.id)
  }
}

onMounted(()=> load())

const filteredProducts = computed(() => {
  const q = (search.value || '').toLowerCase().trim()
  if(!q) return products.value
  return products.value.filter(p => (p.name||'').toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q))
})

const groupedCategories = computed(() => {
  // build map by category id
  const map = new Map()
  // use categoriesList order when possible
  const byId = {}
  categoriesList.value.forEach(c => { byId[c.id] = c })

  // assign products (filtered)
  filteredProducts.value.forEach(p => {
    const cid = p.categoryId || (p.category && p.category.id) || 'uncategorized'
    if(!map.has(cid)) map.set(cid, { id: cid, name: byId[cid]?.name || (p.category && p.category.name) || 'Sem categoria', products: [] })
    map.get(cid).products.push(p)
  })

  // ensure categories from categoriesList are present even if empty
  categoriesList.value.forEach(c => { if(!map.has(c.id)) map.set(c.id, { id: c.id, name: c.name, products: [] }) })

  // return in categoriesList order then uncategorized
  const ordered = []
  categoriesList.value.forEach(c => { const entry = map.get(c.id) || { id: c.id, name: c.name, products: [] }; entry.isActive = c.isActive !== undefined ? c.isActive : true; ordered.push(entry) })
  if(map.has('uncategorized')) ordered.push(map.get('uncategorized'))
  return ordered
})

function findCategoryById(id){
  if(!id) return null
  return categoriesList.value.find(c=>c.id === id) || null
}

function formatCurrency(v){
  try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)); }catch(e){ return v }
}

function toggleCategory(id){
  if(id === 'uncategorized') id = 'uncategorized'
  collapsed[id] = !collapsed[id]
  // persist collapsed state
  try{ localStorage.setItem('menu_admin_collapsed', JSON.stringify(collapsed)) }catch(e){ }
}

function toggleCompact(){
  compactMode.value = !compactMode.value
  try{ localStorage.setItem('menu_admin_compact', JSON.stringify(compactMode.value)) }catch(e){}
}

// helper to fetch image URL and return a dataURL (base64)
async function fetchImageAsBase64(url){
  if(!url) return null
  try{
    // support relative URLs by using the current origin
    const absolute = url.startsWith('http') ? url : (window.location.origin + (url.startsWith('/') ? url : '/' + url))
    const resp = await fetch(absolute, { mode: 'cors' })
    if(!resp.ok) throw new Error('Failed to fetch image')
    const blob = await resp.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }catch(e){ console.warn('fetchImageAsBase64 error', e); return null }
}

function editCategory(cat){
  if(!cat || !cat.id) return
  router.push({ path: `/menu/categories/${cat.id}` })
}



function newProductForCategory(cat){
  const q = cat && cat.id ? { categoryId: cat.id } : {}
  if(menuId.value) q.menuId = menuId.value
  router.push({ path: '/menu/products/new', query: q })
}

async function toggleCategoryActive(cat){
  if(!cat || !cat.id) return
  const realCat = findCategoryById(cat.id)
  if(!realCat) return
  const prev = realCat.isActive
  const newVal = !prev
  // optimistic: disable input while request is in flight
  togglingCategoryIds.value.push(cat.id)
  try{
    await api.patch(`/menu/categories/${cat.id}`, { isActive: newVal })
    Swal.fire({ toast:true, position:'top-end', showConfirmButton:false, timer:1200, icon:'success', title: newVal ? 'Categoria ativada' : 'Categoria desativada' })
    await load()
  }catch(e){
    console.error('Failed to toggle category', e)
    // revert local list if present
    if(realCat) realCat.isActive = prev
    await Swal.fire({ icon:'error', text: 'Falha ao atualizar categoria' })
  }finally{
    togglingCategoryIds.value = togglingCategoryIds.value.filter(id => id !== cat.id)
  }
}

async function duplicateCategory(cat){
  if(!cat) return
  const res = await Swal.fire({ title: 'Duplicar categoria?', text: `Criar uma cópia de "${cat.name}" juntamente com seus produtos?`, icon: 'question', showCancelButton:true, confirmButtonText:'Sim, duplicar' })
  if(!res.isConfirmed) return
  // start duplication
  try{
    Swal.fire({ title: 'Duplicando...', html: 'Por favor aguarde — duplicando categoria e produtos', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } })
    // create new category
    const payload = { name: `${cat.name} (copy)`, description: cat.description || '', position: (cat.position || 0) + 1, isActive: cat.isActive }
    const catRes = await api.post('/menu/categories', payload)
    const newCat = catRes.data

    // if there are no products, we're done
    const productsToCopy = (cat.products || []).slice()
    const errors = []
    for(const p of productsToCopy){
      try{
        // build product payload — copy fields and assign new category
        const prodPayload = {
          name: `${p.name} (copy)`,
          description: p.description || '',
          price: p.price || 0,
          position: (p.position || 0) + 1,
          isActive: p.isActive,
          categoryId: newCat.id,
          // try to copy image url if backend supports it
          image: p.image || null
        }
        const prodRes = await api.post('/menu/products', prodPayload)
        const newProd = prodRes.data

        // copy attached option groups if present
        try{
          const att = await api.get(`/menu/products/${p.id}/option-groups`)
          const attached = att.data && att.data.attachedIds ? att.data.attachedIds : []
          if(attached.length){
            await api.post(`/menu/products/${newProd.id}/option-groups`, { groupIds: attached })
          }
        }catch(e){
          // non-fatal — continue copying others
          console.warn('Failed to copy option-groups for product', p.id, e)
        }

        // attempt to copy image by fetching it, converting to base64 and uploading
        if(p.image){
          try{
            const dataUrl = await fetchImageAsBase64(p.image)
            if(dataUrl){
              // strip metadata prefix for server if needed, but backend expects imageBase64 as dataURL in ProductForm
              await api.post(`/menu/products/${newProd.id}/image`, { imageBase64: dataUrl, filename: `copied-${newProd.id}.jpg` })
            }
          }catch(e){
            console.warn('Failed to copy image for product', p.id, e)
          }
        }
      }catch(e){
        console.error('Failed to duplicate product', p.id, e)
        errors.push({ productId: p.id, error: e })
      }
    }

    await load()
    Swal.close()
    if(errors.length) {
      Swal.fire({ icon: 'warning', text: `Categoria duplicada, mas ${errors.length} produto(s) falharam ao duplicar.` })
    } else {
      Swal.fire({ icon:'success', text:'Categoria e produtos duplicados com sucesso' })
    }
  }catch(e){
    console.error(e)
    Swal.close()
    Swal.fire({ icon:'error', text:'Falha ao duplicar categoria' })
  }
}

async function deleteCategory(cat){
  if(!cat || !cat.id) return
  const res = await Swal.fire({ title: 'Excluir categoria?', text: `Remover categoria "${cat.name}" e desvincular produtos?`, icon: 'warning', showCancelButton:true, confirmButtonText:'Excluir' })
  if(!res.isConfirmed) return
  try{
    await api.delete(`/menu/categories/${cat.id}`)
    await load()
    Swal.fire({ icon:'success', text:'Categoria excluída' })
  }catch(e){ console.error(e); Swal.fire({ icon:'error', text:'Falha ao excluir categoria' }) }
}
</script>

<style scoped>
/* reuse admin shared styles for upload/crop visuals */
.cropper-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:2000 }
.cropper-modal-content { background: #fff; border-radius:8px; max-width:92vw; width:720px; max-height:92vh; overflow:auto }
.cropper-canvas-wrapper { width:100%; height: auto; display:flex; align-items:center; justify-content:center }
.crop-image-container { position: relative; width:100%; max-height:64vh; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#f5f5f5 }
.crop-image { max-width:100%; max-height:64vh; user-select:none; -webkit-user-drag:none }
.crop-box { position:absolute; border:2px dashed #fff; box-shadow: 0 6px 18px rgba(0,0,0,0.2); background: rgba(255,255,255,0.02); touch-action: none }
.upload-dropzone { border: 2px dashed #d9d9e6; border-radius:12px; padding:18px; cursor:pointer; background: #fff; display:block }
.upload-dropzone.drag-over { background: #f3f4ff; border-color: #b9afff }
.upload-inner { display:flex; align-items:center; justify-content:center; flex-direction:column; gap:12px; min-height:100px }
.btn-upload { background: linear-gradient(90deg,#5c6cff,#9b6bff); color: #fff; border: none; padding: .5rem 1rem; border-radius: 20px }
.upload-preview { width:120px; height:120px; margin:0 auto; position:relative; border-radius:6px; overflow:hidden }
.upload-preview-img { width:100%; height:100%; object-fit:cover; display:block }
.image-preview-overlay { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.45); color:#fff; font-weight:700; letter-spacing:0.6px; opacity:0; transition: opacity .14s ease, transform .14s ease; transform: translateY(6px) }
.upload-preview:hover .image-preview-overlay, .upload-preview:focus .image-preview-overlay { opacity:1; transform: translateY(0) }

.admin-product-image { width:72px; height:72px; object-fit:cover; border-radius:6px; display:block }
.admin-product-image-wrapper { position:relative; width:72px; height:72px; border-radius:6px; overflow:hidden; cursor:pointer; display:inline-block }
.admin-image-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); color:#fff; font-weight:700; letter-spacing:0.5px; opacity:0; transition:opacity .14s ease, transform .14s ease; transform:translateY(4px) }
.admin-product-image-wrapper:hover .admin-image-overlay, .admin-product-image-wrapper:focus .admin-image-overlay { opacity:1; transform:translateY(0) }
.admin-product-image-placeholder { width:72px; height:72px; border-radius:6px; cursor:pointer }
</style>
