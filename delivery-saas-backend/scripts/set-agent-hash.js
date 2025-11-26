#!/usr/bin/env node
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function main() {
  const hash = process.argv[2] || process.env.AGENT_HASH;
  if (!hash) {
    console.error('Usage: node scripts/set-agent-hash.js <sha256-hex-hash>');
    process.exit(1);
  }

  console.log('Setting agentTokenHash to:', hash);

  const result = await prisma.printerSetting.updateMany({
    data: { agentTokenHash: hash },
  });

  console.log('Updated records:', result.count);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
