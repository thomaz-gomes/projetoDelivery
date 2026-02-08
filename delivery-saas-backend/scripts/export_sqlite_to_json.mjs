import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

// Script: export_sqlite_to_json.mjs
// Usage:
// 1) From delivery-saas-backend folder run:
//    npm ci
//    npx prisma generate
// 2) Then run:
//    node scripts/export_sqlite_to_json.mjs
// It will create `scripts/exported/<Model>.json` and `prisma/seed_export.json`.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outDir = path.join(__dirname, 'exported');
const prisma = new PrismaClient();

async function readModelNamesFromSchema() {
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const raw = await fs.readFile(schemaPath, 'utf8');
  const modelNames = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^model\s+([A-Za-z0-9_]+)/);
    if (m) modelNames.push(m[1]);
  }
  return modelNames;
}

function modelAccessorName(modelName) {
  // prisma client property is model name with first letter lowercased
  return modelName[0].toLowerCase() + modelName.slice(1);
}

async function exportAll() {
  await fs.mkdir(outDir, { recursive: true });
  const modelNames = await readModelNamesFromSchema();
  const exportObj = {};
  for (const modelName of modelNames) {
    const accessor = modelAccessorName(modelName);
    if (!prisma[accessor]) {
      console.warn(`Skipping model ${modelName} — no client accessor ${accessor}`);
      continue;
    }
    try {
      const rows = await prisma[accessor].findMany();
      await fs.writeFile(path.join(outDir, `${modelName}.json`), JSON.stringify(rows, null, 2), 'utf8');
      exportObj[modelName] = rows;
      console.log(`Exported ${modelName}: ${rows.length} rows`);
    } catch (err) {
      console.error(`Failed to export ${modelName}:`, err.message);
    }
  }
  const seedPath = path.join(__dirname, '..', 'prisma', 'seed_export.json');
  await fs.writeFile(seedPath, JSON.stringify(exportObj, null, 2), 'utf8');
  console.log(`Wrote merged seed to ${seedPath}`);
}

exportAll()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
