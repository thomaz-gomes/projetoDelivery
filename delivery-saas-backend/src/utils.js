import crypto from 'crypto';

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function generateQrSig(orderId, action = 'assign') {
  const secret = process.env.QR_SIGN_SECRET || (process.env.JWT_SECRET || 'dev-qr-secret');
  return crypto.createHmac('sha256', secret).update(`${orderId}|${action}`).digest('hex');
}

export function generateQrUrl(orderId, action = 'assign') {
  const base = process.env.QR_ACTION_BASE_URL || process.env.PUBLIC_API_URL || process.env.SERVER_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const sig = generateQrSig(orderId, action);
  const cleanBase = String(base).replace(/\/$/, '');
  return `${cleanBase}/qr-action?orderId=${encodeURIComponent(orderId)}&action=${encodeURIComponent(action)}&sig=${sig}`;
}

export function verifyQrSig(orderId, action = 'assign', sig) {
  if (!sig) return false;
  const expected = generateQrSig(orderId, action);
  return expected === sig;
}

export function sanitizeCoords(lat, lng) {
  const okLat = Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null;
  const okLng = Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null;
  return { lat: okLat, lng: okLng };
}