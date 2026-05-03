import { Builder } from 'xml2js'
import crypto from 'crypto'

/** IBGE state codes for Brazilian UFs */
const UF_CODES: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53',
  ES: '32', GO: '52', MA: '21', MT: '51', MS: '50', MG: '31', PA: '15',
  PB: '25', PR: '41', PE: '26', PI: '22', RJ: '33', RN: '24', RS: '43',
  RO: '11', RR: '14', SC: '42', SP: '35', SE: '28', TO: '17'
}

function ufToCode(uf: string): string {
  const upper = (uf || '').toUpperCase().trim()
  if (/^\d+$/.test(upper)) return upper
  return UF_CODES[upper] || upper
}

/** Sanitize cMun: extract the first 7-digit sequence from potentially dirty data */
function sanitizeCMun(raw: string): string {
  const m = String(raw || '').match(/\d{7}/)
  return m ? m[0] : '0000000'
}

/** Sanitize nNF: TNF = [1-9]{1}[0-9]{0,8} → max 9 digits, no leading zeros */
function sanitizeNNF(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  // If more than 9 digits, take last 9; if starts with 0, use modulo
  let n = digits.length > 9 ? digits.slice(-9) : digits
  // Remove leading zeros
  n = n.replace(/^0+/, '') || '1'
  return n
}

/** Sanitize serie: TSerie = 0|[1-9]{1}[0-9]{0,2} → max 3 digits */
function sanitizeSerie(raw: string): string {
  const digits = String(raw || '1').replace(/\D/g, '')
  return digits.slice(0, 3) || '1'
}

/** Sanitize CEP: exactly 8 digits */
function sanitizeCEP(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '')
  return digits.padStart(8, '0').slice(0, 8)
}

/** Format decimal for TDec_1110v (up to 10 decimal places, minimum 2) */
function fmtVUnCom(v: string | number): string {
  const n = Number(v || 0)
  // Use 10 decimal places to satisfy TDec_1110v pattern
  return n.toFixed(10)
}

/** Format decimal for TDec_1302 (exactly 2 decimal places) */
function fmtDec2(v: string | number): string {
  return Number(v || 0).toFixed(2)
}

/** Format decimal for TDec_1104v (4 decimal places) */
function fmtQCom(v: string | number): string {
  return Number(v || 0).toFixed(4)
}

/** Generate a random 8-digit numeric code (cNF) */
function randomCNF(): string {
  return String(Math.floor(10000000 + Math.random() * 89999999))
}

/** Calculate mod-11 check digit for the 43-digit key (returns single char) */
function calcDV(chave43: string): string {
  const weights = [2, 3, 4, 5, 6, 7, 8, 9]
  let sum = 0
  const digits = chave43.split('').reverse()
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * weights[i % weights.length]
  }
  const rest = sum % 11
  const dv = rest < 2 ? 0 : 11 - rest
  return String(dv)
}

/**
 * Build a valid 44-digit NF-e access key.
 * Format: cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + serie(3) + nNF(9) + tpEmis(1) + cNF(8) + cDV(1)
 */
function buildChaveAcesso(cUF: string, dhEmi: string, cnpj: string, mod: string, serie: string, nNF: string, tpEmis: string, cNF: string): { chave44: string; cDV: string } {
  const aamm = dhEmi.slice(2, 4) + dhEmi.slice(5, 7) // from ISO date YYYY-MM-...
  const chave43 = cUF.padStart(2, '0')
    + aamm
    + cnpj.replace(/\D/g, '').padStart(14, '0')
    + mod.padStart(2, '0')
    + serie.padStart(3, '0')
    + nNF.padStart(9, '0')
    + tpEmis
    + cNF.padStart(8, '0')
  const cDV = calcDV(chave43)
  return { chave44: chave43 + cDV, cDV }
}

/**
 * Constrói o bloco <imposto> de cada item do det com base nos parâmetros fiscais.
 * Suporta ICMSSN102/500/900 (Simples Nacional) e ICMS00 (Lucro Real/Presumido).
 * CSOSN 102, 103, 300, 400 → todos usam a tag ICMSSN102 per leiauteNFe_v4.00.xsd.
 */
