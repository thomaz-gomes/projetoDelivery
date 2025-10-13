import crypto from 'crypto';

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function sanitizeCoords(lat, lng) {
  const okLat = Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null;
  const okLng = Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null;
  return { lat: okLat, lng: okLng };
}