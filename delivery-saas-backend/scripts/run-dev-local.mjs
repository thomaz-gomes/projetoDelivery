#!/usr/bin/env node
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure we run from the backend package directory (parent of scripts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
try {
  process.chdir(backendRoot);
} catch (e) {
  // if chdir fails, continue using current working directory and warn
  console.warn('Could not chdir to backend root, continuing in', process.cwd(), e && e.message);
}

// Force NODE_ENV=development
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// If DATABASE_URL is not explicitly set or is not a sqlite url, prefer local sqlite dev file
if (!process.env.DATABASE_URL || !(process.env.DATABASE_URL.startsWith('file:') || process.env.DATABASE_URL.startsWith('sqlite:'))) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
  console.log('🔧 [dev-local] Forçando DATABASE_URL ->', process.env.DATABASE_URL);
} else {
  console.log('🔧 [dev-local] Usando DATABASE_URL existente ->', process.env.DATABASE_URL);
}

try {
  console.log('🔁 Executando: npx prisma generate');
  execSync('npx prisma generate', { stdio: 'inherit' });
  console.log('🔁 Executando: npx prisma db push');
  execSync('npx prisma db push', { stdio: 'inherit' });
  // Run seed scripts to provide a usable dev account and SaaS data
  try {
    console.log('🔁 Executando: node scripts/seed_super_admin.mjs');
    execSync('node scripts/seed_super_admin.mjs', { stdio: 'inherit' });
  } catch (e) {
    console.warn('seed_super_admin failed (continuing):', e && e.message);
  }
  try {
    console.log('🔁 Executando: node scripts/seed_demo_company.mjs');
    execSync('node scripts/seed_demo_company.mjs', { stdio: 'inherit' });
  } catch (e) {
    console.warn('seed_demo_company failed (continuing):', e && e.message);
  }
  try {
    console.log('🔁 Executando: node scripts/seed_saas.mjs');
    execSync('node scripts/seed_saas.mjs', { stdio: 'inherit' });
  } catch (e) {
    console.warn('seed_saas failed (continuing):', e && e.message);
  }
  console.log('🔁 Iniciando servidor em modo dev (npm run dev)');
  execSync('npm run dev', { stdio: 'inherit' });
} catch (e) {
  console.error('❌ Falha ao executar dev:local script', e && e.message);
  process.exit(1);
}
