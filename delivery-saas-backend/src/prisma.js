import "dotenv/config";
import pkg from "@prisma/client";

import path from "path";
import { fileURLToPath } from "url";
import ensureDatabaseUrl from "./configureDatabaseEnv.js";

// Ensure DATABASE_URL is set before instantiating PrismaClient
ensureDatabaseUrl()

const { PrismaClient } = pkg;
export const prisma = new PrismaClient();

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