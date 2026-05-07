export const TAKEOUT_TYPES = [
  'RETIRADA',
  'TAKEOUT',
  'TAKE-OUT',
  'PICKUP',
  'PICK-UP',
  'BALCAO',
  'BALCÃO',
  'INDOOR',
];

export function isTakeoutOrderType(orderType) {
  if (!orderType) return false;
  return TAKEOUT_TYPES.includes(String(orderType).toUpperCase());
}
