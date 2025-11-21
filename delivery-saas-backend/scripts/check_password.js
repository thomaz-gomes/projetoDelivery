import ensureDatabaseUrl from '../src/configureDatabaseEnv.js'
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

ensureDatabaseUrl()
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error('Usage: node check_password.js <email> <password>');
    process.exit(2);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log('User not found for email', email);
    process.exit(0);
  }
  console.log('User found, id=', user.id);
  const ok = await bcrypt.compare(password, user.password);
  console.log('Password match:', ok);
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
