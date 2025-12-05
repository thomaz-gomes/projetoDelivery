// Shared date formatting utilities
export function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') return new Date(val);
  try { return new Date(val); } catch (e) { return null; }
}

function pad(n) { return String(n).padStart(2, '0'); }

export function formatDate(d) {
  const dt = parseDate(d);
  if (!dt) return '-';
  return `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()}`;
}

export function formatTime(d) {
  const dt = parseDate(d);
  if (!dt) return '-';
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

export function formatDateTime(d) {
  const dt = parseDate(d);
  if (!dt) return '-';
  // Return date + time in format dd/mm/YYYY HH:MM
  return `${formatDate(dt)} ${formatTime(dt)}`;
}

export function formatDateShort(d) {
  // For consistency return full date in dd/mm/YYYY
  return formatDate(d);
}
