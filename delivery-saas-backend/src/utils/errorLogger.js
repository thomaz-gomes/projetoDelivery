import crypto from 'crypto';
import { prisma } from '../prisma.js';

function fingerprintFor(message, route) {
  return crypto
    .createHash('sha256')
    .update(`${message || 'unknown'}::${route || 'unknown'}`)
    .digest('hex')
    .slice(0, 16);
}

export async function logError({ err, req = null }) {
  try {
    const message = (err && (err.message || String(err))) || 'unknown error';
    const stack = err && err.stack ? String(err.stack).slice(0, 8000) : null;
    const method = req?.method || null;
    const path = req?.originalUrl || req?.url || null;
    const route = method && path ? `${method} ${path.split('?')[0]}` : null;
    const statusCode = err?.status || err?.statusCode || null;
    const companyId = req?.user?.companyId || null;
    const userId = req?.user?.id || null;
    const fingerprint = fingerprintFor(message, route);
    const now = new Date();

    await prisma.errorLog.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        message: message.slice(0, 1000),
        stack,
        route,
        method,
        statusCode,
        companyId,
        userId,
      },
      update: {
        occurrences: { increment: 1 },
        lastSeen: now,
        resolved: false,
        resolvedAt: null,
        resolvedBy: null,
        // Update stack/statusCode on each occurrence so most-recent context wins.
        stack,
        statusCode,
      },
    });
  } catch (loggingErr) {
    console.error('errorLogger failed:', loggingErr && loggingErr.message);
  }
}

export { fingerprintFor };
