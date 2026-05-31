// Generates the DANFE HTML for a NFC-e — extracted from the inline route
// handler in routes/nfe.js#GET /nfe/danfe/:orderId so the same template can
// power three surfaces: the print preview (existing /danfe/:orderId), the
// PDF download (/danfe-pdf/:orderId), and the e-mail attachment (PDF body
// of /enviar-email). When the e-mail/PDF callers render through Puppeteer,
// they pass forPrint=false so the embedded "Imprimir" button and the
// auto-print script don't leak into the static document.

import { prisma } from '../prisma.js'
import { getFiscalConfigForOrder, getEmitenteConfig } from './nfe.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export async function generateDanfeHtml(orderId, companyId, { forPrint = true } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, store: true, company: true },
  })
  if (!order || order.companyId !== companyId) {
    const err = new Error('Pedido não encontrado')
    err.status = 404
    throw err
  }

  const protocol = await prisma.nfeProtocol.findFirst({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  })
  if (!protocol) {
    const err = new Error('NF-e não emitida para este pedido')
    err.status = 404
    throw err
  }

  const rawXml = protocol.rawXml || ''
  const extract = (tag, xml) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    return m ? m[1].trim() : ''
  }
  const chNFe = extract('chNFe', rawXml) || ''
  const dhRecbto = extract('dhRecbto', rawXml) || new Date().toISOString()
  const nProt = protocol.nProt || extract('nProt', rawXml) || ''

  const chaveFormatted = chNFe.replace(/(\d{4})(?=\d)/g, '$1 ')

  let emissaoStr = ''
  try {
    const d = new Date(dhRecbto)
    emissaoStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { emissaoStr = dhRecbto }

  const fiscalConfig = await getFiscalConfigForOrder(orderId).catch(() => ({}))
  const emitenteConfig = order.storeId ? getEmitenteConfig(companyId, order.storeId) : getEmitenteConfig(companyId)
  const enderEmit = emitenteConfig?.enderEmit || {}

  const cnpj = fiscalConfig.cnpj || ''
  const cnpjFormatted = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  const ie = fiscalConfig.ie || 'ISENTO'
  const xNome = emitenteConfig?.xNome || order.store?.name || order.company?.name || ''
  const xFant = order.store?.name || xNome
  const logradouro = [enderEmit.xLgr, enderEmit.nro].filter(Boolean).join(', ')
  const municipio = [enderEmit.xMun, enderEmit.UF].filter(Boolean).join(' - ')
  const cep = (enderEmit.CEP || '').replace(/(\d{5})(\d{3})/, '$1-$2')
  const fone = order.store?.phone || ''
  const nNF = extract('nNF', rawXml) || order.displaySimple || ''
  const serie = extract('serie', rawXml) || fiscalConfig.nfeSerie || '1'
  const tpAmb = extract('tpAmb', rawXml) || '2'

  const items = (order.items || []).map(it => ({
    cProd: it.id?.slice(0, 8) || '',
    xProd: it.name || '',
    qCom: Number(it.quantity || 1).toFixed(0),
    uCom: 'UN',
    vUnCom: Number(it.price || 0).toFixed(2),
    vProd: (Number(it.quantity || 1) * Number(it.price || 0)).toFixed(2),
  }))
  const totalItens = items.reduce((s, i) => s + Number(i.qCom), 0)
  const vNF = Number(order.total || 0).toFixed(2)

  const TPAG_MAP = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de Crédito', '04': 'Cartão de Débito', '05': 'Crédito Loja / Voucher', '10': 'Vale Alimentação', '11': 'Vale Refeição', '15': 'Boleto', '17': 'PIX', '18': 'Transferência', '99': 'Outros' }
  const payRaw = order.payload?.payment || {}
  const payMethod = payRaw.methodCode || payRaw.method || payRaw.type || ''
  const PAYKEY_MAP = { CASH: '01', MONEY: '01', Dinheiro: '01', CREDIT_CARD: '03', DEBIT_CARD: '04', PIX: '17', VOUCHER: '05', ONLINE: '99' }
  const tPagCode = PAYKEY_MAP[payMethod] || '99'
  const payments = [{ desc: TPAG_MAP[tPagCode] || payMethod || 'Outros', value: Number(order.total || 0).toFixed(2) }]

  const deliveryFee = Number(order.deliveryFee || 0)
  const vNFDisplay = Number(vNF).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

  const consultaUrl = tpAmb === '1'
    ? `https://nfce.svrs.rs.gov.br/consulta/consultaPublica.jsp`
    : `https://nfce-homologacao.svrs.rs.gov.br/consulta/consultaPublica.jsp`
  const qrData = chNFe ? `${consultaUrl}?chave=${chNFe}` : consultaUrl
  const QRCode = require('qrcode')
  const qrDataUrl = chNFe ? await QRCode.toDataURL(qrData, { margin: 1, width: 160 }) : ''

  const vTribTotal = (Number(vNF) * 0.24).toFixed(2)
  const vTribFederal = (Number(vNF) * 0.07).toFixed(2)
  const vTribEstadual = (Number(vNF) * 0.12).toFixed(2)
  const vTribMunicipal = (Number(vNF) * 0.05).toFixed(2)

  const printButton = forPrint
    ? `<button class="no-print" onclick="window.print()" style="width:100%;padding:6px;margin-bottom:8px;cursor:pointer;background:#0d6efd;color:#fff;border:none;border-radius:4px;font-size:13px">🖨️ Imprimir</button>`
    : ''
  const autoPrintScript = forPrint
    ? `<script>window.addEventListener('load', () => setTimeout(() => window.print(), 400))<\/script>`
    : ''

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DANFE NFC-e #${nNF}</title>
<style>
  @page { margin: 5mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace, sans-serif; font-size: 11px; background: #fff; color: #000; max-width: 80mm; margin: 0 auto; padding: 4px; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .company-name { font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 2px; }
  .company-info { text-align: center; font-size: 10px; margin-bottom: 2px; }
  .danfe-title { font-weight: bold; text-align: center; font-size: 10px; margin: 6px 0 4px; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th { font-weight: bold; text-align: left; border-bottom: 1px solid #000; padding: 1px 2px; }
  td { padding: 1px 2px; vertical-align: top; }
  .right { text-align: right; }
  .total-row { border-top: 1px dashed #000; margin-top: 4px; padding-top: 3px; display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; margin-bottom: 2px; }
  .total-label { font-size: 10px; font-weight: bold; }
  .section { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; }
  .pay-row { display: flex; justify-content: space-between; margin-bottom: 1px; }
  .qr-section { margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; display: flex; gap: 6px; align-items: flex-start; }
  .qr-img { width: 90px; height: 90px; }
  .qr-info { font-size: 9px; flex: 1; }
  .chave { font-size: 8.5px; text-align: center; margin-top: 4px; word-break: break-all; }
  .homolog { background: #ff0; text-align: center; font-weight: bold; padding: 2px; margin: 4px 0; font-size: 10px; }
  .footer { font-size: 9px; text-align: center; margin-top: 6px; border-top: 1px dashed #000; padding-top: 4px; }
  @media print { body { max-width: 100%; } .no-print { display: none; } }
</style>
</head>
<body>
${printButton}

<div class="company-name">${xFant}</div>
<div class="company-info">CNPJ: ${cnpjFormatted} ${xNome}</div>
${logradouro ? `<div class="company-info">${logradouro} ${municipio}${cep ? ' - ' + cep : ''}</div>` : ''}
${fone ? `<div class="company-info">Fone: ${fone} I.E.: ${ie}</div>` : `<div class="company-info">I.E.: ${ie}</div>`}

${tpAmb === '2' ? '<div class="homolog">⚠️ HOMOLOGAÇÃO - SEM VALOR FISCAL ⚠️</div>' : ''}

<div class="danfe-title">DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA</div>

<table>
  <thead>
    <tr>
      <th style="width:22%">Código</th>
      <th style="width:36%">Descrição</th>
      <th style="width:8%" class="right">Qtde</th>
      <th style="width:8%">Un</th>
      <th style="width:13%" class="right">Valor unit.</th>
      <th style="width:13%" class="right">Valor total</th>
    </tr>
  </thead>
  <tbody>
    ${items.map(it => `<tr>
      <td>${it.cProd}</td>
      <td>${it.xProd}</td>
      <td class="right">${it.qCom}</td>
      <td>${it.uCom}</td>
      <td class="right">${Number(it.vUnCom).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      <td class="right">${Number(it.vProd).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
    </tr>`).join('')}
  </tbody>
</table>

<div class="section">
  <div class="total-row">
    <span>QTD. TOTAL DE ITENS</span>
    <span>${totalItens}</span>
  </div>
  <div class="total-row">
    <span>VALOR TOTAL R$</span>
    <span>${vNFDisplay}</span>
  </div>
</div>

<div class="section">
  <div class="bold" style="margin-bottom:3px">Formas de pagamento:</div>
  ${payments.map(p => `<div class="pay-row"><span>${p.desc}</span><span>R$ ${Number(p.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>`).join('')}
</div>

<div class="section center" style="font-size:9px">
  Consulte pela Chave de Acesso em<br>
  <a href="${consultaUrl}" style="color:#00c">${consultaUrl}</a>
</div>
<div class="chave">${chaveFormatted}</div>

<div class="qr-section">
  ${qrDataUrl ? `<img class="qr-img" src="${qrDataUrl}" alt="QR Code NFC-e">` : ''}
  <div class="qr-info">
    <div class="bold" style="margin-bottom:2px">${nProt}</div>
    <div>NFC-e n° ${nNF} Série ${serie}</div>
    <div>Dt. Emissão: ${emissaoStr}</div>
    <div>Via do consumidor</div>
    <div class="bold">EMISSÃO NORMAL</div>
  </div>
</div>

<div class="footer">
  Tributos Aproximados - Total R$ ${Number(vTribTotal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Federal R$ ${Number(vTribFederal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Estadual R$ ${Number(vTribEstadual).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Municipal R$ ${Number(vTribMunicipal).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}. Fonte IBPT${deliveryFee > 0 ? `<br>Taxa de entrega: R$ ${deliveryFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.` : ''}
</div>

${autoPrintScript}
</body>
</html>`
}

export default { generateDanfeHtml }
