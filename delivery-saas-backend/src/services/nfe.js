import { prisma } from '../prisma.js'
import events from '../utils/events.js'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { decryptText } from '../utils/secretStore.js'

const require = createRequire(import.meta.url)
const nfeModule = require('../../nfe-module/dist/index.js')

// Module-level XSD sanitizers
const sanitizeNNF = (raw) => { let d = String(raw || '').replace(/\D/g, ''); if (d.length > 9) d = d.slice(-9); d = d.replace(/^0+/, '') || '1'; return d }

/**
 * Save SEFAZ protocol/authorization response into DB.
 * Accepts an object with { companyId, orderId, nProt, cStat, xMotivo, rawXml }
 */
export async function saveNfeProtocol({ companyId, orderId, nProt, cStat, xMotivo, rawXml }) {
  if (!companyId) throw new Error('companyId is required')

  // create record; if nProt exists, return existing
  if (nProt) {
    const existing = await prisma.nfeProtocol.findUnique({ where: { nProt } })
    if (existing) return existing
  }

  const created = await prisma.nfeProtocol.create({
    data: {
      companyId,
      orderId: orderId || null,
      nProt: nProt || null,
      cStat: cStat || null,
      xMotivo: xMotivo || null,
      rawXml: rawXml || null,
    },
  })

  // If protocol indicates authorization (100), attach to order payload and emit an event to update frontend
  try {
    const cstatNum = Number(cStat)
    if (!Number.isNaN(cstatNum) && cstatNum === 100 && orderId) {
      // load order
      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (order) {
        // attach nfe info into payload JSON field (non-destructive)
        const oldPayload = order.payload || {}
        const nfeInfo = { nProt: nProt || null, cStat: cStat || null, xMotivo: xMotivo || null, authorizedAt: new Date() }
  const newPayload = { ...oldPayload, nfe: nfeInfo }
  // update order payload and set status to INVOICE_AUTHORIZED
  await prisma.order.update({ where: { id: orderId }, data: { payload: newPayload, status: 'INVOICE_AUTHORIZED' } })

        // emit app-level event so socket layer can notify frontend
        const payload = { id: order.id, displayId: order.displayId, status: order.status, nfe: nfeInfo }
        try { events.emit('nfe.authorized', payload) } catch (e) { console.warn('Failed to emit nfe.authorized', e) }
      }
    }
  } catch (e) {
    console.warn('Error handling post-protocol order update:', e)
  }

  // optional: if orderId provided, return combined object with order
  if (orderId) {
    const withOrder = await prisma.nfeProtocol.findUnique({ where: { id: created.id }, include: { order: true } })
    return withOrder
  }

  return created
}

