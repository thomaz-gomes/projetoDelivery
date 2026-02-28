import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { randomUUID } from 'crypto';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import { requireModuleStrict } from '../modules.js';
import { normalizePhone, findOrCreateCustomer } from '../services/customers.js';

export const customersRouter = express.Router();
customersRouter.use(authMiddleware);
customersRouter.use(requireModuleStrict('CARDAPIO_COMPLETO'));

// Helper: calcula tier de fidelidade baseado nos pedidos concluídos
function computeCustomerTier(orders) {
  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const all = orders || [];
  // If the customer has exactly one order (any status), classify as NOVO
  if (all.length === 1) return { tier: 'novo', stars: 1, label: 'NOVO' };

  const completed = all.filter(o => o.status === 'CONCLUIDO');
  if (!completed.length) return { tier: 'em_risco', stars: 1, label: 'Em Risco' };

  const last = new Date(completed[0].createdAt).getTime(); // orders are desc
  if (last < d30) return { tier: 'em_risco', stars: 1, label: 'Em Risco' };

  const orders30d = completed.filter(o => new Date(o.createdAt).getTime() >= d30).length;
  if (orders30d >= 8) return { tier: 'vip', stars: 4, label: 'VIP' };
  if (orders30d >= 4) return { tier: 'fiel', stars: 3, label: 'Fiel' };
  return { tier: 'regular', stars: 2, label: 'Regular' };
}

// Helper: calcula stats completos do cliente
function computeCustomerStats(orders) {
  const completed = (orders || []).filter(o => o.status === 'CONCLUIDO');
  const totalSpent = completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalOrders = (orders || []).length;
  const lastOrderDate = orders?.length ? orders[0].createdAt : null;

  // Item favorito: agrupa por nome e soma quantidades
  const itemCounts = {};
  for (const o of completed) {
    for (const item of (o.items || [])) {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + item.quantity;
    }
  }
  let favoriteItem = null;
  let maxQty = 0;
  for (const [name, qty] of Object.entries(itemCounts)) {
    if (qty > maxQty) { maxQty = qty; favoriteItem = name; }
  }

  const tierInfo = computeCustomerTier(orders);
  return { totalSpent, totalOrders, lastOrderDate, favoriteItem, ...tierInfo };
}

// Listagem com paginação simples
customersRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const take = Math.min(Number(req.query.take || 50), 200);
  const skip = Math.max(Number(req.query.skip || 0), 0);
  const search = String(req.query.q || '').trim();

  const where = { companyId };
  if (search) {
    // Se a busca parece ser um número (telefone), busca apenas em campos de telefone
    const isPhone = /^\d+$/.test(search);
    if (isPhone) {
      // Busca apenas nos últimos dígitos de whatsapp e phone (ignorando DDI)
      where.OR = [
        { whatsapp: { contains: search } },
        { phone: { contains: search } },
      ];
    } else {
      where.OR = [
        { fullName: { contains: search } },
        { cpf: { contains: search } },
        { whatsapp: { contains: search } },
        { phone: { contains: search } },
      ];
    }
  }

  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        addresses: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, createdAt: true, status: true, total: true },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  // Enriquece cada customer com tier e stats resumidos
  const enriched = rows.map(c => {
    const all = (c.orders || []);
    const completed = all.filter(o => o.status === 'CONCLUIDO');
    const totalSpent = completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const lastOrderDate = all.length ? all[0].createdAt : null;
    const tierInfo = computeCustomerTier(c.orders);
    return { ...c, stats: { totalSpent, lastOrderDate, totalOrders: all.length, ...tierInfo } };
  });

  res.json({ total, rows: enriched });
});

