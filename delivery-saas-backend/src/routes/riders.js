import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware, requireRole, createUser } from '../auth.js';
import riderAccountService from '../services/riderAccount.js';
import { evoSendDocument, evoSendMediaUrl, evoSendText, normalizePhone } from '../wa.js';
import fs from 'fs';
import path from 'path';
import { assertModuleEnabled } from '../utils/saas.js';

export const ridersRouter = express.Router();
ridersRouter.use(authMiddleware);

// Enforce SaaS module availability: RIDERS must be enabled in the company's plan
ridersRouter.use(async (req, res, next) => {
  try {
    await assertModuleEnabled(req.user.companyId, 'RIDERS')
    return next()
  } catch (e) {
    const status = e && e.statusCode ? e.statusCode : 403
    return res.status(status).json({ message: 'Módulo de entregadores não está disponível no seu plano.' })
  }
});

ridersRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const riders = await prisma.rider.findMany({
    where: { companyId },
    select: { id: true, name: true, whatsapp: true }
  });
  res.json(riders);
});

ridersRouter.get('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });
  res.json(rider);
});

// GET account balance
ridersRouter.get('/:id/account', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });
  const balance = await riderAccountService.getRiderBalance(id);
  res.json({ riderId: id, balance });
});

// GET transactions
ridersRouter.get('/:id/transactions', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  // query params: page, pageSize, from, to, type, sort, format
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize || 25)));

  // Helper: parse date-only strings (YYYY-MM-DD) as local dates to avoid
  // timezone shifts when converting to UTC. Falls back to Date(string) for other formats.
  function parseDateLocal(s) {
    if (!s) return null;
    const str = String(s).trim();
    // if date-only YYYY-MM-DD, construct using local date components
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      // new Date(year, monthIndex, day) creates a date at local midnight
      return new Date(y, mo - 1, d);
    }
    const dt = new Date(str);
    return isNaN(dt) ? null : dt;
  }

  const from = req.query.from ? parseDateLocal(req.query.from) : null;
  let to = req.query.to ? parseDateLocal(req.query.to) : null;
  // make 'to' inclusive (end of day) when present
  if (to && !isNaN(to)) {
    to.setHours(23, 59, 59, 999);
  }
  const type = req.query.type ? String(req.query.type) : null; // single type or comma-separated
  const sort = String(req.query.sort || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const where = { riderId: id };
  if (from || to) {
    where.date = {};
    if (from && !isNaN(from)) where.date.gte = from;
    if (to && !isNaN(to)) where.date.lte = to;
  }
  if (type) {
    const types = type.split(',').map(t => t.trim()).filter(Boolean);
    if (types.length === 1) where.type = types[0];
    else where.type = { in: types };
  }

  const format = String(req.query.format || '').toLowerCase();

  // If client requests full JSON set (not CSV) use ?full=true to return all matching rows
  if (String(req.query.full || '').toLowerCase() === 'true') {
    const all = await prisma.riderTransaction.findMany({ where, orderBy: { date: sort }, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });
    const totalAll = all.length;
    return res.json({ items: all, total: totalAll, page: 1, pageSize: totalAll, totalPages: 1 });
  }

  // Debug logging: show incoming query params and the final Prisma `where` used for the DB query
  try {
    console.log('GET /riders/:id/transactions req.query:', req.query);
    console.log('GET /riders/:id/transactions prisma where:', JSON.stringify(where, null, 2));
  } catch (logErr) {
    // ignore logging errors
    console.error('Failed to log transactions debug info', logErr);
  }

  // if CSV requested, export the full filtered set (ignoring paging)
  if (format === 'csv') {
    // include related order (displaySimple/displayId) so frontend can show comanda
    const all = await prisma.riderTransaction.findMany({ where, orderBy: { date: sort }, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });
    function mapTypeLabel(type) {
      if (!type) return '';
      switch (type) {
        case 'DELIVERY_FEE': return 'Taxa de entrega';
        case 'DAILY_RATE': return 'Diária';
        case 'MANUAL_ADJUSTMENT': return 'Ajuste manual';
        default: return String(type);
      }
    }
    const rows = all.map(t => ({
      id: t.id,
      date: t.date,
      type: mapTypeLabel(t.type),
      amount: t.amount,
      orderId: t.orderId || '',
      orderDisplaySimple: t.order?.displaySimple ?? '',
      orderDisplayId: t.order?.displayId ?? '',
      note: t.note || '',
    }));
    const header = ['id', 'date', 'type', 'amount', 'orderId', 'note'];
    const csv = [header.join(',')].concat(rows.map(r => header.map(h => {
      const v = r[h] === null || r[h] === undefined ? '' : String(r[h]);
      if (v.includes(',') || v.includes('\n') || v.includes('"')) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    }).join(','))).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rider-${id}-transactions.csv"`);
    return res.send(csv);
  }

  // count total
  const total = await prisma.riderTransaction.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const skip = (page - 1) * pageSize;

  // include order relation so frontend can display order's visual id in transactions
  const items = await prisma.riderTransaction.findMany({ where, orderBy: { date: sort }, skip, take: pageSize, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });

  res.json({ items, total, page, pageSize, totalPages });
});