export function buildNfePayload(data) {
  const { ide, emit, dest, det, total, pag } = data

  const tpAmb = ide.tpAmb || '2'
  const mod = ide.mod || '65'

  // Sanitize helpers for XSD types
  const sanitizeCMun = (raw) => { const m = String(raw || '').match(/\d{7}/); return m ? m[0] : '0000000' }
  const sanitizeNNF = (raw) => { let d = String(raw || '').replace(/\D/g, ''); if (d.length > 9) d = d.slice(-9); d = d.replace(/^0+/, '') || '1'; return d }
  const sanitizeSerie = (raw) => { const d = String(raw || '1').replace(/\D/g, ''); return d.slice(0, 3) || '1' }
  const sanitizeCEP = (raw) => { const d = String(raw || '').replace(/\D/g, ''); return d.padStart(8, '0').slice(0, 8) }
  const fmtVUnCom = (v) => Number(v || 0).toFixed(10)
  const fmtDec2 = (v) => Number(v || 0).toFixed(2)
  const fmtQCom = (v) => Number(v || 0).toFixed(4)

  const infNFe = {
    ide: {
      cUF: emit.enderEmit?.UF || '29',
      cNF: String(Math.floor(10000000 + Math.random() * 89999999)),
      natOp: ide.natOp || 'VENDA',
      mod,
      serie: sanitizeSerie(ide.serie || '1'),
      nNF: sanitizeNNF(ide.nNF),
      dhEmi: new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00'),
      tpNF: '1',
      idDest: '1',
      cMunFG: sanitizeCMun(emit.enderEmit?.cMun),
      tpImp: mod === '65' ? '4' : '1',
      tpEmis: '1',
      cDV: '0',
      tpAmb,
      finNFe: '1',
      indFinal: '1',
      indPres: mod === '65' ? '1' : '0',
      procEmi: '0',
      verProc: '1.0.0'
    },
    emit: {
      CNPJ: (emit.CNPJ || '').replace(/\D/g, '').padStart(14, '0'),
      xNome: tpAmb === '2' ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : emit.xNome,
      enderEmit: {
        xLgr: emit.enderEmit?.xLgr || 'RUA TESTE',
        nro: emit.enderEmit?.nro || 'S/N',
        xBairro: emit.enderEmit?.xBairro || 'CENTRO',
        cMun: sanitizeCMun(emit.enderEmit?.cMun),
        xMun: emit.enderEmit?.xMun || 'CIDADE',
        UF: emit.enderEmit?.UF || '',
        CEP: sanitizeCEP(emit.enderEmit?.CEP),
        cPais: emit.enderEmit?.cPais || '1058',
        xPais: emit.enderEmit?.xPais || 'BRASIL'
      },
      IE: emit.IE || 'ISENTO',
      CRT: emit.CRT || '1'
    },
    dest: {},
    det: det.map((item) => {
      const eanVal = item.prod._ean || 'SEM GTIN'
      const pPIS = Number(item.imposto?._pPIS || 0)
      const pCOFINS = Number(item.imposto?._pCOFINS || 0)
      const pIPI = Number(item.imposto?._pIPI || 0)
      const vProdNum = Number(item.prod.vProd || 0)

      const pisTag = pPIS > 0
        ? { PISAliq: { CST: '01', vBC: fmtDec2(vProdNum), pPIS: pPIS.toFixed(2), vPIS: fmtDec2(vProdNum * pPIS / 100) } }
        : { PISNT: { CST: '07' } }

      const cofinsTag = pCOFINS > 0
        ? { COFINSAliq: { CST: '01', vBC: fmtDec2(vProdNum), pCOFINS: pCOFINS.toFixed(2), vCOFINS: fmtDec2(vProdNum * pCOFINS / 100) } }
        : { COFINSNT: { CST: '07' } }

      const impostoObj = {
        ICMS: buildIcmsTag(item.imposto?.pICMS, item.imposto?._orig, item.imposto?._modBC),
        PIS: pisTag,
        COFINS: cofinsTag
      }

      if (pIPI > 0) {
        impostoObj.IPI = { IPITrib: { CST: '50', vBC: fmtDec2(vProdNum), pIPI: pIPI.toFixed(2), vIPI: fmtDec2(vProdNum * pIPI / 100) } }
      }

      return {
        nItem: item.nItem,
        prod: {
          cProd: (item.prod.cProd || String(item.nItem)).slice(0, 60),
          cEAN: eanVal,
          xProd: tpAmb === '2' ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : (item.prod.xProd || 'PRODUTO').slice(0, 120),
          NCM: (item.prod.NCM || '00000000').replace(/\D/g, '').padStart(8, '0').slice(0, 8),
          CFOP: item.prod.CFOP || '5102',
          uCom: (item.prod.uCom || 'UN').slice(0, 6),
          qCom: fmtQCom(item.prod.qCom || '1'),
          vUnCom: fmtVUnCom(item.prod.vUnCom || '0'),
          vProd: fmtDec2(item.prod.vProd || '0'),
          cEANTrib: eanVal,
          uTrib: (item.prod.uTrib || item.prod.uCom || 'UN').slice(0, 6),
          qTrib: fmtQCom(item.prod.qTrib || item.prod.qCom || '1'),
          vUnTrib: fmtVUnCom(item.prod.vUnTrib || item.prod.vUnCom || '0'),
          indTot: '1'
        },
        imposto: impostoObj
      }
    }),
    total: {
      ICMSTot: {
        vBC: '0.00',
        vICMS: fmtDec2(total.vICMS || '0'),
        vICMSDeson: '0.00',
        vFCPUFDest: '0.00',
        vICMSUFDest: '0.00',
        vICMSUFRemet: '0.00',
        vFCP: '0.00',
        vBCST: '0.00',
        vST: '0.00',
        vFCPST: '0.00',
        vFCPSTRet: '0.00',
        vProd: fmtDec2(total.vProd || '0'),
        vFrete: fmtDec2(total.vFrete || '0'),
        vSeg: fmtDec2(total.vSeg || '0'),
        vDesc: fmtDec2(total.vDesc || '0'),
        vII: '0.00',
        vIPI: '0.00',
        vIPIDevol: '0.00',
        vPIS: '0.00',
        vCOFINS: '0.00',
        vOutro: fmtDec2(total.vOutro || '0'),
        vNF: fmtDec2(total.vNF || total.vProd || '0'),
        vTotTrib: '0.00'
      }
    },
    transp: { modFrete: '9' },
    pag: {
      detPag: {
        tPag: pag?.tPag || '99',
        vPag: fmtDec2(pag?.vPag || total.vNF || total.vProd || '0')
      },
      vTroco: fmtDec2(pag?.vTroco || '0')
    }
  }

  const destCPF = (dest.CPF || '').replace(/\D/g, '')
  const destCNPJ = (dest.CNPJ || '').replace(/\D/g, '')
  if (destCPF && destCPF.length === 11) {
    infNFe.dest.CPF = destCPF
  } else if (destCNPJ && destCNPJ.length === 14) {
    infNFe.dest.CNPJ = destCNPJ
  }
  // xNome is required for NF-e mod 55
  const destXNome = dest.xNome || ''
  if (mod === '55') {
    infNFe.dest.xNome = tpAmb === '2'
      ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'
      : (destXNome || 'CONSUMIDOR FINAL')
    // enderDest is required for NF-e mod 55
    const ed = dest.enderDest || emit.enderEmit || {}
    infNFe.dest.enderDest = {
      xLgr: ed.xLgr || 'NAO INFORMADO',
      nro: ed.nro || 'S/N',
      xBairro: ed.xBairro || 'NAO INFORMADO',
      cMun: sanitizeCMun(ed.cMun || emit.enderEmit?.cMun),
      xMun: ed.xMun || 'NAO INFORMADO',
      UF: ed.UF || emit.enderEmit?.UF || '',
      CEP: sanitizeCEP(ed.CEP || '00000000'),
      cPais: ed.cPais || '1058',
      xPais: ed.xPais || 'BRASIL'
    }
  } else if ((destCPF || destCNPJ) && destXNome) {
    infNFe.dest.xNome = destXNome
  }
  infNFe.dest.indIEDest = '9' // 9=Não Contribuinte

  if (tpAmb === '2') {
    infNFe.infAdic = { infCpl: 'Documento emitido em ambiente de homologacao - sem valor fiscal' }
  }

  return infNFe
}

