import 'dotenv/config';            // <-- garante que .env está carregado
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();