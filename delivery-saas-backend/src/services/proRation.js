// Pro-ration utility for module subscription billing

export function calculateProRation(fullPrice, period, startDate = new Date()) {
  const start = new Date(startDate)
  const periodMonths = period === 'ANNUAL' ? 12 : 1
  const nextDueAt = new Date(start)
  nextDueAt.setMonth(nextDueAt.getMonth() + periodMonths)
  const totalDays = Math.ceil((nextDueAt - start) / (1000 * 60 * 60 * 24))
  const remainingDays = totalDays // first cycle = full cycle
  const proRatedPrice = Number(((fullPrice / totalDays) * remainingDays).toFixed(2))
  return { proRatedPrice, nextDueAt }
}