function buildIcmsTag(pICMS, orig, modBC) {
  const aliq = Number(pICMS) || 0
  const origVal = orig != null ? String(orig) : '0'
  if (aliq > 0) {
    return {
      ICMS00: {
        orig: origVal,
        CST: '00',
        modBC: modBC != null ? String(modBC) : '3',
        vBC: '0.00',
        pICMS: aliq.toFixed(2),
        vICMS: '0.00'
      }
    }
  }
  return { ICMSSN102: { orig: origVal, CSOSN: '102' } }
}

export async function signNfeXml(infNFe, certConfig, fiscalOpts = {}) {
  const { generateAndSignSimpleNFCe } = nfeModule

  const itens = infNFe.det.map((d, idx) => ({
    id: idx + 1,
    prodName: d.prod.xProd,
    vProd: d.prod.vProd,
    vUnCom: d.prod.vUnCom,
    qCom: d.prod.qCom,
    ncm: d.prod.NCM,
    cfop: d.prod.CFOP,
    unity: d.prod.uCom,
    cProd: d.prod.cProd
  }))

  const example = {
    cnpj: infNFe.emit.CNPJ,
    companyName: infNFe.emit.xNome,
    uf: infNFe.ide.cUF,
    serie: infNFe.ide.serie,
    nNF: infNFe.ide.nNF,
    mod: infNFe.ide.mod || '65',
    tpAmb: infNFe.ide.tpAmb || '2',
    crt: infNFe.emit.CRT || '1',
    natOp: infNFe.ide.natOp || 'VENDA',
    cMunFG: infNFe.ide.cMunFG,
    ie: infNFe.emit.IE,
    enderEmit: infNFe.emit.enderEmit || {},
    dest: infNFe.dest || {},
    // enderDest is included inside dest already
    itens,
    pag: {
      tPag: infNFe.pag?.detPag?.tPag || '99',
      vPag: infNFe.pag?.detPag?.vPag || '0.00',
      vTroco: infNFe.pag?.vTroco || '0.00'
    },
    csc: fiscalOpts.csc || null,
    cscId: fiscalOpts.cscId || null
  }

  const options = {}
  if (certConfig.certBuffer) options.certBuffer = certConfig.certBuffer
  else if (certConfig.certPath) options.certPath = certConfig.certPath
  // Always pass certPassword explicitly (even as empty string) to prevent fallback
  // to the placeholder "senhaDoCertificado" from nfe-module/config.json
  options.certPassword = certConfig.certPassword ?? ''

  console.log('[NFe] signNfeXml example.dest:', JSON.stringify(example.dest))
  const result = await generateAndSignSimpleNFCe(example, options)
  // Log the dest portion of the signed XML for debugging
  const destMatch = result.signedXml?.match(/<dest>[\s\S]*?<\/dest>/)
  console.log('[NFe] XML <dest> section:', destMatch ? destMatch[0] : 'NOT FOUND IN XML')
  return result
}

