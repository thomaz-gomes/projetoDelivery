"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNFCeXml = generateNFCeXml;
const xml2js_1 = require("xml2js");
/**
 * Minimal NFC-e v4.00 XML generator for a simple invoice with one product
 * This produces a simplified structure intended as a starting point; for
 * production you must follow the complete layout in the SEFAZ XSDs and MANUAL.
 */
async function generateNFCeXml(payload) {
    const { cnpj, companyName, uf, serie, nNF, itens } = payload;
    // Compose a minimal NFe/NFC-e structure (v4.00). This is intentionally
    // simplified. See the official layout for all required tags.
    const chave = `NFe${cnpj}${serie}${nNF}`; // placeholder chave (real chave requires many fields)
    const infNFe = {
        $: { versao: '4.00', Id: chave },
        ide: {
            cUF: uf,
            natOp: 'VENDA',
            mod: '65',
            serie: serie,
            nNF: nNF,
            dhEmi: new Date().toISOString(),
            tpNF: '1',
            idDest: '1',
            cMunFG: '0',
            tpImp: '4',
            tpEmis: '1',
            cDV: '0',
            tpAmb: '2', // homologation by default
            finNFe: '1',
            indFinal: '1',
            indPres: '1'
        },
        emit: {
            CNPJ: cnpj,
            xNome: companyName,
            enderEmit: { xLgr: 'Endereco', nro: '0', xBairro: 'Bairro', cMun: '0', xMun: 'Cidade', UF: uf, CEP: '00000000' },
            IE: 'ISENTO'
        },
        dest: { CPF: '00000000000' },
        det: itens.map((it, idx) => ({
            $: { nItem: idx + 1 },
            prod: {
                cProd: String(it.id),
                cEAN: '',
                xProd: it.prodName,
                NCM: it.ncm || '00000000',
                CFOP: it.cfop || '5102',
                uCom: it.unity || 'UN',
                qCom: it.qCom || '1.00',
                vUnCom: it.vUnCom || it.vProd || '0.00',
                vProd: it.vProd || '0.00'
            },
            imposto: {
                // For an ICMS-exempt product (example) we use ICMSSN102 (Simples Nacional
                // com tributação por substituição/conceito). This is a simplified
                // example; confirm the correct tag for your scenario.
                ICMS: { ICMSSN102: { orig: '0', CSOSN: '102' } },
                PIS: { PISAliq: { CST: '07', vBC: '0.00', pPIS: '0.00', vPIS: '0.00' } },
                COFINS: { COFINSAliq: { CST: '07', vBC: '0.00', pCOFINS: '0.00', vCOFINS: '0.00' } }
            }
        })),
        total: {
            ICMSTot: { vBC: '0.00', vICMS: '0.00', vProd: itens.reduce((s, i) => s + Number(i.vProd || 0), 0).toFixed(2), vNF: itens.reduce((s, i) => s + Number(i.vProd || 0), 0).toFixed(2) }
        },
        transp: { modFrete: '9' },
        pag: { detPag: { tPag: '99', vPag: itens.reduce((s, i) => s + Number(i.vProd || 0), 0).toFixed(2) } },
        infAdic: { infCpl: 'Documento emitido em ambiente de homologação' }
    };
    const root = {
        NFe: { infNFe }
    };
    const builder = new xml2js_1.Builder({ headless: true, renderOpts: { pretty: false } });
    const xml = builder.buildObject(root);
    return xml;
}
