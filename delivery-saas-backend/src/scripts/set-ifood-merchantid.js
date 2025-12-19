import ensureDatabaseUrl from '../configureDatabaseEnv.js';
import { PrismaClient } from '@prisma/client';

// Usage: node src/scripts/set-ifood-merchantid.js <companyId> <merchantId|merchantUuid>
// If the second argument looks like a UUID, the script will set `merchantUuid`, otherwise `merchantId`.
async function main(){
  ensureDatabaseUrl();
  const prisma = new PrismaClient();
  const [ , , companyId, merchantId ] = process.argv;
  if(!companyId || !merchantId){
    console.error('Usage: node src/scripts/set-ifood-merchantid.js <companyId> <merchantId>');
    process.exit(1);
  }

  try{
    const integ = await prisma.apiIntegration.findFirst({ where: { companyId, provider: 'IFOOD' }, orderBy: { updatedAt: 'desc' } });
    if(!integ){
      console.error('No IFOOD integration found for company', companyId);
      process.exit(1);
    }

    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(merchantId);
    const data = isUuid ? { merchantUuid: merchantId } : { merchantId };
    const updated = await prisma.apiIntegration.update({ where: { id: integ.id }, data });
    console.log('Updated ApiIntegration id', updated.id, 'applied:', data);
  }catch(e){
    console.error('Error:', e?.message || e);
    process.exit(1);
  }finally{
    await prisma.$disconnect();
  }
}

main();
