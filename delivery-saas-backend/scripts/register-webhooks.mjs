import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const BASE = process.env.EVOLUTION_API_BASE_URL;
const KEY = process.env.EVOLUTION_API_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || process.env.BASE_URL;

if (!BASE || !KEY || !BACKEND_URL) {
  console.error('Set EVOLUTION_API_BASE_URL, EVOLUTION_API_API_KEY, BACKEND_URL');
  process.exit(1);
}

const instances = await prisma.whatsAppInstance.findMany();
console.log(`Found ${instances.length} instances`);

for (const inst of instances) {
  try {
    await axios.put(
      `${BASE}/webhook/set/${encodeURIComponent(inst.instanceName)}`,
      {
        url: `${BACKEND_URL}/webhook/evolution`,
        webhook_by_events: true,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'],
      },
      { headers: { apikey: KEY } }
    );
    console.log(`✅ ${inst.instanceName}`);
  } catch (e) {
    console.error(`❌ ${inst.instanceName}: ${e.message}`);
  }
}

await prisma.$disconnect();
