export async function getAffiliateIfOwned(prismaClient, id, companyId) {
  if (!id || !companyId) return null;
  try {
    const aff = await prismaClient.affiliate.findFirst({ where: { id, companyId } });
    return aff || null;
  } catch (e) {
    console.error('getAffiliateIfOwned error', e && e.message);
    return null;
  }
}

export default { getAffiliateIfOwned };