function buildItemImposto(it: any, vProdNum: number): any {
  const orig = it.orig ?? '0'
  const csosn = it.csosn
  const icmsAliq = Number(it.icmsAliq ?? 0)

  let ICMS: any
  if (icmsAliq > 0) {
    ICMS = { ICMS00: { orig, CST: '00', modBC: it.modBC ?? '3', vBC: '0.00', pICMS: icmsAliq.toFixed(2), vICMS: '0.00' } }
  } else if (csosn === '500') {
    ICMS = { ICMSSN500: { orig, CSOSN: '500', vBCSTRet: '0.00', pST: '0.00', vICMSSTRet: '0.00' } }
  } else if (csosn === '900') {
    ICMS = { ICMSSN900: { orig, CSOSN: '900', modBC: '3', vBC: '0.00', pRedBC: '0.00', pICMS: '0.00', vICMS: '0.00', modBCST: '3', pMVAST: '0.00', pRedBCST: '0.00', vBCST: '0.00', pICMSST: '0.00', vICMSST: '0.00', vCredICMSSN: '0.00' } }
  } else {
    // 102, 103, 300, 400 → todos usam ICMSSN102
    ICMS = { ICMSSN102: { orig, CSOSN: csosn ?? '102' } }
  }

  // PIS
  const cstPis = it.cstPis ?? null
  const pPIS = Number(it.pPIS ?? 0)
  let PIS: any
  if (!cstPis || cstPis === '07') {
    PIS = { PISNT: { CST: '07' } }
  } else if (cstPis === '01' || pPIS > 0) {
    PIS = { PISAliq: { CST: cstPis ?? '01', vBC: vProdNum.toFixed(2), pPIS: pPIS.toFixed(2), vPIS: (vProdNum * pPIS / 100).toFixed(2) } }
  } else {
    PIS = { PISNT: { CST: cstPis } }
  }

  // COFINS
  const cstCofins = it.cstCofins ?? null
  const pCOFINS = Number(it.pCOFINS ?? 0)
  let COFINS: any
  if (!cstCofins || cstCofins === '07') {
    COFINS = { COFINSNT: { CST: '07' } }
  } else if (cstCofins === '01' || pCOFINS > 0) {
    COFINS = { COFINSAliq: { CST: cstCofins ?? '01', vBC: vProdNum.toFixed(2), pCOFINS: pCOFINS.toFixed(2), vCOFINS: (vProdNum * pCOFINS / 100).toFixed(2) } }
  } else {
    COFINS = { COFINSNT: { CST: cstCofins } }
  }

  const imposto: any = { ICMS, PIS, COFINS }

  const pIPI = Number(it.pIPI ?? 0)
  if (pIPI > 0) {
    imposto.IPI = { IPITrib: { CST: '50', vBC: vProdNum.toFixed(2), pIPI: pIPI.toFixed(2), vIPI: (vProdNum * pIPI / 100).toFixed(2) } }
  }

  return imposto
}

/**
 * NFC-e (mod 65) v4.00 XML generator compliant with leiauteNFe_v4.00.xsd.
 *
 * NFC-e is used for direct-to-consumer sales (restaurants, retail).
 * Dest identification is optional — anonymous sales are allowed up to state limits.
 * All required elements and their ordering follow the official schema.
 */
