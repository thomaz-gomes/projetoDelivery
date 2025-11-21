import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function run(){
  try{
    const nbs = await prisma.neighborhood.findMany({})
    for(const n of nbs){
      console.log('name:', n.name, 'deliveryFee:', String(n.deliveryFee), 'aliases:', n.aliases)
    }
  }catch(e){ console.error(e) } finally { await prisma.$disconnect() }
}
run()
