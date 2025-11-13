import express from 'express'
import { prisma } from '../prisma.js'
import { findOrCreateCustomer } from '../services/customers.js'
import { emitirNovoPedido } from '../index.js'

export const publicMenuRouter = express.Router()

// GET /public/:companyId/menu
publicMenuRouter.get('/:companyId/menu', async (req, res) => {
  const { companyId } = req.params
  try {
    const categories = await prisma.menuCategory.findMany({
      // only expose active categories on the public menu
      where: { companyId, isActive: true },
      orderBy: { position: 'asc' },
      include: { products: { where: { isActive: true }, orderBy: { position: 'asc' }, include: { productOptionGroups: { include: { group: { include: { options: { include: { linkedProduct: { select: { id: true, isActive: true } } } } } } } } } } }
    })
    // uncategorized products will not be exposed via the public menu for privacy/consistency

    // include company basic info (hours)
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, alwaysOpen: true, timezone: true, weeklySchedule: true } })
    // include publicly-visible payment methods (active) and pickup info (from printer settings as a lightweight store address)
  const paymentMethods = await prisma.paymentMethod.findMany({ where: { companyId, isActive: true }, orderBy: { createdAt: 'asc' } })
  const printer = await prisma.printerSetting.findFirst({ where: { companyId } })
  if (company) company.paymentMethods = paymentMethods || []
  if (company) company.pickupInfo = printer ? `${printer.headerName || ''}${printer.headerCity ? ' - ' + printer.headerCity : ''}`.trim() : null

    // normalize products to expose optionGroups directly
    for(const cat of categories){
      cat.products = (cat.products || []).map(p => ({
        ...p,
        optionGroups: (p.productOptionGroups || []).map(pg => {
          const group = { ...pg.group }
          // if options link to products, reflect linked availability
          if (group.options && Array.isArray(group.options)) {
            // remove options that link to inactive products entirely (don't expose inactive items)
            group.options = group.options
              .filter(o => !(o.linkedProduct && o.linkedProduct.isActive === false))
              .map(o => {
                const opt = { ...o }
                if (opt.linkedProduct) {
                  // availability follows linked product (should be true here)
                  opt.isAvailable = Boolean(opt.linkedProduct.isActive)
                  // remove availability-specific scheduling from the public payload
                  delete opt.availableDays
                  delete opt.availableFrom
                  delete opt.availableTo
                }
                if (opt.linkedProduct) delete opt.linkedProduct
                return opt
              })
          }
          return group
        })
      }))
    }
    // remove categories that became empty after filtering out inactive products/options
    const filteredCategories = categories.filter(c => Array.isArray(c.products) && c.products.length > 0)
    // replace categories variable with filtered list to return
    const categoriesToReturn = filteredCategories
    res.json({ categories: categoriesToReturn, company: company || null })
  } catch (e) {
    console.error('Error loading public menu', e)
    res.status(500).json({ message: 'Erro ao carregar cardápio' })
  }
})

// GET /public/:companyId/neighborhoods
// Public endpoint to list neighborhoods and delivery fees for a company (used by the public checkout)
publicMenuRouter.get('/:companyId/neighborhoods', async (req, res) => {
  const { companyId } = req.params
  try {
    const rows = await prisma.neighborhood.findMany({ where: { companyId }, orderBy: { name: 'asc' } })
    // return minimal payload to avoid leaking admin fields
    const out = (rows || []).map(r => ({ id: r.id, name: r.name, deliveryFee: Number(r.deliveryFee || 0), aliases: Array.isArray(r.aliases) ? r.aliases : [] }))
    return res.json(out)
  } catch (e) {
    console.error('Error loading public neighborhoods', e)
    return res.status(500).json({ message: 'Erro ao carregar bairros' })
  }
})

// POST /public/:companyId/neighborhoods/match
// Accepts { text } and returns { match: neighborhoodName|null, deliveryFee?: number }
publicMenuRouter.post('/:companyId/neighborhoods/match', async (req, res) => {
  const { companyId } = req.params
  const { text } = req.body || {}
  if (!text) return res.status(400).json({ message: 'text é obrigatório' })
  try {
    const txt = String(text).toLowerCase()
    const neighborhoods = await prisma.neighborhood.findMany({ where: { companyId } })
    const matched = neighborhoods.find(n => {
      if (!n || !n.name) return false
      const name = String(n.name).toLowerCase()
      if (txt.includes(name)) return true
      if (n.aliases) {
        try{
          const arr = Array.isArray(n.aliases) ? n.aliases : JSON.parse(n.aliases)
          if (arr.some(a => txt.includes(String(a || '').toLowerCase()))) return true
        }catch(e){}
      }
      return false
    })
    if (matched) return res.json({ match: matched.name, deliveryFee: Number(matched.deliveryFee || 0) })
    return res.json({ match: null })
  } catch (e) {
    console.error('POST /public/:companyId/neighborhoods/match', e)
    return res.status(500).json({ message: 'Erro ao procurar bairro' })
  }
})

