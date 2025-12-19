import 'dotenv/config'
import pkg from '@prisma/client'
const { PrismaClient } = pkg
const prisma = new PrismaClient()
async function main(){
  console.log('DB URL:', process.env.DATABASE_URL)
  const users = await prisma.user.findMany({ take: 1 })
  console.log('users:', users)
}
main().then(()=>process.exit()).catch(e=>{console.error(e); process.exit(1)})
