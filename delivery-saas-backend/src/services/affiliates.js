import { prisma } from '../prisma.js';

/**
 * Check if an order has an affiliate coupon and create affiliate sale record
 * @param {Object} order - The order object with discount/coupon information
 * @param {string} companyId - Company ID to scope the affiliate search
 * @returns {Promise<Object|null>} Created affiliate sale or null if no affiliate coupon
 */
export async function trackAffiliateSale(order, companyId) {
  try {
    // Check if order has discount/coupon information
    const couponCode = extractCouponCode(order);
    console.log('[affiliates] trackAffiliateSale called — orderId=', order && order.id, 'companyId=', companyId, 'couponCode=', couponCode)
    if (!couponCode) {
      console.log('[affiliates] no coupon code found on order', order && order.id)
      return null;
    }

    // Try to find a coupon record first (coupons now hold affiliate linkage).
    // If a coupon exists and references an affiliate, use that affiliate.
    // Fallback: legacy behavior - find affiliate by couponCode stored on affiliate.
    const codeUpper = couponCode.toUpperCase()
    let affiliate = null

    // Find coupon using case-insensitive match so tracking works regardless of stored case
    const coupon = await prisma.coupon.findFirst({ where: { companyId, isActive: true, code: { equals: couponCode, mode: 'insensitive' } }, include: { affiliate: true } })
    if (coupon) console.log('[affiliates] found coupon row', { id: coupon.id, code: coupon.code, affiliateId: coupon.affiliateId })
    if (coupon && coupon.affiliateId && coupon.affiliate) {
      affiliate = coupon.affiliate
      console.log('[affiliates] coupon links to affiliate', { id: affiliate.id, name: affiliate.name, isActive: affiliate.isActive })
    } else {
      // legacy fallback: affiliate table having couponCode field
      console.log('[affiliates] coupon did not link to an affiliate, trying legacy affiliate.couponCode lookup (case-insensitive) for code', couponCode)
      affiliate = await prisma.affiliate.findFirst({
        where: {
          companyId,
          couponCode: { equals: couponCode, mode: 'insensitive' },
          isActive: true
        }
      })
      if (affiliate) console.log('[affiliates] found legacy affiliate by couponCode', { id: affiliate.id, name: affiliate.name })
    }

    if (!affiliate) {
      console.log('[affiliates] No active affiliate found for coupon:', couponCode);
      return null;
    }

    // Calculate sale amount and commission
    const saleAmount = Number(order.total || order.totalAmount || 0);
    console.log('[affiliates] saleAmount computed=', saleAmount)
    if (saleAmount <= 0) {
      console.log('[affiliates] Invalid sale amount for affiliate tracking:', saleAmount)
      return null;
    }

    const commissionAmount = saleAmount * Number(affiliate.commissionRate);
    console.log('[affiliates] affiliate.commissionRate=', affiliate.commissionRate, 'commissionAmount=', commissionAmount)

    // Create affiliate sale record and update balance in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the affiliate sale record
      const affiliateSale = await tx.affiliateSale.create({
        data: {
          affiliateId: affiliate.id,
          orderId: order.id,
          saleAmount,
          commissionRate: affiliate.commissionRate,
          commissionAmount,
          couponCode: (coupon && coupon.code) ? coupon.code : couponCode,
          note: `Venda automática - Pedido ${order.displayId || order.id}`
        }
      });

      // Update affiliate balance
      const updatedAffiliate = await tx.affiliate.update({
        where: { id: affiliate.id },
        data: {
          currentBalance: {
            increment: commissionAmount
          }
        }
      });

      return { affiliateSale, affiliate: updatedAffiliate };
    });

    console.log(`Affiliate sale tracked: ${affiliate.name} earned R$ ${commissionAmount.toFixed(2)} from order ${order.displayId || order.id}`);
    return result;

  } catch (error) {
    console.error('Error tracking affiliate sale:', error);
    return null;
  }
}

/**
 * Extract coupon code from order object
 * Handles different order formats (iFood, Saipos, manual)
 * @param {Object} order - Order object
 * @returns {string|null} Coupon code or null if not found
 */
function extractCouponCode(order) {
  // Check various possible locations for coupon code
  if (order.couponCode) {
    return order.couponCode;
  }

  if (order.discount?.couponCode) {
    return order.discount.couponCode;
  }

  if (order.coupon?.code) {
    return order.coupon.code;
  }

  // Check if there's a discount with a code-like format
  if (order.discounts && Array.isArray(order.discounts)) {
    for (const discount of order.discounts) {
      if (discount.couponCode || discount.code) {
        return discount.couponCode || discount.code;
      }
    }
  }

  // Check order notes/observations for coupon mentions
  const notes = order.notes || order.observations || order.customerNotes || '';
  const couponMatch = notes.match(/cupom:?\s*([A-Z0-9]+)/i);
  if (couponMatch) {
    return couponMatch[1];
  }

  return null;
}

/**
 * Get affiliate sales statistics
 * @param {string} companyId - Company ID
 * @param {Object} options - Filter options (dateFrom, dateTo, affiliateId)
 * @returns {Promise<Object>} Sales statistics
 */
export async function getAffiliateSalesStats(companyId, options = {}) {
  const { dateFrom, dateTo, affiliateId } = options;

  const where = {
    affiliate: { companyId }
  };

  if (affiliateId) {
    where.affiliateId = affiliateId;
  }

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const [sales, totalStats] = await Promise.all([
    // Get individual sales
    prisma.affiliateSale.findMany({
      where,
      include: {
        affiliate: {
          select: { name: true, couponCode: true }
        },
        order: {
          select: { displayId: true, createdAt: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    }),

    // Get aggregated stats
    prisma.affiliateSale.aggregate({
      where,
      _sum: {
        saleAmount: true,
        commissionAmount: true
      },
      _count: true
    })
  ]);

  return {
    sales,
    stats: {
      totalSales: totalStats._count || 0,
      totalSaleAmount: Number(totalStats._sum.saleAmount || 0),
      totalCommissionAmount: Number(totalStats._sum.commissionAmount || 0)
    }
  };
}

/**
 * Process pending affiliate sales for existing orders
 * Useful for backfilling affiliate sales after system implementation
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Processing results
 */
export async function processExistingOrdersForAffiliates(companyId) {
  try {
    // Get active affiliates
    const affiliates = await prisma.affiliate.findMany({
      where: { companyId, isActive: true }
    });

    if (affiliates.length === 0) {
      return { processed: 0, created: 0, errors: 0 };
    }

    // Get orders without affiliate sales
    const orders = await prisma.order.findMany({
      where: {
        companyId,
        affiliateSales: {
          none: {}
        }
      },
      include: {
        affiliateSales: true
      }
    });

    let processed = 0;
    let created = 0;
    let errors = 0;

    for (const order of orders) {
      try {
        processed++;
        const result = await trackAffiliateSale(order, companyId);
        if (result) {
          created++;
        }
      } catch (error) {
        console.error(`Error processing order ${order.id}:`, error);
        errors++;
      }
    }

    console.log(`Processed ${processed} orders, created ${created} affiliate sales, ${errors} errors`);
    return { processed, created, errors };

  } catch (error) {
    console.error('Error processing existing orders for affiliates:', error);
    throw error;
  }
}