// Adjust rider account (credit/debit) - ADMIN only
ridersRouter.post('/:id/account/adjust', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const { amount, type = 'CREDIT', note } = req.body || {};
  const val = Number(amount || 0);
  if (!isFinite(val) || val === 0) return res.status(400).json({ message: 'Amount inválido' });

  const adjAmount = type === 'DEBIT' ? -Math.abs(val) : Math.abs(val);

  const tx = await riderAccountService.addRiderTransaction({ companyId, riderId: id, amount: adjAmount, type: 'MANUAL_ADJUSTMENT', note: note || (type === 'DEBIT' ? 'Débito manual' : 'Crédito manual'), date: new Date() });

  res.json({ ok: true, tx });
});

ridersRouter.post('/', async (req, res) => {
  const companyId = req.user.companyId;
  const { name, whatsapp: rawWhatsapp, dailyRate, active, password } = req.body || {};
  const whatsapp = rawWhatsapp ? String(rawWhatsapp).replace(/\D/g, '') : rawWhatsapp;
  const created = await prisma.rider.create({ data: { companyId, name, whatsapp, dailyRate: dailyRate ? Number(dailyRate) : undefined, active: active !== false } });

  // If a password was provided, create a linked User record with role RIDER
  if (password) {
    try {
      // generate a deterministic unique email for the rider user (not used for contact)
      const fakeEmail = `rider+${created.id}@${companyId}.local`;
      const user = await createUser({ name: String(name || ''), email: fakeEmail, password: String(password), role: 'RIDER', companyId });
      // link rider -> user
      await prisma.rider.update({ where: { id: created.id }, data: { userId: user.id } });
      // include userId in returned payload
      created.userId = user.id;
    } catch (e) {
      console.error('Failed to create linked rider user', e);
      // don't fail the whole request; return rider created but inform about user creation failure
      return res.status(201).json({ rider: created, warning: 'Rider criado, porém falha ao criar usuário vinculado' });
    }
  }

  res.json(created);
});

ridersRouter.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const { name, whatsapp: rawWhatsapp, dailyRate, active } = req.body || {};
  const whatsapp = rawWhatsapp ? String(rawWhatsapp).replace(/\D/g, '') : rawWhatsapp;
  const existing = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!existing) return res.status(404).json({ message: 'Entregador não encontrado' });
  const updated = await prisma.rider.update({ where: { id }, data: { name, whatsapp, dailyRate: dailyRate ? Number(dailyRate) : existing.dailyRate, active: typeof active === 'boolean' ? active : existing.active } });
  // if password present in update body, attempt to update linked user's password (if exists)
  const { password } = req.body || {};
  if (password) {
    try {
      if (existing.userId) {
        const hash = await (await import('bcryptjs')).hash(String(password), 10);
        await prisma.user.update({ where: { id: existing.userId }, data: { password: hash } });
      } else {
        // create a new linked user if none exists
        const fakeEmail = `rider+${existing.id}@${companyId}.local`;
        const user = await createUser({ name: String(updated.name || ''), email: fakeEmail, password: String(password), role: 'RIDER', companyId });
        await prisma.rider.update({ where: { id: existing.id }, data: { userId: user.id } });
      }
    } catch (e) {
      console.error('Failed to set/update rider password', e);
    }
  }

  res.json(updated);
});