// Pedidos paginados do cliente
customersRouter.get('/:id/orders', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const take = Math.min(Number(req.query.take || 10), 50);
  const skip = Math.max(Number(req.query.skip || 0), 0);

  const customer = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true, displayId: true, displaySimple: true,
        status: true, createdAt: true, total: true,
        orderType: true, address: true, customerName: true,
        deliveryFee: true, couponCode: true, couponDiscount: true,
        items: { select: { name: true, quantity: true, price: true, notes: true } },
      },
    }),
    prisma.order.count({ where: { customerId: customer.id } }),
  ]);

  res.json({ rows, total });
});

// Perfil
customersRouter.get('/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const c = await prisma.customer.findFirst({
    where: { id, companyId },
    include: {
      addresses: { orderBy: { isDefault: 'desc' } },
      orders: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, displayId: true, displaySimple: true,
          status: true, createdAt: true, total: true,
          items: { select: { name: true, quantity: true, price: true } },
        },
      },
    },
  });
  if (!c) return res.status(404).json({ message: 'Cliente não encontrado' });
  res.json({ ...c, stats: computeCustomerStats(c.orders) });
});

// Cadastro/edição
customersRouter.post('/', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { fullName, cpf, whatsapp, phone, addresses = [] } = req.body || {};
  if (!fullName) return res.status(400).json({ message: 'Nome é obrigatório' });

  const existsCpf = cpf ? await prisma.customer.findFirst({ where: { companyId, cpf: cpf.replace(/\D+/g, '') } }) : null;
  const existsWa  = whatsapp ? await prisma.customer.findFirst({ where: { companyId, whatsapp: normalizePhone(whatsapp) } }) : null;
  if (existsCpf || existsWa) return res.status(409).json({ message: 'Já existe cliente com este CPF/WhatsApp' });

  const customer = await prisma.customer.create({
    data: {
      companyId,
      fullName,
      cpf: cpf ? cpf.replace(/\D+/g, '') : null,
      whatsapp: whatsapp ? normalizePhone(whatsapp) : null,
      phone: phone ? normalizePhone(phone) : null,
      addresses: {
        create: addresses.map(a => ({
          label: a.label || null,
          street: a.street || null,
          number: a.number || null,
          complement: a.complement || null,
          neighborhood: a.neighborhood || null,
          reference: a.reference || null,
          observation: a.observation || null,
          city: a.city || null,
          state: a.state || null,
          postalCode: a.postalCode || null,
          country: a.country || 'BR',
          latitude: Number.isFinite(Number(a.latitude)) ? Number(a.latitude) : null,
          longitude: Number.isFinite(Number(a.longitude)) ? Number(a.longitude) : null,
          formatted: a.formatted || null,
          isDefault: !!a.isDefault,
        })),
      },
    },
    include: { addresses: true },
  });

  // garante um default
  const hasDefault = customer.addresses.some(a => a.isDefault);
  if (!hasDefault && customer.addresses.length) {
    await prisma.customerAddress.update({
      where: { id: customer.addresses[0].id },
      data: { isDefault: true },
    });
  }

  res.status(201).json(customer);
});

customersRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const { fullName, cpf, whatsapp, phone } = req.body || {};
  const patch = {};
  if (fullName) patch.fullName = fullName;
  if (cpf !== undefined) patch.cpf = cpf ? cpf.replace(/\D+/g, '') : null;
  if (whatsapp !== undefined) patch.whatsapp = whatsapp ? normalizePhone(whatsapp) : null;
  if (phone !== undefined) patch.phone = phone ? normalizePhone(phone) : null;

  const updated = await prisma.customer.update({
    where: { id },
    data: patch,
  });
  res.json(updated);
});