export async function transmitNfe(signedXml, certConfig, uf) {
  const { sendAndPersist } = nfeModule

  const environment = certConfig.tpAmb === '1' ? 'production' : 'homologation'

  // Auto-detect mod from signed XML (65=NFC-e, 55=NF-e)
  const modMatch = signedXml.match(/<mod>(\d+)<\/mod>/)
  const mod = certConfig.mod || (modMatch ? modMatch[1] : '65')

  const sendOpts = {
    environment,
    uf: uf || 'ba',
    mod,
    wsSecurity: true
  }
  if (certConfig.certBuffer) sendOpts.certBuffer = certConfig.certBuffer
  else if (certConfig.certPath) sendOpts.certPath = certConfig.certPath
  sendOpts.certPassword = certConfig.certPassword ?? ''

  console.log('[NFe transmit] Enviando para SEFAZ:', { environment, uf: sendOpts.uf, certPath: certConfig.certPath || '(buffer)', hasCertBuffer: !!certConfig.certBuffer, hasPassword: !!certConfig.certPassword })

  let res
  try {
    res = await sendAndPersist(signedXml, sendOpts)
  } catch (err) {
    // Enrich the error with SEFAZ/axios details
    const enriched = new Error(
      err?.response
        ? `SEFAZ retornou HTTP ${err.response.status} — URL: ${err.config?.url || '?'} — Resposta: ${typeof err.response.data === 'string' ? err.response.data.substring(0, 500) : JSON.stringify(err.response.data).substring(0, 500)}`
        : `Falha na comunicação com SEFAZ: ${err?.message || String(err)}${err?.code ? ` (${err.code})` : ''}${err?.config?.url ? ` — URL: ${err.config.url}` : ''}`
    )
    enriched.originalError = err
    throw enriched
  }

  console.log('[NFe transmit] Resposta SEFAZ:', { cStat: res.cStat, xMotivo: res.xMotivo, protocolo: res.protocolo })

  const cStatNum = Number(res.cStat)
  let status = 'erro'
  if (cStatNum === 100) status = 'autorizado'
  else if (cStatNum >= 200 && cStatNum < 300) status = 'rejeitado'
  else if (res.xMotivo && /schema|validacao|xml/i.test(res.xMotivo)) status = 'erro_schema'

  return {
    status,
    cStat: res.cStat || null,
    xMotivo: res.xMotivo || null,
    nProt: res.protocolo || null,
    rawXml: res.raw || null
  }
}