// Send PDF report via WhatsApp (admin) - uses first connected instance if not provided
ridersRouter.post('/:id/account/send-report', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const body = req.body || {};
  const toPhone = body.phone;
  const providedInstance = body.instanceName;
  const dateFrom = body.from;
  const dateTo = body.to;
  const type = body.type;
  if (!toPhone) return res.status(400).json({ message: 'to (telefone destino) é obrigatório' });

  // Debug: log incoming request for send-report
  try {
    console.log('POST /riders/:id/account/send-report request body:', JSON.stringify(body));
  } catch (__e) {}

  // build where filter
  const where = { riderId: id };
  if (dateFrom || dateTo) {
    // parseDateLocal: interpret YYYY-MM-DD as local date (midnight local)
    function parseDateLocal(s) {
      if (!s) return null;
      const str = String(s).trim();
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        return new Date(y, mo - 1, d);
      }
      const dt = new Date(str);
      return isNaN(dt) ? null : dt;
    }

    where.date = {};
    const fromDate = dateFrom ? parseDateLocal(dateFrom) : null;
    let toDate = dateTo ? parseDateLocal(dateTo) : null;
    if (toDate && !isNaN(toDate)) toDate.setHours(23, 59, 59, 999);
    if (fromDate && !isNaN(fromDate)) where.date.gte = fromDate;
    if (toDate && !isNaN(toDate)) where.date.lte = toDate;
  }

  // debug computed where
  try {
    console.log('send-report prisma where:', JSON.stringify(where, null, 2));
  } catch (__e) {}
  if (type) {
    const types = String(type).split(',').map(t => t.trim()).filter(Boolean);
    where.type = types.length === 1 ? types[0] : { in: types };
  }

  // fetch transactions (full set for report)
  // include order relation for report generation, so we can print the displaySimple/displayId
  const txs = await prisma.riderTransaction.findMany({ where, orderBy: { date: 'asc' }, include: { order: { select: { id: true, displaySimple: true, displayId: true } } } });

  // Debug: how many transactions matched
  try {
    console.log(`send-report: found ${txs.length} transactions for rider ${id}`);
    if (txs.length > 0) console.log('send-report sample txs:', txs.slice(0, 3));
  } catch (__e) {}

    // create PDF
  try {
    const PDFDocument = (await import('pdfkit')).default;
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const finishPromise = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Prepare table layout that fits A4 and supports pagination
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margins = doc.page.margins || { top: 40, bottom: 40, left: 40, right: 40 };
    const leftX = margins.left;
    const rightX = pageWidth - margins.right;
    const usableWidth = rightX - leftX;
    const topY = margins.top;
    const bottomY = pageHeight - margins.bottom;

    const colDateW = 120;
    const colOrderW = 100;
    const colValueW = 80;
    // note column gets the remaining width
    const colNoteW = Math.max(60, usableWidth - (colDateW + colOrderW + colValueW));

    const rowHeight = 18; // approximate row height
    const headerHeight = 20;

    // formatting helpers
    const moneyFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

    let cursorY = doc.y;
    let pageIndex = 1;

    function renderHeader() {
      doc.fontSize(16).font('Helvetica-Bold').text(`Relatório de transações - entregador: ${rider.name}`, leftX, topY);
      doc.fontSize(10).font('Helvetica').text(`Período: ${dateFrom || '-'} até ${dateTo || '-'}`, leftX, topY + 22);
      doc.fontSize(10).text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, leftX + usableWidth - 200, topY + 22, { width: 200, align: 'right' });

      // table header
      cursorY = topY + 50;
      doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();
      doc.fontSize(11).font('Helvetica-Bold');
  doc.text('Data / Hora', leftX + 4, cursorY + 4, { width: colDateW - 8 });
  doc.text('Pedido', leftX + colDateW + 4, cursorY + 4, { width: colOrderW - 8 });
  doc.text('Observação', leftX + colDateW + colOrderW + 4, cursorY + 4, { width: colNoteW - 8 });
  doc.text('Valor', leftX + colDateW + colOrderW + colNoteW + 4, cursorY + 4, { width: colValueW - 8, align: 'right' });
  cursorY += headerHeight;
      doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();
      // vertical separators
  let sepX = leftX + colDateW;
  doc.moveTo(sepX, topY + 50).lineTo(sepX, bottomY).stroke();
  sepX += colOrderW;
  doc.moveTo(sepX, topY + 50).lineTo(sepX, bottomY).stroke();
  sepX += colNoteW;
  doc.moveTo(sepX, topY + 50).lineTo(sepX, bottomY).stroke();

      doc.font('Helvetica');
      // set the document y to our cursor so subsequent text() without y will continue correctly
      doc.y = cursorY;
    }

    function renderFooter() {
      const footerY = pageHeight - margins.bottom + 10;
      doc.fontSize(9).fillColor('gray').text(`Página ${pageIndex}`, leftX, footerY, { align: 'center', width: usableWidth });
      doc.fillColor('black');
    }

    function newPage() {
      // use `margins` option (plural) when adding a page
      doc.addPage({ size: 'A4', margins });
      pageIndex += 1;
      renderHeader();
    }

    // initial header
    renderHeader();

    // draw rows with pagination
    let totalAmount = 0;
    doc.lineWidth(0.5).strokeColor('#444');
    for (const t of txs) {
      const dt = new Date(t.date);
      const dateStr = dt.toLocaleDateString('pt-BR');
      const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const dateTime = `${dateStr} ${timeStr}`;
  const valueStr = moneyFmt.format(Number(t.amount || 0));
  // use orders.displaySimple (número do pedido) preferentially for the report's "Pedido" column
  const orderStr = (t.order && t.order.displaySimple != null)
    ? String(t.order.displaySimple).padStart(2, '0')
    : (t.order?.displayId ?? t.orderId ?? '-');
  const noteStr = String(t.note || '-');

      // check space
      if (cursorY + rowHeight > bottomY - 30) {
        renderFooter();
        newPage();
        cursorY = doc.y; // reset after header
      }

      // draw horizontal line for row top
      doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();

  // write cells in order: Date, Order, Note, Value
  doc.fontSize(10).text(dateTime, leftX + 4, cursorY + 4, { width: colDateW - 8 });
  doc.text(orderStr, leftX + colDateW + 4, cursorY + 4, { width: colOrderW - 8 });
  doc.text(noteStr, leftX + colDateW + colOrderW + 4, cursorY + 4, { width: colNoteW - 8 });
  // color negative amounts in red
  const amtNum = Number(t.amount || 0);
  if (amtNum < 0) doc.fillColor('red');
  else doc.fillColor('black');
  doc.text(valueStr, leftX + colDateW + colOrderW + colNoteW + 4, cursorY + 4, { width: colValueW - 8, align: 'right' });
  // restore color
  doc.fillColor('black');

      cursorY += rowHeight;

      totalAmount += Number(t.amount || 0);
    }

    // total row
    if (cursorY + rowHeight > bottomY - 30) {
      renderFooter();
      newPage();
      cursorY = doc.y;
    }
    doc.moveTo(leftX, cursorY).lineTo(rightX, cursorY).stroke();
  doc.font('Helvetica-Bold').fontSize(11).text('Total', leftX + 4, cursorY + 6, { width: colDateW + colOrderW + colNoteW - 8 });
  doc.text(moneyFmt.format(totalAmount), leftX + colDateW + colOrderW + colNoteW + 4, cursorY + 6, { width: colValueW - 8, align: 'right' });
    cursorY += rowHeight;

    // final footer
    renderFooter();

    doc.end();
    const pdfBuffer = await finishPromise;

    // Debug: size of generated PDF
    try {
      console.log(`send-report: generated PDF size=${pdfBuffer.length} bytes for rider ${id}`);
    } catch (__e) {}

    // choose instance
    let instanceName = providedInstance;
    if (!instanceName) {
      const inst = await prisma.whatsAppInstance.findFirst({ where: { companyId, status: 'CONNECTED' } });
      if (inst) instanceName = inst.instanceName;
    }
    if (!instanceName) return res.status(400).json({ message: 'Nenhuma instância WhatsApp conectada encontrada. Forneça instanceName.' });

    const filename = `rider-${id}-transactions-${Date.now()}.pdf`;
    const caption = `Relatório de transações do entregador ${rider.name}`;

    // ensure public/reports exists and write file so Evolution can fetch it by URL
    try {
      const reportsDir = path.join(process.cwd(), 'public', 'reports');
      await fs.promises.mkdir(reportsDir, { recursive: true });
      const outPath = path.join(reportsDir, filename);
      await fs.promises.writeFile(outPath, pdfBuffer);

      // build public URL based on request host
      const host = req.get('host');
      const proto = req.protocol || 'https';
      const publicUrl = `${proto}://${host}/public/reports/${encodeURIComponent(filename)}`;

      console.log('send-report: publicUrl for pdf=', publicUrl);

      // If caller only wants the generated URL (test mode), return it and skip sending
      if (body.returnUrlOnly) {
        return res.json({ ok: true, url: publicUrl });
      }

      // Allow overriding the public media URL for testing (mocked public URL)
      // e.g., caller can pass { mockMediaUrl: 'http://example.com/test.pdf' }
      const mediaUrlToSend = body.mockMediaUrl ? String(body.mockMediaUrl) : publicUrl;
      if (body.mockMediaUrl) console.log('send-report: using mocked media URL for send:', mediaUrlToSend);

      // send by URL using evoSendMediaUrl (uses mocked URL if provided)
      const sent = await evoSendMediaUrl({ instanceName, to: toPhone, mediaUrl: mediaUrlToSend, filename, mimeType: 'application/pdf', caption });

      // Optionally remove the file after sending (keep for debugging)
      // await fs.promises.unlink(outPath);

      res.json({ ok: true, result: sent, url: publicUrl });
    } catch (fileErr) {
      console.error('send-report file/save/send error', fileErr);
      return res.status(500).json({ ok: false, message: 'Falha ao salvar/enviar relatório', error: String(fileErr) });
    }
  } catch (e) {
    // Log complete error with stack and response body (if any)
    try {
      console.error('send-report error full:', e);
      if (e?.response?.data) console.error('send-report evo response data:', e.response.data);
      if (e?.stack) console.error('send-report stack:', e.stack);
    } catch (__logErr) {}
    res.status(500).json({ ok: false, message: 'Falha ao gerar/enviar relatório', error: e.response?.data || e.message || String(e) });
  }
});

