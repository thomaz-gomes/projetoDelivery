export function buildVisibleNav(user, enabledModules, nav) {
  try {
    const role = user && user.role ? String(user.role).toUpperCase() : null;
    if (role === 'SUPER_ADMIN') {
      return [
        { name: 'SaaS Dashboard', to: '/saas', icon: 'bi bi-grid-3x3-gap' },
        { name: 'Planos', to: '/saas/plans', icon: 'bi bi-list-check' },
        { name: 'Módulos', to: '/saas/modules', icon: 'bi bi-box-seam' },
        { name: 'Empresas', to: '/saas/companies', icon: 'bi bi-building' },
        { name: 'Mensalidades', to: '/saas/billing', icon: 'bi bi-receipt' }
      ];
    }

    const enabled = (enabledModules || []).map(k => String(k).toLowerCase());
    const isModuleEnabled = (key) => !key || enabled.includes(String(key).toLowerCase());

    return (nav || []).map((item) => {
      if (item.role && role !== String(item.role).toUpperCase()) return null;
      if (item.moduleKey && !isModuleEnabled(item.moduleKey)) return null;
      const copy = { ...item };
      if (Array.isArray(copy.children)) {
        copy.children = copy.children.filter(c => {
          if (c.role && String(c.role).toUpperCase() !== role) return false;
          if (c.moduleKey && !isModuleEnabled(c.moduleKey)) return false;
          return true;
        });
        if (copy.children.length === 0) return null;
      }
      return copy;
    }).filter(Boolean);
  } catch (e) {
    return nav || [];
  }
}
