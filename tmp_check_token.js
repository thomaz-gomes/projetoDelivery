const crypto = require('crypto');
const { PrismaClient } = require('./delivery-saas-backend/node_modules/@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const token = 'y9dd_9V7rcREgV6MMok_3QGaIArhZ9x8';
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  console.log('Computed sha256:', hash);

  const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693';
  try {
    const ps = await prisma.printerSetting.findUnique({ where: { companyId } });
    if (!ps) {
      console.log('No PrinterSetting found for companyId', companyId);
    } else {
      console.log('PrinterSetting.agentTokenHash:', ps.agentTokenHash || null);
      console.log('agentTokenCreatedAt:', ps.agentTokenCreatedAt || null);
      console.log('Matches?:', ps.agentTokenHash === hash);
    }
  } catch (err) {
    console.error('Error querying PrinterSetting:', err.message || err);
  }

  await prisma.$disconnect();
})();