export async function loadCertConfig(companyId) {
  const base = process.cwd()

  const loadSettings = (type, id) => {
    // check centralized path first, then legacy path
    const candidates = type === 'store'
      ? [path.join(base, 'settings', 'stores', id, 'settings.json'), path.join(base, 'public', 'uploads', 'store', id, 'settings.json')]
      : [path.join(base, 'settings', 'stores', id, 'settings.json'), path.join(base, 'public', 'uploads', type, id, 'settings.json')]
    for (const settingsPath of candidates) {
      try {
        if (fs.existsSync(settingsPath)) {
          return JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}')
        }
      } catch { /* ignore */ }
    }
    return {}
  }

  const settings = loadSettings('company', companyId)
  const result = { certPath: null, certPassword: null, certBuffer: null }

  if (settings.certFilename) {
    const cp = path.join(base, 'secure', 'certs', String(settings.certFilename))
    if (fs.existsSync(cp)) {
      result.certPath = cp
      result.certBuffer = fs.readFileSync(cp)
    }
  }

  if (settings.certPasswordEnc) {
    try {
      result.certPassword = decryptText(settings.certPasswordEnc)
    } catch (e) {
      console.warn(`[NFe] Falha ao descriptografar senha do certificado da empresa ${companyId} — provavelmente criptografada com CERT_STORE_KEY antiga. Re-salve a senha na edição da loja. Erro: ${e?.message}`)
      result.certPassword = null
    }
  } else if (process.env.NFE_CERT_PASSWORD) {
    result.certPassword = process.env.NFE_CERT_PASSWORD
  }

  return result
}