// Create a new address for an existing customer
customersRouter.post('/:id/addresses', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const { label, street, number, complement, neighborhood, reference, observation, state, postalCode, latitude, longitude, formatted } = req.body || {};
  // ensure customer belongs to company
  const customer = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

  // unset previous default
  try {
    await prisma.customerAddress.updateMany({ where: { customerId: customer.id, isDefault: true }, data: { isDefault: false } });
  } catch (e) { /* ignore */ }
  // Avoid creating duplicate addresses: check existing by formatted, or by street+number+postalCode, or street+number+neighborhood
  const whereOr = [];
  if (formatted) whereOr.push({ formatted });
  if (postalCode) whereOr.push({ postalCode });
  if (street && number) whereOr.push({ street, number });
  if (whereOr.length) {
    const exists = await prisma.customerAddress.findFirst({ where: { customerId: customer.id, OR: whereOr } });
    if (exists) {
      // ensure it's marked default and return it
      try { await prisma.customerAddress.update({ where: { id: exists.id }, data: { isDefault: true } }); } catch(e){}
      return res.status(200).json(exists);
    }
  }

  const created = await prisma.customerAddress.create({ data: {
    customerId: customer.id,
    label: label || null,
    street: street || null,
    number: number || null,
    complement: complement || null,
    neighborhood: neighborhood || null,
    reference: reference || null,
    observation: observation || null,
    city: null,
    state: state || null,
    postalCode: postalCode || null,
    formatted: formatted || null,
    latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : null,
    longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : null,
    isDefault: true,
  } });

  res.status(201).json(created);
});

// Definir endereço padrão
customersRouter.patch('/:id/addresses/:addressId/default', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id, addressId } = req.params;

  const customer = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

  const address = await prisma.customerAddress.findFirst({ where: { id: addressId, customerId: customer.id } });
  if (!address) return res.status(404).json({ message: 'Endereço não encontrado' });

  await prisma.$transaction([
    prisma.customerAddress.updateMany({ where: { customerId: customer.id }, data: { isDefault: false } }),
    prisma.customerAddress.update({ where: { id: addressId }, data: { isDefault: true } }),
  ]);

  res.json({ ok: true });
});

// Editar endereço
customersRouter.patch('/:id/addresses/:addressId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id, addressId } = req.params;

  const customer = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

  const address = await prisma.customerAddress.findFirst({ where: { id: addressId, customerId: customer.id } });
  if (!address) return res.status(404).json({ message: 'Endereço não encontrado' });

  const fields = ['label','street','number','complement','neighborhood','reference','observation','city','state','postalCode','formatted'];
  const patch = {};
  for (const f of fields) {
    if (req.body[f] !== undefined) patch[f] = req.body[f] || null;
  }

  const updated = await prisma.customerAddress.update({ where: { id: addressId }, data: patch });
  res.json(updated);
});

// Excluir endereço
customersRouter.delete('/:id/addresses/:addressId', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { id, addressId } = req.params;

  const customer = await prisma.customer.findFirst({ where: { id, companyId } });
  if (!customer) return res.status(404).json({ message: 'Cliente não encontrado' });

  const address = await prisma.customerAddress.findFirst({ where: { id: addressId, customerId: customer.id } });
  if (!address) return res.status(404).json({ message: 'Endereço não encontrado' });

  await prisma.customerAddress.delete({ where: { id: addressId } });

  // Se era o padrão, promove o primeiro restante
  if (address.isDefault) {
    const first = await prisma.customerAddress.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: 'asc' } });
    if (first) {
      await prisma.customerAddress.update({ where: { id: first.id }, data: { isDefault: true } });
    }
  }

  res.json({ ok: true });
});

// ─── Import em segundo plano ────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

// Mapa de jobs em memória: jobId → { processed, total, created, updated, errors, done, error }
const importJobs = new Map();

