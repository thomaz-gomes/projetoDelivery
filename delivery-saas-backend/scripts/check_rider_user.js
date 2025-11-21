import ensureDatabaseUrl from '../src/configureDatabaseEnv.js'
import { PrismaClient } from '@prisma/client';

ensureDatabaseUrl()
const prisma = new PrismaClient();

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node check_rider_user.js <digits>');
    process.exit(2);
  }
  const digits = String(arg).replace(/\D/g, '');
  console.log('Searching for rider user matching digits:', digits);
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { rider: { whatsapp: digits } },
        { rider: { whatsapp: { endsWith: digits } } },
        { rider: { whatsapp: '55' + digits } }
      ]
    },
    include: { rider: true }
  });
  if (!user) {
    console.log('No user found');
  } else {
    console.log('Found user:', {
      id: user.id,
      email: user.email,
      role: user.role,
      riderId: user.rider?.id ?? null,
      riderWhatsapp: user.rider?.whatsapp ?? null,
    });
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
