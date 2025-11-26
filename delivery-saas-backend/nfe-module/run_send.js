// delivery-saas-backend/nfe-module/run_send.js
// Roda geração -> assinatura -> envio e tenta persistir protocolo no backend
// Ajuste COMPANY_ID, UF e orderId conforme necessário.

const path = require('path');
const { generateAndSignSimpleNFCe, sendAndPersist, loadCompanyCertBuffer, loadConfig } = require('./dist/index.js');

async function run() {
  const COMPANY_ID = 'bd6a5381-6b90-4cc9-bc8f-24890c491693'; // alterar se precisar
  const ORDER_ID = null; // opcional: id do pedido para anexar protocolo (se quiser testar integração com pedidos)
  const UF = 'ba'; // estado da SEFAZ
  const BACKEND_URL = 'http://localhost:3000'; // URL do seu backend (usar https se seu backend expõe https)

  try {
    const cfg = loadConfig();
    console.log('nfe-module config environment:', cfg.environment);

    // carrega PFX da pasta segura (certsDir)
    const certBuffer = await loadCompanyCertBuffer(COMPANY_ID);
    if (!certBuffer) throw new Error('PFX não encontrado em certsDir para companyId=' + COMPANY_ID);

    // gerar + assinar
    const example = {
      cnpj: cfg.cnpj || '00000000000191',
      companyName: 'Empresa Exemplo LTDA',
      uf: UF,
      serie: '1',
      nNF: String(Math.floor(1000 + Math.random()*8000)),
      itens: [
        { id: 1, prodName: 'Produto Teste', vProd: '10.00', vUnCom: '10.00', qCom: '1.00', ncm: '00000000', cfop: '5102' }
      ]
    };

    const signed = await generateAndSignSimpleNFCe(example, { certBuffer, certPassword: cfg.certPassword, companyId: COMPANY_ID });
    console.log('Signed XML saved at:', signed.path);

    // enviar para SEFAZ (homologation) e persistir protocolo no backend
    const sendRes = await sendAndPersist(signed.signedXml, { certBuffer, certPassword: cfg.certPassword, environment: 'homologation', uf: UF }, { persistenceUrl: BACKEND_URL, companyId: COMPANY_ID, orderId: ORDER_ID });
    console.log('SEFAZ response summary:', sendRes.cStat, sendRes.protocolo, sendRes.xMotivo);
    console.log('Raw response saved to:', (sendRes.raw ? 'available' : 'none'));

  } catch (err) {
    console.error('Erro no fluxo NFC-e:', err && err.stack ? err.stack : err);
  }
}

run();