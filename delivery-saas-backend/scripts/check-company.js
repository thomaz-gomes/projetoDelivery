const { PrismaClient } = require('../node_modules/@prisma/client');
(async () => {
  try {
    const prisma = new PrismaClient();
    const c = await prisma.company.findFirst({ select: { id: true, name: true, evolutionEnabled: true } });
    console.log('company:', JSON.stringify(c, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error('error:', e && e.message);
    process.exit(1);
  }
})();