function parseImportRows(buffer, originalname, mimetype) {
  const xlsxOptions = { type: 'buffer' };
  const fileName = (originalname || '').toLowerCase();
  const isCsv = fileName.endsWith('.csv') || mimetype === 'text/csv';
  if (isCsv) {
    const firstLine = buffer.toString('utf8').replace(/^\uFEFF/, '').split('\n')[0] || '';
    const semiCount = (firstLine.match(/;/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    if (semiCount > commaCount) xlsxOptions.FS = ';';
  }
  const wb = xlsx.read(buffer, xlsxOptions);
  // raw: false → preserva "150,00" e "+5511..." como strings em vez de auto-converter
  return xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
}

async function processOneImportRow(r, companyId) {
  const fullName = r.fullName || r.nome || r.Nome || 'Cliente';
  const cpf = r['CPF/CNPJ'] || r.cpf || r.CPF || r.cnpj || '';
  // Telefone (coluna da planilha) vai SOMENTE para whatsapp; phone fica para colunas explícitas
  const whatsapp = r.whatsapp || r.WhatsApp || r.Telefone || r.telefone || r.phone || '';
  const phone = r.phone || r.phone_alt || '';
  const email = r.email || r.Email || r['E-mail'] || r['e-mail'] || '';
  // Birthday: aceita ISO (1990-05-12) ou formatos BR (12/05/1990)
  const birthdayRaw = r['Data Aniversário'] || r['Data de Aniversário'] || r.birthday || r.aniversario || r.Aniversário || '';
  const qtdPedidos = r['Qtd. Pedidos'] || r['Qtd Pedidos'] || r.qtdPedidos || r.qtd_pedidos || r.totalOrders || r.total_orders || r.totalPedidos || '';
  const valorTotal = r['Valor Total'] || r.valorTotal || r.total_spent || '';
  const ticketMedio = r['Ticket Medio'] || r['Ticket Médio'] || r.ticketMedio || r.avgTicket || r.ticket_medio || '';
  const ultimaCompra = r['Última Compra'] || r['Ultima Compra'] || r.ultimaCompra || r.lastPurchase || r.last_order_date || '';
  const saldoTotal = r['Saldo Financeiro Total'] || r.saldoTotal || r.balanceTotal || '';
  const saldoPeriodo = r['Saldo Financeiro do Período'] || r.saldoPeriodo || r.balancePeriod || '';
  // "Código ifood" → ifoodCode (identificador do cliente no iFood, separado do ifoodCustomerId da integração)
  const ifoodCode = r['Código ifood'] || r.ifoodCode || '';
  const codigoConfirmacaoIfood = r['Código Confirmação iFood'] || r['Codigo Confirmacao iFood'] || r.ifoodConfirmationCode || '';
  const enderecoLivre = r['Endereço'] || r.Endereço || r.endereco || '';
  const complementoLivre = r['Complemento'] || r.complemento || r.complement || '';

  const address = {
    label: r.label || r.rótulo || null,
    street: r.street || r.logradouro || r.rua || enderecoLivre,
    number: r.number || r.numero || '',
    complement: r.complement || r.complemento || r.Complemento || complementoLivre,
    neighborhood: r.neighborhood || r.bairro || '',
    reference: r.reference || r.referencia || r.referência || '',
    observation: r.observation || r.observacao || r.observação || r.note || r.notes || '',
    city: r.city || r.cidade || '',
    state: r.state || r.estado || '',
    postalCode: r.postalCode || r.cep || '',
    latitude: r.latitude ? (parseFloat(String(r.latitude)) || null) : null,
    longitude: r.longitude ? (parseFloat(String(r.longitude)) || null) : null,
    formatted: r.formatted || enderecoLivre,
    isDefault: true,
  };

  const parseBRL = (v) => v !== '' ? (parseFloat(String(v).replace(/\./g, '').replace(/,/g, '.')) || 0) : null;
  const parseDate = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    // Tenta ISO direto
    let d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    // Tenta formato BR: DD/MM/YYYY ou DD/MM/YY
    const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (brMatch) {
      const year = brMatch[3].length === 2 ? `19${brMatch[3]}` : brMatch[3];
      d = new Date(`${year}-${brMatch[2].padStart(2,'0')}-${brMatch[1].padStart(2,'0')}`);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  };
  const parsedTotalOrders = qtdPedidos !== '' ? (Number(String(qtdPedidos).replace(/\./g, '').replace(/,/g, '.')) || 0) : null;
  const parsedTotalSpent = parseBRL(valorTotal);
  const parsedAvgTicket = parseBRL(ticketMedio);
  const parsedBalanceTotal = parseBRL(saldoTotal);
  const parsedBalancePeriod = parseBRL(saldoPeriodo);
  const parsedLastPurchase = parseDate(ultimaCompra);
  const parsedBirthday = parseDate(birthdayRaw);

  const orClauses = [
    cpf ? { cpf: String(cpf).replace(/\D+/g, '') } : null,
    whatsapp ? { whatsapp: normalizePhone(whatsapp) } : null,
  ].filter(Boolean);

  const before = orClauses.length
    ? await prisma.customer.findFirst({ where: { companyId, OR: orClauses } })
    : null;

  if (!before) {
    await prisma.customer.create({
      data: {
        companyId, fullName,
        cpf: cpf ? String(cpf).replace(/\D+/g, '') : null,
        email: email || null,
        birthday: parsedBirthday,
        whatsapp: whatsapp ? normalizePhone(whatsapp) : null,
        phone: phone ? normalizePhone(phone) : null,
        ifoodCode: ifoodCode || null,
        ifoodConfirmationCode: codigoConfirmacaoIfood || null,
        totalSpent: parsedTotalSpent !== null ? parsedTotalSpent : undefined,
        addresses: { create: [address] },
        importedTotalOrders: parsedTotalOrders,
        importedTotalSpent: parsedTotalSpent,
        importedAvgTicket: parsedAvgTicket,
        importedLastPurchase: parsedLastPurchase,
        importedFinancialBalanceTotal: parsedBalanceTotal,
        importedFinancialBalancePeriod: parsedBalancePeriod,
      },
    });
    return 'created';
  } else {
    const updateData = {
      fullName: before.fullName || fullName,
      cpf: before.cpf || (cpf ? String(cpf).replace(/\D+/g, '') : null),
      whatsapp: before.whatsapp || (whatsapp ? normalizePhone(whatsapp) : null),
      phone: before.phone || (phone ? normalizePhone(phone) : null),
    };
    if (email && !before.email) updateData.email = email;
    if (parsedBirthday && !before.birthday) updateData.birthday = parsedBirthday;
    if (ifoodCode) updateData.ifoodCode = ifoodCode;
    if (codigoConfirmacaoIfood) updateData.ifoodConfirmationCode = codigoConfirmacaoIfood;
    if (parsedTotalOrders !== null) updateData.importedTotalOrders = parsedTotalOrders;
    if (parsedTotalSpent !== null) { updateData.importedTotalSpent = parsedTotalSpent; updateData.totalSpent = parsedTotalSpent; }
    if (parsedAvgTicket !== null) updateData.importedAvgTicket = parsedAvgTicket;
    if (parsedLastPurchase !== null) updateData.importedLastPurchase = parsedLastPurchase;
    if (parsedBalanceTotal !== null) updateData.importedFinancialBalanceTotal = parsedBalanceTotal;
    if (parsedBalancePeriod !== null) updateData.importedFinancialBalancePeriod = parsedBalancePeriod;

    try {
      await prisma.customer.update({ where: { id: before.id }, data: updateData });
    } catch (e) {
      if (e.code === 'P2002') {
        const conflictFields = e.meta?.target || [];
        if (conflictFields.includes('whatsapp')) delete updateData.whatsapp;
        if (conflictFields.includes('cpf')) delete updateData.cpf;
        await prisma.customer.update({ where: { id: before.id }, data: updateData });
      } else { throw e; }
    }
    const hasAddr = await prisma.customerAddress.findFirst({ where: { customerId: before.id } });
    if (!hasAddr) await prisma.customerAddress.create({ data: { customerId: before.id, ...address } });
    return 'updated';
  }
}

async function processImportBackground(jobId, rows, companyId) {
  const job = importJobs.get(jobId);
  const BATCH = 50; // cede o event loop a cada 50 linhas
  for (let i = 0; i < rows.length; i++) {
    try {
      const result = await processOneImportRow(rows[i], companyId);
      if (result === 'created') job.created++; else job.updated++;
    } catch (e) {
      job.errors++;
      console.warn(`Import row ${i} error:`, e?.message || e);
    }
    job.processed++;
    if (i % BATCH === BATCH - 1) await new Promise(res => setImmediate(res));
  }
  job.done = true;
  setTimeout(() => importJobs.delete(jobId), 10 * 60 * 1000); // limpa após 10 min
}

// POST /customers/import — responde imediatamente, processa em segundo plano
customersRouter.post('/import', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Arquivo é obrigatório' });
  const companyId = req.user.companyId;
  try {
    const rows = parseImportRows(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (!rows.length) return res.status(400).json({ message: 'Arquivo sem linhas de dados' });
    const jobId = randomUUID();
    importJobs.set(jobId, { processed: 0, total: rows.length, created: 0, updated: 0, errors: 0, done: false, error: null });
    res.json({ ok: true, jobId, total: rows.length });
    processImportBackground(jobId, rows, companyId).catch(e => {
      const job = importJobs.get(jobId);
      if (job) { job.done = true; job.error = e.message; }
      console.error('Import background fatal:', e);
    });
  } catch (e) {
    console.error('Import parse error:', e);
    res.status(500).json({ message: 'Falha ao ler arquivo', error: e.message });
  }
});

// GET /customers/import/:jobId/status — consulta progresso do job
customersRouter.get('/import/:jobId/status', requireRole('ADMIN'), (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ message: 'Job não encontrado ou expirado' });
  res.json(job);
});



