import { prisma } from '../prisma.js';

// Returns the id of the first active menu under `storeId`, ordered by
// (position asc, createdAt asc). Used by order-creation paths so every
// order ends up with a menuId even when callers only know the storeId —
// downstream consumers (WhatsApp routing, notify.js {{loja}} placeholder,
// per-menu automations) all rely on menuId being set.
export async function resolveMenuForStore(storeId) {
  if (!storeId) return null;
  const menu = await prisma.menu.findFirst({
    where: { storeId, isActive: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return menu?.id || null;
}
