import express from 'express';
import { prisma } from '../prisma.js';
import { authMiddleware } from '../auth.js';

export const ridersRouter = express.Router();
ridersRouter.use(authMiddleware);

ridersRouter.get('/', async (req, res) => {
  const companyId = req.user.companyId;
  const riders = await prisma.rider.findMany({
    where: { companyId },
    select: { id: true, name: true, whatsapp: true }
  });
  res.json(riders);
});