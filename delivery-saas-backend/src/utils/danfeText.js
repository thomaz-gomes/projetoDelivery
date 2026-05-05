'use strict'

/**
 * Gera o texto do DANFE NFC-e a partir dos dados do pedido + protocolo SEFAZ.
 * Função pura (sem I/O) para permitir testes sem DB.
 *
 * @param {object} data
 * @param {object} data.protocol      - { rawXml, nProt }
 * @param {object} data.order         - resultado de prisma.order.findUnique com `items`
 * @param {object} [data.fiscalConfig]- { cnpj, ie }
 * @param {object} [data.emitenteConfig] - { xNome, enderEmit: { xLgr, nro, xMun, UF } }
 * @returns {string} Texto multilinha pronto para impressão térmica (48 col).
 */
export function buildDanfeText(data) {
  const { protocol, order, fiscalConfig = {}, emitenteConfig = null } = data
  const rawXml = protocol?.rawXml || ''

  const extract = (tag, xml) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    return m ? m[1].trim() : ''
  }
  const chNFe = extract('chNFe', rawXml) || ''
  const dhRecbto = extract('dhRecbto', rawXml) || new Date().toISOString()
  const nProt = protocol?.nProt || extract('nProt', rawXml) || ''
  const nNF = extract('nNF', rawXml) || ''
  const serie = extract('serie', rawXml) || '1'
  const tpAmb = extract('tpAmb', rawXml) || '2'

  const enderEmit = (emitenteConfig && emitenteConfig.enderEmit) || {}
  const cnpj = fiscalConfig.cnpj || ''
  const cnpjFormatted = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  const ie = fiscalConfig.ie || 'ISENTO'
  const xNome = (emitenteConfig && emitenteConfig.xNome) || (order.store && order.store.name) || (order.company && order.company.name) || ''
  const xFant = (order.store && order.store.name) || xNome
  const logradouro = [enderEmit.xLgr, enderEmit.nro].filter(Boolean).join(', ')
  const municipio = [enderEmit.xMun, enderEmit.UF].filter(Boolean).join(' - ')

  const W = 48
  const sep = '-'.repeat(W)
  const dbl = '='.repeat(W)
  const center = (s) => { const sp = Math.max(0, W - s.length); return ' '.repeat(Math.floor(sp / 2)) + s }
  const ljust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length) }
  const rjust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : ' '.repeat(n - str.length) + str }

  let emissaoStr = ''
  try {
    const d = new Date(dhRecbto)
    emissaoStr = d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    emissaoStr = dhRecbto
  }

  const lines = []
  lines.push(dbl)
  lines.push(center(xFant))
  if (cnpjFormatted) lines.push(center(`CNPJ: ${cnpjFormatted}`))
  if (xNome && xNome !== xFant) lines.push(center(xNome))
  if (logradouro) lines.push(center(logradouro))
  if (municipio) lines.push(center(municipio))
  lines.push(sep)
  lines.push(center('DOCUMENTO AUXILIAR DA NOTA'))
  lines.push(center('FISCAL DE CONSUMIDOR ELETRONICO'))
  lines.push(sep)
  if (tpAmb === '2') {
    lines.push(center('** HOMOLOGACAO - SEM VALOR FISCAL **'))
    lines.push(sep)
  }

  lines.push(ljust('DESCRICAO', 24) + rjust('QTD', 6) + rjust('TOTAL', 18))
  lines.push(sep)
  const items = order.items || []
  let totalItens = 0
  for (const it of items) {
    const qty = Number(it.quantity || 1)
    totalItens += qty
    const unit = Number(it.price || 0)
    const total = qty * unit
    const totalStr = `R$${total.toFixed(2)}`
    const qtyStr = `${qty}x`
    const nameWidth = W - qtyStr.length - totalStr.length - 2
    lines.push(ljust(it.name || '', nameWidth) + ' ' + qtyStr + ' ' + totalStr)
    if (qty > 1) lines.push(`  @ R$${unit.toFixed(2)}/un`)
  }
  lines.push(sep)

  const vNF = Number(order.total || 0)
  lines.push(ljust(`Qtd itens: ${totalItens}`, W - 20) + rjust(`TOTAL R$${vNF.toFixed(2)}`, 20))
  lines.push('')

  const TPAG_MAP = { '01': 'Dinheiro', '03': 'Cartao Credito', '04': 'Cartao Debito', '17': 'PIX', '99': 'Outros' }
  const PAYKEY_MAP = { CASH: '01', MONEY: '01', CREDIT_CARD: '03', DEBIT_CARD: '04', PIX: '17', VOUCHER: '05', ONLINE: '99' }
  const payRaw = (order.payload && order.payload.payment) || {}
  const payMethod = payRaw.methodCode || payRaw.method || payRaw.type || ''
  const tPagCode = PAYKEY_MAP[payMethod] || '99'
  const payDesc = TPAG_MAP[tPagCode] || payMethod || 'Outros'
  lines.push(ljust('Pagamento:', W - 20) + rjust(payDesc, 20))
  lines.push(sep)

  const consultaUrl = tpAmb === '1'
    ? 'https://nfce.svrs.rs.gov.br/consulta/consultaPublica.jsp'
    : 'https://nfce-homologacao.svrs.rs.gov.br/consulta/consultaPublica.jsp'
  const qrData = chNFe ? `${consultaUrl}?chave=${chNFe}` : consultaUrl
  lines.push(center('Consulte a NF-e pelo QR Code'))
  lines.push(`[QR:${qrData}]`)
  lines.push(sep)

  lines.push(center('CHAVE DE ACESSO'))
  const chaveFormatted = chNFe.replace(/(\d{4})(?=\d)/g, '$1 ')
  const chaveWords = chaveFormatted.split(' ')
  let cur = ''
  for (const w of chaveWords) {
    if (cur && (cur + ' ' + w).length > W) {
      lines.push(center(cur))
      cur = w
    } else {
      cur = cur ? cur + ' ' + w : w
    }
  }
  if (cur) lines.push(center(cur))
  lines.push(sep)

  lines.push(`Prot.: ${nProt}`)
  lines.push(`NFC-e n.${nNF} Serie: ${serie}`)
  lines.push(`Emissao: ${emissaoStr}`)
  lines.push(`I.E.: ${ie}`)
  lines.push(dbl)

  return lines.join('\n')
}