// PATCH transaction (edit amount/note) - ADMIN only
ridersRouter.patch('/:id/transactions/:txId', requireRole('ADMIN'), async (req, res) => {
  const { id, txId } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const existing = await prisma.riderTransaction.findFirst({ where: { id: txId, riderId: id } });
  if (!existing) return res.status(404).json({ message: 'Transação não encontrada' });

  const { amount, note } = req.body || {};
  const newAmount = typeof amount !== 'undefined' ? Number(amount) : undefined;

  // update tx
  const updated = await prisma.riderTransaction.update({ where: { id: txId }, data: { note: typeof note === 'string' ? note : existing.note, amount: typeof newAmount === 'number' && !isNaN(newAmount) ? newAmount : existing.amount } });

  // adjust account balance by delta
  if (typeof newAmount === 'number' && !isNaN(newAmount)) {
    const delta = Number(newAmount) - Number(existing.amount || 0);
    if (delta !== 0) {
      const acct = await prisma.riderAccount.findUnique({ where: { riderId: id } });
      if (acct) {
        await prisma.riderAccount.update({ where: { riderId: id }, data: { balance: { increment: delta } } });
      } else {
        await prisma.riderAccount.create({ data: { riderId: id, balance: delta } });
      }
    }
  }

  res.json({ ok: true, tx: updated });
});

