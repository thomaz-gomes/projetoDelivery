// run_send_node_sped.js
// Demo script that uses the third-party `node-sped-nfe` library to check SEFAZ status
// and exercises certificate loading in this project. This is non-destructive and
// doesn't replace existing code; it's a safe first integration step.

const path = require('path');
const fs = require('fs');

const { loadCompanyCertBuffer } = require('./dist/index.js');
const { loadConfig } = require('./dist/config.js');

(async function main() {
  const COMPANY_ID = 'bd6a5381-6b90-4cc9-bc8f-24890c491693';
  const UF = 'BA'; // adjust as needed

  try {
    const cfg = loadConfig();
    console.log('nfe-module config environment:', cfg.environment);

    const certBuffer = await loadCompanyCertBuffer(COMPANY_ID);
    if (!certBuffer) throw new Error('PFX não encontrado em certsDir para companyId=' + COMPANY_ID);

    // write to a temporary file because `node-sped-nfe` examples use a pfx path
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPfxPath = path.join(tmpDir, `${COMPANY_ID}.pfx`);
    fs.writeFileSync(tmpPfxPath, certBuffer);

    // dynamic import to be compatible with CJS project
    const nodeSped = await import('node-sped-nfe');
    const { Tools } = nodeSped;

    const tpAmb = cfg.environment === 'production' ? 1 : 2;

    // build Tools config and prefer paths declared in nfe-module/config.json when present
    const toolsConfig = {
      mod: '65',
      tpAmb,
      UF,
      versao: '4.00'
    };

    if (cfg.xmllint) toolsConfig.xmllint = cfg.xmllint;
    if (cfg.openssl) toolsConfig.openssl = cfg.openssl;

    const tools = new Tools(toolsConfig, {
      pfx: tmpPfxPath,
      senha: cfg.certPassword
    });

    console.log('Calling SEFAZ status via node-sped-nfe (this may take a few seconds)...');
    const res = await tools.sefazStatus();
    console.log('SEFAZ status response:', res);

    // cleanup temp pfx
    try { fs.unlinkSync(tmpPfxPath); } catch (e) { /* ignore */ }

  } catch (err) {
    console.error('Erro ao usar node-sped-nfe:', err && err.stack ? err.stack : err);
    process.exitCode = 2;
  }
})();
