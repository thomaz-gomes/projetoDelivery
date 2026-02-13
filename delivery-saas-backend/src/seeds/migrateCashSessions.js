/**
 * Migração: cashSessions.json → Prisma (CashSession + CashMovement)
 *
 * Uso: node src/seeds/migrateCashSessions.js
 *
 * Idempotente: verifica se o ID já existe antes de criar.
 * Cria backup do arquivo original antes de migrar.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'cashSessions.json');

function normalizeMovementType(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('retir') || t.includes('withdraw')) return 'WITHDRAWAL';
  if (t.includes('refor') || t.includes('reinfor') || t.includes('refo')) return 'REINFORCEMENT';
  return 'ADJUSTMENT';
}

async function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.log('Arquivo cashSessions.json não encontrado. Nada a migrar.');
    return;
  }

  // Backup
  const backupPath = FILE_PATH + '.backup.' + Date.now();
  fs.copyFileSync(FILE_PATH, backupPath);
  console.log(`Backup criado: ${backupPath}`);

  const raw = fs.readFileSync(FILE_PATH, 'utf8');
  const data = JSON.parse(raw || '{"sessions":[]}');
  const sessions = data.sessions || [];

  console.log(`Encontradas ${sessions.length} sessões para migrar.`);

  let created = 0;
  let skipped = 0;

  for (const s of sessions) {
    // Verificar se já existe
    const existing = await prisma.cashSession.findUnique({ where: { id: s.id } });
    if (existing) {
      skipped++;
      continue;
    }

    // Parse closingSummary
    let closingSummary = s.closingSummary;
    if (typeof closingSummary === 'string') {
      try { closingSummary = JSON.parse(closingSummary); } catch (e) { /* keep as-is */ }
    }

    const declaredValues = closingSummary?.counted || null;
    const closingNote = closingSummary?.note || null;
    const status = s.closedAt ? 'CLOSED' : 'OPEN';

    // Criar sessão
    await prisma.cashSession.create({
      data: {
        id: s.id,
        companyId: s.companyId,
        openedAt: new Date(s.openedAt),
        openedBy: s.openedBy || 'unknown',
        openingAmount: Number(s.openingAmount || 0),
        currentBalance: Number(s.balance || 0),
        status,
        closedAt: s.closedAt ? new Date(s.closedAt) : null,
        closedBy: s.closedBy || null,
        closingNote,
        blindClose: false,
        declaredValues: declaredValues || undefined,
      },
    });

    // Migrar movimentos
    const movements = Array.isArray(s.movements) ? s.movements : [];
    for (const mv of movements) {
      await prisma.cashMovement.create({
        data: {
          id: mv.id,
          sessionId: s.id,
          type: normalizeMovementType(mv.type),
          amount: Math.abs(Number(mv.amount || 0)),
          note: mv.note || null,
          createdAt: mv.at ? new Date(mv.at) : new Date(),
          createdBy: mv.by || null,
        },
      });
    }

    created++;
    console.log(`  Sessão ${s.id.slice(0, 8)} migrada (${movements.length} movimentos)`);
  }

  console.log(`\nMigração concluída: ${created} criadas, ${skipped} ignoradas (já existiam).`);
}

main()
  .catch((e) => {
    console.error('Erro na migração:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
