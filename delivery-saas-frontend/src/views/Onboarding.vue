<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import api from '../api'

// ─── Brand tokens (mirrors onboarding-shared.jsx + chefiz-shared.jsx) ───────
const C = {
  green: '#89D136',
  greenDark: '#6DAE1E',
  greenSoft: '#EAF7D6',
  greenInk: '#3D6313',
  ink: '#1F1F1F',
  graphite: '#3F3F3F',
  slate: '#5B5B5B',
  mute: '#8A8A8A',
  hairline: '#E7E6E2',
  paper: '#FAFAF7',
  paperWarm: '#F4F2EC',
  white: '#FFFFFF',
  danger: '#D9483E',
}

const router = useRouter()

// ─── Wizard state ──────────────────────────────────────────────────────────
const STEPS = [
  { key: 'identify', label: 'Identifique-se' },
  { key: 'store',    label: 'Sobre a loja' },
  { key: 'address',  label: 'Endereço' },
  { key: 'menu',     label: 'Criar cardápio' },
  { key: 'review',   label: 'Revisar' },
  { key: 'live',     label: 'No ar' },
]

const step = ref(0)
const stepKey = computed(() => STEPS[step.value].key)

const state = ref({
  name: '',
  email: '',
  password: '',
  phone: '',
  storeName: '',
  slug: '',
  slugTouched: false,
  category: '',
  cep: '',
  street: '',
  district: '',
  city: '',
  stateUF: '',
  timezone: '',
  number: '',
  complement: '',
  menuPath: '',
  products: [],
})

function next() { step.value = Math.min(STEPS.length - 1, step.value + 1) }
function back() { step.value = Math.max(0, step.value - 1) }
function jumpTo(i) { if (i <= step.value) step.value = i }

// ─── Helpers ───────────────────────────────────────────────────────────────
function maskPhoneBR(value) {
  const d = (value || '').replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length < 3) return `(${d}`
  if (d.length < 8) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
