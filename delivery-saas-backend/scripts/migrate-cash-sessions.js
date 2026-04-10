import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function migrate() {
  // Find sessions that need migration (ownerId might be empty/null for existing records)
  const sessions = await prisma.cashSession.findMany({
    where: { ownerId: null },  // Nullable field — null for existing records before migration
  });

  let migrated = 0;
  for (const s of sessions) {
    try {
      await prisma.cashSession.update({
        where: { id: s.id },
        data: {
          ownerId: s.openedBy,
          label: 'Caixa',
          channels: ['BALCAO', 'IFOOD', 'AIQFOME', 'WHATSAPP'],
        },
      });
      migrated++;
    } catch (e) {
      console.error(`Failed to migrate session ${s.id}:`, e.message);
    }
  }

  console.log(`Migrated ${migrated} of ${sessions.length} cash sessions`);
  await prisma.$disconnect();
}

migrate().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
