import { prisma } from '../src/prisma.js'

async function run(){
  const id = process.argv[2]
  if (!id) return console.error('Provide order id')
  try{
    const o = await prisma.order.findUnique({ where: { id }, select: { id: true, payload: true, couponCode: true, couponDiscount: true, createdAt: true } })
    console.log(JSON.stringify(o, null, 2))
  }catch(e){ console.error(e) }
  finally{ await prisma.$disconnect() }
}
run()
