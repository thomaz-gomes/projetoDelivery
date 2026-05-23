import { prisma } from '../prisma.js';

// Returns the id of the first active menu under `storeId`, ordered by
// (position asc, createdAt asc). Used by order-creation paths so every
// order ends up with a menuId even when callers only know the storeId —
// downstream consumers (WhatsApp routing, notify.js {{loja}} placeholder,
// per-menu automations) all rely on menuId being set.
//
// When `merchantHint` is provided (e.g. iFood merchantName) and the store
// has multiple active menus, prefer the menu whose name best matches the
// hint — this prevents iFood-style integrations from cross-tagging orders
// from Cardápio A as belonging to Cardápio B and routing the customer's
// WhatsApp notifications to the wrong brand's Cloud API / Evolution
// instance. Falls back to first-by-position when no hint match is found.
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export async function resolveMenuForStore(storeId, { merchantHint } = {}) {
  if (!storeId) return null;
  const menus = await prisma.menu.findMany({
    where: { storeId, isActive: true },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  });
  if (!menus.length) return null;
  if (menus.length === 1) return menus[0].id;

  if (merchantHint) {
    const hint = norm(merchantHint);
    if (hint) {
      const exact = menus.find(m => norm(m.name) === hint);
      if (exact) return exact.id;
      const contained = menus.find(m => {
        const mn = norm(m.name);
        return mn && (hint.includes(mn) || mn.includes(hint));
      });
      if (contained) return contained.id;
    }
    console.warn('[resolveMenuForStore] multiple menus and no hint match — falling back to first by position', {
      storeId, merchantHint, picked: menus[0].name, candidates: menus.map(m => m.name),
    });
  }

  return menus[0].id;
}
