import { generateAndSignSimpleNFCe, loadCompanyCertBuffer } from './index'
import { loadConfig } from './config'

const COMPANY_ID = 'bd6a5381-6b90-4cc9-bc8f-24890c491693'

async function run() {
  try {
    const cfg = loadConfig()

    // try to load company certificate buffer from configured certsDir
    const certBuffer = await loadCompanyCertBuffer(COMPANY_ID)
    if (!certBuffer) {
      throw new Error(`Company certificate not found for companyId=${COMPANY_ID} in configured certsDir`)
    }

    const res = await generateAndSignSimpleNFCe({
      cnpj: '00000000000191',
      companyName: 'Empresa Exemplo LTDA',
      uf: '29',
      serie: '1',
      nNF: '123',
      itens: [
        { id: 1, prodName: 'Produto Isento', vProd: '10.00', vUnCom: '10.00', qCom: '1.00', ncm: '00000000', cfop: '5102' }
      ]
    }, { certBuffer, certPassword: cfg.certPassword, companyId: COMPANY_ID })

    console.log('Signed XML saved to', res.path)
  } catch (e) {
    console.error('Error', e)
  }
}

run()