// Get orders assigned to the authenticated rider (convenience endpoint)
ridersRouter.get('/me/orders', async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { rider: true } });
    if (!user || !user.rider) return res.status(404).json({ message: 'Rider profile not found for this user' });
    const riderId = user.rider.id;
    const orders = await prisma.order.findMany({ where: { riderId, companyId: req.user.companyId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return res.json({ items: orders });
  } catch (e) {
    console.error('GET /riders/me/orders error', e);
    return res.status(500).json({ message: 'Erro ao buscar pedidos do entregador' });
  }
});

// Admin: reset or set rider password (creates linked user if missing)
ridersRouter.post('/:id/reset-password', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  let { password } = req.body || {};

  // generate a random password if none provided
  if (!password) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 10; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
    password = pw;
  }

  try {
    if (rider.userId) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(String(password), 10);
      await prisma.user.update({ where: { id: rider.userId }, data: { password: hash } });
    } else {
      // create linked user
      const fakeEmail = `rider+${rider.id}@${companyId}.local`;
      const user = await createUser({ name: String(rider.name || ''), email: fakeEmail, password: String(password), role: 'RIDER', companyId });
      await prisma.rider.update({ where: { id: rider.id }, data: { userId: user.id } });
    }
    // attempt sending password by WhatsApp if rider has a phone and there is a connected instance
    let waSendResult = null;
    try {
      // destination phone: prefer rider.whatsapp, fall back to explicit phone in body
      const toPhone = (rider.whatsapp && String(rider.whatsapp).trim()) || (req.body && req.body.phone);
      // allow caller to override instanceName
      let instanceName = req.body && req.body.instanceName;
      if (!instanceName) {
        const inst = await prisma.whatsAppInstance.findFirst({ where: { companyId, status: 'CONNECTED' } });
        if (inst) instanceName = inst.instanceName;
      }

      if (toPhone && instanceName) {
        const text = `Olá ${rider.name || ''}, sua nova senha de acesso ao painel é: ${password}\nRecomendamos alterar a senha no primeiro login.`;
        // evoSendText will normalize the phone, but we still validate here
        const normalized = normalizePhone(toPhone);
        if (normalized) {
          waSendResult = await evoSendText({ instanceName, to: toPhone, text }).catch(e => ({ error: String(e) }));
        } else {
          waSendResult = { error: 'Telefone inválido para envio via WhatsApp' };
        }
      }
    } catch (e) {
      console.error('Failed to send reset password via WhatsApp', e);
      waSendResult = { error: String(e) };
    }

  // For security, do NOT return the plaintext password in the API response.
  // The password is sent to the rider's WhatsApp when possible. Return only the
  // WhatsApp send result to avoid leaking credentials to callers.
  res.json({ ok: true, wa: waSendResult });
  } catch (e) {
    console.error('Failed to reset rider password', e);
    res.status(500).json({ ok: false, message: 'Falha ao resetar senha' });
  }
});