// POST /public/:companyId/orders
// body: { customerName, customerPhone, address: { street, number, neighborhood, city, formatted }, items: [{ productId?, name, quantity, price, notes }], payment: { methodCode, raw } }
publicMenuRouter.post('/:companyId/orders', async (req, res) => {
  const { companyId } = req.params
  const payload = req.body || {}
  try {
    // load company to check operating hours
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, alwaysOpen: true, timezone: true, weeklySchedule: true } })
    if (!company) return res.status(404).json({ message: 'Empresa não encontrada' })

    // if the store is not always open, validate current time against openFrom/openTo using the store timezone if provided
    if (!company.alwaysOpen) {
      const parseHM = (s) => {
        if (!s) return null
        const [hh, mm] = String(s).split(':').map(x=>Number(x))
        if (Number.isNaN(hh) || Number.isNaN(mm)) return null
        return { hh, mm }
      }
      // Prefer weeklySchedule if present
      const cmpMins = (hh, mm) => (hh * 60) + mm

      const checkInterval = (nowParts, from, to) => {
        const nowMinutes = cmpMins(nowParts.hh, nowParts.mm)
        const fromMinutes = cmpMins(from.hh, from.mm)
        const toMinutes = cmpMins(to.hh, to.mm)
        if (fromMinutes <= toMinutes) {
          return nowMinutes >= fromMinutes && nowMinutes <= toMinutes
        } else {
          // crosses midnight
          return (nowMinutes >= fromMinutes) || (nowMinutes <= toMinutes)
        }
      }

      // get current time in store timezone (or server timezone if not provided)
      let nowParts
      try {
        const tz = company.timezone || 'America/Sao_Paulo'
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
        nowParts = { hh: Number(parts.find(p => p.type === 'hour')?.value), mm: Number(parts.find(p => p.type === 'minute')?.value) }
      } catch (tzErr) {
        console.warn('Timezone parse failed, falling back to server time:', tzErr?.message || tzErr)
        const d = new Date()
        nowParts = { hh: d.getHours(), mm: d.getMinutes() }
      }

      if (company.weeklySchedule && Array.isArray(company.weeklySchedule)) {
        try {
          const schedule = company.weeklySchedule
          // determine weekday in store timezone
          const tz = company.timezone || 'America/Sao_Paulo'
          const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).formatToParts(new Date())
          // get weekday index 0=Sun..6=Sat by creating a Date in tz and using .getUTCDay fallback
          // simpler: compute day via Date in tz by formatting full date and building Date
          const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
          // fmt is like 'dd/mm/yyyy'
          const [dayStr, monthStr, yearStr] = fmt.split('/')
          // create Date from yyyy-mm-dd in tz by constructing UTC date
          const tzDate = new Date(`${yearStr}-${monthStr}-${dayStr}T00:00:00Z`)
          const weekDay = tzDate.getUTCDay()

          const today = schedule.find(d => Number(d?.day) === Number(weekDay))
          if (!today || !today.enabled) {
            return res.status(400).json({ message: 'Fora do horário de funcionamento; não é possível criar pedidos neste momento' })
          }
          if (!today.from || !today.to) return res.status(400).json({ message: 'Horário de funcionamento da loja inválido' })
          const fromH = Number(String(today.from).split(':')[0])
          const fromM = Number(String(today.from).split(':')[1])
          const toH = Number(String(today.to).split(':')[0])
          const toM = Number(String(today.to).split(':')[1])
          const from = { hh: fromH, mm: fromM }
          const to = { hh: toH, mm: toM }
          const open = checkInterval(nowParts, from, to)
          if (!open) return res.status(400).json({ message: 'Fora do horário de funcionamento; não é possível criar pedidos neste momento' })
        } catch (err) {
          console.warn('Failed to parse weeklySchedule, falling back to single interval:', err?.message || err)
          // fallthrough to single-interval handling below
        }
      }

      // fallback: if weeklySchedule is not present, reject because there is no configured schedule
      return res.status(400).json({ message: 'Horário de funcionamento não configurado; configure o horário semanal ou marque como "Sempre disponível".' })
    }

  // support both old shape (customerName/customerPhone) and new shape (customer: { name, contact, address })
  const raw = payload || {}
  const customer = (raw.customer && { name: String(raw.customer.name || ''), contact: String(raw.customer.contact || '') }) || { name: String(raw.customerName || ''), contact: String(raw.customerPhone || '') }
  const address = (raw.customer && raw.customer.address) || raw.address || {}
  const items = Array.isArray(raw.items) ? raw.items.map(it => ({ productId: it.productId || null, name: String(it.name || it.productName || 'Item'), quantity: Number(it.quantity || 1), price: Number(it.price || 0), notes: it.notes || null, options: Array.isArray(it.options) ? it.options.map(o => ({ id: o.id, name: o.name, price: Number(o.price || 0) })) : null })) : []
  const payment = raw.payment ? { methodCode: String(raw.payment.methodCode || ''), amount: Number(raw.payment.amount || 0), raw: raw.payment.raw || null } : null
  const neighborhoodFromPayload = String(raw.neighborhood || (address && (address.neighborhood || address.neigh)) || '')

  if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ message: 'Itens são obrigatórios' })

    // enforce delivery address when orderType explicitly requests DELIVERY
    const orderType = String((raw.orderType || 'DELIVERY')).toUpperCase()
    if (orderType === 'DELIVERY') {
      const formatted = String((address && (address.formatted || address.formattedAddress)) || '')
      const neigh = String(neighborhoodFromPayload || '')
      if (!formatted || !neigh) return res.status(400).json({ message: 'Endereço completo e bairro são obrigatórios para entrega' })
    }

  // subtotal (use sanitized items)
  const subtotal = items.reduce((s, it) => s + (Number(it.price || 0) * Number(it.quantity || 1)), 0)

    // find neighborhood delivery fee (case-insensitive match against name or aliases)
    const neighborhoods = await prisma.neighborhood.findMany({ where: { companyId } })
    const neighborhoodName = (address.neighborhood || '').trim().toLowerCase()
    let deliveryFee = 0
    if (neighborhoodName) {
      const match = neighborhoods.find(n => {
        if (!n) return false
        if ((n.name || '').toLowerCase() === neighborhoodName) return true
        if (n.aliases && Array.isArray(n.aliases)) {
          return n.aliases.map(a => String(a).toLowerCase()).includes(neighborhoodName)
        }
        return false
      })
      if (match) deliveryFee = Number(match.deliveryFee || 0)
    }

  const total = subtotal + Number(deliveryFee || 0)

    // optional: validate payment method
    if (payment && payment.methodCode) {
      const pm = await prisma.paymentMethod.findFirst({ where: { companyId, code: payment.methodCode, isActive: true } })
      if (!pm) return res.status(400).json({ message: 'Método de pagamento inválido' })
    }

    // Try to create/find a Customer when contact (whatsapp/phone) or name is provided from public menu.
    // This is best-effort: if customer creation fails we still allow the order to be created but log the issue.
    let persistedCustomer = null
    try {
      const maybeContact = String(customer.contact || '').trim()
      const maybeName = String(customer.name || '').trim()
      console.log('Public order customer attempt:', { maybeName, maybeContact })
      if (maybeContact || maybeName) {
        // build a small address payload so the customer service can persist an address if available
        const getFormatted = (a) => {
          if (!a) return null
          if (typeof a === 'string') return a
          if (a.formatted) return a.formatted
          if (a.formattedAddress) return a.formattedAddress
          if (a.street || a.number) return [a.street, a.number].filter(Boolean).join(', ')
          return null
        }
        const addressPayload = {
          delivery: {
            deliveryAddress: {
              formattedAddress: getFormatted(address),
              streetName: address?.street || address?.streetName || null,
              streetNumber: address?.number || address?.streetNumber || null,
              neighborhood: address?.neighborhood || address?.neigh || null,
              postalCode: address?.postalCode || address?.zip || null
            }
          }
        }
        console.log('Public order addressPayload:', addressPayload)
        persistedCustomer = await findOrCreateCustomer({ companyId, fullName: maybeName || null, cpf: null, whatsapp: maybeContact || null, phone: maybeContact || null, addressPayload })
        console.log('findOrCreateCustomer result:', persistedCustomer ? { id: persistedCustomer.id, whatsapp: persistedCustomer.whatsapp, fullName: persistedCustomer.fullName } : null)
      }
    } catch (custErr) {
      console.warn('Failed to persist public customer:', custErr?.message || custErr)
    }

    // create order with nested items
    // build a sanitized payload to store in DB (avoid keeping the entire raw input with unknown fields)
    const safePayload = { customer, payment, orderType, neighborhood: neighborhoodFromPayload, items }

    const created = await prisma.order.create({
      data: {
        companyId,
        customerId: persistedCustomer ? persistedCustomer.id : undefined,
        customerSource: 'PUBLIC',
        customerName: customer.name || null,
        customerPhone: customer.contact || null,
        address: ((address && (address.formatted || address.formattedAddress)) || [address.street, address.number].filter(Boolean).join(', ')) || null,
        total: total,
        orderType: String(orderType || ''),
        deliveryFee: deliveryFee,
        payload: {
          publicOrder: true,
          payment: payment || null,
          orderType: orderType,
          rawPayload: safePayload
        },
        items: {
          // persist provided options (if any) into the OrderItem.options JSON column
          create: items.map(it => ({
            name: it.name || it.productName || 'Item',
            quantity: Number(it.quantity || 1),
            price: Number(it.price || 0),
            notes: it.notes || null,
            options: it.options || null
          }))
        }
      },
      include: { items: true }
    })

    // emit socket to panel if available
    try { emitirNovoPedido(created) } catch (e) { console.warn('Emit novo pedido falhou:', e.message || e) }

    res.status(201).json({ id: created.id, displayId: created.displayId, total: Number(created.total) + Number(created.deliveryFee || 0) })
  } catch (e) {
    console.error('Error creating public order', e)
    res.status(500).json({ message: 'Erro ao criar pedido' })
  }
})

