import express from 'express'
import { saveNfeProtocol, getFiscalConfigForOrder, buildNfePayload, signNfeXml, transmitNfe, loadCertConfig, getEmitenteConfig, emitNfeFromOrder } from '../services/nfe.js'
import { authMiddleware, requireRole } from '../auth.js'
import { prisma } from '../prisma.js'
import { decryptText } from '../utils/secretStore.js'
import fs from 'fs'
import path from 'path'
import https from 'https'
import axios from 'axios'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export const nfeRouter = express.Router()

// Middleware: verifica se a empresa tem o Módulo Fiscal habilitado no plano
async function requireFiscalModule(req, res, next) {
  try {
    const companyId = req.user?.companyId
    if (!companyId) return res.status(401).json({ error: 'Não autenticado' })
    const sub = await prisma.saasSubscription.findUnique({
      where: { companyId },
      include: { plan: { include: { modules: { include: { module: true } } } } }
    })
    const hasFiscal = sub?.plan?.modules?.some(pm => pm.module?.key === 'FISCAL' && pm.module?.isActive !== false)
    if (!hasFiscal) return res.status(403).json({ error: 'Módulo Fiscal não habilitado no seu plano.' })
    next()
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) })
  }
}

// Persist SEFAZ authorization/protocol returned by SEFAZ
// Expected body: { companyId, orderId?, nProt?, cStat?, xMotivo?, rawXml? }
nfeRouter.post('/protocol', async (req, res) => {
  try {
    const { companyId, orderId, nProt, cStat, xMotivo, rawXml } = req.body
    if (!companyId) return res.status(400).json({ error: 'companyId required' })

    const rec = await saveNfeProtocol({ companyId, orderId, nProt, cStat, xMotivo, rawXml })
    return res.json({ success: true, record: rec })
  } catch (err) {
    console.error('Failed to save NFe protocol:', err?.message || err)
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

// Debug endpoint: resolve fiscal configuration for an order (prefers store overrides)
nfeRouter.get('/config/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params
    if (!orderId) return res.status(400).json({ error: 'orderId required' })
    const cfg = await getFiscalConfigForOrder(orderId)
    // do not leak sensitive data in production
    if (process.env.NODE_ENV === 'production') {
      delete cfg.certPasswordEnc
      // hide absolute cert path in production
      delete cfg.certPath
    }
    return res.json({ success: true, config: cfg })
  } catch (err) {
    console.error('Failed to resolve fiscal config:', err?.message || err)
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

nfeRouter.get('/emitente-config', authMiddleware, requireFiscalModule, async (req, res) => {
  try {
    const companyId = req.user?.companyId
    if (!companyId) return res.status(400).json({ error: 'companyId not found in token' })
    const config = getEmitenteConfig(companyId)
    return res.json({ success: true, config })
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

nfeRouter.post('/emit', authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN'), requireFiscalModule, async (req, res) => {
  try {
    const { ide, emit, dest, det, total, pag, orderId } = req.body
    const companyId = req.user?.companyId

    if (!companyId) return res.status(400).json({ error: 'companyId not found in token' })
    if (!ide?.nNF) return res.status(400).json({ error: 'Número da NF (nNF) é obrigatório' })
    if (!det?.length) return res.status(400).json({ error: 'Pelo menos um item é obrigatório' })
    if (!emit?.CNPJ) return res.status(400).json({ error: 'CNPJ do emitente é obrigatório' })

    const infNFe = buildNfePayload({ ide, emit, dest, det, total, pag })

    const certConfig = await loadCertConfig(companyId)
    if (!certConfig.certPath && !certConfig.certBuffer) {
      return res.status(400).json({ error: 'Certificado digital A1 (.pfx) não encontrado. Configure em Configurações > Fiscal.' })
    }

    const signed = await signNfeXml(infNFe, certConfig)

    const uf = emit.enderEmit?.UF?.toLowerCase() || 'ba'
    const result = await transmitNfe(signed.signedXml, { ...certConfig, tpAmb: ide.tpAmb || '2' }, uf)

    if (result.nProt || result.cStat) {
      await saveNfeProtocol({
        companyId,
        orderId: orderId || null,
        nProt: result.nProt,
        cStat: result.cStat,
        xMotivo: result.xMotivo,
        rawXml: result.rawXml
      })
    }

    const success = result.status === 'autorizado'
    return res.json({
      success,
      status: result.status,
      cStat: result.cStat,
      xMotivo: result.xMotivo,
      nProt: result.nProt
    })
  } catch (err) {
    console.error('NFe emit error:', err?.message || err)
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

nfeRouter.post('/emit-from-order', authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN'), requireFiscalModule, async (req, res) => {
  try {
    const { orderId, orderIds } = req.body

    if (orderIds && Array.isArray(orderIds) && orderIds.length > 0) {
      const results = []
      for (const id of orderIds) {
        try {
          const r = await emitNfeFromOrder(id)
          results.push({ orderId: id, ...r })
        } catch (err) {
          results.push({ orderId: id, success: false, error: err?.message || String(err) })
        }
      }
      return res.json({ success: true, results })
    }

    if (!orderId) return res.status(400).json({ error: 'orderId ou orderIds é obrigatório' })

    const result = await emitNfeFromOrder(orderId)
    return res.json(result)
  } catch (err) {
    // Build detailed error info for diagnostics
    const detail = {
      message: err?.message || String(err),
      // Axios errors carry response info
      httpStatus: err?.response?.status || null,
      httpData: err?.response?.data ? (typeof err.response.data === 'string' ? err.response.data.substring(0, 1000) : JSON.stringify(err.response.data).substring(0, 1000)) : null,
      url: err?.config?.url || null,
      code: err?.code || null,
      stack: err?.stack?.split('\n').slice(0, 5).join('\n') || null
    }
    console.error('NFe emit-from-order error:', JSON.stringify(detail, null, 2))
    return res.status(500).json({
      error: err?.message || String(err),
      detail: process.env.NODE_ENV !== 'production' ? detail : undefined
    })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// DEBUG: Diagnóstico completo do certificado + conexão SEFAZ
// POST /nfe/debug-cert
// Body (opcional): { storeId }
// Retorna checklist detalhado de cada etapa: cert encontrado, senha, leitura PFX,
// dados do certificado, e teste de Status Serviço na SEFAZ (homologação).
// ══════════════════════════════════════════════════════════════════════════════
nfeRouter.post('/debug-cert', authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN'), requireFiscalModule, async (req, res) => {
  const steps = []
  const addStep = (name, status, detail) => { steps.push({ step: name, status, detail }); return status === 'ok' }
  const companyId = req.user?.companyId
  if (!companyId) return res.status(400).json({ error: 'companyId não encontrado no token' })

  const { storeId } = req.body || {}

  // ── 1. Variáveis de ambiente ──
  const hasCertStoreKey = !!process.env.CERT_STORE_KEY
  addStep('CERT_STORE_KEY configurada', hasCertStoreKey ? 'ok' : 'fail',
    hasCertStoreKey ? 'Variável presente' : 'CERT_STORE_KEY não definida — senhas de certificado não podem ser descriptografadas')

  // ── 2. Resolver settings (company + store) ──
  const base = process.cwd()
  let settings = {}
  let settingsSource = null
  const settingsPaths = []

  if (storeId) {
    settingsPaths.push(
      { label: `settings/stores/${storeId}/settings.json`, path: path.join(base, 'settings', 'stores', storeId, 'settings.json') },
      { label: `public/uploads/store/${storeId}/settings.json`, path: path.join(base, 'public', 'uploads', 'store', storeId, 'settings.json') }
    )
  }
  settingsPaths.push(
    { label: `public/uploads/company/${companyId}/settings.json`, path: path.join(base, 'public', 'uploads', 'company', companyId, 'settings.json') }
  )

  for (const sp of settingsPaths) {
    const exists = fs.existsSync(sp.path)
    if (exists && !settingsSource) {
      try {
        settings = JSON.parse(fs.readFileSync(sp.path, 'utf8') || '{}')
        settingsSource = sp.label
      } catch (e) {
        addStep(`Leitura ${sp.label}`, 'fail', `Erro ao ler/parsear: ${e?.message}`)
      }
    }
    steps.push({ step: `Arquivo ${sp.label}`, status: exists ? (settingsSource === sp.label ? 'ok (usado)' : 'ok (encontrado)') : 'não encontrado', detail: sp.path })
  }
  addStep('Settings carregados', settingsSource ? 'ok' : 'warn',
    settingsSource ? `Usando: ${settingsSource}` : 'Nenhum arquivo settings.json encontrado')

  // ── 3. Verificar campos fiscais ──
  const fiscalFields = ['cnpj', 'ie', 'razaoSocial', 'nfeSerie', 'nfeEnvironment', 'csc', 'cscId']
  const missingFiscal = fiscalFields.filter(f => !settings[f])
  addStep('Campos fiscais', missingFiscal.length === 0 ? 'ok' : 'warn',
    missingFiscal.length === 0 ? 'Todos presentes' : `Campos ausentes: ${missingFiscal.join(', ')}`)

  // endereço emitente
  const enderEmit = settings.enderEmit || {}
  const enderFields = ['xLgr', 'nro', 'xBairro', 'cMun', 'xMun', 'UF', 'CEP']
  const missingEnder = enderFields.filter(f => !enderEmit[f])
  addStep('Endereço do emitente', missingEnder.length === 0 ? 'ok' : 'warn',
    missingEnder.length === 0 ? 'Completo' : `Campos ausentes: ${missingEnder.join(', ')}`)

  // ── 4. Verificar arquivo PFX ──
  let certFilename = settings.certFilename
  let certPath = null
  let certBuffer = null

  if (certFilename) {
    certPath = path.join(base, 'secure', 'certs', String(certFilename))
    const certExists = fs.existsSync(certPath)
    addStep('Arquivo PFX', certExists ? 'ok' : 'fail',
      certExists ? `${certPath} (${(fs.statSync(certPath).size / 1024).toFixed(1)} KB)` : `Arquivo não encontrado: ${certPath}`)
    if (certExists) certBuffer = fs.readFileSync(certPath)
  } else {
    addStep('Arquivo PFX', 'fail', 'certFilename não definido no settings.json')
  }

  // ── 5. Descriptografar senha do certificado ──
  let certPassword = null
  let certPasswordFailed = false
  const certPasswordEnc = settings.certPasswordEnc
  if (certPasswordEnc) {
    try {
      certPassword = decryptText(certPasswordEnc)
      addStep('Senha do certificado', 'ok', `Descriptografada com sucesso (${certPassword ? certPassword.length : 0} caracteres)`)
    } catch (e) {
      certPasswordFailed = true
      const hint = /authenticate data|unsupported state/i.test(e?.message)
        ? 'A CERT_STORE_KEY atual é diferente da usada ao salvar a senha. A senha precisa ser re-salva: edite a loja, preencha a senha do PFX e clique Salvar.'
        : e?.message
      addStep('Senha do certificado', 'fail', `Falha ao descriptografar: ${hint}`)
    }
  } else if (process.env.NFE_CERT_PASSWORD) {
    certPassword = process.env.NFE_CERT_PASSWORD
    addStep('Senha do certificado', 'ok', 'Usando NFE_CERT_PASSWORD do ambiente')
  } else {
    addStep('Senha do certificado', 'warn', 'Nenhuma senha armazenada (certPasswordEnc ausente) e NFE_CERT_PASSWORD não definida')
  }

  // ── 6. Ler e validar PFX com node-forge ──
  let certInfo = null
  let effectivePassword = certPassword // the password that actually opens the PFX
  if (certBuffer) {
    try {
      const forge = require('node-forge')
      const raw = certBuffer.toString('binary')
      const p12Asn1 = forge.asn1.fromDer(raw)
      // Try with decrypted password first, then empty string, then null
      let p12 = null
      const passwordsToTry = [certPassword, '', null]
      let usedPassword = null
      for (const pw of passwordsToTry) {
        try {
          p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pw ?? '')
          usedPassword = pw
          break
        } catch (tryErr) {
          // try next password
        }
      }
      if (!p12) {
        // all passwords failed — try one more time to get the actual error
        p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, certPassword || '')
      }

      // Track which password actually worked for use in SEFAZ test
      effectivePassword = usedPassword

      // Report if the stored password didn't work but empty did
      if (certPasswordFailed && usedPassword === '') {
        addStep('Nota sobre senha', 'warn', 'PFX aberto com senha vazia — o certificado pode não ter senha, mas a senha armazenada está corrompida. Re-salve na edição da loja.')
      } else if (certPassword && usedPassword !== certPassword) {
        addStep('Nota sobre senha', 'warn', `PFX aberto com senha diferente da armazenada (usou: ${usedPassword === '' ? 'vazia' : 'alternativa'})`)
      }

      let keyObj = null
      const allCerts = []
      for (const sc of p12.safeContents) {
        for (const sb of sc.safeBags) {
          if (sb.type === forge.pki.oids.certBag && sb.cert) allCerts.push(sb.cert)
          if (sb.type === forge.pki.oids.pkcs8ShroudedKeyBag || sb.type === forge.pki.oids.keyBag) keyObj = sb.key
        }
      }
      // Pick the cert whose public key matches the private key (modulus)
      let certObj = allCerts[0] || null
      if (keyObj && allCerts.length > 1) {
        const privMod = keyObj.n.toString(16)
        for (const c of allCerts) {
          if (c.publicKey && c.publicKey.n.toString(16) === privMod) { certObj = c; break }
        }
      }
      const keyFound = !!keyObj

      if (certObj && keyFound) {
        const notBefore = certObj.validity?.notBefore
        const notAfter = certObj.validity?.notAfter
        const subject = certObj.subject?.attributes?.map(a => `${a.shortName}=${a.value}`).join(', ')
        const issuer = certObj.issuer?.attributes?.map(a => `${a.shortName}=${a.value}`).join(', ')
        const now = new Date()
        const expired = notAfter && now > notAfter
        const notYetValid = notBefore && now < notBefore

        certInfo = {
          subject,
          issuer,
          notBefore: notBefore?.toISOString(),
          notAfter: notAfter?.toISOString(),
          expired: !!expired,
          notYetValid: !!notYetValid,
          daysRemaining: notAfter ? Math.floor((notAfter - now) / 86400000) : null
        }

        let certStatus = 'ok'
        let certDetail = `Válido até ${notAfter?.toISOString()}`
        if (expired) { certStatus = 'fail'; certDetail = `CERTIFICADO EXPIRADO em ${notAfter?.toISOString()}` }
        else if (notYetValid) { certStatus = 'fail'; certDetail = `Certificado ainda não válido (início: ${notBefore?.toISOString()})` }
        else if (certInfo.daysRemaining !== null && certInfo.daysRemaining < 30) { certStatus = 'warn'; certDetail += ` (ATENÇÃO: expira em ${certInfo.daysRemaining} dias)` }

        addStep('Leitura do PFX', certStatus, certDetail)
        addStep('Subject do certificado', 'info', subject || 'N/A')
        addStep('Emissor do certificado', 'info', issuer || 'N/A')
      } else {
        addStep('Leitura do PFX', 'fail', `Chave privada: ${keyFound ? 'Sim' : 'NÃO'}, Certificado: ${certObj ? 'Sim' : 'NÃO'}`)
      }
    } catch (e) {
      const msg = e?.message || String(e)
      let hint = msg
      if (/decrypt|password|mac/i.test(msg)) hint = `Senha incorreta ou ausente para o PFX. Erro: ${msg}`
      else if (/asn1|invalid/i.test(msg)) hint = `Arquivo PFX corrompido ou formato inválido. Erro: ${msg}`
      addStep('Leitura do PFX', 'fail', hint)
    }
  }

  // ── 7. Teste de conexão SEFAZ (Status Serviço) ──
  const tpAmb = (settings.nfeEnvironment === 'production') ? '1' : '2'
  const envLabel = tpAmb === '1' ? 'Produção' : 'Homologação'
  const uf = (enderEmit.UF || 'BA').toUpperCase()

  // Status-Serviço XML body
  const statusServicoXml = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
        <tpAmb>${tpAmb}</tpAmb>
        <cUF>${getUFCode(uf)}</cUF>
        <xServ>STATUS</xServ>
      </consStatServ>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`

  // Resolve SEFAZ status endpoint
  const statusEndpoints = {
    BA: { '2': 'https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx', '1': 'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx' },
    SP: { '2': 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx', '1': 'https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx' },
    MG: { '2': 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4', '1': 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4' },
    RS: { '2': 'https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '1': 'https://nfe.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx' },
    PR: { '2': 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4', '1': 'https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4' },
  }
  // Fallback to SVRS for states not listed
  const SVRS = { '2': 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx', '1': 'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx' }
  const endpoints = statusEndpoints[uf] || SVRS
  const statusUrl = endpoints[tpAmb]

  addStep('Endpoint SEFAZ', 'info', `${statusUrl} (${envLabel}, UF: ${uf})`)

  if (certBuffer) {
    try {
      // Use node-forge to extract PEM key+cert from PFX instead of passing
      // raw PFX to https.Agent — Node.js 17+ / OpenSSL 3.0 rejects legacy
      // PKCS12 encryption (RC2/DES) commonly used by Brazilian CAs.
      const forge = require('node-forge')
      const rawBin = certBuffer.toString('binary')
      const asn1 = forge.asn1.fromDer(rawBin)
      const p12Agent = forge.pkcs12.pkcs12FromAsn1(asn1, effectivePassword ?? '')
      let agentKeyObj = null
      const agentCerts = []
      for (const sc of p12Agent.safeContents) {
        for (const sb of sc.safeBags) {
          if (sb.type === forge.pki.oids.certBag && sb.cert) agentCerts.push(sb.cert)
          if (sb.type === forge.pki.oids.pkcs8ShroudedKeyBag || sb.type === forge.pki.oids.keyBag) agentKeyObj = sb.key
        }
      }
      if (!agentKeyObj || agentCerts.length === 0) throw new Error('Chave privada ou certificado não encontrados no PFX')
      // Pick cert matching the private key (modulus comparison)
      let agentCertObj = agentCerts[0]
      if (agentCerts.length > 1) {
        const mod = agentKeyObj.n.toString(16)
        for (const c of agentCerts) {
          if (c.publicKey && c.publicKey.n.toString(16) === mod) { agentCertObj = c; break }
        }
      }
      const keyPem = forge.pki.privateKeyToPem(agentKeyObj)
      const certPem = forge.pki.certificateToPem(agentCertObj)

      const httpsAgent = new https.Agent({ key: keyPem, cert: certPem, rejectUnauthorized: false })
      const sefazRes = await axios.post(statusUrl, statusServicoXml, {
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF"'
        },
        httpsAgent,
        timeout: 30000,
        validateStatus: () => true // accept any HTTP status
      })

      const responseText = typeof sefazRes.data === 'string' ? sefazRes.data : String(sefazRes.data)

      // Parse key fields from XML response
      const cStatMatch = responseText.match(/<cStat>(.*?)<\/cStat>/)
      const xMotivoMatch = responseText.match(/<xMotivo>(.*?)<\/xMotivo>/)
      const tRetMatch = responseText.match(/<tMed>(.*?)<\/tMed>/)
      const dhRecMatch = responseText.match(/<dhRecbto>(.*?)<\/dhRecbto>/)
      const cUFMatch = responseText.match(/<cUF>(.*?)<\/cUF>/)

      const sefazCStat = cStatMatch?.[1]
      const sefazMotivo = xMotivoMatch?.[1]

      if (sefazRes.status >= 200 && sefazRes.status < 300 && sefazCStat) {
        const sefazOk = sefazCStat === '107' // 107 = Serviço em Operação
        addStep('SEFAZ Status Serviço', sefazOk ? 'ok' : 'warn', `HTTP ${sefazRes.status} — cStat=${sefazCStat}: ${sefazMotivo || 'sem descrição'}`)
        if (tRetMatch) steps.push({ step: 'Tempo médio de resposta SEFAZ', status: 'info', detail: `${tRetMatch[1]} segundos` })
        if (dhRecMatch) steps.push({ step: 'Data/hora SEFAZ', status: 'info', detail: dhRecMatch[1] })
      } else {
        addStep('SEFAZ Status Serviço', 'fail', `HTTP ${sefazRes.status} — ${sefazMotivo || responseText.substring(0, 500)}`)
      }

      // Include raw response for debugging
      steps.push({ step: 'Resposta SEFAZ (raw)', status: 'info', detail: responseText.substring(0, 2000) })

    } catch (e) {
      const msg = e?.message || String(e)
      let hint = msg
      if (/mac verify failure/i.test(msg)) hint = `Senha do certificado incorreta ou ausente — o PFX não pôde ser aberto para autenticação mútua TLS. Re-salve a senha na edição da loja. Erro: ${msg}`
      else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(msg)) hint = `Falha de rede ao conectar na SEFAZ. Verifique conectividade e firewall. Erro: ${msg}`
      else if (/routines:.*:wrong/i.test(msg) || /ssl|tls|handshake/i.test(msg)) hint = `Falha TLS/SSL — o certificado pode estar expirado, senha incorreta, ou o PFX é inválido para autenticação mútua. Erro: ${msg}`
      else if (/DEPTH_ZERO_SELF_SIGNED/i.test(msg)) hint = `Certificado autoassinado rejeitado. Erro: ${msg}`
      addStep('SEFAZ Status Serviço', 'fail', hint)
    }
  } else {
    addStep('SEFAZ Status Serviço', 'skip', 'Sem certificado PFX disponível — impossível testar conexão')
  }

  // ── Resumo ──
  const failures = steps.filter(s => s.status === 'fail')
  const warnings = steps.filter(s => s.status === 'warn')
  const summary = failures.length === 0
    ? (warnings.length === 0 ? '✅ Tudo OK — certificado válido e SEFAZ respondendo' : `⚠️ ${warnings.length} aviso(s) encontrado(s)`)
    : `❌ ${failures.length} erro(s) encontrado(s)`

  return res.json({ summary, certInfo, steps })
})

// ── Relatório de notas emitidas ─────────────────────────────────────────────
// GET /nfe/emitidas?page=1&limit=20&from=YYYY-MM-DD&to=YYYY-MM-DD&search=nome&status=100
nfeRouter.get('/emitidas', authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN'), requireFiscalModule, async (req, res) => {
  try {
    const companyId = req.user?.companyId
    if (!companyId) return res.status(400).json({ error: 'companyId not found in token' })

    const page  = Math.max(1, parseInt(req.query.page)  || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20))
    const skip  = (page - 1) * limit

    const where = { companyId }

    if (req.query.from || req.query.to) {
      where.createdAt = {}
      if (req.query.from) where.createdAt.gte = new Date(req.query.from)
      if (req.query.to)   { const to = new Date(req.query.to); to.setHours(23,59,59,999); where.createdAt.lte = to }
    }
    if (req.query.status) where.cStat = req.query.status

    const [protocols, total] = await Promise.all([
      prisma.nfeProtocol.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, displayId: true, displaySimple: true, customerName: true, total: true, payload: true } },
          store: { select: { id: true, name: true } }
        }
      }),
      prisma.nfeProtocol.count({ where })
    ])

    let data = protocols
    if (req.query.search) {
      const term = req.query.search.toLowerCase()
      data = protocols.filter(p =>
        (p.order?.customerName || '').toLowerCase().includes(term) ||
        (p.nProt || '').includes(term)
      )
    }

    return res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

// GET /nfe/xml/:id — download raw XML stored for the protocol
nfeRouter.get('/xml/:id', authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN'), requireFiscalModule, async (req, res) => {
  try {
    const companyId = req.user?.companyId
    const protocol = await prisma.nfeProtocol.findFirst({ where: { id: req.params.id, companyId } })
    if (!protocol) return res.status(404).json({ error: 'Protocolo não encontrado' })
    if (!protocol.rawXml) return res.status(404).json({ error: 'XML não disponível para este protocolo' })

    const filename = `nfe-${protocol.nProt || protocol.id}.xml`
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(protocol.rawXml)
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

// POST /nfe/cancelar — local cancellation (SEFAZ NFeRecepcaoEvento: TODO)
nfeRouter.post('/cancelar', authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN'), requireFiscalModule, async (req, res) => {
  try {
    const companyId = req.user?.companyId
    const { nfeProtocolId, motivo } = req.body
    if (!nfeProtocolId) return res.status(400).json({ error: 'nfeProtocolId é obrigatório' })
    if (!motivo || String(motivo).trim().length < 15)
      return res.status(400).json({ error: 'Motivo deve ter pelo menos 15 caracteres' })

    const protocol = await prisma.nfeProtocol.findFirst({ where: { id: nfeProtocolId, companyId } })
    if (!protocol) return res.status(404).json({ error: 'Protocolo não encontrado' })
    if (protocol.cStat === 'CANCELADA') return res.status(400).json({ error: 'NF-e já está cancelada' })

    // TODO: enviar evento de cancelamento (110111) para SEFAZ via NFeRecepcaoEvento
    const updated = await prisma.nfeProtocol.update({
      where: { id: nfeProtocolId },
      data: { cStat: 'CANCELADA', xMotivo: `CANCELADA: ${String(motivo).trim()}` }
    })

    if (protocol.orderId) {
      await prisma.order.update({ where: { id: protocol.orderId }, data: { status: 'INVOICE_CANCELLED' } })
    }

    return res.json({ success: true, record: updated })
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

// POST /nfe/enviar-email — stub (email service integration: TODO)
nfeRouter.post('/enviar-email', authMiddleware, requireRole('ADMIN', 'SUPER_ADMIN'), requireFiscalModule, async (req, res) => {
  try {
    const companyId = req.user?.companyId
    const { nfeProtocolId, email } = req.body
    if (!nfeProtocolId) return res.status(400).json({ error: 'nfeProtocolId é obrigatório' })
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'E-mail inválido' })

    const protocol = await prisma.nfeProtocol.findFirst({ where: { id: nfeProtocolId, companyId } })
    if (!protocol) return res.status(404).json({ error: 'Protocolo não encontrado' })
    if (!protocol.rawXml) return res.status(400).json({ error: 'XML não disponível' })

    // TODO: enviar via nodemailer/SMTP configurado na empresa
    return res.status(501).json({ error: 'Serviço de e-mail não configurado. Integre SMTP nas configurações.' })
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) })
  }
})

// Código de UF (IBGE) a partir da sigla
function getUFCode(uf) {
  const codes = { AC:'12', AL:'27', AM:'13', AP:'16', BA:'29', CE:'23', DF:'53', ES:'32', GO:'52', MA:'21', MG:'31', MS:'50', MT:'51', PA:'15', PB:'25', PE:'26', PI:'22', PR:'41', RJ:'33', RN:'24', RO:'11', RR:'14', RS:'43', SC:'42', SE:'28', SP:'35', TO:'17' }
  return codes[uf?.toUpperCase()] || '29'
}

export default nfeRouter
