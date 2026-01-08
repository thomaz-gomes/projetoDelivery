import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run(){
  try{
    const o = await prisma.order.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true, address: true, deliveryNeighborhood: true, payload: true, createdAt: true }
    });
    console.log(JSON.stringify(o, null, 2));
  }catch(e){
    console.error('Failed to query last order', e && (e.message || e));
    process.exit(2);
  } finally {
    await prisma.$disconnect();
  }
}
run();