export default publicMenuRouter

// Public: GET single order (by id) with phone verification
publicMenuRouter.get('/:companyId/orders/:orderId', async (req, res) => {
  const { companyId, orderId } = req.params
  const phone = String(req.query.phone || '').trim()
  if (!phone) return res.status(400).json({ message: 'Informe o número de WhatsApp (phone) para acessar o pedido' })
  try {
    const order = await prisma.order.findFirst({ where: { id: orderId, companyId }, include: { items: true, histories: true } })
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado' })
    const orderPhone = String(order.customerPhone || '')
    // also check payload rawPayload customer contact
    let payloadPhone = ''
    try { payloadPhone = String((order.payload && order.payload.rawPayload && order.payload.rawPayload.customer && order.payload.rawPayload.customer.contact) || '') } catch (e) { payloadPhone = '' }
    if (orderPhone && orderPhone.replace(/\D/g,'') === phone.replace(/\D/g,'')) return res.json(order)
    if (payloadPhone && payloadPhone.replace(/\D/g,'') === phone.replace(/\D/g,'')) return res.json(order)
    return res.status(403).json({ message: 'Número não autorizado para visualizar este pedido' })
  } catch (e) {
    console.error('Error fetching public order', e)
    return res.status(500).json({ message: 'Erro ao buscar pedido' })
  }
})

