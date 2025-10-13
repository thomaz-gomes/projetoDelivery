// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { authRouter } from './routes/auth.js';
import { ordersRouter } from './routes/orders.js';
import { ticketsRouter } from './routes/tickets.js';
import { webhooksRouter } from './routes/webhooks.js'; // vamos estender este
import { ridersRouter } from './routes/riders.js';
import { waRouter } from './routes/wa.js';
import { customersRouter } from './routes/customers.js';
import { integrationsRouter } from './routes/integrations.js';

const app = express();

/* CORS (igual você já tinha) */
const allowed = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  process.env.FRONTEND_ORIGIN,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Requested-With','X-IFood-Signature','X-Signature'],
  exposedHeaders: ['Content-Type','Authorization'],
}));

/**
 * ⚠️ IMPORTANTE:
 * Para validar assinatura precisamos do RAW body.
 * Só para a rota do webhook usamos express.raw(),
 * no restante do app mantemos express.json().
 */
app.use('/webhooks/ifood', express.raw({ type: '*/*', limit: '2mb' }));

// Demais body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Rotas
app.use('/auth', authRouter);
app.use('/orders', ordersRouter);
app.use('/tickets', ticketsRouter);
app.use('/webhooks', webhooksRouter);     // aqui estará o /webhooks/ifood
app.use('/riders', ridersRouter);
app.use('/wa', waRouter);
app.use('/customers', customersRouter);
app.use('/integrations', integrationsRouter);

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));