function phoneDigits(v) { return (v || '').replace(/\D/g, '') }
function isValidPhoneBR(v) {
  const d = phoneDigits(v)
  return d.length === 10 || d.length === 11
}
function slugify(s) {
  return (s || '')
    .toString().toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
function maskCEP(v) {
  const d = (v || '').replace(/\D/g, '').slice(0, 8)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5)}`
}

// Masked-input @input handlers: Vue skips DOM updates when the bound value
// doesn't actually change between renders (e.g. after the 11th digit, the
// mask keeps returning the same 11-digit string while the raw target.value
// still grows). Forcing target.value = masked guarantees the input never
// drifts past the mask's cap.
function onMaskedInput(e, masker, key) {
  const masked = masker(e.target.value)
  state.value[key] = masked
  if (e.target.value !== masked) e.target.value = masked
}
function onPhoneInput(e) { onMaskedInput(e, maskPhoneBR, 'phone') }
function onCepInput(e) { onMaskedInput(e, maskCEP, 'cep') }

// ─── Screen 1 — Identifique-se ─────────────────────────────────────────────
const touched1 = ref({})
const emailStatus = ref(null) // 'checking' | 'taken' | 'ok' | null
const emailDebounce = ref(null)

watch(() => state.value.email, (v) => {
  if (!v) { emailStatus.value = null; return }
  // Don't bother the backend with obviously-malformed strings — only probe
  // once the input looks like a real e-mail.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    emailStatus.value = null
    return
  }
  emailStatus.value = 'checking'
  clearTimeout(emailDebounce.value)
  emailDebounce.value = setTimeout(async () => {
    try {
      const { data } = await api.get('/auth/check-email', { params: { email: v } })
      if (!data?.valid) { emailStatus.value = null; return }
      emailStatus.value = data.available ? 'ok' : 'taken'
    } catch {
      // Network failure: be permissive so the wizard doesn't get stuck —
      // the actual register call will reject duplicates anyway.
      emailStatus.value = null
    }
  }, 600)
})

const nameErr1 = computed(() => touched1.value.name && !state.value.name.trim() ? 'Diz seu nome aí 🙂' : null)
const emailErr1 = computed(() => {
  if (!touched1.value.email) return null
  if (emailStatus.value === 'taken') return 'taken'
  if (state.value.email && !/.+@.+\..+/.test(state.value.email)) return 'E-mail inválido'
  return null
})
const passErr1 = computed(() => touched1.value.password && state.value.password.length < 8 ? 'Mínimo 8 caracteres' : null)
const phoneErr1 = computed(() => touched1.value.phone && !isValidPhoneBR(state.value.phone) ? 'WhatsApp inválido. Use DDD + 9 dígitos.' : null)

const step1Valid = computed(() =>
  state.value.name.trim() &&
  /.+@.+\..+/.test(state.value.email) &&
  state.value.password.length >= 8 &&
  isValidPhoneBR(state.value.phone) &&
  emailStatus.value !== 'taken',
)

function submitStep1() {
  touched1.value = { name: true, email: true, password: true, phone: true }
  if (step1Valid.value) next()
}

// ─── Screen 2 — Sobre a loja ────────────────────────────────────────────────
const touched2 = ref({})
const slugStatus = ref(null) // 'checking' | 'ok' | 'taken'
const slugDebounce = ref(null)

watch(() => state.value.slug, (v) => {
  if (!v) { slugStatus.value = null; return }
  slugStatus.value = 'checking'
  clearTimeout(slugDebounce.value)
  slugDebounce.value = setTimeout(() => {
    // TODO: replace with real backend probe (GET /public/slug-available?slug=)
    if (['admin', 'chefiz', 'pizzaria'].includes(v)) slugStatus.value = 'taken'
    else slugStatus.value = 'ok'
  }, 500)
})

function onStoreNameInput(v) {
  state.value.storeName = v
  if (!state.value.slugTouched) state.value.slug = slugify(v)
}
function onSlugInput(v) {
  state.value.slug = slugify(v)
  state.value.slugTouched = true
}
function suggestSlug() {
  const year = new Date().getFullYear()
  state.value.slug = `${state.value.slug}-${year}`
  state.value.slugTouched = true
}

const CATEGORIES = [
  { value: 'lanchonete', label: 'Lanchonete', icon: '🥪' },
  { value: 'pizzaria',   label: 'Pizzaria',   icon: '🍕' },
  { value: 'acai',       label: 'Açaí/Sorvete', icon: '🍦' },
  { value: 'marmita',    label: 'Marmita/Caseira', icon: '🍱' },
  { value: 'burger',     label: 'Hamburgueria', icon: '🍔' },
  { value: 'doceria',    label: 'Doceria',    icon: '🧁' },
  { value: 'outros',     label: 'Outros',     icon: '🍽️' },
]

const nameErr2 = computed(() => touched2.value.storeName && !state.value.storeName.trim() ? 'Como sua loja se chama?' : null)
const slugErr2 = computed(() => touched2.value.slug && slugStatus.value === 'taken' ? 'taken' : null)
const catErr2 = computed(() => touched2.value.category && !state.value.category ? 'Escolhe uma categoria' : null)

const step2Valid = computed(() =>
  state.value.storeName.trim() &&
  state.value.slug && slugStatus.value === 'ok' &&
  state.value.category,
)

function submitStep2() {
  touched2.value = { storeName: true, slug: true, category: true }
  if (step2Valid.value) next()
}

// ─── Screen 3 — Endereço ────────────────────────────────────────────────────
const touched3 = ref({})
const cepLookup = ref('idle') // 'idle' | 'loading' | 'found' | 'notfound' | 'manual'
const cepDebounce = ref(null)

watch(() => state.value.cep, (v) => {
  const d = (v || '').replace(/\D/g, '')
  if (d.length < 8) { cepLookup.value = 'idle'; return }
  cepLookup.value = 'loading'
  clearTimeout(cepDebounce.value)
  cepDebounce.value = setTimeout(async () => {
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const data = await res.json()
      if (data.erro) {
        cepLookup.value = 'notfound'
        return
      }
      cepLookup.value = 'found'
      state.value.street = data.logradouro || ''
      state.value.district = data.bairro || ''
      state.value.city = data.localidade || ''
      state.value.stateUF = data.uf || ''
      state.value.timezone = 'America/Sao_Paulo'
    } catch {
      cepLookup.value = 'notfound'
    }
  }, 500)
})

function fillManually() { cepLookup.value = 'manual' }

const cepFound = computed(() => cepLookup.value === 'found' || cepLookup.value === 'manual')
const cepErr3 = computed(() => touched3.value.cep && cepLookup.value === 'notfound')
const numErr3 = computed(() => touched3.value.number && !state.value.number ? 'Coloca o número' : null)
const step3Valid = computed(() => cepFound.value && state.value.number.trim())

function submitStep3() {
  touched3.value = { cep: true, number: true }
  if (step3Valid.value) next()
}

// ─── Screen 4 — Criar cardápio (3 paths) ────────────────────────────────────
const processing = ref(false)
const progress = ref(0)
const aiFailed = ref(false)
const aiError = ref('')
const photoInputRef = ref(null)
const aiCategories = ref(null) // categories returned by /public/onboarding/menu-from-photo
let _photoPollTimer = null
let _progressTimer = null

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function cancelPhotoProcessing() {
  clearTimeout(_photoPollTimer)
  clearInterval(_progressTimer)
  processing.value = false
}

async function uploadPhotosAndParse(files) {
  state.value.menuPath = 'photo'
  processing.value = true
  aiFailed.value = false
  aiError.value = ''
  progress.value = 0
  aiCategories.value = null

  // Visual progress ticker — caps at 90% until the backend reports done.
  // Real wall-clock varies a lot (vision IA pode levar 10-60s).
  let p = 0
  _progressTimer = setInterval(() => {
    p = Math.min(90, p + 4 + Math.random() * 4)
    progress.value = Math.round(p)
  }, 350)

  try {
    const photos = []
    for (const f of files) photos.push(await readFileAsBase64(f))
    const { data } = await api.post('/public/onboarding/menu-from-photo', { photos }, { timeout: 15_000 })
    const jobId = data?.jobId
    if (!jobId) throw new Error('Resposta inválida do servidor.')

    const result = await new Promise((resolve, reject) => {
      function poll() {
        _photoPollTimer = setTimeout(async () => {
          try {
            const { data: status } = await api.get(`/public/onboarding/menu-from-photo/${jobId}`, { timeout: 8000 })
            if (status.done) {
              if (status.error) reject(new Error(status.error))
              else resolve(status)
            } else {
              poll()
            }
          } catch (e) {
            reject(e)
          }
        }, 1500)
      }
      poll()
    })

    clearInterval(_progressTimer)
    progress.value = 100
    aiCategories.value = Array.isArray(result.categories) ? result.categories : []
    setTimeout(() => {
      processing.value = false
      // Falha silenciosa quando a IA não achou nada: trata como erro pro usuário.
      if (!aiCategories.value.length) {
        aiFailed.value = true
        aiError.value = 'A IA não encontrou itens nessa foto. Tente outra imagem ou use o modelo pronto.'
        return
      }
      next()
    }, 300)
  } catch (err) {
    clearInterval(_progressTimer)
    const status = err?.response?.status
    const msg = err?.response?.data?.message || err?.message || 'Falha ao processar a imagem.'
    aiError.value = status === 429
      ? msg + ' Use o modelo pronto enquanto isso.'
      : msg
    aiFailed.value = true
    processing.value = false
  }
}

function onPhotoFilesChange(e) {
  const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'))
  e.target.value = '' // permite re-selecionar os mesmos arquivos
  if (files.length === 0) return
  uploadPhotosAndParse(files)
}

function triggerPhotoUpload() {
  if (photoInputRef.value) photoInputRef.value.click()
}

const PATHS = [
  { key: 'photo',    icon: '📸', title: 'Da foto',         desc: 'Tira foto do cardápio físico ou manda PDF — a IA monta tudo.', time: '~2 min',       tone: 'paper' },
  { key: 'template', icon: '⚡', title: 'Modelo pronto',    desc: '',                                                              time: '~30 segundos', tone: 'green',  recommended: true },
  { key: 'scratch',  icon: '✍️', title: 'Do zero',          desc: 'Você cadastra cada produto manualmente.',                       time: '~5 minutos',   tone: 'paper' },
]

const templateDesc = computed(() => `Cardápio típico de ${categoryLabel.value} já no ar — você só edita.`)
const categoryLabel = computed(() => {
  const c = CATEGORIES.find(x => x.value === state.value.category)
  return c ? c.label.toLowerCase() : 'sua categoria'
})

function pickPath(key) {
  if (key === 'photo') {
    // Reset and open the native file picker — the actual parse begins on file select.
    aiFailed.value = false
    aiError.value = ''
    triggerPhotoUpload()
  } else {
    state.value.menuPath = key
    next()
  }
}
function retryPhoto() {
  aiFailed.value = false
  aiError.value = ''
  triggerPhotoUpload()
}
function useFallbackTemplate() {
  state.value.menuPath = 'template'
  aiFailed.value = false
  aiError.value = ''
  next()
}

// ─── Screen 5 — Revisar cardápio ───────────────────────────────────────────
const TEMPLATE_PRODUCTS = {
  pizzaria: [
    { name: 'Margherita', desc: 'molho, mussarela, manjericão fresco', price: '58,00' },
    { name: 'Calabresa', desc: 'calabresa, cebola roxa, azeitona', price: '62,00' },
    { name: 'Portuguesa', desc: 'presunto, ovo, ervilha, cebola, azeitona', price: '64,00' },
    { name: 'Quatro Queijos', desc: 'mussarela, gorgonzola, parmesão, provolone', price: '64,00' },
    { name: 'Frango c/ Catupiry', desc: 'frango desfiado, catupiry, milho', price: '60,00' },
    { name: 'Chocolate', desc: 'doce — chocolate ao leite e morango', price: '52,00' },
  ],
  burger: [
    { name: 'Cheese Clássico', desc: '150g, queijo cheddar, picles, pão brioche', price: '28,00' },
    { name: 'Bacon Tropa', desc: '180g, bacon crispy, cheddar, alface, tomate', price: '34,00' },
    { name: 'Veggie Beterraba', desc: 'hambúrguer de beterraba, vegano, pão integral', price: '30,00' },
  ],
  lanchonete: [
    { name: 'X-Burger', desc: 'hambúrguer, queijo, alface, tomate', price: '18,00' },
    { name: 'X-Salada', desc: 'hambúrguer, queijo, alface, tomate, milho', price: '22,00' },
    { name: 'Misto Quente', desc: 'presunto e queijo no pão francês', price: '12,00' },
    { name: 'Coca-Cola 350ml', desc: 'lata gelada', price: '7,00' },
  ],
  acai: [
    { name: 'Açaí 300ml', desc: 'banana, granola, leite condensado', price: '18,00' },
    { name: 'Açaí 500ml', desc: 'banana, granola, leite ninho, paçoca', price: '24,00' },
  ],
  marmita: [
    { name: 'Marmita Mista', desc: 'arroz, feijão, bife, fritas, salada', price: '22,00' },
    { name: 'Marmita Frango', desc: 'arroz, feijão, frango grelhado, legumes', price: '20,00' },
  ],
  doceria: [
    { name: 'Brownie', desc: 'chocolate meio amargo, com nozes', price: '14,00' },
    { name: 'Cheesecake', desc: 'fatia com calda de frutas vermelhas', price: '18,00' },
  ],
  outros: [
    { name: 'Item 1', desc: 'descrição curta', price: '20,00' },
    { name: 'Item 2', desc: 'descrição curta', price: '25,00' },
  ],
}

const productErrors = ref({})
const publishing = ref(false)

function formatPriceBR(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num <= 0) return ''
  return num.toFixed(2).replace('.', ',')
}

watch(stepKey, (k) => {
  if (k !== 'review') return
  if (state.value.products && state.value.products.length > 0) return
  if (state.value.menuPath === 'template') {
    const seed = TEMPLATE_PRODUCTS[state.value.category] || TEMPLATE_PRODUCTS.outros
    state.value.products = seed.map((p, i) => ({ id: `p${i}`, ...p, category: 'Principal' }))
  } else if (state.value.menuPath === 'photo' && aiCategories.value?.length) {
    // Flatten the real AI extraction into the inline-edit list shape.
    const flat = []
    let pid = 0
    for (const cat of aiCategories.value) {
      const catName = String(cat.name || 'Principal').trim() || 'Principal'
      for (const item of (cat.items || [])) {
        flat.push({
          id: `p${pid++}`,
          name: String(item.name || '').trim(),
          desc: String(item.description || '').trim(),
          price: formatPriceBR(item.price),
          category: catName,
          fromAI: true,
        })
      }
    }
    state.value.products = flat.length ? flat : [{ id: 'p0', name: '', desc: '', price: '', category: 'Principal' }]
  } else {
    state.value.products = [{ id: 'p0', name: '', desc: '', price: '', category: 'Principal' }]
  }
})

const groupedProducts = computed(() => {
  const map = {}
  for (const p of state.value.products) {
    const cat = p.category || 'Principal'
    if (!map[cat]) map[cat] = []
    map[cat].push(p)
  }
  return map
})

function updateProduct(id, patch) {
  const idx = state.value.products.findIndex(p => p.id === id)
  if (idx >= 0) state.value.products[idx] = { ...state.value.products[idx], ...patch }
}
function removeProduct(id) {
  state.value.products = state.value.products.filter(p => p.id !== id)
}
function addProduct() {
  state.value.products.push({ id: `p${Date.now()}`, name: '', desc: '', price: '', category: 'Principal' })
}
function renameCategory(oldName, newName) {
  state.value.products = state.value.products.map(p =>
    p.category === oldName ? { ...p, category: newName } : p,
  )
}
function validateProducts() {
  const errs = {}
  for (const p of state.value.products) {
    if (!p.name?.trim()) errs[p.id] = { ...(errs[p.id] || {}), name: 'Nome obrigatório' }
    const priceNum = parseFloat((p.price || '').replace(',', '.'))
    if (!priceNum || priceNum <= 0) errs[p.id] = { ...(errs[p.id] || {}), price: 'Preço inválido' }
  }
  productErrors.value = errs
  return Object.keys(errs).length === 0
}
function publish() {
  if (!validateProducts()) return
  publishing.value = true
  setTimeout(() => {
    // TODO: replace with real API calls — create company, store, menu, categories, products.
    publishing.value = false
    next()
  }, 1100)
}

// ─── Screen 6 — Cardápio no ar ─────────────────────────────────────────────
const confettiActive = ref(false)
const copied = ref(false)
const confettiPieces = ref([])

watch(stepKey, (k) => {
  if (k === 'live') {
    setTimeout(() => {
      confettiActive.value = true
      generateConfetti()
    }, 200)
  }
})

function generateConfetti() {
  const colors = [C.green, '#FFB800', '#FF6B6B', C.ink, '#5BA8FF', '#F9DC4D']
  confettiPieces.value = Array.from({ length: 80 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1.5 + Math.random() * 1.5,
    dx: (Math.random() - 0.5) * 200,
    dy: 500 + Math.random() * 300,
    r: (Math.random() - 0.5) * 1440,
    w: 6 + Math.random() * 6,
    h: 10 + Math.random() * 10,
    color: colors[i % colors.length],
  }))
}

const publicUrl = computed(() => `chefiz.com.br/${state.value.slug || 'sua-loja'}`)
const firstName = computed(() => (state.value.name || 'chef').split(' ')[0])

function copyLink() {
  const url = `https://${publicUrl.value}`
  if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {})
  copied.value = true
  setTimeout(() => { copied.value = false }, 1500)
}
function shareWhatsApp() {
  const text = encodeURIComponent(`Olha o cardápio digital do ${state.value.storeName || 'meu restaurante'}: https://${publicUrl.value}`)
  window.open(`https://wa.me/?text=${text}`, '_blank')
}
function goToDashboard() {
  // TODO: route to the real dashboard once the wizard is wired to backend.
  router.push('/orders')
}

