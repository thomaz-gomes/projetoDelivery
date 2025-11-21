import ensureDatabaseUrl from '../src/configureDatabaseEnv.js'
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

ensureDatabaseUrl()
const prisma = new PrismaClient();

async function main(){
  const digits = process.argv[2] || '73991429676';
  const user = await prisma.user.findFirst({ where: { OR: [ { rider: { whatsapp: digits } }, { rider: { whatsapp: { endsWith: digits } } }, { rider: { whatsapp: '55' + digits } } ] }, include: { rider: true } });
  if(!user){ console.log('no user found'); process.exit(0); }
  console.log('found user', user.id, user.email, 'riderWhatsapp=', user.rider?.whatsapp);
  const ok = await bcrypt.compare('rider123', user.password);
  console.log('bcrypt compare with rider123:', ok);
  await prisma.$disconnect();
}

main().catch(e=>{ console.error(e); process.exit(1); });
