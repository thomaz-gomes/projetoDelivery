import "dotenv/config";
import pkg from "@prisma/client";

import path from "path";
import { fileURLToPath } from "url";

const { PrismaClient } = pkg;
export const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log("🔍 Prisma carregado de:", __dirname);
console.log("🗄️ DATABASE_URL em uso:", process.env.DATABASE_URL);