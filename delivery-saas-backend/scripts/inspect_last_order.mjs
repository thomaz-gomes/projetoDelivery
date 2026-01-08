import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async function(){
  try{
    const o = await prisma.order.findFirst({ orderBy: { createdAt: 'desc' }, select: { id:true, companyId:true, storeId:true, status:true, address:true, deliveryNeighborhood:true, createdAt:true } });
    console.log(JSON.stringify(o, null, 2));
  }catch(e){ console.error(e); process.exit(1) } finally { await prisma.$disconnect(); }
})();
