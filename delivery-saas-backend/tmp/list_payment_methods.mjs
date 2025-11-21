import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  const methods = await prisma.paymentMethod.findMany();
  console.log(JSON.stringify(methods, null, 2));
} catch (e) {
  console.error(e);
} finally {
  await prisma.$disconnect();
}
