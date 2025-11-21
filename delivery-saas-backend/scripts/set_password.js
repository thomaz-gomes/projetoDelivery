import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3];
  if (!email || !newPassword) {
    console.error('Usage: node set_password.js <email> <newPassword>');
    process.exit(2);
  }
  const hash = await bcrypt.hash(newPassword, 10);
  const updated = await prisma.user.update({ where: { email }, data: { password: hash } });
  console.log('Updated user', { id: updated.id, email: updated.email });
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
