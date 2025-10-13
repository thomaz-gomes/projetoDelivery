import express from 'express';
import { pollIFood } from '../integrations/ifood/index.js';
import { authMiddleware, requireRole } from '../auth.js';

export const ifoodRouter = express.Router();

ifoodRouter.use(authMiddleware);
ifoodRouter.post('/poll', requireRole('ADMIN'), async (req, res) => {
  try {
    const events = await pollIFood(req.user.companyId);
    res.json({ ok: true, count: events.length });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});