// ─── QR Code generator (port of onboarding-shared.jsx QRCodeMini) ──────────
// Galois Field GF(256) tables.
const QR_EXP = new Array(512)
const QR_LOG = new Array(256)
;(function initQR() {
  let x = 1
  for (let i = 0; i < 255; i++) {
    QR_EXP[i] = x
    QR_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) QR_EXP[i] = QR_EXP[i - 255]
})()
function gfMul(a, b) {
  if (!a || !b) return 0
  return QR_EXP[QR_LOG[a] + QR_LOG[b]]
}
function rsGenPoly(degree) {
  let g = [1]
  for (let i = 0; i < degree; i++) {
    const n = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) { n[j] ^= g[j]; n[j + 1] ^= gfMul(g[j], QR_EXP[i]) }
    g = n
  }
  return g
}
function rsEnc(data, ecLen) {
  const gen = rsGenPoly(ecLen)
  const buf = data.concat(new Array(ecLen).fill(0))
  for (let i = 0; i < data.length; i++) {
    const c = buf[i]
    if (c) for (let j = 0; j < gen.length; j++) buf[i + j] ^= gfMul(gen[j], c)
  }
  return buf.slice(data.length)
}
const QR_VER = {
  1: { size: 21, ec: 7,  blocks: [[1, 19]] },
  2: { size: 25, ec: 10, blocks: [[1, 34]] },
  3: { size: 29, ec: 15, blocks: [[1, 55]] },
  4: { size: 33, ec: 20, blocks: [[1, 80]] },
  5: { size: 37, ec: 26, blocks: [[1, 108]] },
}
function pickVersion(byteLen) {
  for (const k of [1, 2, 3, 4, 5]) {
    const v = QR_VER[k]
    const cap = v.blocks.reduce((a, [c, d]) => a + c * d, 0)
    if (byteLen + 2 <= cap) return k
  }
  return 5
}
const QR_FORMAT_L = [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976]
function makeMatrix(version) {
  const size = QR_VER[version].size
  const m = Array.from({ length: size }, () => new Array(size).fill(null))
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false))
  function setF(r, c, v) { m[r][c] = v; reserved[r][c] = true }
  function finder(r, c) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
        const edge = (dr === -1 || dr === 7 || dc === -1 || dc === 7)
        const ring = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) && (dr === 0 || dr === 6 || dc === 0 || dc === 6)
        const core = (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)
        setF(rr, cc, edge ? 0 : (ring || core) ? 1 : 0)
      }
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0)
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === null) setF(6, i, i % 2 === 0 ? 1 : 0)
    if (m[i][6] === null) setF(i, 6, i % 2 === 0 ? 1 : 0)
  }
  setF(size - 8, 8, 1)
  for (let i = 0; i < 9; i++) { reserved[8][i] = true; reserved[i][8] = true }
  for (let i = 0; i < 8; i++) { reserved[size - 1 - i][8] = true; reserved[8][size - 1 - i] = true }
  return { m, reserved, size }
}
function placeData(stateObj, bits) {
  const { m, reserved, size } = stateObj
  let bitIdx = 0, upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i
      for (let cOff = 0; cOff < 2; cOff++) {
        const cc = col - cOff
        if (!reserved[row][cc] && m[row][cc] === null) {
          m[row][cc] = bitIdx < bits.length ? bits[bitIdx++] : 0
        }
      }
    }
    upward = !upward
  }
}
function applyMask(stateObj, mask) {
  const { m, reserved, size } = stateObj
  const fns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ]
  const fn = fns[mask]
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) m[r][c] ^= 1
    }
  }
}
function writeFormat(stateObj, mask) {
  const { m, size } = stateObj
  const fmt = QR_FORMAT_L[mask]
  for (let i = 0; i <= 5; i++) m[8][i] = (fmt >> i) & 1
  m[8][7] = (fmt >> 6) & 1; m[8][8] = (fmt >> 7) & 1; m[7][8] = (fmt >> 8) & 1
  for (let i = 9; i < 15; i++) m[14 - i][8] = (fmt >> i) & 1
  for (let i = 0; i < 7; i++) m[size - 1 - i][8] = (fmt >> i) & 1
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = (fmt >> (i + 7)) & 1
}
function qrEncode(text) {
  const bytes = []
  for (let i = 0; i < text.length; i++) {
    const cc = text.charCodeAt(i)
    bytes.push(cc > 0xff ? 0x3f : cc)
  }
  const ver = pickVersion(bytes.length)
  const vInfo = QR_VER[ver]
  const capacity = vInfo.blocks.reduce((a, [c, d]) => a + c * d, 0)
  const bits = []
  const pushBits = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1) }
  pushBits(0b0100, 4)
  pushBits(bytes.length, 8)
  for (const b of bytes) pushBits(b, 8)
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const pads = [0xec, 0x11]
  let pi = 0
  while (bits.length < capacity * 8) pushBits(pads[pi++ % 2], 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    data.push(v)
  }
  const ec = rsEnc(data, vInfo.ec)
  const all = data.concat(ec)
  const stateObj = makeMatrix(ver)
  const placeBits = []
  for (const b of all) for (let i = 7; i >= 0; i--) placeBits.push((b >> i) & 1)
  placeData(stateObj, placeBits)
  function penalty(s) {
    const { m: mm, size: sz } = s
    let p = 0
    for (let r = 0; r < sz; r++) {
      let run = 1
      for (let c = 1; c < sz; c++) {
        if (mm[r][c] === mm[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++ } else run = 1
      }
    }
    for (let c = 0; c < sz; c++) {
      let run = 1
      for (let r = 1; r < sz; r++) {
        if (mm[r][c] === mm[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p++ } else run = 1
      }
    }
    return p
  }
  let best = null
  for (let mk = 0; mk < 8; mk++) {
    const copy = { m: stateObj.m.map(row => row.slice()), reserved: stateObj.reserved, size: stateObj.size }
    applyMask(copy, mk)
    writeFormat(copy, mk)
    const score = penalty(copy)
    if (!best || score < best.score) best = { score, state: copy, mask: mk }
  }
  return best.state.m
}

const qrMatrix = computed(() => qrEncode(`https://${publicUrl.value}`))
const QR_SIZE_DESKTOP = 220
const QR_SIZE_MOBILE = 160
const QR_PADDING = 12

function qrCell(size) {
  const n = qrMatrix.value.length
  return (size - QR_PADDING * 2) / n
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────
const PREV_TITLE = typeof document !== 'undefined' ? document.title : ''
let injectedFontLink = null
onMounted(() => {
  document.title = 'Chefiz — Crie sua conta grátis'
  if (!document.getElementById('chefiz-font')) {
    injectedFontLink = document.createElement('link')
    injectedFontLink.id = 'chefiz-font'
    injectedFontLink.rel = 'stylesheet'
    injectedFontLink.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'
    document.head.appendChild(injectedFontLink)
  }
})
onUnmounted(() => {
  document.title = PREV_TITLE
  cancelPhotoProcessing()
})

// ─── Primary CTA for footer ────────────────────────────────────────────────
function onPrimaryClick() {
  switch (stepKey.value) {
    case 'identify': submitStep1(); break
    case 'store':    submitStep2(); break
    case 'address':  submitStep3(); break
    case 'review':   publish(); break
    default: break
  }
}
</script>

<template>
  <div class="ob">
    <!-- Confetti overlay (only on Step 6) -->
    <div v-if="stepKey === 'live' && confettiActive" class="ob-confetti" aria-hidden="true">
      <span
        v-for="p in confettiPieces"
        :key="p.id"
        :style="{
          left: p.left + '%',
          width: p.w + 'px',
          height: p.h + 'px',
          background: p.color,
          '--dx': p.dx + 'px',
          '--dy': p.dy + 'px',
          '--r': p.r + 'deg',
          animationDelay: p.delay + 's',
          animationDuration: p.duration + 's',
        }"
      />
    </div>

    <!-- Header: back button + stepper (hidden on the 'live' screen) -->
    <header v-if="stepKey !== 'live'" class="ob-header">
      <button
        type="button"
        class="ob-back"
        :class="{ 'ob-back-hidden': step === 0 }"
        :aria-label="'Voltar'"
        @click="back"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div class="ob-stepper-wrap">
        <div class="ob-stepper" role="navigation" aria-label="Progresso do onboarding">
          <button
            v-for="(s, i) in STEPS"
            :key="s.key"
            type="button"
            :class="['ob-step-bar', { done: i < step, active: i === step }]"
            :disabled="i > step"
            :aria-current="i === step ? 'step' : undefined"
            :aria-label="`Passo ${i + 1} de ${STEPS.length}: ${s.label}`"
            @click="jumpTo(i)"
          />
        </div>
        <div class="ob-step-label">
          Passo {{ step + 1 }} de {{ STEPS.length }} · <strong>{{ STEPS[step].label }}</strong>
        </div>
      </div>
    </header>

    <!-- Live screen has its own minimal header -->
    <header v-else class="ob-live-header">
      <svg class="ob-logo" viewBox="0 0 380 100" height="22" xmlns="http://www.w3.org/2000/svg">
        <text x="0" y="80" font-family="'Plus Jakarta Sans', system-ui" font-weight="800" font-size="100" letter-spacing="-0.04em" fill="#3F3F3F">Chef</text>
        <g transform="translate(245,0)">
          <path d="M 0 0 L 130 0 L 110 100 L -20 100 Z" :fill="C.green" />
          <text x="14" y="80" font-family="'Plus Jakarta Sans', system-ui" font-weight="800" font-size="100" letter-spacing="-0.04em" fill="#3F3F3F">iz</text>
        </g>
      </svg>
      <div class="ob-live-badge">
        <span class="ob-live-dot"></span>
        publicado
      </div>
    </header>

    <main class="ob-main" :class="{ 'ob-main-live': stepKey === 'live' }">
      <!-- ─── Screen 1: Identifique-se ─────────────────────────────── -->
      <section v-if="stepKey === 'identify'" class="ob-narrow ob-slide-up">
        <h1 class="ob-title">Em 5 minutos seu cardápio<br>digital está no ar.</h1>
        <p class="ob-subtitle">Sem cartão. 14 dias grátis no plano Pro.</p>

        <div class="ob-form">
          <div class="ob-field">
            <label class="ob-label" for="ob-name">Seu nome</label>
            <input
              id="ob-name"
              type="text"
              :value="state.name"
              placeholder="Maria Souza"
              :data-state="nameErr1 ? 'error' : ''"
              @input="state.name = $event.target.value"
              @blur="touched1.name = true"
            />
            <div v-if="nameErr1" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {{ nameErr1 }}
            </div>
          </div>

          <div class="ob-field">
            <label class="ob-label" for="ob-email">E-mail</label>
            <div class="ob-input-wrap">
              <input
                id="ob-email"
                type="email"
                :value="state.email"
                placeholder="voce@restaurante.com.br"
                :data-state="emailErr1 ? 'error' : emailStatus === 'ok' ? 'success' : ''"
                @input="state.email = $event.target.value"
                @blur="touched1.email = true"
              />
              <span v-if="emailStatus === 'checking'" class="ob-input-icon"><span class="ob-spin"></span></span>
              <span v-else-if="emailStatus === 'ok'" class="ob-input-icon ob-input-ok">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="4 12 10 18 20 6" /></svg>
              </span>
            </div>
            <div v-if="emailErr1 === 'taken'" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              Esse e-mail já está cadastrado. <a href="#" @click.prevent>Entrar na conta</a>
            </div>
            <div v-else-if="emailErr1" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {{ emailErr1 }}
            </div>
            <div v-else-if="state.email && emailStatus === 'ok'" class="ob-ok">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 12 10 18 20 6" /></svg>
              E-mail disponível
            </div>
          </div>

          <div class="ob-field">
            <label class="ob-label" for="ob-password">Senha</label>
            <input
              id="ob-password"
              type="password"
              :value="state.password"
              placeholder="••••••••"
              :data-state="passErr1 ? 'error' : ''"
              @input="state.password = $event.target.value"
              @blur="touched1.password = true"
            />
            <div v-if="passErr1" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {{ passErr1 }}
            </div>
            <div v-else class="ob-hint">Mínimo 8 caracteres.</div>
          </div>

          <div class="ob-field">
            <label class="ob-label" for="ob-phone">WhatsApp de contato</label>
            <input
              id="ob-phone"
              type="tel"
              inputmode="tel"
              maxlength="15"
              :value="state.phone"
              placeholder="(11) 99999-9999"
              :data-state="phoneErr1 ? 'error' : ''"
              @input="onPhoneInput"
              @blur="touched1.phone = true"
            />
            <div v-if="phoneErr1" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {{ phoneErr1 }}
            </div>
            <div v-else class="ob-hint">Só pra contato e recuperação — não é o WhatsApp da loja.</div>
          </div>
        </div>

        <p class="ob-terms">
          Ao criar conta, você concorda com nossos
          <router-link to="/termos-de-servico">Termos</router-link>
          e
          <router-link to="/politica-de-privacidade">Política de Privacidade</router-link>.
        </p>
      </section>

      <!-- ─── Screen 2: Sobre a loja ───────────────────────────────── -->
      <section v-else-if="stepKey === 'store'" class="ob-narrow ob-slide-up">
        <h1 class="ob-title">Conta pra gente da sua loja.</h1>
        <p class="ob-subtitle">A categoria nos ajuda a montar seu cardápio mais rápido.</p>

        <div class="ob-form">
          <div class="ob-field">
            <label class="ob-label" for="ob-store">Nome da loja</label>
            <input
              id="ob-store"
              type="text"
              :value="state.storeName"
              placeholder="Lanchão Express"
              :data-state="nameErr2 ? 'error' : ''"
              @input="onStoreNameInput($event.target.value)"
              @blur="touched2.storeName = true"
            />
            <div v-if="nameErr2" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {{ nameErr2 }}
            </div>
          </div>

          <div class="ob-field">
            <label class="ob-label" for="ob-slug">Link público do cardápio</label>
            <div
              class="ob-slug"
              :class="{ 'ob-slug-error': slugErr2, 'ob-slug-ok': !slugErr2 && slugStatus === 'ok' }"
            >
              <span class="ob-slug-prefix">chefiz.com.br/</span>
              <input
                id="ob-slug"
                type="text"
                :value="state.slug"
                placeholder="lanchao-express"
                @input="onSlugInput($event.target.value)"
                @blur="touched2.slug = true"
              />
              <span class="ob-slug-status">
                <span v-if="slugStatus === 'checking'" class="ob-spin"></span>
                <svg v-else-if="slugStatus === 'ok' && !slugErr2" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 12 10 18 20 6" /></svg>
              </span>
            </div>
            <div v-if="slugErr2" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              Esse link já está em uso. Tenta
              <button type="button" class="ob-err-link" @click="suggestSlug">{{ state.slug }}-{{ new Date().getFullYear() }}</button>?
            </div>
            <div v-else-if="slugStatus === 'ok'" class="ob-ok">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 12 10 18 20 6" /></svg>
              Link disponível
            </div>
            <div v-else-if="!slugStatus" class="ob-hint">A gente gera a partir do nome. Você pode editar.</div>
          </div>

          <div class="ob-field">
            <label class="ob-label">Categoria</label>
            <div class="ob-chips">
              <button
                v-for="opt in CATEGORIES"
                :key="opt.value"
                type="button"
                :class="['ob-chip', { active: state.category === opt.value }]"
                @click="state.category = opt.value; touched2.category = true"
              >
                <span class="ob-chip-icon">{{ opt.icon }}</span>
                {{ opt.label }}
              </button>
            </div>
            <div v-if="catErr2" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              {{ catErr2 }}
            </div>
          </div>
        </div>
      </section>

      <!-- ─── Screen 3: Endereço ──────────────────────────────────── -->
      <section v-else-if="stepKey === 'address'" class="ob-narrow ob-slide-up">
        <h1 class="ob-title">Onde fica sua loja?</h1>
        <p class="ob-subtitle">Só pra mostrar no cardápio público. Entrega e raio de cobertura você configura depois.</p>

        <div class="ob-form">
          <div class="ob-field">
            <label class="ob-label" for="ob-cep">CEP</label>
            <div class="ob-input-wrap">
              <input
                id="ob-cep"
                type="text"
                inputmode="numeric"
                maxlength="9"
                :value="state.cep"
                placeholder="00000-000"
                :data-state="cepErr3 ? 'error' : cepFound ? 'success' : ''"
                @input="onCepInput"
                @blur="touched3.cep = true"
              />
              <span v-if="cepLookup === 'loading'" class="ob-input-icon"><span class="ob-spin"></span></span>
              <span v-else-if="cepLookup === 'found'" class="ob-input-icon ob-input-ok">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 12 10 18 20 6" /></svg>
              </span>
            </div>
            <div v-if="cepErr3" class="ob-err">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              Não achei esse CEP. <button type="button" class="ob-err-link" @click="fillManually">Preencher manualmente</button>
            </div>
          </div>

          <div v-if="cepFound" class="ob-fade-in" style="display: flex; flex-direction: column; gap: 14px">
            <div class="ob-cep-summary">
              <span class="ob-cep-summary-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
              </span>
              <div>
                <div class="ob-cep-summary-line">{{ state.street }}, {{ state.district }}</div>
                <div class="ob-cep-summary-sub">{{ state.city }} — {{ state.stateUF }} · GMT-3 (Brasília)</div>
              </div>
            </div>
            <div class="ob-address-grid">
              <div class="ob-field">
                <label class="ob-label" for="ob-num">Número</label>
                <input
                  id="ob-num"
                  type="text"
                  inputmode="numeric"
                  :value="state.number"
                  placeholder="123"
                  :data-state="numErr3 ? 'error' : ''"
                  @input="state.number = $event.target.value"
                  @blur="touched3.number = true"
                />
                <div v-if="numErr3" class="ob-err">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  {{ numErr3 }}
                </div>
              </div>
              <div class="ob-field">
                <label class="ob-label" for="ob-comp">Complemento <span class="ob-optional">opcional</span></label>
                <input
                  id="ob-comp"
                  type="text"
                  :value="state.complement"
                  placeholder="loja 2, fundos"
                  @input="state.complement = $event.target.value"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ─── Screen 4: Criar cardápio ────────────────────────────── -->
      <section v-else-if="stepKey === 'menu'" class="ob-wide ob-slide-up">
        <!-- Hidden file input — triggered by the "Da foto" path or retry button. -->
        <input
          ref="photoInputRef"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="onPhotoFilesChange"
        />
        <h1 class="ob-title">Como você quer montar seu cardápio?</h1>
        <p class="ob-subtitle">Pode mudar depois. Tudo é editável.</p>

        <!-- AI processing -->
        <div v-if="processing" class="ob-processing ob-fade-in">
          <div class="ob-processing-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" /></svg>
          </div>
          <div>
            <div class="ob-processing-title">Lendo seu cardápio com IA…</div>
            <div class="ob-processing-sub">Isso costuma levar de 10 a 30 segundos.</div>
          </div>
          <div class="ob-progress">
            <div class="ob-progress-bar" :style="{ width: progress + '%' }"></div>
          </div>
          <div class="ob-progress-pct">{{ progress }}%</div>
        </div>

        <!-- AI failure -->
        <div v-else-if="aiFailed" class="ob-ai-failed ob-fade-in">
          <span class="ob-ai-failed-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2L12 3z" /><line x1="12" y1="10" x2="12" y2="14" /><circle cx="12" cy="17.5" r=".6" fill="currentColor" stroke="none" /></svg>
          </span>
          <div class="ob-ai-failed-body">
            <div class="ob-ai-failed-title">A IA não conseguiu ler sua foto.</div>
            <p class="ob-ai-failed-text">{{ aiError || 'Costuma acontecer quando a imagem está desfocada ou cortada. Você pode tentar outra foto ou ir com o modelo pronto da sua categoria — sem retrabalho.' }}</p>
            <div class="ob-ai-failed-actions">
              <button type="button" class="ob-btn ob-btn-dark ob-btn-sm" @click="retryPhoto">Tentar outra foto</button>
              <button type="button" class="ob-btn ob-btn-secondary ob-btn-sm" @click="useFallbackTemplate">Usar modelo pronto</button>
            </div>
          </div>
        </div>

        <!-- Paths (default) -->
        <div v-else class="ob-paths">
          <button
            v-for="p in PATHS"
            :key="p.key"
            type="button"
            :class="['ob-path', `tone-${p.tone}`, { recommended: p.recommended }]"
            @click="pickPath(p.key)"
          >
            <span v-if="p.recommended" class="ob-path-badge">⭐ RECOMENDADO</span>
            <div class="ob-path-emoji">{{ p.icon }}</div>
            <h3 class="ob-path-title">{{ p.title }}</h3>
            <p class="ob-path-desc">{{ p.key === 'template' ? templateDesc : p.desc }}</p>
            <div class="ob-path-foot">
              <span class="ob-path-time">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></svg>
                {{ p.time }}
              </span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
            </div>
          </button>
        </div>
      </section>

      <!-- ─── Screen 5: Revisar cardápio ──────────────────────────── -->
      <section v-else-if="stepKey === 'review'" class="ob-medium ob-slide-up">
        <h1 class="ob-title">Revise e publique.</h1>
        <p class="ob-subtitle">Clica em qualquer campo pra editar. Salva automático ao sair do campo.</p>

        <div v-if="state.menuPath === 'photo'" class="ob-photo-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" /></svg>
          <span><strong>{{ state.products.length }} produtos extraídos pela IA.</strong> Confira nomes e preços.</span>
        </div>

        <div class="ob-review-list">
          <section
            v-for="(items, cat) in groupedProducts"
            :key="cat"
            class="ob-cat-section"
          >
            <div class="ob-cat-head">
              <input
                :value="cat"
                class="ob-cat-input"
                @input="renameCategory(cat, $event.target.value)"
              />
              <span class="ob-cat-count">{{ items.length }} {{ items.length === 1 ? 'item' : 'itens' }}</span>
            </div>
            <div class="ob-products">
              <div
                v-for="p in items"
                :key="p.id"
                :class="['ob-product', { 'ob-product-error': productErrors[p.id] }]"
              >
                <div class="ob-product-photo">
                  <svg preserveAspectRatio="none" class="ob-product-photo-x">
                    <line x1="0" y1="0" x2="100%" y2="100%" stroke="currentColor" stroke-width="1" />
                    <line x1="100%" y1="0" x2="0" y2="100%" stroke="currentColor" stroke-width="1" />
                  </svg>
                  <span class="ob-product-photo-label">FOTO</span>
                </div>
                <div class="ob-product-body">
                  <input
                    :value="p.name"
                    class="ob-product-name"
                    placeholder="Nome do prato"
                    :data-state="productErrors[p.id]?.name ? 'error' : ''"
                    @input="updateProduct(p.id, { name: $event.target.value })"
                  />
                  <input
                    :value="p.desc"
                    class="ob-product-desc"
                    placeholder="Descrição curta — ingredientes, peso…"
                    @input="updateProduct(p.id, { desc: $event.target.value })"
                  />
                  <div class="ob-product-price-mobile">
                    <span>R$</span>
                    <input
                      :value="p.price"
                      placeholder="0,00"
                      :data-state="productErrors[p.id]?.price ? 'error' : ''"
                      @input="updateProduct(p.id, { price: $event.target.value })"
                    />
                  </div>
                  <div v-if="productErrors[p.id]" class="ob-product-err">
                    {{ productErrors[p.id].name || productErrors[p.id].price }}
                  </div>
                </div>
                <div class="ob-product-price-desktop">
                  <span>R$</span>
                  <input
                    :value="p.price"
                    placeholder="0,00"
                    :data-state="productErrors[p.id]?.price ? 'error' : ''"
                    @input="updateProduct(p.id, { price: $event.target.value })"
                  />
                </div>
                <button type="button" class="ob-product-remove" :aria-label="'Remover'" @click="removeProduct(p.id)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>
                </button>
              </div>
            </div>
          </section>
        </div>

        <button type="button" class="ob-add-product" @click="addProduct">
          <span class="ob-add-plus">+</span> Adicionar produto
        </button>

        <div v-if="Object.keys(productErrors).length > 0" class="ob-review-err ob-fade-in">
          Corrige os produtos marcados antes de publicar.
        </div>
      </section>

      <!-- ─── Screen 6: Cardápio no ar ────────────────────────────── -->
      <section v-else-if="stepKey === 'live'" class="ob-live">
        <div class="ob-live-grid">
          <div>
            <div class="ob-live-eyebrow">⭐ pronto, {{ firstName }}!</div>
            <h1 class="ob-live-title">
              Seu cardápio do<br />
              <span class="ob-live-store">{{ state.storeName || 'seu restaurante' }}</span> está no ar.
            </h1>
            <p class="ob-live-sub">Compartilha o link com seus clientes — eles abrem no celular, escolhem e finalizam pedido pelo WhatsApp.</p>

            <div class="ob-live-url">
              <div class="ob-live-url-label">Link público</div>
              <div class="ob-live-url-row">
                <span class="ob-live-url-mono">{{ publicUrl }}</span>
                <button type="button" class="ob-live-copy" @click="copyLink">
                  {{ copied ? '✓ copiado' : '📋 copiar' }}
                </button>
              </div>
            </div>

            <div class="ob-live-actions">
              <button type="button" class="ob-btn ob-btn-primary ob-btn-lg" @click="shareWhatsApp">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.07L2 22l5.07-1.33A10 10 0 1 0 12 2zm5.43 14.13c-.23.65-1.36 1.24-1.86 1.3-.5.06-1.1.09-1.78-.11-.4-.13-.93-.31-1.6-.6-2.8-1.21-4.62-4.03-4.76-4.22-.14-.18-1.13-1.5-1.13-2.86 0-1.37.72-2.04.97-2.32.26-.28.56-.35.74-.35.18 0 .37 0 .53.01.17.01.4-.07.62.47.23.55.78 1.91.85 2.05.07.14.12.31.02.5-.1.18-.14.3-.28.46-.14.16-.3.36-.43.49-.14.14-.29.29-.13.57.16.28.7 1.15 1.5 1.86 1.04.93 1.92 1.21 2.2 1.36.27.14.43.12.59-.07.16-.2.68-.79.86-1.06.18-.27.36-.23.6-.14.25.09 1.57.74 1.83.88.27.13.45.2.51.31.07.12.07.66-.16 1.31z" /></svg>
                Compartilhar no WhatsApp
              </button>
              <button type="button" class="ob-btn ob-btn-secondary ob-btn-lg" @click="goToDashboard">
                Ir para o painel
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
              </button>
            </div>
          </div>

          <div class="ob-live-qr-wrap">
            <div class="ob-live-qr">
              <svg :width="QR_SIZE_DESKTOP" :height="QR_SIZE_DESKTOP" :viewBox="`0 0 ${QR_SIZE_DESKTOP} ${QR_SIZE_DESKTOP}`" class="ob-qr-svg">
                <rect :width="QR_SIZE_DESKTOP" :height="QR_SIZE_DESKTOP" fill="#fff" rx="10" />
                <template v-for="(row, r) in qrMatrix" :key="r">
                  <rect
                    v-for="(v, c) in row"
                    v-show="v"
                    :key="`${r}-${c}`"
                    :x="QR_PADDING + c * qrCell(QR_SIZE_DESKTOP)"
                    :y="QR_PADDING + r * qrCell(QR_SIZE_DESKTOP)"
                    :width="qrCell(QR_SIZE_DESKTOP) + 0.5"
                    :height="qrCell(QR_SIZE_DESKTOP) + 0.5"
                    :fill="C.ink"
                  />
                </template>
              </svg>
            </div>
            <div class="ob-live-qr-cap">QR Code · imprime e cola na fachada,<br />no balcão, no cardápio físico</div>
          </div>
        </div>
      </section>
    </main>

    <!-- Footer with primary CTA (hidden on menu-paths screen and live) -->
    <footer
      v-if="stepKey !== 'menu' && stepKey !== 'live'"
      class="ob-footer"
    >
      <div v-if="stepKey === 'identify'" class="ob-footer-stack">
        <button
          type="button"
          class="ob-btn ob-btn-primary ob-btn-lg ob-btn-full"
          :disabled="!step1Valid"
          @click="onPrimaryClick"
        >
          Começar grátis
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
        </button>
        <div class="ob-footer-aux">
          Já tem conta? <router-link to="/login">Entrar</router-link>
        </div>
      </div>

      <button
        v-else-if="stepKey === 'store'"
        type="button"
        class="ob-btn ob-btn-primary ob-btn-lg ob-btn-full"
        :disabled="!step2Valid"
        @click="onPrimaryClick"
      >
        Continuar
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
      </button>

      <button
        v-else-if="stepKey === 'address'"
        type="button"
        class="ob-btn ob-btn-primary ob-btn-lg ob-btn-full"
        :disabled="!step3Valid"
        @click="onPrimaryClick"
      >
        Continuar
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
      </button>

      <div v-else-if="stepKey === 'review'" class="ob-footer-review">
        <div class="ob-footer-count">
          {{ state.products.length }} {{ state.products.length === 1 ? 'produto' : 'produtos' }}
          <span v-if="state.menuPath === 'photo'" class="ob-footer-count-ai"> · extraídos da sua foto</span>
        </div>
        <button
          type="button"
          class="ob-btn ob-btn-primary ob-btn-lg"
          :disabled="state.products.length === 0 || publishing"
          @click="onPrimaryClick"
        >
          <span v-if="publishing" class="ob-spin"></span>
          {{ publishing ? 'Publicando…' : 'Publicar cardápio' }}
          <svg v-if="!publishing" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></svg>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ─── Base ─────────────────────────────────────────────────── */
.ob,
.ob * { box-sizing: border-box; }
.ob {
  font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif;
  color: #1F1F1F;
  background: #fff;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  -webkit-font-smoothing: antialiased;
}
.ob :focus-visible {
  outline: 2px solid #89D136;
  outline-offset: 2px;
  border-radius: 4px;
}
.ob a {
  color: #1F1F1F;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* Inputs */
.ob input[type="text"],
.ob input[type="email"],
.ob input[type="password"],
.ob input[type="tel"],
.ob input[type="number"] {
  width: 100%;
  padding: 14px 16px;
  font-size: 16px;
  line-height: 1.3;
  background: #fff;
  border: 1.5px solid #E7E6E2;
  border-radius: 12px;
  color: #1F1F1F;
  font-family: inherit;
  transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
}
.ob input::placeholder { color: #8A8A8A; }
.ob input:hover { border-color: #BFBDB6; }
.ob input:focus {
  outline: none;
  border-color: #89D136;
  box-shadow: 0 0 0 4px rgba(137, 209, 54, 0.18);
}
.ob input[data-state="error"] {
  border-color: #D9483E;
  box-shadow: 0 0 0 4px rgba(217, 72, 62, 0.12);
}
.ob input[data-state="success"] { border-color: #89D136; }
.ob input[disabled] {
  background: #F4F2EC;
  color: #8A8A8A;
  cursor: not-allowed;
}

/* Animations */
.ob-fade-in { animation: ob-fade-in 0.35s ease-out both; }
.ob-slide-up { animation: ob-slide-up 0.4s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
@keyframes ob-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ob-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
}
@keyframes ob-spin { to { transform: rotate(360deg); } }
@keyframes ob-shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-3px); }
  40%, 60% { transform: translateX(3px); }
}
.ob-spin {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(31, 31, 31, 0.18);
  border-top-color: #1F1F1F;
  animation: ob-spin 0.8s linear infinite;
  flex-shrink: 0;
}

/* ─── Header / Stepper ─────────────────────────────────────── */
.ob-header {
  padding: 20px 40px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}
.ob-back {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: #F4F2EC;
  border: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #1F1F1F;
  flex-shrink: 0;
  transition: opacity 0.2s, background 0.15s;
}
.ob-back:hover { background: #E7E6E2; }
.ob-back-hidden {
  opacity: 0;
  cursor: default;
  pointer-events: none;
}
.ob-stepper-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ob-stepper {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.ob-step-bar {
  flex: 1;
  height: 4px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: #E7E5DF;
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.ob-step-bar.done { background: #89D136; }
.ob-step-bar.active { background: #89D136; }
.ob-step-bar:disabled { cursor: default; }
.ob-step-label {
  font-size: 12px;
  color: #8A8A8A;
  font-weight: 500;
}
.ob-step-label strong {
  color: #1F1F1F;
  font-weight: 600;
}

/* Live screen header */
.ob-live-header {
  padding: 20px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.ob-logo { display: block; }
.ob-live-badge {
  font-size: 11px;
  font-weight: 700;
  color: #89D136;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ob-live-dot {
  width: 6px;
  height: 6px;
  background: #89D136;
  border-radius: 50%;
}

/* ─── Main ─────────────────────────────────────────────────── */
.ob-main {
  flex: 1;
  padding: 24px 40px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.ob-main-live {
  padding: 20px 40px 40px;
}
.ob-narrow {
  max-width: 560px;
  margin: 0 auto;
  width: 100%;
}
.ob-medium {
  max-width: 760px;
  margin: 0 auto;
  width: 100%;
}
.ob-wide {
  max-width: 920px;
  margin: 0 auto;
  width: 100%;
}
.ob-title {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.1;
  margin: 0;
}
.ob-subtitle {
  font-size: 15px;
  color: #5B5B5B;
  margin: 12px 0 0;
  line-height: 1.55;
}
.ob-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 28px;
}
.ob-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ob-label {
  font-size: 14px;
  font-weight: 600;
  color: #1F1F1F;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.ob-optional {
  font-size: 12px;
  color: #8A8A8A;
  font-weight: 500;
}
.ob-hint {
  font-size: 13px;
  color: #8A8A8A;
}
.ob-err {
  font-size: 13px;
  color: #D9483E;
  display: flex;
  align-items: center;
  gap: 6px;
  animation: ob-fade-in 0.2s ease-out;
}
.ob-err a,
.ob-err-link {
  color: #3D6313;
  font-weight: 700;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
  font-size: inherit;
  text-decoration: underline;
}
.ob-ok {
  font-size: 13px;
  color: #3D6313;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ob-terms {
  font-size: 12px;
  color: #8A8A8A;
  margin-top: 20px;
  line-height: 1.5;
}
.ob-terms a {
  color: #1F1F1F;
  text-decoration: underline;
}

/* Input with icon */
.ob-input-wrap {
  position: relative;
}
.ob-input-icon {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: #8A8A8A;
  display: inline-flex;
}
.ob-input-ok { color: #89D136; }

/* ─── Step 2: Slug ─────────────────────────────────────────── */
.ob-slug {
  display: flex;
  align-items: stretch;
  border-radius: 12px;
  border: 1.5px solid #E7E6E2;
  overflow: hidden;
  background: #fff;
  transition: border-color 0.15s;
}
.ob-slug-error { border-color: #D9483E; }
.ob-slug-ok { border-color: #89D136; }
.ob-slug-prefix {
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  font-size: 14px;
  color: #8A8A8A;
  background: #F4F2EC;
  border-right: 1px solid #E7E6E2;
  font-family: ui-monospace, monospace;
  flex-shrink: 0;
}
.ob-slug input {
  border: none;
  border-radius: 0;
  font-family: ui-monospace, monospace;
  font-size: 14px;
  padding: 14px 16px;
  flex: 1;
  min-width: 0;
  box-shadow: none;
}
.ob-slug input:focus { box-shadow: none; }
.ob-slug-status {
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  color: #8A8A8A;
}
.ob-slug-status svg { color: #89D136; }

/* Category chips */
.ob-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.ob-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  color: #1F1F1F;
  border: 1.5px solid #E7E6E2;
  border-radius: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.ob-chip:hover {
  border-color: #BFBDB6;
}
.ob-chip.active {
  background: #1F1F1F;
  color: #fff;
  border-color: #1F1F1F;
}
.ob-chip-icon {
  display: inline-flex;
  font-size: 16px;
}

/* ─── Step 3: Address ──────────────────────────────────────── */
.ob-cep-summary {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  background: #EAF7D6;
  border-radius: 12px;
  border: 1px solid rgba(137, 209, 54, 0.3);
}
.ob-cep-summary-icon {
  color: #3D6313;
  margin-top: 2px;
}
.ob-cep-summary-line {
  font-weight: 700;
  color: #1F1F1F;
  font-size: 14px;
}
.ob-cep-summary-sub {
  color: #5B5B5B;
  font-size: 14px;
}
.ob-address-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
}

/* ─── Step 4: Menu paths ───────────────────────────────────── */
.ob-paths {
  margin-top: 32px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.ob-path {
  position: relative;
  text-align: left;
  cursor: pointer;
  padding: 24px;
  border-radius: 20px;
  border: 1.5px solid #E7E6E2;
  background: #fff;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: all 0.15s;
  font-family: inherit;
}
.ob-path:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 30px -10px rgba(0, 0, 0, 0.12);
}
.ob-path.tone-green {
  background: #EAF7D6;
  border-color: #89D136;
}
.ob-path-badge {
  position: absolute;
  top: -10px;
  left: 18px;
  background: #1F1F1F;
  color: #fff;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.ob-path-emoji {
  font-size: 32px;
  line-height: 1;
}
.ob-path-title {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}
.ob-path-desc {
  font-size: 14px;
  color: #5B5B5B;
  margin: 0;
  flex: 1;
}
.ob-path-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.ob-path-time {
  font-size: 12px;
  color: #8A8A8A;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* AI Processing */
.ob-processing {
  margin-top: 32px;
  padding: 32px;
  background: #1F1F1F;
  color: #fff;
  border-radius: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  text-align: center;
}
.ob-processing-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(137, 209, 54, 0.18);
  color: #89D136;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ob-processing-title {
  font-size: 18px;
  font-weight: 700;
}
.ob-processing-sub {
  font-size: 13px;
  color: #aaa;
  margin-top: 4px;
}
.ob-progress {
  width: 100%;
  max-width: 360px;
  height: 8px;
  background: #2a2a2a;
  border-radius: 999px;
  overflow: hidden;
}
.ob-progress-bar {
  height: 100%;
  background: #89D136;
  transition: width 0.2s;
}
.ob-progress-pct {
  font-size: 12px;
  color: #888;
}

/* AI Failed */
.ob-ai-failed {
  margin-top: 24px;
  padding: 20px 22px;
  background: #FEF2F0;
  border: 1px solid #F0CDC9;
  border-radius: 16px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
}
.ob-ai-failed-icon {
  color: #D9483E;
  margin-top: 2px;
}
.ob-ai-failed-body { flex: 1; }
.ob-ai-failed-title {
  font-weight: 700;
  color: #7A2A22;
}
.ob-ai-failed-text {
  font-size: 13px;
  color: #7A2A22;
  margin-top: 4px;
}
.ob-ai-failed-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

/* ─── Step 5: Review ───────────────────────────────────────── */
.ob-photo-banner {
  margin-top: 18px;
  padding: 12px 14px;
  background: #EAF7D6;
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #3D6313;
}
.ob-photo-banner svg { color: #3D6313; }
.ob-review-list {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.ob-cat-section { display: flex; flex-direction: column; }
.ob-cat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.ob-cat-input {
  font-size: 18px;
  font-weight: 700;
  padding: 4px 8px;
  border: none;
  background: transparent;
  border-radius: 6px;
  width: auto;
  min-width: 0;
  box-shadow: none;
}
.ob-cat-input:focus { box-shadow: 0 0 0 2px rgba(137, 209, 54, 0.3); }
.ob-cat-count {
  font-size: 12px;
  color: #8A8A8A;
}
.ob-products {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ob-product {
  display: grid;
  grid-template-columns: 88px 1fr 110px 36px;
  gap: 12px;
  align-items: center;
  padding: 14px;
  background: #fff;
  border: 1px solid #E7E6E2;
  border-radius: 14px;
}
.ob-product-error {
  border-color: #F0CDC9;
  animation: ob-shake 0.4s;
}
.ob-product-photo {
  width: 88px;
  height: 88px;
  border-radius: 10px;
  background: #F4F2EC;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8A8A8A;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.ob-product-photo-x {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.3;
}
.ob-product-photo-label {
  position: relative;
}
.ob-product-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ob-product-name,
.ob-product-desc {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 4px 6px;
  width: 100%;
}
.ob-product-name {
  font-size: 15px;
  font-weight: 700;
  color: #1F1F1F;
}
.ob-product-name:focus {
  border-radius: 6px;
  box-shadow: 0 0 0 2px rgba(137, 209, 54, 0.3);
}
.ob-product-desc {
  font-size: 13px;
  color: #5B5B5B;
}
.ob-product-desc:focus {
  border-radius: 6px;
  box-shadow: 0 0 0 2px rgba(137, 209, 54, 0.3);
}
.ob-product-name[data-state="error"] {
  background: rgba(217, 72, 62, 0.06);
  border-radius: 4px;
}
.ob-product-price-mobile { display: none; }
.ob-product-price-desktop {
  display: flex;
  align-items: center;
  gap: 4px;
}
.ob-product-price-desktop span {
  font-size: 14px;
  color: #8A8A8A;
}
.ob-product-price-desktop input {
  font-size: 16px;
  font-weight: 700;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid #E7E6E2;
  background: #fff;
  text-align: right;
  width: 80px;
}
.ob-product-price-desktop input[data-state="error"] {
  border-color: #D9483E;
  border-width: 1.5px;
}
.ob-product-err {
  font-size: 11px;
  color: #D9483E;
  padding-left: 6px;
  margin-top: 2px;
}
.ob-product-remove {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: #8A8A8A;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.ob-product-remove:hover {
  background: #FEF2F0;
  color: #D9483E;
}
.ob-add-product {
  margin-top: 16px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  border: 1.5px dashed #E7E6E2;
  padding: 12px 16px;
  border-radius: 12px;
  color: #5B5B5B;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  width: 100%;
  justify-content: center;
  transition: border-color 0.15s, color 0.15s;
}
.ob-add-product:hover {
  border-color: #8A8A8A;
  color: #1F1F1F;
}
.ob-add-plus {
  font-size: 18px;
  line-height: 1;
}
.ob-review-err {
  margin-top: 14px;
  padding: 12px 14px;
  background: #FEF2F0;
  border: 1px solid #F0CDC9;
  border-radius: 12px;
  font-size: 13px;
  color: #7A2A22;
}

/* ─── Step 6: Live ─────────────────────────────────────────── */
.ob-live {
  flex: 1;
  display: flex;
  align-items: center;
  position: relative;
}
.ob-live-grid {
  max-width: 980px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 32px;
  align-items: center;
  width: 100%;
}
.ob-live-eyebrow {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: #89D136;
  text-transform: uppercase;
}
.ob-live-title {
  font-size: 48px;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin-top: 12px;
}
.ob-live-store { color: #3D6313; }
.ob-live-sub {
  font-size: 15px;
  color: #5B5B5B;
  margin-top: 14px;
  line-height: 1.5;
}
.ob-live-url {
  margin-top: 24px;
  padding: 14px;
  background: #F4F2EC;
  border-radius: 14px;
  border: 1px solid #E7E6E2;
}
.ob-live-url-label {
  font-size: 11px;
  color: #8A8A8A;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.ob-live-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ob-live-url-mono {
  font-family: ui-monospace, monospace;
  font-size: 15px;
  font-weight: 600;
  color: #1F1F1F;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ob-live-copy {
  background: #1F1F1F;
  color: #fff;
  border: none;
  padding: 8px 12px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  transition: background 0.15s;
}
.ob-live-copy:hover { background: #3a3a3a; }
.ob-live-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
.ob-live-qr-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.ob-live-qr {
  padding: 18px;
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 24px 60px -20px rgba(0, 0, 0, 0.15);
  border: 1px solid #E7E6E2;
}
.ob-qr-svg { display: block; }
.ob-live-qr-cap {
  font-size: 12px;
  color: #8A8A8A;
  text-align: center;
}

/* ─── Buttons ──────────────────────────────────────────────── */
.ob-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 999px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, transform 0.05s, opacity 0.15s;
  border: none;
}
.ob-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.ob-btn-primary {
  background: #89D136;
  color: #1F1F1F;
}
.ob-btn-primary:hover:not(:disabled) {
  background: #7AC624;
}
.ob-btn-dark {
  background: #1F1F1F;
  color: #fff;
}
.ob-btn-dark:hover:not(:disabled) {
  background: #3a3a3a;
}
.ob-btn-secondary {
  background: #fff;
  color: #1F1F1F;
  border: 1.5px solid #E7E6E2;
}
.ob-btn-secondary:hover:not(:disabled) {
  background: #F4F2EC;
}
.ob-btn-sm {
  padding: 8px 14px;
  font-size: 13px;
  min-height: 36px;
}
.ob-btn-lg {
  padding: 18px 28px;
  font-size: 17px;
  min-height: 56px;
}
.ob-btn-full {
  width: 100%;
}

/* ─── Footer ───────────────────────────────────────────────── */
.ob-footer {
  padding: 24px 40px;
  flex-shrink: 0;
  border-top: 1px solid #E7E6E2;
  background: #fff;
}
.ob-footer-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ob-footer-aux {
  text-align: center;
  font-size: 13px;
  color: #5B5B5B;
}
.ob-footer-review {
  display: flex;
  gap: 10px;
  align-items: center;
}
.ob-footer-count {
  font-size: 13px;
  color: #5B5B5B;
  flex: 1;
}
.ob-footer-count-ai {
  color: #3D6313;
}

/* ─── Confetti ─────────────────────────────────────────────── */
.ob-confetti {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 50;
}
.ob-confetti span {
  position: absolute;
  top: -20px;
  border-radius: 2px;
  animation-name: ob-confetti-fall;
  animation-timing-function: cubic-bezier(0.2, 0.7, 0.4, 1);
  animation-fill-mode: forwards;
}
@keyframes ob-confetti-fall {
  0% {
    transform: translate3d(0, 0, 0) rotate(0deg);
    opacity: 1;
  }
  100% {
    transform: translate3d(var(--dx, 0px), var(--dy, 500px), 0) rotate(var(--r, 720deg));
    opacity: 0;
  }
}

/* ─── Responsive ───────────────────────────────────────────── */
@media (max-width: 768px) {
  .ob-header { padding: 12px 20px 16px; }
  .ob-live-header { padding: 12px 20px; }
  .ob-main { padding: 8px 20px 24px; }
  .ob-main-live { padding: 8px 20px 24px; }
  .ob-title { font-size: 26px; }
  .ob-form { gap: 16px; }
  .ob-chips { grid-template-columns: repeat(2, 1fr); }
  .ob-paths { grid-template-columns: 1fr; }
  .ob-path { min-height: auto; }
  .ob-address-grid { grid-template-columns: 1fr 2fr; }
  .ob-product { grid-template-columns: 64px 1fr 36px; }
  .ob-product-photo { width: 64px; height: 64px; }
  .ob-product-price-mobile {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 6px;
    margin-top: 2px;
  }
  .ob-product-price-mobile span {
    font-size: 12px;
    color: #8A8A8A;
  }
  .ob-product-price-mobile input {
    font-size: 14px;
    font-weight: 700;
    padding: 2px 6px;
    border: none;
    background: transparent;
    box-shadow: none;
    width: 70px;
    color: #1F1F1F;
  }
  .ob-product-price-mobile input[data-state="error"] {
    color: #D9483E;
  }
  .ob-product-price-desktop { display: none; }
  .ob-live-grid { grid-template-columns: 1fr; gap: 24px; }
  .ob-live-title { font-size: 32px; }
  .ob-live-actions { flex-direction: column; }
  .ob-live-actions .ob-btn { width: 100%; }
  .ob-footer { padding: 16px 20px max(20px, env(safe-area-inset-bottom)); }
}
</style>
