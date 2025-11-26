import dotenv from 'dotenv'; dotenv.config({ path: './delivery-saas-backend/.env' });
import { prisma } from './delivery-saas-backend/src/prisma.js';
(async ()=>{
  try{
    const stores = await prisma.store.findMany({ select: { id: true, name: true, companyId: true } });
    console.log('stores:', JSON.stringify(stores, null, 2));
  } catch(e){ console.error('err', e); }
  process.exit(0);
})();