export async function generateNFCeXml(payload: {
  cnpj: string
  companyName: string
  uf: string
  serie: string
  nNF: string
  mod?: string
  tpAmb?: string
  crt?: string          // 1=SN, 2=SN excesso, 3=Normal, 4=MEI
  natOp?: string
  cMunFG?: string       // 7-digit IBGE code
  tpEmis?: string
  indPres?: string
  indIntermed?: string
  enderEmit?: {
    xLgr?: string; nro?: string; xBairro?: string; cMun?: string; xMun?: string; UF?: string; CEP?: string; cPais?: string; xPais?: string
  }
  ie?: string
  dest?: { CPF?: string; CNPJ?: string; xNome?: string; enderDest?: { xLgr?: string; nro?: string; xBairro?: string; cMun?: string; xMun?: string; UF?: string; CEP?: string; cPais?: string; xPais?: string } }
  itens: Array<{
    id: number; prodName: string; cfop?: string; ncm?: string; unity?: string;
    qCom?: string; vUnCom?: string; vProd: string; cProd?: string
    // campos fiscais por item
    csosn?: string      // CSOSN (102, 300, 400, 500, 900) – Simples Nacional
    orig?: string       // origem da mercadoria (0=nacional)
    icmsAliq?: number   // alíquota ICMS (ICMS00 quando > 0)
    modBC?: string      // modalidade base de cálculo ICMS
    cstPis?: string     // CST PIS (07=NT, 01=Aliq)
    pPIS?: number       // alíquota PIS %
    cstCofins?: string  // CST COFINS (07=NT, 01=Aliq)
    pCOFINS?: number    // alíquota COFINS %
    pIPI?: number       // alíquota IPI %
  }>
  pag?: { tPag?: string; vPag?: string; vTroco?: string }
  infRespTec?: { CNPJ: string; xContato: string; email: string; fone: string }
  csc?: string
  cscId?: string
}) {
  const { cnpj, companyName, uf, itens } = payload
  const serie = sanitizeSerie(payload.serie)
  const nNF = sanitizeNNF(payload.nNF)
  const tpAmb = payload.tpAmb || '2'
  const mod = payload.mod || '65'
  const tpEmis = payload.tpEmis || '1'
  const cNF = randomCNF()
  const cUF = ufToCode(uf)
  // BRT = UTC-3; subtract 3h from UTC so the timestamp value is correct for the -03:00 offset
  const dhEmi = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '-03:00')

  const { chave44, cDV } = buildChaveAcesso(cUF, dhEmi, cnpj, mod, serie, nNF, tpEmis, cNF)
  const chaveId = `NFe${chave44}`

  const vProdTotal = itens.reduce((s, i) => s + Number(i.vProd || 0), 0)
  const vNF = vProdTotal.toFixed(2)

  const emitUF = payload.enderEmit?.UF || uf.toUpperCase()
  const rawCMun = payload.cMunFG || payload.enderEmit?.cMun || '0000000'
  const cMunFG = sanitizeCMun(rawCMun)

  const infNFe: any = {
    $: { versao: '4.00', Id: chaveId },
    ide: {
      cUF,
      cNF,
      natOp: payload.natOp || 'VENDA',
      mod,
      serie,
      nNF,
      dhEmi,
      tpNF: '1',        // 1=Saída
      idDest: '1',       // 1=Interna
      cMunFG,
      tpImp: mod === '65' ? '4' : '1', // 4=DANFE NFC-e, 1=DANFE retrato
      tpEmis,
      cDV,
      tpAmb,
      finNFe: '1',       // 1=Normal
      indFinal: '1',     // 1=Consumidor final
      // indPres: 1=presencial, 4=entrega em domicílio (delivery). NT2020.006: indIntermed
      // é obrigatório quando indPres ∈ {2,3,4,9} — 0=sem intermediador, 1=marketplace
      indPres: payload.indPres || (mod === '65' ? '1' : '0'),
      ...(['2','3','4','9'].includes(payload.indPres || (mod === '65' ? '1' : '0'))
        ? { indIntermed: payload.indIntermed ?? '0' }
        : {}),
      procEmi: '0',      // 0=Aplicativo do contribuinte
      verProc: '1.0.0'
    },
    emit: {
      CNPJ: cnpj.replace(/\D/g, '').padStart(14, '0'),
      xNome: tpAmb === '2' ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : companyName,
      enderEmit: {
        xLgr: payload.enderEmit?.xLgr || 'RUA TESTE',
        nro: payload.enderEmit?.nro || 'S/N',
        xBairro: payload.enderEmit?.xBairro || 'CENTRO',
        cMun: sanitizeCMun(payload.enderEmit?.cMun || cMunFG),
        xMun: payload.enderEmit?.xMun || 'CIDADE',
        UF: emitUF,
        CEP: sanitizeCEP(payload.enderEmit?.CEP || '00000000'),
        cPais: payload.enderEmit?.cPais || '1058',
        xPais: payload.enderEmit?.xPais || 'BRASIL'
      },
      IE: payload.ie || 'ISENTO',
      CRT: payload.crt || '1'  // 1=Simples Nacional
    },
    dest: {} as any,
    det: itens.map((it, idx) => ({
      $: { nItem: String(idx + 1) },
      prod: {
        cProd: (it.cProd || String(it.id)).slice(0, 60),
        cEAN: 'SEM GTIN',
        xProd: tpAmb === '2' ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : (it.prodName || 'PRODUTO').slice(0, 120),
        NCM: (it.ncm || '00000000').replace(/\D/g, '').padStart(8, '0').slice(0, 8),
        CFOP: it.cfop || '5102',
        uCom: (it.unity || 'UN').slice(0, 6),
        qCom: fmtQCom(it.qCom || '1'),
        vUnCom: fmtVUnCom(it.vUnCom || it.vProd || '0'),
        vProd: fmtDec2(it.vProd || '0'),
        cEANTrib: 'SEM GTIN',
        uTrib: (it.unity || 'UN').slice(0, 6),
        qTrib: fmtQCom(it.qCom || '1'),
        vUnTrib: fmtVUnCom(it.vUnCom || it.vProd || '0'),
        indTot: '1'
      },
      imposto: buildItemImposto(it, Number(it.vProd || 0))
    })),
    total: {
      ICMSTot: {
        vBC: '0.00',
        vICMS: '0.00',
        vICMSDeson: '0.00',
        vFCPUFDest: '0.00',
        vICMSUFDest: '0.00',
        vICMSUFRemet: '0.00',
        vFCP: '0.00',
        vBCST: '0.00',
        vST: '0.00',
        vFCPST: '0.00',
        vFCPSTRet: '0.00',
        vProd: fmtDec2(vNF),
        vFrete: '0.00',
        vSeg: '0.00',
        vDesc: '0.00',
        vII: '0.00',
        vIPI: '0.00',
        vIPIDevol: '0.00',
        vPIS: '0.00',
        vCOFINS: '0.00',
        vOutro: '0.00',
        vNF: fmtDec2(vNF),
        vTotTrib: '0.00'
      }
    },
    transp: { modFrete: '9' }, // 9=Sem frete
    pag: (() => {
      // Avoid tPag=99 (outros): SVRS rejects xPag in schema despite requiring it (known SVRS bug).
      // Unknown methods default to 01 (dinheiro), which needs no extra fields.
      const tPagVal = payload.pag?.tPag || '01'
      const safeTpag = tPagVal === '99' ? '01' : tPagVal
      const detPag: any = {
        tPag: safeTpag,
        vPag: fmtDec2(payload.pag?.vPag || vNF),
      }
      // cStat 391: tPag=03/04 (credit/debit) requires <card> with tpIntegra=2 (não integrado)
      if (safeTpag === '03' || safeTpag === '04') detPag.card = { tpIntegra: '2' }
      return { detPag, vTroco: fmtDec2(payload.pag?.vTroco || '0') }
    })()
  }

  if (tpAmb === '2') {
    infNFe.infAdic = { infCpl: 'Documento emitido em ambiente de homologacao - sem valor fiscal' }
  }

  // infRespTec: obrigatório per NT2018.005; identifica o fornecedor do software emissor
  if (payload.infRespTec?.CNPJ) {
    infNFe.infRespTec = {
      CNPJ: payload.infRespTec.CNPJ.replace(/\D/g, '').padStart(14, '0'),
      xContato: payload.infRespTec.xContato,
      email: payload.infRespTec.email,
      fone: payload.infRespTec.fone,
    }
  }

  // Build dest in schema order: CPF|CNPJ|idEstrangeiro → xNome → ... → indIEDest
  const destCPF = (payload.dest?.CPF || '').replace(/\D/g, '')
  const destCNPJ = (payload.dest?.CNPJ || '').replace(/\D/g, '')
  if (destCPF && destCPF.length === 11) {
    infNFe.dest.CPF = destCPF
  } else if (destCNPJ && destCNPJ.length === 14) {
    infNFe.dest.CNPJ = destCNPJ
  }
  // xNome is required for NF-e mod 55
  const destXNome = payload.dest?.xNome || ''
  if (mod === '55') {
    infNFe.dest.xNome = tpAmb === '2'
      ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
      : (destXNome || 'CONSUMIDOR FINAL')
    // enderDest is required for NF-e mod 55
    const ed = payload.dest?.enderDest || payload.enderEmit || {}
    infNFe.dest.enderDest = {
      xLgr: ed.xLgr || 'NAO INFORMADO',
      nro: ed.nro || 'S/N',
      xBairro: ed.xBairro || 'NAO INFORMADO',
      cMun: sanitizeCMun(ed.cMun || cMunFG),
      xMun: ed.xMun || 'NAO INFORMADO',
      UF: ed.UF || emitUF,
      CEP: sanitizeCEP(ed.CEP || '00000000'),
      cPais: ed.cPais || '1058',
      xPais: ed.xPais || 'BRASIL'
    }
  } else if ((destCPF || destCNPJ) && destXNome) {
    infNFe.dest.xNome = tpAmb === '2'
      ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
      : destXNome
  }
  infNFe.dest.indIEDest = '9' // 9=Não Contribuinte

  // Debug: log dest to verify CPF is present
  console.log('[generate] infNFe.dest:', JSON.stringify(infNFe.dest))

  const root: any = {
    NFe: {
      $: { xmlns: 'http://www.portalfiscal.inf.br/nfe' },
      infNFe
    }
  }

  const builder = new Builder({ headless: true, renderOpts: { pretty: false } })
  const xml = builder.buildObject(root)
  return { xml, chave44, tpAmb, cscId: payload.cscId || '', csc: payload.csc || '' }
}

