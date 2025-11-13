import https from "https";
import fs from "fs";
import { app, attachSocket } from "./index.js"; // attachSocket will bind Socket.IO to the server
import { startWatching } from './fileWatcher.js';

const options = {
  key: fs.readFileSync("./ssl/localhost-key.pem"),
  cert: fs.readFileSync("./ssl/localhost.pem"),
};

const DEFAULT_PORT = Number(process.env.PORT) || 3000;

/**
 * Tenta iniciar o servidor HTTPS em `port`. Se o porto estiver em uso,
 * tenta o próximo porto (port+1) até `retries` tentativas.
 */
function startServer(port = DEFAULT_PORT, retries = 3) {
  const server = https.createServer(options, app);

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
    console.log(`✅ HTTPS rodando em https://localhost:${port}`);
    try {
      attachSocket(server);
      console.log('🔌 Socket.IO anexado ao servidor HTTPS');
      // start file watcher (if any paths configured)
      startWatching().catch(e => console.error('Failed to start file watcher:', e));
    } catch (e) {
      console.error('❌ Falha ao anexar Socket.IO:', e.message || e);
    }
  });
}

startServer();