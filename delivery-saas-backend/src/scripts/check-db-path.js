// scripts/check-db-path.js
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import ensureDatabaseUrl from "../configureDatabaseEnv.js";
import { PrismaClient } from "@prisma/client";

// ensure DATABASE_URL is set correctly before instantiating Prisma
ensureDatabaseUrl()
const prisma = new PrismaClient();

// 🔍 Função auxiliar para mostrar info do arquivo
function getFileInfo(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      exists: true,
      size: (stat.size / 1024).toFixed(1) + " KB",
      modified: stat.mtime.toLocaleString(),
    };
  } catch {
    return { exists: false };
  }
}

async function main() {
  console.log("======================================");
  console.log("🔎 VERIFICAÇÃO DO BANCO DE DADOS PRISMA");
  console.log("======================================\n");

  // Caminho do schema e URL
  const schemaPath = path.resolve("prisma/schema.prisma");
  console.log("📄 schema.prisma:", schemaPath);

  const databaseUrl = process.env.DATABASE_URL;
  console.log("🌐 DATABASE_URL:", databaseUrl || "❌ (não definida no .env)");

  // Detecta caminho real do arquivo SQLite
  let dbPath = null;
  if (databaseUrl?.startsWith("file:")) {
    dbPath = databaseUrl.replace("file:", "");
    if (!path.isAbsolute(dbPath)) dbPath = path.resolve(dbPath);
  }

  if (dbPath) {
    const info = getFileInfo(dbPath);
    console.log("\n📁 Caminho real do arquivo SQLite:");
    console.log("   →", dbPath);
    if (info.exists) {
      console.log("   🟢 Existe | Tamanho:", info.size, "| Modificado:", info.modified);
    } else {
      console.log("   🔴 Arquivo não encontrado!");
    }
  }

  console.log("\n🧩 Testando conexão com o Prisma...");

  try {
    const companies = await prisma.company.findMany();
    const orders = await prisma.order.findMany();
    const integrations = await prisma.apiIntegration.findMany();

    console.log("✅ Conexão OK!");
    console.log(`🏢 Empresas: ${companies.length}`);
    console.log(`📦 Pedidos: ${orders.length}`);
    console.log(`🔗 Integrações: ${integrations.length}`);

    if (orders.length > 0) {
      console.log("\n📋 Último pedido salvo:");
      console.log({
        id: orders[0].id,
        displayId: orders[0].displayId,
        customer: orders[0].customerName,
        total: orders[0].total,
        createdAt: orders[0].createdAt,
      });
    }
  } catch (err) {
    console.error("\n❌ Erro ao consultar o banco:");
    console.error(err.message);
  } finally {
    await prisma.$disconnect();
  }

  console.log("\n======================================");
  console.log("🔍 Fim da verificação");
  console.log("======================================");
}

main();