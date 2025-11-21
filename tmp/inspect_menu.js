import { prisma } from '../delivery-saas-backend/src/prisma.js';

const companyId = 'bd6a5381-6b90-4cc9-bc8f-24890c491693';
const menuId = 'e1ab9318-ee40-4259-b474-5ebd32924be0';
(async()=>{
  try{
    const menu = await prisma.menu.findUnique({ where: { id: menuId }, include: { store: true } })
    console.log('menu', menu ? { id: menu.id, name: menu.name, storeId: menu.storeId } : null)
    const cats = await prisma.menuCategory.findMany({
      where: { companyId, isActive: true, menuId },
      orderBy: { position: 'asc' },
      include: {
        products: {
          where: { isActive: true, menuId },
          include: {
            productOptionGroups: {
              include: {
                group: {
                  include: {
                    options: {
                      include: {
                        linkedProduct: { select: { id: true, isActive: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    })
    console.log('categories count', cats.length)
    for(const c of cats){
      console.log('cat', c.id, c.name, 'products', (c.products||[]).map(p=>({id:p.id,name:p.name})))
    }
    const unc = await prisma.product.findMany({ where: { companyId, categoryId: null, isActive: true, menuId }, orderBy: { position: 'asc' } })
    console.log('uncategorized count', unc.length, unc.map(p=>({id:p.id,name:p.name})))
  }catch(e){console.error(e)}finally{process.exit(0)}
})();