export function getEmitenteConfig(companyId, storeId) {
  const base = process.cwd()
  const result = { cnpj: null, ie: null, xNome: null, nfeSerie: null, nfeEnvironment: null, enderEmit: null }

  // Load company-level settings as base
  try {
    const companyPath = path.join(base, 'public', 'uploads', 'company', companyId, 'settings.json')
    if (fs.existsSync(companyPath)) {
      const raw = JSON.parse(fs.readFileSync(companyPath, 'utf8') || '{}')
      result.cnpj = raw.cnpj || null
      result.ie = raw.ie || null
      result.xNome = raw.xNome || raw.razaoSocial || null
      result.nfeSerie = raw.nfeSerie || null
      result.nfeEnvironment = raw.nfeEnvironment || null
      result.enderEmit = raw.enderEmit || null
    }
  } catch { /* ignore */ }

  // Override with store-level settings when storeId provided
  if (storeId) {
    const loadStoreSettings = (p) => { try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8') || '{}') } catch {} return null }
    const storeSettings = loadStoreSettings(path.join(base, 'settings', 'stores', storeId, 'settings.json'))
      || loadStoreSettings(path.join(base, 'public', 'uploads', 'store', storeId, 'settings.json'))
    if (storeSettings) {
      if (storeSettings.cnpj) result.cnpj = storeSettings.cnpj
      if (storeSettings.ie) result.ie = storeSettings.ie
      if (storeSettings.razaoSocial || storeSettings.xNome) result.xNome = storeSettings.razaoSocial || storeSettings.xNome
      if (storeSettings.nfeSerie) result.nfeSerie = storeSettings.nfeSerie
      if (storeSettings.nfeEnvironment) result.nfeEnvironment = storeSettings.nfeEnvironment
      if (storeSettings.enderEmit) result.enderEmit = storeSettings.enderEmit
    }
  }

  return result
}

const PAYMENT_MAP = {
  CASH: '01', MONEY: '01', Dinheiro: '01',
  CREDIT_CARD: '03', 'Crédito': '03',
  DEBIT_CARD: '04', 'Débito': '04',
  PIX: '17',
  VOUCHER: '05',
  // ONLINE/unknown → 01 (dinheiro): tPag=99 causes SVRS schema conflicts
  ONLINE: '01',
}

export async function emitNfeFromOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, store: true, company: true, customer: true }
  })
  if (!order) throw new Error('Pedido não encontrado')

  // If order has no linked customer but has phone, try to find the customer by phone
  if (!order.customer && order.customerPhone) {
    const phoneClean = String(order.customerPhone).replace(/\D/g, '')
    if (phoneClean) {
      const found = await prisma.customer.findFirst({
        where: { companyId: order.companyId, whatsapp: phoneClean }
      })
      if (found) {
        order.customer = found
        console.log('[NFe] Linked customer by phone:', { customerId: found.id, cpf: found.cpf })
      }
    }
  }

  if (order.payload?.nfe?.nProt) {
    return { success: false, error: 'NF-e já emitida para este pedido', nProt: order.payload.nfe.nProt, cStat: order.payload.nfe.cStat }
  }

  const fiscalConfig = await getFiscalConfigForOrder(orderId)
  if (!fiscalConfig.cnpj) throw new Error('CNPJ não configurado para esta loja/empresa')

  const certConfig = await loadCertConfig(order.companyId)
  // Determine effective storeId: use order.storeId or fall back to first store of company
  let effectiveStoreId = order.storeId
  if (!effectiveStoreId) {
    const firstStore = await prisma.store.findFirst({ where: { companyId: order.companyId }, select: { id: true } })
    if (firstStore) {
      effectiveStoreId = firstStore.id
      console.log('[NFe] order sem storeId, usando primeira loja da empresa:', effectiveStoreId)
    }
  }
  if (effectiveStoreId) {
    const storeCert = loadStoreCert(effectiveStoreId)
    if (storeCert.certPath) Object.assign(certConfig, storeCert)
  }
  if (!certConfig.certPath && !certConfig.certBuffer) {
    throw new Error('Certificado digital A1 (.pfx) não encontrado')
  }

  const emitenteConfig = effectiveStoreId
    ? getEmitenteConfig(order.companyId, effectiveStoreId)
    : getEmitenteConfig(order.companyId)

  const tpAmb = fiscalConfig.nfeEnvironment === 'production' ? '1' : '2'

  // Load fiscal data for each product (with category as fallback)
  const productIds = order.items.filter(i => i.productId).map(i => i.productId)
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { dadosFiscais: true, category: { include: { dadosFiscais: true } } }
      })
    : []
  const productMap = new Map(products.map(p => [p.id, p]))

  const det = order.items.map((item, idx) => {
    const prod = productMap.get(item.productId)
    const fiscal = prod?.dadosFiscais || prod?.category?.dadosFiscais || null

    const ncm = fiscal?.ncm ? String(fiscal.ncm).replace(/\D/g, '').padStart(8, '0').slice(0, 8) : '00000000'
    let cfop = '5102'
    if (fiscal?.cfops) {
      try {
        const cfopArr = typeof fiscal.cfops === 'string' ? JSON.parse(fiscal.cfops) : fiscal.cfops
        if (Array.isArray(cfopArr) && cfopArr.length > 0) cfop = String(cfopArr[0]).replace('.', '')
      } catch { /* keep default */ }
    }
    const ean = fiscal?.ean ? String(fiscal.ean).replace(/\D/g, '') : null
    const cEAN = (ean && ean.length >= 8) ? ean : 'SEM GTIN'

    return {
      nItem: idx + 1,
      prod: {
        xProd: item.name,
        cProd: String(item.id || idx + 1),
        NCM: ncm,
        CFOP: cfop,
        uCom: 'UN',
        qCom: String(Number(item.quantity).toFixed(4)),
        vUnCom: Number(item.price).toFixed(2),
        vProd: (Number(item.quantity) * Number(item.price)).toFixed(2),
        _ean: cEAN,
      },
      imposto: {
        pICMS: Number(fiscal?.icmsAliq || 0),
        _orig: String(fiscal?.orig ?? '0'),
        _modBC: fiscal?.icmsModBC != null ? String(fiscal.icmsModBC) : null,
        _pPIS: Number(fiscal?.pPIS || 0),
        _pCOFINS: Number(fiscal?.pCOFINS || 0),
        _pIPI: Number(fiscal?.pIPI || 0),
      }
    }
  })

  const vProd = det.reduce((s, d) => s + Number(d.prod.vProd), 0)

  const paymentRaw = order.payload?.payment || order.payload?.rawPayload?.payment || {}
  const methodKey = paymentRaw.method || paymentRaw.methodCode || paymentRaw.type || ''
  const tPag = PAYMENT_MAP[methodKey] || '99'

    // Resolve customer CPF from multiple possible sources
    const customerCpf = order.customer?.cpf
      || order.payload?.customer?.cpf
      || order.payload?.rawPayload?.customer?.cpf
      || order.payload?.cpf
      || ''
    const customerName = order.customer?.fullName || order.customerName
      || order.payload?.customer?.name || order.payload?.rawPayload?.customer?.name
      || ''

    console.log('[NFe] dest debug:', {
      customerId: order.customerId,
      customerCpfFromRelation: order.customer?.cpf,
      customerCpfFromPayload: order.payload?.customer?.cpf || order.payload?.rawPayload?.customer?.cpf,
      resolvedCpf: customerCpf,
      resolvedName: customerName
    })

    const data = {
    ide: {
      natOp: 'VENDA',
      mod: '65',
      serie: fiscalConfig.nfeSerie || '1',
      nNF: sanitizeNNF(String(order.displaySimple || order.displayId || Date.now())),
      tpAmb
    },
    emit: {
      CNPJ: fiscalConfig.cnpj,
      xNome: emitenteConfig.xNome || order.company?.name || '',
      IE: fiscalConfig.ie || 'ISENTO',
      CRT: '1',
      enderEmit: emitenteConfig.enderEmit || {}
    },
    dest: {
      CPF: customerCpf,
      xNome: customerName,
      enderDest: {
        xLgr: order.address || emitenteConfig.enderEmit?.xLgr || 'NAO INFORMADO',
        nro: emitenteConfig.enderEmit?.nro || 'S/N',
        xBairro: order.deliveryNeighborhood || emitenteConfig.enderEmit?.xBairro || 'NAO INFORMADO',
        cMun: emitenteConfig.enderEmit?.cMun || '',
        xMun: emitenteConfig.enderEmit?.xMun || '',
        UF: emitenteConfig.enderEmit?.UF || 'BA',
        CEP: emitenteConfig.enderEmit?.CEP || '00000000'
      }
    },
    det,
    total: {
      vProd: vProd.toFixed(2),
      vICMS: '0.00',
      vNF: vProd.toFixed(2)
    },
    pag: { tPag, vPag: vProd.toFixed(2), vTroco: '0.00' }
  }

  const infNFe = buildNfePayload(data)
  const signed = await signNfeXml(infNFe, certConfig, { csc: fiscalConfig.csc, cscId: fiscalConfig.cscId })
  const uf = (emitenteConfig.enderEmit?.UF || 'BA').toLowerCase()
  const result = await transmitNfe(signed.signedXml, { ...certConfig, tpAmb }, uf)

  await saveNfeProtocol({
    companyId: order.companyId,
    orderId: order.id,
    nProt: result.nProt,
    cStat: result.cStat,
    xMotivo: result.xMotivo,
    rawXml: result.rawXml
  })

  return {
    success: result.status === 'autorizado',
    status: result.status,
    cStat: result.cStat,
    xMotivo: result.xMotivo,
    nProt: result.nProt
  }
}