// Pay period (create a payment transaction that deducts the period total) - ADMIN only
ridersRouter.post('/:id/account/pay', requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params;
  const companyId = req.user.companyId;
  const rider = await prisma.rider.findFirst({ where: { id, companyId } });
  if (!rider) return res.status(404).json({ message: 'Entregador não encontrado' });

  const { from, to } = req.body || {};

  // parse YYYY-MM-DD as local date
  function parseDateLocal(s) {
    if (!s) return null;
    const str = String(s).trim();
    const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
      return new Date(y, mo - 1, d);
    }
    const dt = new Date(str);
    return isNaN(dt) ? null : dt;
  }

  const where = { riderId: id };
  const fromDate = parseDateLocal(from);
  let toDate = parseDateLocal(to);
  if (fromDate || toDate) {
    where.date = {};
    if (fromDate && !isNaN(fromDate)) where.date.gte = fromDate;
    if (toDate && !isNaN(toDate)) { toDate.setHours(23,59,59,999); where.date.lte = toDate; }
  }

  // fetch matching transactions and sum amounts
  const items = await prisma.riderTransaction.findMany({ where });
  const sum = items.reduce((acc, t) => acc + Number(t.amount || 0), 0);

  if (!sum || Number(sum) === 0) return res.json({ ok: true, message: 'Nenhuma transação para pagar neste período', total: 0 });

  // Create a payment transaction with negative amount to deduct balance
  const note = `Pagamento do período ${from || '-'} → ${to || '-'}`;
  const paymentTx = await riderAccountService.addRiderTransaction({ companyId, riderId: id, amount: -Math.abs(sum), type: 'MANUAL_ADJUSTMENT', date: new Date(), note });

  return res.json({ ok: true, message: 'Pagamento registrado', total: sum, tx: paymentTx });
});