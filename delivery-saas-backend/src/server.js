import http from "http";
import fs from "fs";
import path from "path";
import { app, attachSocket } from "./index.js";
import { prisma } from './prisma.js';
import { sha256 } from './utils.js';
import { startWatching } from './fileWatcher.js';
import { startIFoodPollingWorker } from './jobs/ifoodPollWorker.js';

function pickFirstExisting(dir, candidates) {
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const SSL_DIR = path.resolve(process.cwd(), 'ssl');

// SSL support removed: this backend will run over plain HTTP only.
// All TLS termination must be handled by the reverse proxy (EasyPanel)
// or at network edge. The code no longer searches for local cert files.
const DISABLE_SSL = true;
let options = {};
let usedPfx = false;

const DEFAULT_PORT = Number(process.env.PORT) || 3000;

// If a developer/operator created a `.print-agent-token` file in the project root
// we will use it to automatically create/update a PrinterSetting for the first
// company found in the database. This makes the dev UX "configure once" so the
// agent and backend share the same token without manual DB operations.
async function ensureAgentTokenFromFile() {
  try {
    const tokenPath = path.join(process.cwd(), '.print-agent-token');
    if (!fs.existsSync(tokenPath)) return;
    const raw = fs.readFileSync(tokenPath, { encoding: 'utf8' }).trim();
    if (!raw) return;
    const token = raw;
    console.log('Found .print-agent-token file; registering token to database (if missing)');

    // Determine companyId to use: prefer explicit .print-agent-company file (dev convenience)
    const companyFile = path.join(process.cwd(), '.print-agent-company');
    let companyId = null;
    if (fs.existsSync(companyFile)) {
      try {
        const rawc = fs.readFileSync(companyFile, { encoding: 'utf8' }).trim();
        if (rawc) companyId = rawc;
      } catch (e) {
        console.warn('Failed to read .print-agent-company file, falling back to first company', e && e.message ? e.message : e);
      }
    }

    let company = null;
    if (companyId) {
      company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
      if (!company) {
        console.warn(`.print-agent-company specified id ${companyId} but no such company found; falling back to first company in DB`);
      }
    }
    if (!company) {
      // find first company (single-tenant dev instances usually have one)
      company = await prisma.company.findFirst({ select: { id: true } });
    }
    if (!company) {
      // In development, create a default company so dev UX can proceed without manual DB seeding.
      if (process.env.NODE_ENV !== 'production') {
        try {
          const devCompanyName = process.env.COMPANY_NAME || 'Dev Company';
          // If a specific companyId file was provided, try to use that id when creating the company
          const createData = {};
          if (companyId) createData.id = companyId;
          createData.name = devCompanyName;
          company = await prisma.company.create({ data: createData });
          console.log('Created development Company record for PRINTER token registration:', company.id);
        } catch (e) {
          console.error('Failed to create development Company record:', e && e.message);
          return;
        }
      } else {
        console.warn('No company record present in DB; skipping PrinterSetting upsert');
        return;
      }
    }

    const tokenHash = sha256(token);
    const existing = await prisma.printerSetting.findUnique({ where: { companyId: company.id } });
    if (existing) {
      if (existing.agentTokenHash !== tokenHash) {
        await prisma.printerSetting.update({ where: { companyId: company.id }, data: { agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } });
        console.log('Updated PrinterSetting.agentTokenHash for company', company.id);
      } else {
        console.log('PrinterSetting.agentTokenHash already matches file token');
      }
    } else {
      await prisma.printerSetting.create({ data: { companyId: company.id, agentTokenHash: tokenHash, agentTokenCreatedAt: new Date() } });
      console.log('Created PrinterSetting with agent token for company', company.id);
    }
  } catch (e) {
    console.error('Failed to ensure agent token from file:', e && e.message ? e.message : e);
  }
}


/**
 * Tenta iniciar o servidor HTTPS em `port`. Se o porto estiver em uso,
 * tenta o próximo porto (port+1) até `retries` tentativas.
 */
function startServer(port = DEFAULT_PORT, retries = 3) {
  let server;
  // Honor DISABLE_SSL or the temporary Easypanel skip flag set above
  const useHttp = DISABLE_SSL || process.env.EASYPANEL_SKIP_SSL_LOOKUP === '1';
  try {
    // Force HTTP server - TLS termination should happen upstream
    server = http.createServer(app);
    console.log('Starting HTTP server (TLS disabled in backend)');
  } catch (e) {
    console.error('❌ Failed to create server with the provided options:', e && e.message ? e.message : e);
    // If we tried a PFX earlier and it failed here, try to give a hint
    if (pfxPath) console.error('The PFX file may be invalid or password protected:', pfxPath);
    process.exit(1);
  }

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Porta ${port} em uso.`);
      if (retries > 0) {
        console.log(`➡️ Tentando porta ${port + 1} (restam ${retries} tentativas)...`);
        setTimeout(() => startServer(port + 1, retries - 1), 250);
        return;
      }
      console.error(`❌ Todas as tentativas falharam; porta ${port} continua em uso.`);
      console.error('Use `netstat -ano | findstr :3000` e mate o processo que está usando a porta, ou defina PORT=XXXX');
      process.exit(1);
    }
    console.error('❌ Erro ao iniciar servidor:', err);
    process.exit(1);
  });

  server.listen(port, () => {
    const hostLabel = process.env.HOST || 'localhost';
    console.log(`✅ HTTP rodando em http://${hostLabel}:${port}`);
    try {
      const io = attachSocket(server);
        console.log('🔌 Socket.IO anexado ao servidor HTTP');
        // expose io instance to routes via app.locals so routes can emit to agents
        try { app.locals.io = io } catch (e) { console.warn('Could not set app.locals.io', e) }
      // start file watcher (if any paths configured)
      startWatching().catch(e => console.error('Failed to start file watcher:', e));
      // start background iFood polling worker (polls all active integrations)
      try {
        startIFoodPollingWorker().catch(e => console.error('iFood polling worker failed to start:', e && e.message));
        console.log('Started iFood polling worker');
      } catch (e) {
        console.error('Failed to start iFood polling worker:', e && e.message);
      }
    } catch (e) {
      console.error('❌ Falha ao anexar Socket.IO:', e.message || e);
    }
  });
}

// Ensure token file (if present) is registered, then start the server
ensureAgentTokenFromFile().then(() => startServer()).catch(e => {
  console.error('Error processing .print-agent-token:', e && e.message ? e.message : e);
  // still attempt to start server even if token processing failed
  startServer();
});