/* ------------------------------------------------------------------ */
/*  NFC-e QR Code helpers (infNFeSupl)                                */
/* ------------------------------------------------------------------ */

/** QR Code v2 URLs by UF – homologation & production
 *  Note: qrCode element allows up to 1000 chars (not subject to TUri 85-char limit)
 *  These must match SEFAZ's registered portal URLs exactly (cStat 395 otherwise).
 *  BA uses /qrcode.aspx endpoint (confirmed from authorized NFC-e XML sample). */
const NFCE_QR_URLS: Record<string, Record<string, string>> = {
  BA: {
    homologation: 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx',
    production:   'http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx',
  },
}

/** URL consulta por chave – TUri max 85 chars (NT2014.002 ZX03).
 *  Source: http://nfce.encat.org/consulte-sua-nota-qr-code-versao-2-0/ */
const NFCE_URL_CHAVE: Record<string, Record<string, string>> = {
  BA: {
    homologation: 'http://hinternet.sefaz.ba.gov.br/nfce/consulta',  // 48 chars
    production:   'http://www.sefaz.ba.gov.br/nfce/consulta',         // 41 chars
  },
}

/**
 * Build the NFC-e QR Code URL (version 2).
 *
 * Format: `BASE?p=chNFe|2|tpAmb|cIdToken|cHashQRCode`
 *   cHashQRCode = SHA256( chNFe|2|tpAmb|cIdToken + CSC )  → uppercase hex
 */
