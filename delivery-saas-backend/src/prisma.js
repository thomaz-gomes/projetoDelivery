import "dotenv/config";
import pkg from "@prisma/client";

import path from "path";
import { fileURLToPath } from "url";
import ensureDatabaseUrl from "./configureDatabaseEnv.js";

// Ensure DATABASE_URL is set before instantiating PrismaClient
ensureDatabaseUrl()

const { PrismaClient } = pkg;
const _prisma = new PrismaClient();

// Auto-generate integrationCode on every Product/Option create when the
// caller didn't supply one. Centralized here so importers, copy routes,
// AI imports, seeds, and any future code path all inherit the rule
// without each file having to remember it.
async function _ensureProductCode(companyId) {
  if (!companyId) return null;
  const { generateProductCode } = await import('./utils/integrationCode.js');
  return generateProductCode(companyId);
}
async function _ensureOptionCode(groupId) {
  if (!groupId) return null;
  const { generateOptionCode } = await import('./utils/integrationCode.js');
  return generateOptionCode(groupId);
}

export const prisma = _prisma.$extends({
  query: {
    product: {
      async create({ args, query }) {
        if (!args.data?.integrationCode && args.data?.companyId) {
          const code = await _ensureProductCode(args.data.companyId);
          if (code) args.data.integrationCode = code;
        }
        return query(args);
      },
      async createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          for (const row of args.data) {
            if (!row.integrationCode && row.companyId) {
              const code = await _ensureProductCode(row.companyId);
              if (code) row.integrationCode = code;
            }
          }
        }
        return query(args);
      },
    },
    option: {
      async create({ args, query }) {
        if (!args.data?.integrationCode && args.data?.groupId) {
          const code = await _ensureOptionCode(args.data.groupId);
          if (code) args.data.integrationCode = code;
        }
        return query(args);
      },
      async createMany({ args, query }) {
        if (Array.isArray(args.data)) {
          for (const row of args.data) {
            if (!row.integrationCode && row.groupId) {
              const code = await _ensureOptionCode(row.groupId);
              if (code) row.integrationCode = code;
            }
          }
        }
        return query(args);
      },
    },
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function maskDatabaseUrl(raw) {
	try {
		if (!raw) return '<not set>'
		const u = new URL(raw)
		const user = u.username ? `${u.username}:****@` : ''
		return `${u.protocol}//${user}${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}${u.search || ''}`
	} catch (e) {
		// fallback: hide credentials between // and @ if present
		return raw.replace(/:\/\/(.*?):.*?@/, '://$1:****@')
	}
}

console.log("🔍 Prisma carregado de:", __dirname);
function summarizeDatabaseUrl(raw) {
	try {
		if (!raw) return '<not set>'
		const u = new URL(raw)
		// return protocol, host, port and path/search but omit credentials
		return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}${u.pathname}${u.search || ''}`
	} catch (e) {
		// fallback to masked form if parsing fails
		return maskDatabaseUrl(raw)
	}
}

console.log("🗄️ DATABASE_HOST/DB em uso:", summarizeDatabaseUrl(process.env.DATABASE_URL));