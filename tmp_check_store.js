const { PrismaClient } = require('./delivery-saas-backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const ids = [
    'd9952923-ed61-4294-8166-0935d608c69d',
    '2e25e850-768f-4c5e-ae2c-95e16388b4b8'
  ];

  for (const id of ids) {
    try {
      const s = await prisma.store.findUnique({ where: { id } });
      if (s) {
        console.log(`FOUND: store ${id} -> companyId=${s.companyId} name=${s.name || ''}`);
      } else {
        console.log(`MISSING: store ${id} not found`);
      }
    } catch (err) {
      console.error('ERROR querying store', id, err.message || err);
    }
  }

  await prisma.$disconnect();
})();
