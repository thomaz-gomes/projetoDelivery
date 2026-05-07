/**
 * Marketplace / gateway settlement date calculator.
 *
 * Each PaymentGatewayConfig describes when the merchant actually receives the
 * money. This module turns (orderDate, gatewayConfig) into the date the cash
 * lands in the bank, so the orderFinancialBridge can stamp the right
 * `expectedDate` on the receivable.
 *
 * Schedule types supported:
 *
 *   DAILY      orderDate + settlementDays business days (skip weekends).
 *              Used by cards (D+1, D+30) and PIX (D+0).
 *
 *   WEEKLY     Closes the calendar week ending on
 *              ((periodStartDayOfWeek + 6) % 7), then the *next*
 *              settlementDayOfWeek strictly after that close date.
 *              Default mirror of iFood antecipated: Mon→Sun close, Wed credit.
 *
 *   MONTHLY    Adds settlementMonthlyDelay days to orderDate, then the *next*
 *              settlementDayOfWeek on or after that target date.
 *              Default mirror of iFood non-antecipated: 30d delay, Wed credit.
 *
 * `anticipationEnabled` only controls whether the per-sale anticipation FEE is
 * charged (the WEEKLY schedule already represents the antecipated payout for
 * iFood; switch the schedule type to MONTHLY for the non-antecipated D+30
 * cycle). It does NOT change the settlement date.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addBusinessDays(date, days) {
  const result = startOfDay(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

/**
 * Returns the next date (strictly after `from`) whose day-of-week equals
 * `targetDayOfWeek` (0=Sun..6=Sat). When `inclusive=true`, returns `from`
 * itself if it already falls on the target day.
 */
function nextDayOfWeek(from, targetDayOfWeek, inclusive = false) {
  const d = startOfDay(from);
  const cur = d.getDay();
  let delta;
  if (inclusive && cur === targetDayOfWeek) {
    delta = 0;
  } else {
    delta = (targetDayOfWeek - cur + 7) % 7;
    if (delta === 0) delta = 7;
  }
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * @param {Date|string} orderDate
 * @param {Object} gateway   PaymentGatewayConfig row.
 * @returns {{ expectedDate: Date, isAnticipated: boolean }}
 */
export function calcSettlementDate(orderDate, gateway) {
  const od = startOfDay(orderDate);
  const isAnticipated = Boolean(gateway?.anticipationEnabled);

  const type = String(gateway?.settlementType || 'DAILY').toUpperCase();

  if (type === 'WEEKLY') {
    const periodStart = Number.isInteger(gateway.periodStartDayOfWeek)
      ? gateway.periodStartDayOfWeek
      : 1; // default Monday
    const periodEndDow = (periodStart + 6) % 7; // Sunday when periodStart=Monday
    const settlementDow = Number.isInteger(gateway.settlementDayOfWeek)
      ? gateway.settlementDayOfWeek
      : 3; // default Wednesday

    // Period close = the periodEndDow on/after the order date.
    const periodEnd = nextDayOfWeek(od, periodEndDow, true);
    // Settlement = next settlementDayOfWeek strictly after periodEnd.
    const expected = nextDayOfWeek(periodEnd, settlementDow, false);
    return { expectedDate: expected, isAnticipated };
  }

  if (type === 'MONTHLY') {
    const delay = Number(gateway.settlementMonthlyDelay || 30);
    const settlementDow = Number.isInteger(gateway.settlementDayOfWeek)
      ? gateway.settlementDayOfWeek
      : 3;
    const target = new Date(od.getTime() + delay * DAY_MS);
    const expected = nextDayOfWeek(target, settlementDow, true);
    return { expectedDate: expected, isAnticipated };
  }

  // DAILY (default)
  const days = Number(gateway?.settlementDays || 0);
  return { expectedDate: addBusinessDays(od, days), isAnticipated };
}

/**
 * Computes the period-close date for an order under the gateway's WEEKLY
 * schedule. Used by the settlement aggregator to group all sales of the
 * same week into one repasse.
 */
export function getWeeklyPeriodClose(orderDate, gateway) {
  const periodStart = Number.isInteger(gateway?.periodStartDayOfWeek)
    ? gateway.periodStartDayOfWeek
    : 1;
  const periodEndDow = (periodStart + 6) % 7;
  return nextDayOfWeek(orderDate, periodEndDow, true);
}

// Exported for unit testing
export const __test__ = { addBusinessDays, nextDayOfWeek, startOfDay };