function loadStoreCert(storeId) {
  const base = process.cwd()
  const result = { certPath: null, certPassword: null, certBuffer: null }
  const candidates = [
    path.join(base, 'settings', 'stores', storeId, 'settings.json'),
    path.join(base, 'public', 'uploads', 'store', storeId, 'settings.json')
  ]
  for (const settingsPath of candidates) {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}')
        if (settings.certFilename) {
          const cp = path.join(base, 'secure', 'certs', String(settings.certFilename))
          if (fs.existsSync(cp)) {
            result.certPath = cp
            result.certBuffer = fs.readFileSync(cp)
          }
        }
        if (settings.certPasswordEnc) {
          try { result.certPassword = decryptText(settings.certPasswordEnc) } catch (e) { console.warn('Failed to decrypt store cert password', storeId, e?.message) }
        }
        if (result.certPath) break
      }
    } catch { /* ignore */ }
  }
  return result
}

export default { saveNfeProtocol, buildNfePayload, signNfeXml, transmitNfe, loadCertConfig, getEmitenteConfig, emitNfeFromOrder }

/**
 * Resolve fiscal configuration for an order, preferring store-level settings when available.
 *
 * Returns an object with keys:
 *  - cnpj, ie, nfeSerie, nfeEnvironment, csc, cscId
 *  - certPath: absolute path to a .pfx certificate file (if found)
 *  - certExists: boolean
 *  - source: 'store' | 'company'
 *
 * This helper reads the public settings files under:
 *  - public/uploads/company/<companyId>/settings.json
 *  - public/uploads/store/<storeId>/settings.json
 * and checks for certificate files placed in secure/certs/ (filename stored in settings.certFilename)
 */
