import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole } from '../auth.js';
import { normalizePhone, findOrCreateCustomer } from '../services/customers.js';

export const customersRouter = express.Router();
customersRouter.use(authMiddleware);

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
      include: { addresses: true, orders: { select: { id: true } } },
    }),
    prisma.customer.count({ where }),
  ]);

  res.json({ total, rows });
});

// Perfil
customersRouter.get('/:id', async (req, res) => {
  const companyId = req.user.companyId;
  const { id } = req.params;
  const c = await prisma.customer.findFirst({
    where: { id, companyId },
    include: {
      addresses: { orderBy: { isDefault: 'desc' } },
      orders: { orderBy: { createdAt: 'desc' }, select: { id: true, displayId: true, status: true, createdAt: true, total: true } },
    },
  });
  if (!c) return res.status(404).json({ message: 'Cliente não encontrado' });
  res.json(c);
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

// Importação CSV/XLSX (colunas suportadas: fullName, cpf, whatsapp, phone, street, number, complement, neighborhood, city, state, postalCode, latitude, longitude, formatted)
const upload = multer({ storage: multer.memoryStorage() });

customersRouter.post('/import', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Arquivo é obrigatório' });
  const companyId = req.user.companyId;

  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

    let created = 0, updated = 0;
    for (const r of rows) {
      const fullName = r.fullName || r.nome || r.Nome || 'Cliente';
      const cpf = r.cpf || r.CPF || '';
      const whatsapp = r.whatsapp || r.WhatsApp || r.telefone || r.phone || '';
      const phone = r.phone || r.telefone || '';
      const address = {
        label: r.label || r.rótulo || null,
        street: r.street || r.logradouro || r.rua || '',
        number: r.number || r.numero || '',
        complement: r.complement || r.complemento || '',
        neighborhood: r.neighborhood || r.bairro || '',
        city: r.city || r.cidade || '',
        state: r.state || r.estado || '',
        postalCode: r.postalCode || r.cep || '',
        latitude: r.latitude || '',
        longitude: r.longitude || '',
        formatted: r.formatted || '',
        isDefault: true,
      };

      const before = await prisma.customer.findFirst({
        where: {
          companyId,
          OR: [
            cpf ? { cpf: String(cpf).replace(/\D+/g, '') } : undefined,
            whatsapp ? { whatsapp: normalizePhone(whatsapp) } : undefined,
          ].filter(Boolean),
        },
      });

      if (!before) {
        await prisma.customer.create({
          data: {
            companyId,
            fullName,
            cpf: cpf ? String(cpf).replace(/\D+/g, '') : null,
            whatsapp: whatsapp ? normalizePhone(whatsapp) : null,
            phone: phone ? normalizePhone(phone) : null,
            addresses: {
              create: [address],
            },
          },
        });
        created++;
      } else {
        await prisma.customer.update({
          where: { id: before.id },
          data: {
            fullName: before.fullName || fullName,
            cpf: before.cpf || (cpf ? String(cpf).replace(/\D+/g, '') : null),
            whatsapp: before.whatsapp || (whatsapp ? normalizePhone(whatsapp) : null),
            phone: before.phone || (phone ? normalizePhone(phone) : null),
          },
        });
        // cria endereço default se não tiver
        const hasAddr = await prisma.customerAddress.findFirst({ where: { customerId: before.id } });
        if (!hasAddr) {
          await prisma.customerAddress.create({ data: { customerId: before.id, ...address } });
        }
        updated++;
      }
    }

    res.json({ ok: true, created, updated, total: rows.length });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ message: 'Falha ao importar', error: e.message });
  }
});