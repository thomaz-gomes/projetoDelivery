// Role hierarchy: higher roles can see items restricted to lower roles
const ROLE_LEVEL = { MASTER: 5, SUPER_ADMIN: 4, ADMIN: 3, ATTENDANT: 2, RIDER: 1 }

function canAccessRole(userRole, requiredRole) {
  if (!requiredRole) return true
  const userLevel = ROLE_LEVEL[String(userRole || '').toUpperCase()] || 0
  const requiredLevel = ROLE_LEVEL[String(requiredRole).toUpperCase()] || 0
  return userLevel >= requiredLevel
}

export function buildVisibleNav(user, enabledModules, nav) {
  try {
    const role = user && user.role ? String(user.role).toUpperCase() : null;
    if (role === 'SUPER_ADMIN' || role === 'MASTER') {
      const nav = [
        { name: 'SaaS Dashboard', to: '/saas', icon: 'bi bi-grid-3x3-gap' },
        { name: 'Planos', to: '/saas/plans', icon: 'bi bi-list-check' },
        { name: 'Módulos', to: '/saas/modules', icon: 'bi bi-box-seam' },
        { name: 'Empresas', to: '/saas/companies', icon: 'bi bi-building' },
        { name: 'Mensalidades', to: '/saas/billing', icon: 'bi bi-receipt' }
      ];
      if (role === 'MASTER') {
        nav.push({ name: 'Super Admins', to: '/saas/super-admins', icon: 'bi bi-shield-lock' });
      }
      return nav;
    }

    const enabled = (enabledModules || []).map(k => String(k).toLowerCase());
    const isModuleEnabled = (key) => !key || enabled.includes(String(key).toLowerCase());

    return (nav || []).map((item) => {
      // Role hierarchy check: user must have sufficient level
      if (item.role && !canAccessRole(role, item.role)) return null;

      // Module guard: inaccessible items show with locked:true (upgrade badge)
      if (item.moduleKey && !isModuleEnabled(item.moduleKey)) {
        if (item.lockable) {
          return { ...item, locked: true, to: `/store/${item.moduleKey.toLowerCase()}`, children: [] }
        }
        return { ...item, locked: true, children: [] };
      }

      const copy = { ...item };
      if (Array.isArray(copy.children)) {
        copy.children = copy.children.map(c => {
          if (c.role && !canAccessRole(role, c.role)) return null;
          if (c.moduleKey && !isModuleEnabled(c.moduleKey)) {
            if (c.lockable) {
              return { ...c, locked: true, to: `/store/${c.moduleKey.toLowerCase()}` };
            }
            return { ...c, locked: true };
          }
          return c;
        }).filter(Boolean);
        // If parent has no accessible/lockable children, hide the parent
        if (copy.children.length === 0) return null;
      }
      return copy;
    }).filter(Boolean);
  } catch (e) {
    return nav || [];
  }
}