// Public: GET order history for a phone number
publicMenuRouter.get('/:companyId/orders', async (req, res) => {
  const { companyId } = req.params
  const phone = String(req.query.phone || '').trim()
  if (!phone) return res.status(400).json({ message: 'Informe o número de WhatsApp (phone) para consultar histórico' })
  try {
    const orders = await prisma.order.findMany({ where: { companyId, customerPhone: phone }, orderBy: { createdAt: 'desc' }, include: { items: true } })
    // also try matching by payload rawPayload customer contact
    const also = await prisma.order.findMany({ where: { companyId, NOT: { customerPhone: phone } }, orderBy: { createdAt: 'desc' }, include: { items: true } })
    const matched = []
    for (const o of also) {
      try {
        const p = o.payload && o.payload.rawPayload && o.payload.rawPayload.customer && o.payload.rawPayload.customer.contact
        if (p && String(p).replace(/\D/g,'') === phone.replace(/\D/g,'')) matched.push(o)
      } catch (e) { }
    }
    const combined = [...orders, ...matched]
    // dedupe by id
    const map = new Map()
    for (const o of combined) map.set(o.id, o)
    return res.json(Array.from(map.values()))
  } catch (e) {
    console.error('Error fetching public order history', e)
    return res.status(500).json({ message: 'Erro ao buscar histórico' })
  }
})