// Merge customers: transfer orders/addresses/accounts/members to primary and delete merged records
customersRouter.post('/merge', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const { primaryId, mergeIds = [], overwrite = {} } = req.body || {};
  if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) return res.status(400).json({ message: 'primaryId e mergeIds são obrigatórios' });

  // ensure primary exists and belongs to company
  const primary = await prisma.customer.findFirst({ where: { id: primaryId, companyId } });
  if (!primary) return res.status(404).json({ message: 'Conta principal não encontrada' });

  // filter valid merge ids (exclude primary and ensure company)
  const validMerge = await prisma.customer.findMany({ where: { id: { in: mergeIds }, companyId } });
  const validIds = validMerge.map(c => c.id).filter(id => id !== primaryId);
  if (validIds.length === 0) return res.status(400).json({ message: 'Nenhuma conta válida para mesclar' });

  try {
    await prisma.$transaction(async (tx) => {
      // transfer orders
      await tx.order.updateMany({ where: { customerId: { in: validIds } }, data: { customerId: primaryId } });

      // transfer addresses: try to avoid duplicates
      const addrs = await tx.customerAddress.findMany({ where: { customerId: { in: validIds } } });
      for (const a of addrs) {
        const exists = await tx.customerAddress.findFirst({ where: {
          customerId: primaryId,
          OR: [ { formatted: a.formatted }, { AND: [{ street: a.street }, { number: a.number }] } ].filter(Boolean)
        } });
        if (exists) {
          // remove duplicate address
          try { await tx.customerAddress.delete({ where: { id: a.id } }); } catch(e){}
        } else {
          // reassign
          await tx.customerAddress.update({ where: { id: a.id }, data: { customerId: primaryId } });
        }
      }

      // transfer customer accounts (avoid duplicate emails)
      const accounts = await tx.customerAccount.findMany({ where: { customerId: { in: validIds } } });
      for (const acc of accounts) {
        if (!acc.email) { await tx.customerAccount.update({ where: { id: acc.id }, data: { customerId: primaryId } }); continue }
        const exists = await tx.customerAccount.findFirst({ where: { companyId, email: acc.email } });
        if (exists) {
          // delete duplicate
          try { await tx.customerAccount.delete({ where: { id: acc.id } }); } catch(e){}
        } else {
          await tx.customerAccount.update({ where: { id: acc.id }, data: { customerId: primaryId } });
        }
      }

      // transfer customer group memberships (avoid duplicate member rows)
      const members = await tx.customerGroupMember.findMany({ where: { customerId: { in: validIds } } });
      for (const m of members) {
        const exists = await tx.customerGroupMember.findFirst({ where: { groupId: m.groupId, customerId: primaryId } });
        if (exists) {
          try { await tx.customerGroupMember.delete({ where: { id: m.id } }); } catch(e){}
        } else {
          await tx.customerGroupMember.update({ where: { id: m.id }, data: { customerId: primaryId } });
        }
      }

      // transfer cashback wallets if any (cashback wallet uses clientId)
      try {
        await tx.cashbackWallet.updateMany({ where: { clientId: { in: validIds } }, data: { clientId: primaryId } });
      } catch(e) { /* ignore if no table or constraint issues */ }

      // Update primary fields according to overwrite flags: prefer first non-empty from merged customers
      const mergedCustomers = await tx.customer.findMany({ where: { id: { in: validIds } } });
      const patch = {};
      if (overwrite.fullName) {
        const val = mergedCustomers.map(c => c.fullName).find(v => v && v.trim())
        if (val) patch.fullName = val
      }
      if (overwrite.cpf) {
        const val = mergedCustomers.map(c => c.cpf).find(v => v && v.trim())
        if (val) patch.cpf = String(val).replace(/\D+/g, '')
      }
      if (overwrite.whatsapp) {
        const val = mergedCustomers.map(c => c.whatsapp).find(v => v && v.trim())
        if (val) patch.whatsapp = val
      }
      if (overwrite.phone) {
        const val = mergedCustomers.map(c => c.phone).find(v => v && v.trim())
        if (val) patch.phone = val
      }
      if (overwrite.ifoodCustomerId) {
        const val = mergedCustomers.map(c => c.ifoodCustomerId).find(v => v && String(v).trim())
        if (val) patch.ifoodCustomerId = val
      }
      // normalize cpf/phones
      if (patch.cpf) patch.cpf = String(patch.cpf).replace(/\D+/g, '');
      if (patch.whatsapp) patch.whatsapp = normalizePhone(patch.whatsapp);
      if (patch.phone) patch.phone = normalizePhone(patch.phone);

      // Reconcile remaining child records to avoid FK violations
      // 1) Ensure any leftover addresses point to primary
      try {
        await tx.customerAddress.updateMany({ where: { customerId: { in: validIds } }, data: { customerId: primaryId } });
      } catch (e) { /* ignore */ }

      // 2) Reconcile customer accounts (handle email uniqueness)
      const remainingAccounts = await tx.customerAccount.findMany({ where: { customerId: { in: validIds } } });
      for (const acc of remainingAccounts) {
        if (!acc.email) {
          try { await tx.customerAccount.update({ where: { id: acc.id }, data: { customerId: primaryId } }); } catch(e){}
          continue;
        }
        const exists = await tx.customerAccount.findFirst({ where: { companyId, email: acc.email, customerId: primaryId } });
        if (exists) {
          try { await tx.customerAccount.delete({ where: { id: acc.id } }); } catch(e){}
        } else {
          try { await tx.customerAccount.update({ where: { id: acc.id }, data: { customerId: primaryId } }); } catch(e){}
        }
      }

      // 3) Reconcile group members
      const remainingMembers = await tx.customerGroupMember.findMany({ where: { customerId: { in: validIds } } });
      for (const m of remainingMembers) {
        const exists = await tx.customerGroupMember.findFirst({ where: { groupId: m.groupId, customerId: primaryId } });
        if (exists) {
          try { await tx.customerGroupMember.delete({ where: { id: m.id } }); } catch(e){}
        } else {
          try { await tx.customerGroupMember.update({ where: { id: m.id }, data: { customerId: primaryId } }); } catch(e){}
        }
      }

      // 4) Reconcile cashback wallets: if primary already has a wallet, merge balances and transactions
      try {
        const sourceWallets = await tx.cashbackWallet.findMany({ where: { clientId: { in: validIds } } });
        const primaryWallet = await tx.cashbackWallet.findFirst({ where: { companyId, clientId: primaryId } });
        for (const w of sourceWallets) {
          if (primaryWallet && primaryWallet.id !== w.id) {
            // move transactions to primary wallet
            try {
              await tx.cashbackTransaction.updateMany({ where: { walletId: w.id }, data: { walletId: primaryWallet.id } });
            } catch (err) {}
            // add balance to primary wallet
            try {
              await tx.cashbackWallet.update({ where: { id: primaryWallet.id }, data: { balance: { increment: w.balance } } });
            } catch (err) {}
            // delete source wallet
            try { await tx.cashbackWallet.delete({ where: { id: w.id } }); } catch(e){}
          } else {
            // no primary wallet yet (or this is primary), just reassign clientId
            try { await tx.cashbackWallet.update({ where: { id: w.id }, data: { clientId: primaryId } }); } catch(e){}
          }
        }
      } catch(e) { /* ignore if no table or other issues */ }

      // Diagnostic: check for any remaining FK references before delete
      const tables = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      const fkProblems = [];
      for (const trow of tables) {
        const table = trow.name;
        try {
          const cols = await tx.$queryRawUnsafe(`PRAGMA table_info('${table}')`);
          const candidateCols = cols.filter(c => /customerid|clientid|customer_id|client_id/i.test(String(c.name))).map(c => c.name);
          for (const col of candidateCols) {
            const placeholders = validIds.map(() => '?').join(',');
            const q = `SELECT count(*) as cnt FROM "${table}" WHERE \"${col}\" IN (${placeholders})`;
            const cntRow = await tx.$queryRawUnsafe(q, ...validIds);
            const cnt = Number(cntRow?.[0]?.cnt ?? cntRow?.cnt ?? 0);
            if (cnt > 0) fkProblems.push({ table, column: col, count: cnt });
          }
        } catch (e) {
          // ignore inspection errors
        }
      }

      if (fkProblems.length) {
        console.error('FK problems detected before deleting merged customers:', fkProblems);
        throw new Error('FK references still exist: ' + JSON.stringify(fkProblems));
      }

      // Finally delete merged customers
      try {
        await tx.customer.deleteMany({ where: { id: { in: validIds }, companyId } });
      } catch (err) {
        console.error('Failed to delete merged customers', validIds, err?.message || err);
        throw err;
      }

      // Ensure uniqueness: don't set CPF/WhatsApp if another remaining customer already has it
      if (patch.whatsapp) {
        const conflict = await tx.customer.findFirst({ where: { companyId, whatsapp: patch.whatsapp, id: { notIn: [primaryId] } } });
        if (conflict) {
          delete patch.whatsapp;
          console.warn('Merge skip: whatsapp conflict, not overwriting primary', patch.whatsapp);
        }
      }
      if (patch.cpf) {
        const conflict = await tx.customer.findFirst({ where: { companyId, cpf: patch.cpf, id: { notIn: [primaryId] } } });
        if (conflict) {
          delete patch.cpf;
          console.warn('Merge skip: cpf conflict, not overwriting primary', patch.cpf);
        }
      }

      if (Object.keys(patch).length) {
        await tx.customer.update({ where: { id: primaryId }, data: patch });
      }
    });

    res.json({ ok: true, merged: validIds.length });
  } catch (e) {
    console.error('Merge error:', e);
    res.status(500).json({ message: 'Falha ao combinar clientes', error: e?.message });
  }
});