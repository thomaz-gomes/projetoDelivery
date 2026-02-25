// src/routes/wa.js
import express from 'express';
import { prisma } from '../../prisma.js';
import { authMiddleware, requireRole } from '../../auth.js';
import { evoCreateInstance, evoGetStatus, evoGetQr, evoSendText } from '../../wa.js';
import axios from 'axios';

export const waRouter = express.Router();
waRouter.use(authMiddleware);

// Criar instância (verifica toggle por empresa)
waRouter.post('/instances', requireRole('ADMIN'), async (req, res) => {
	const companyId = req.user.companyId;
	const {
		instanceName,
		displayName,
		token,
		number,
		integration,
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

	try {
		const cmp = await prisma.company.findUnique({ where: { id: companyId }, select: { evolutionEnabled: true } });
		if (!cmp || !cmp.evolutionEnabled) return res.status(403).json({ ok: false, message: 'Integração Evolution/WhatsApp está desativada para esta empresa' });

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
	} catch (err) {
		console.error('Erro criando instância WhatsApp:', err.response || err.message || err);
		const statusCode = err.response?.status || 500;
		const message = err.response?.message || err.message || 'Erro interno ao criar instância';
		return res.status(statusCode).json({ ok: false, message, error: err.response || String(err) });
	}
});

// Company-level settings for WhatsApp/Evolution module
waRouter.get('/settings', requireRole('ADMIN'), async (req, res) => {
	const companyId = req.user.companyId;
	const cmp = await prisma.company.findUnique({ where: { id: companyId }, select: { evolutionEnabled: true } });
	res.json({ evolutionEnabled: !!(cmp && cmp.evolutionEnabled) });
});

waRouter.put('/settings', requireRole('ADMIN'), async (req, res) => {
	const companyId = req.user.companyId;
	const { evolutionEnabled } = req.body || {};
	if (typeof evolutionEnabled !== 'boolean') return res.status(400).json({ message: 'evolutionEnabled deve ser booleano' });
	const updated = await prisma.company.update({ where: { id: companyId }, data: { evolutionEnabled } });
	res.json({ ok: true, evolutionEnabled: !!updated.evolutionEnabled });
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

// Atribuir uma instância a várias lojas (ou a todas). Uma loja só pode ter UMA instância.
// Body: { storeIds: ["id1","id2"] } ou { all: true }
waRouter.post('/instances/:name/assign-stores', requireRole('ADMIN'), async (req, res) => {
	const companyId = req.user.companyId;
	const { name } = req.params;
	const { storeIds, all } = req.body || {};

	const instance = await prisma.whatsAppInstance.findUnique({ where: { instanceName: name } });
	if (!instance || instance.companyId !== companyId) return res.status(404).json({ message: 'Instância não encontrada para esta empresa' });

	let stores = [];
	if (all) {
		stores = await prisma.store.findMany({ where: { companyId }, select: { id: true, whatsappInstanceId: true } });
	} else {
		if (!Array.isArray(storeIds) || storeIds.length === 0) return res.status(400).json({ message: 'storeIds obrigatório ou use all: true' });
		stores = await prisma.store.findMany({ where: { id: { in: storeIds }, companyId }, select: { id: true, whatsappInstanceId: true } });
		if (stores.length !== storeIds.length) return res.status(404).json({ message: 'Uma ou mais lojas não foram encontradas' });
	}

	const conflicts = stores.filter(s => s.whatsappInstanceId && s.whatsappInstanceId !== instance.id).map(s => s.id);
	if (conflicts.length > 0) return res.status(409).json({ ok: false, message: 'Algumas lojas já têm outra instância atribuída', conflictStoreIds: conflicts });

	const idsToUpdate = stores.map(s => s.id);
	if (idsToUpdate.length === 0) return res.json({ ok: true, assignedStoreIds: [] });

	await prisma.store.updateMany({ where: { id: { in: idsToUpdate } }, data: { whatsappInstanceId: instance.id } });

	res.json({ ok: true, assignedStoreIds: idsToUpdate });
});

// Enviar texto (verifica toggle por empresa da instância)
waRouter.post('/instances/:name/send-text', requireRole('ADMIN'), async (req, res) => {
	const { name } = req.params;
	const { to, text } = req.body || {};
	if (!to || !text) return res.status(400).json({ message: 'to e text são obrigatórios' });
	const inst = await prisma.whatsAppInstance.findUnique({ where: { instanceName: name }, select: { companyId: true } });
	if (!inst) return res.status(404).json({ message: 'Instância não encontrada' });
	const cmp = await prisma.company.findUnique({ where: { id: inst.companyId }, select: { evolutionEnabled: true } });
	if (!cmp || !cmp.evolutionEnabled) return res.status(403).json({ ok: false, message: 'Integração Evolution/WhatsApp desativada para a empresa desta instância' });

	const r = await evoSendText({ instanceName: name, to, text });
	res.json({ ok: true, result: r });
});

// 🗑️ Deletar instância Evolution + remover do banco local
waRouter.delete('/instances/:name', requireRole('ADMIN'), async (req, res) => {
	const { name } = req.params;

	let evoResult = null;
	let evoError = null;

	// Attempt to call Evolution API only if base URL is configured
	if (process.env.EVOLUTION_API_BASE_URL) {
		try {
			const evoUrl = `${process.env.EVOLUTION_API_BASE_URL.replace(/\/$/, '')}/instance/delete/${encodeURIComponent(name)}`;
			const { data } = await axios.delete(evoUrl, {
				headers: { apikey: process.env.EVOLUTION_API_API_KEY },
				timeout: 10000,
			});
			evoResult = { ok: true, data };
		} catch (err) {
			// capture details but do not fail the whole operation
			evoError = {
				message: err.message,
				status: err.response?.status || null,
				body: err.response?.data || null,
			};
			console.warn('wa: Evolution delete failed for', name, evoError);
		}
	} else {
		evoError = { message: 'EVOLUTION_API_BASE_URL not configured' };
		console.warn('wa: skipping Evolution delete because EVOLUTION_API_BASE_URL is not set');
	}

	// Always attempt to remove local record(s)
	try {
		await prisma.whatsAppInstance.deleteMany({ where: { instanceName: name } });
	} catch (dbErr) {
		console.error('wa: failed to delete local whatsAppInstance for', name, dbErr && dbErr.message);
		return res.status(500).json({ ok: false, message: 'Erro ao excluir instância local', error: dbErr && dbErr.message });
	}

	// Return combined result: local deletion succeeded, include Evolution result or error
	return res.json({ ok: true, message: `Instância ${name} excluída localmente.`, evo: evoResult, evoError });
});

