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

// Format date as `dd/mm/YYYY` or `dd/mm/YYYY às HH:MM` when the original
// value (string) contains a time component. If a Date/number is provided
// we include the time only when hours/minutes are non-zero.
export function formatDateWithOptionalTime(val) {
  if (!val) return '-';
  const dt = parseDate(val);
  if (!dt) return '-';

  const isString = typeof val === 'string';
  let hasTime = false;
  if (isString) {
    // detect time in common ISO or datetime-like strings
    hasTime = /T.*\d{2}:\d{2}|\d{2}:\d{2}/.test(val);
  } else {
    // if a Date/number, include time only when not midnight
    hasTime = !(dt.getHours() === 0 && dt.getMinutes() === 0 && dt.getSeconds() === 0);
  }

  if (hasTime) return `${formatDate(dt)} às ${formatTime(dt)}`;
  return formatDate(dt);
}
