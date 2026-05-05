'use strict'

/**
 * Gera o texto do DANFE NFC-e conforme MOC v6.0 (Manual de Especificações
 * Técnicas do DANFE NFC-e + QR Code).
 *
 * Layout (48 colunas — impressora térmica 80mm):
 *   I   Cabeçalho (razão social, CNPJ, endereço)
 *   II  Identificação (DANFE NFC-e)
 *   III Itens (2 linhas por item: # nome / qty UN x unit ... total)
 *   IV  Totais (Subtotal, Desconto, Acréscimo, TOTAL, Pagamento, Troco)
 *   V   Consulta por chave de acesso
 *   VI  QR Code
 *   VII NFC-e + Protocolo
 *   VIII Consumidor (CPF/CNPJ ou "NAO IDENTIFICADO")
 *
 * @param {object} data
 * @returns {string} Texto multilinha pronto para impressão.
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

  // Formata valor com vírgula decimal (pt-BR): 50.00 → "R$ 50,00"
  const money = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',')

  let emissaoStr = ''
  let emissaoDate = ''
  try {
    const d = new Date(dhRecbto)
    emissaoDate = d.toLocaleDateString('pt-BR')
    emissaoStr = emissaoDate + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    emissaoStr = dhRecbto
    emissaoDate = ''
  }

  const lines = []

  // ── Divisão I: Cabeçalho ─────────────────────────────────────────────
  lines.push(dbl)
  lines.push(center(xFant))
  if (cnpjFormatted) lines.push(center(`CNPJ: ${cnpjFormatted}`))
  if (xNome && xNome !== xFant) lines.push(center(xNome))
  if (logradouro) lines.push(center(logradouro))
  if (municipio) lines.push(center(municipio))
  lines.push(sep)

  // ── Divisão II: Identificação do documento ──────────────────────────
  lines.push(center('DANFE NFC-e'))
  lines.push(center('Documento Auxiliar da Nota Fiscal'))
  lines.push(center('de Consumidor Eletronica'))
  lines.push(sep)
  if (tpAmb === '2') {
    lines.push(center('** HOMOLOGACAO - SEM VALOR FISCAL **'))
    lines.push(sep)
  }

  // ── Divisão III: Itens (2 linhas por item) ──────────────────────────
  lines.push('ITENS')
  lines.push(sep)
  const items = order.items || []
  let totalItens = 0
  let subtotal = 0
  items.forEach((it, idx) => {
    const num = String(idx + 1).padStart(3, '0')
    const qty = Number(it.quantity || 1)
    const unit = Number(it.price || 0)
    const total = qty * unit
    totalItens += qty
    subtotal += total

    // Linha 1: "001 NOME DO ITEM" (truncado em 44 chars)
    const nameMax = W - 4 // 4 = "001 "
    const name = String(it.name || '').slice(0, nameMax)
    lines.push(`${num} ${name}`)

    // Linha 2: "    qty UN x R$ unit ... R$ total" (right-aligned)
    const left = `    ${qty} UN x ${money(unit)}`
    const right = money(total)
    const pad = Math.max(1, W - left.length - right.length)
    lines.push(left + ' '.repeat(pad) + right)
  })
  lines.push(sep)

  // ── Divisão IV: Totais ──────────────────────────────────────────────
  const vNF = Number(order.total || subtotal)
  const desconto = Number(order.discount || 0)
  const acrescimo = Number(order.deliveryFee || 0)
  const payRaw = (order.payload && order.payload.payment) || {}
  const troco = Number(payRaw.change || 0)

  const totalLine = (label, amount, prefix = '') => {
    const left = label
    const right = prefix + money(amount)
    return ljust(left, W - right.length) + right
  }

  lines.push(`Qtd itens: ${totalItens}`)
  lines.push(totalLine('Subtotal:', subtotal))
  if (desconto > 0) lines.push(totalLine('Desconto:', desconto, '- '))
  if (acrescimo > 0) lines.push(totalLine('Acrescimo:', acrescimo, '+ '))
  lines.push(totalLine('TOTAL:', vNF))

  // Pagamento
  const TPAG_MAP = { '01': 'Dinheiro', '03': 'Cartao Credito', '04': 'Cartao Debito', '17': 'PIX', '99': 'Outros' }
  const PAYKEY_MAP = { CASH: '01', MONEY: '01', CREDIT_CARD: '03', DEBIT_CARD: '04', PIX: '17', VOUCHER: '05', ONLINE: '99' }
  const payMethod = payRaw.methodCode || payRaw.method || payRaw.type || ''
  const tPagCode = PAYKEY_MAP[payMethod] || '99'
  const payDesc = TPAG_MAP[tPagCode] || payMethod || 'Outros'
  lines.push(ljust('Pagamento:', W - payDesc.length) + payDesc)
  if (troco > 0) lines.push(totalLine('Troco:', troco))
  lines.push(sep)

  // ── Divisão V: Consulta por chave de acesso ────────────────────────
  lines.push(center('Consulte pela Chave de Acesso em'))
  const consultaUrl = tpAmb === '1'
    ? 'nfce.svrs.rs.gov.br/consulta'
    : 'nfce-homologacao.svrs.rs.gov.br/consulta'
  lines.push(center(consultaUrl))
  lines.push('')
  lines.push(center('CHAVE DE ACESSO'))
  const chaveFormatted = chNFe.replace(/(\d{4})(?=\d)/g, '$1 ')
  // Wrap se passar de W
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

  // ── Divisão VI: QR Code ─────────────────────────────────────────────
  const qrUrlBase = tpAmb === '1'
    ? 'https://nfce.svrs.rs.gov.br/consulta/consultaPublica.jsp'
    : 'https://nfce-homologacao.svrs.rs.gov.br/consulta/consultaPublica.jsp'
  const qrData = chNFe ? `${qrUrlBase}?chave=${chNFe}` : qrUrlBase
  lines.push(`[QR:${qrData}]`)
  lines.push(sep)

  // ── Divisão VII: NFC-e + Protocolo ──────────────────────────────────
  lines.push(`NFC-e nro. ${nNF} Serie ${serie}`)
  lines.push(`Emissao: ${emissaoStr}`)
  lines.push(`Protocolo: ${nProt} ${emissaoDate}`)
  lines.push(`I.E.: ${ie}`)
  lines.push(sep)

  // ── Divisão VIII: Consumidor ────────────────────────────────────────
  const cpf = (order.customer && order.customer.cpf)
    || (order.payload && order.payload.customer && order.payload.customer.cpf)
    || ''
  const cnpjConsumidor = (order.customer && order.customer.cnpj)
    || (order.payload && order.payload.customer && order.payload.customer.cnpj)
    || ''
  const consumerName = (order.customer && order.customer.fullName)
    || order.customerName
    || (order.payload && order.payload.customer && order.payload.customer.name)
    || ''

  if (cpf) {
    const cpfFmt = cpf.replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
    lines.push(`CONSUMIDOR CPF: ${cpfFmt}`)
    if (consumerName) lines.push(consumerName)
  } else if (cnpjConsumidor) {
    const cnpjFmt = cnpjConsumidor.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    lines.push(`CONSUMIDOR CNPJ: ${cnpjFmt}`)
    if (consumerName) lines.push(consumerName)
  } else {
    lines.push(center('CONSUMIDOR NAO IDENTIFICADO'))
  }

  lines.push(dbl)

  return lines.join('\n')
}
