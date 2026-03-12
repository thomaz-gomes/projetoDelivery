import { Router } from 'express';
import { prisma } from '../prisma.js';

const router = Router();

router.post('/leads', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'name and phone are required' });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (cleanPhone.length < 10 || cleanPhone.length > 13) {
      return res.status(400).json({ error: 'Invalid phone number' });
    }
    const lead = await prisma.lead.create({
      data: { name: String(name).trim(), phone: cleanPhone, source: 'landing' }
    });
    return res.json({ ok: true, id: lead.id });
  } catch (err) {
    console.error('POST /public/leads error:', err);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
});

export default router;