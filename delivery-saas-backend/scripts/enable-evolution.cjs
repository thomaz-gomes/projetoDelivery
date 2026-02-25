const { PrismaClient } = require('@prisma/client');
(async () => {
  try {
    const prisma = new PrismaClient();
    const name = process.argv[2] || 'Demo Lanchonete';
    const found = await prisma.company.findFirst({ where: { name } });
    if (!found) {
      console.log('Company not found by name:', name);
      const all = await prisma.company.findMany({ select: { id: true, name: true, evolutionEnabled: true } });
      console.log('Companies:');
      console.log(JSON.stringify(all, null, 2));
      await prisma.$disconnect();
      process.exit(0);
    }
    console.log('Found company:', JSON.stringify(found, null, 2));
    const updated = await prisma.company.update({ where: { id: found.id }, data: { evolutionEnabled: true } });
    console.log('Updated company:', JSON.stringify(updated, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e && e.message);
    process.exit(1);
  }
})();
