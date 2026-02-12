// src/routes/wa.js
import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { evoCreateInstance, evoGetStatus, evoGetQr, evoSendText } from '../../wa.js';
import axios from 'axios'; 

export const waRouter = express.Router();
waRouter.use(authMiddleware);

// Criar instância
waRouter.post('/instances', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  // aceitamos opções extras pra evolution
  const {
    instanceName,
    displayName,
    token,
    number,
    integration, // default WHATSAPP-BAILEYS
    qrcode = true,
    rejectCall = true,
    readMessages = true,
    readStatus = true,
    alwaysOnline = true,
    webhook,
    rabbitmq,
    sqs,
    chatwootAccountId,
    chatwootToken,
    chatwootUrl,
    chatwootSignMsg,
    chatwootReopenConversation,
    chatwootConversationPending,
    chatwootImportContacts,
    chatwootNameInbox,
    chatwootMergeBrazilContacts,
    chatwootImportMessages,
    chatwootDaysLimitImportMessages,
    chatwootOrganization,
    chatwootLogo
  } = req.body || {};

  if (!instanceName) return res.status(400).json({ message: 'instanceName é obrigatório' });

  const evo = await evoCreateInstance({
    instanceName,
    token,
    qrcode,
    number,
    integration: integration || 'WHATSAPP-BAILEYS',
    rejectCall,
    readMessages,
    readStatus,
    alwaysOnline,
    webhook,
    rabbitmq,
    sqs,
    chatwootAccountId,
    chatwootToken,
    chatwootUrl,
    chatwootSignMsg,
    chatwootReopenConversation,
    chatwootConversationPending,
    chatwootImportContacts,
    chatwootNameInbox,
    chatwootMergeBrazilContacts,
    chatwootImportMessages,
    chatwootDaysLimitImportMessages,
    chatwootOrganization,
    chatwootLogo
  });

  const instance = await prisma.whatsAppInstance.upsert({
    where: { instanceName },
    update: { displayName: displayName || instanceName, status: 'QRCODE' },
    create: { companyId, instanceName, displayName: displayName || instanceName, status: 'QRCODE' }
  });

  res.status(201).json({ ok: true, instance, evo });
});

// Status
waRouter.get('/instances/:name/status', requireRole('ADMIN'), async (req, res) => {
  const { name } = req.params;
  const evo = await evoGetStatus(name);
  const status = (evo?.status || 'UNKNOWN').toUpperCase();
  await prisma.whatsAppInstance.update({ where: { instanceName: name }, data: { status } }).catch(() => {});
  res.json({ status, raw: evo });
});

// QR com proteção
waRouter.get('/instances/:name/qr', requireRole('ADMIN'), async (req, res) => {
  const { name } = req.params;
  try {
    const st = await evoGetStatus(name);
    if (st.status === 'CONNECTED') return res.status(204).send();
    const qr = await evoGetQr(name);
    res.json(qr);
  } catch (e) {
    res.status(e.response?.status || 500).json({ ok: false, message: 'Falha ao obter QR', error: e.response?.data || e.message });
  }
});
// Listar
waRouter.get('/instances', requireRole('ADMIN'), async (req, res) => {
  const companyId = req.user.companyId;
  const instances = await prisma.whatsAppInstance.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' }
  });
  res.json(instances);
});

// Enviar texto
waRouter.post('/instances/:name/send-text', requireRole('ADMIN'), async (req, res) => {
  const { name } = req.params;
  const { to, text } = req.body || {};
  if (!to || !text) return res.status(400).json({ message: 'to e text são obrigatórios' });
  const r = await evoSendText({ instanceName: name, to, text });
  res.json({ ok: true, result: r });
});

// 🗑️ Deletar instância Evolution + remover do banco local
waRouter.delete('/instances/:name', requireRole('ADMIN'), async (req, res) => {
  const { name } = req.params;

  try {
    // 🔹 Apagar na Evolution API
    const evoUrl = `${process.env.EVOLUTION_API_BASE_URL}/instance/delete/${encodeURIComponent(name)}`;
    const { data } = await axios.delete(evoUrl, {
      headers: { apikey: process.env.EVOLUTION_API_API_KEY },
    });

    // 🔹 Apagar no banco local (não é erro se não existir)
    await prisma.whatsAppInstance.deleteMany({ where: { instanceName: name } });

    res.json({
      ok: true,
      message: `Instância ${name} excluída com sucesso.`,
      evo: data,
    });
  } catch (err) {
    console.error('Erro ao excluir instância:', err.response?.data || err.message);
    res.status(500).json({
      ok: false,
      message: 'Erro ao excluir instância',
      error: err.response?.data || err.message,
    });
  }
});