export function buildNFCeQrCodeUrl(
  chave44: string,
  tpAmb: string,
  cscId: string,
  csc: string,
  uf: string = 'BA',
): string {
  const env = tpAmb === '2' ? 'homologation' : 'production'
  const baseUrl = NFCE_QR_URLS[uf.toUpperCase()]?.[env]
    || NFCE_QR_URLS['BA'][env]

  // Concatenation for hash: chNFe|2|tpAmb|cIdToken  +  CSC  (no separator before CSC)
  // Hash algorithm: SHA1 per NFC-e spec v2 (NT 2013.001) - confirmed by sped-nfe reference
  const concat = `${chave44}|2|${tpAmb}|${cscId}${csc}`
  const hash = crypto.createHash('sha1').update(concat).digest('hex').toUpperCase()

  return `${baseUrl}?p=${chave44}|2|${tpAmb}|${cscId}|${hash}`
}

/**
 * Return the NFC-e "urlChave" (consulta por chave de acesso) for a given UF/environment.
 */
export function getNFCeUrlChave(tpAmb: string, uf: string = 'BA'): string {
  const env = tpAmb === '2' ? 'homologation' : 'production'
  return NFCE_URL_CHAVE[uf.toUpperCase()]?.[env]
    || NFCE_URL_CHAVE['BA'][env]
}

/**
 * Insert <infNFeSupl> into the signed NFC-e XML, right before </NFe>.
 *
 * Position: after <Signature> and before the closing </NFe> tag.
 * The qrCode value MUST be wrapped in CDATA.
 */
export function insertInfNFeSupl(signedXml: string, qrCodeUrl: string, urlChave: string): string {
  const infNFeSupl =
    `<infNFeSupl>` +
      `<qrCode><![CDATA[${qrCodeUrl}]]></qrCode>` +
      `<urlChave>${urlChave}</urlChave>` +
    `</infNFeSupl>`

  // Per leiauteNFe_v4.00.xsd the sequence inside <NFe> must be:
  //   infNFe → infNFeSupl (optional) → Signature
  // xml-crypto appends <Signature> at the end of the root, so we insert infNFeSupl
  // immediately BEFORE <Signature to preserve the required schema order.
  if (/<Signature[\s>]/.test(signedXml)) {
    return signedXml.replace(/<Signature[\s>]/, `${infNFeSupl}$&`)
  }
  // Fallback: no Signature found yet (should not happen in normal flow)
  return signedXml.replace('</NFe>', `${infNFeSupl}</NFe>`)
}
