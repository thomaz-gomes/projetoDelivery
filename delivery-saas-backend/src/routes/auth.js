import express from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { signToken } from '../auth.js';

export const authRouter = express.Router();

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Informe email e senha' });

  const user = await prisma.user.findUnique({
    where: { email },
    include: { rider: true }
  });
  if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ message: 'Credenciais inválidas' });

  const token = signToken({
    id: user.id,
    role: user.role,
    companyId: user.companyId ?? null,
    riderId: user.rider?.id ?? null,
    name: user.name
  });

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      companyId: user.companyId,
      riderId: user.rider?.id ?? null
    }
  });
});