export async function getFiscalConfigForOrder(orderId) {
  if (!orderId) throw new Error('orderId is required')
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, companyId: true, storeId: true } })
  if (!order) throw new Error('Order not found')

  const path = await import('path')
  const fs = await import('fs')
  const base = process.cwd()

  // Helper to load JSON settings file if present (tries centralized then legacy path)
  const loadSettings = async (type, id) => {
    const candidates = type === 'store'
      ? [path.join(base, 'settings', 'stores', id, 'settings.json'), path.join(base, 'public', 'uploads', 'store', id, 'settings.json')]
      : [path.join(base, 'public', 'uploads', type, id, 'settings.json')]
    for (const settingsPath of candidates) {
      try {
        if (fs.existsSync(settingsPath)) {
          const raw = await fs.promises.readFile(settingsPath, 'utf8')
          return JSON.parse(raw || '{}')
        }
      } catch (e) { /* ignore parse errors */ }
    }
    return {}
  }

  // Start with company-level settings
  const companyExtra = await loadSettings('company', order.companyId)
  const result = {
    cnpj: companyExtra.cnpj || null,
    ie: companyExtra.ie || null,
    nfeSerie: companyExtra.nfeSerie || null,
    nfeEnvironment: companyExtra.nfeEnvironment || null,
    csc: companyExtra.csc || null,
    cscId: companyExtra.cscId || null,
    certPath: null,
    certExists: false,
    source: 'company',
  }

  // company cert file (if present)
  if (companyExtra.certFilename) {
    const cp = path.join(base, 'secure', 'certs', String(companyExtra.certFilename))
    try { if (fs.existsSync(cp)) { result.certPath = cp; result.certExists = true } } catch (e) { /* ignore */ }
  }

  // If order is bound to a store, allow store overrides
  if (order.storeId) {
    const storeExtra = await loadSettings('store', order.storeId)
    // prefer store-level simple fields when present
    if (storeExtra.cnpj) result.cnpj = storeExtra.cnpj
    if (storeExtra.ie) result.ie = storeExtra.ie
    if (storeExtra.nfeSerie) result.nfeSerie = storeExtra.nfeSerie
    if (storeExtra.nfeEnvironment) result.nfeEnvironment = storeExtra.nfeEnvironment
    if (storeExtra.csc) result.csc = storeExtra.csc
    if (storeExtra.cscId) result.cscId = storeExtra.cscId

    // store-specified certificate filename (preferred)
    if (storeExtra.certFilename) {
      const sp = path.join(base, 'secure', 'certs', String(storeExtra.certFilename))
      try { if (fs.existsSync(sp)) { result.certPath = sp; result.certExists = true; result.source = 'store' } } catch (e) { /* ignore */ }
    }

    // also allow common store certificate filename patterns if explicit filename not present
    if (!result.certPath) {
      const candidates = [
        path.join(base, 'secure', 'certs', `${order.storeId}.pfx`),
        path.join(base, 'secure', 'certs', `store-${order.storeId}.pfx`),
      ]
      for (const c of candidates) {
        try { if (fs.existsSync(c)) { result.certPath = c; result.certExists = true; result.source = 'store'; break } } catch (e) { /* ignore */ }
      }
    }
  }

  // If we didn't set a store cert and company cert exists, keep company cert as source
  if (!result.certPath && result.certExists === false && companyExtra.certFilename) {
    const cp = path.join(base, 'secure', 'certs', String(companyExtra.certFilename))
    try { if (fs.existsSync(cp)) { result.certPath = cp; result.certExists = true; result.source = 'company' } } catch (e) { /* ignore */ }
  }

  // attach encrypted password where present (store first, then company); do not expose decrypted password here
  if (order.storeId) {
    try {
      const storeExtra = await loadSettings('store', order.storeId)
      if (storeExtra.certPasswordEnc) result.certPasswordEnc = storeExtra.certPasswordEnc
    } catch (e) {}
  }
  if (!result.certPasswordEnc && companyExtra.certPasswordEnc) result.certPasswordEnc = companyExtra.certPasswordEnc

  return result
}
