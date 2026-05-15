'use strict'

/**
 * Gera o texto do DANFE NFC-e conforme MOC v6.0 (Manual de Especificações
 * Técnicas do DANFE NFC-e + QR Code), alinhado visualmente com o modelo
 * "padrão Saipos" que o operador esperava na impressora térmica.
 *
 * Layout (largura configurável — 48 colunas em 80mm Font A,
 * 32 colunas em 58mm Font A):
 *   I    Cabeçalho (nome fantasia, CNPJ + razão, endereço, fone + I.E.)
 *   II   Identificação (DANFE NFC-e)
 *   III  Itens (cabeçalho de colunas + 2 linhas por item: # cód nome /
 *        qty UN x unit ............... total)
 *   IV   Totais (Qtd, Valor Total, Descontos, Acréscimos, Valor a Pagar)
 *   V    Forma de Pagamento (uma linha por método + troco)
 *   VI   Consulta por chave de acesso (URL + 44 dígitos em grupos de 4)
 *   VII  QR Code (placeholder textual; o agente substitui pelo bitmap)
 *   VIII NFC-e + Protocolo + Série + Emissão
 *   IX   Consumidor (CPF/CNPJ identificado ou "NAO IDENTIFICADO")
 *   X    Tributos Aproximados (Lei 12.741, estimativa IBPT)
 *
 * @param {object} data
 * @param {object} [opts]
 * @param {number} [opts.cols=48]  Largura útil em colunas. 32 para 58mm,
 *                                 48 para 80mm Font A. Deve bater com o
 *                                 PrinterSetting.width para evitar wrap.
 * @returns {string} Texto multilinha pronto para impressão.
 */
export function buildDanfeText(data, opts = {}) {
  const { protocol, order, fiscalConfig = {}, emitenteConfig = null } = data
  const W = Number(opts.cols) > 0 ? Number(opts.cols) : 48
  // Compact mode: drops redundant subtitle/banner lines and the IBPT footer
  // so the cupom occupies less paper. Used when the printer's effective
  // font can't be reduced (legacy print-agent builds without [FONT:B]).
  const compact = !!opts.compact
  const rawXml = protocol?.rawXml || ''

  const extract = (tag, xml) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    return m ? m[1].trim() : ''
  }
  const chNFe = extract('chNFe', rawXml) || ''
  const dhRecbto = extract('dhRecbto', rawXml) || new Date().toISOString()
  const nProt = protocol?.nProt || extract('nProt', rawXml) || ''
  const tpAmb = extract('tpAmb', rawXml) || '2'

  // Prefer chNFe-derived serie/nNF over the response payload — they're the
  // canonical values present even when the SEFAZ response is the lightweight
  // protNFe shape that doesn't echo <nNF>/<serie>.
  const serie = chNFe ? String(parseInt(chNFe.slice(22, 25), 10)) : (extract('serie', rawXml) || '1')
  const nNF = chNFe ? String(parseInt(chNFe.slice(25, 34), 10)).padStart(9, '0') : (extract('nNF', rawXml) || '')

  const enderEmit = (emitenteConfig && emitenteConfig.enderEmit) || {}
  const cnpj = fiscalConfig.cnpj || (emitenteConfig && emitenteConfig.cnpj) || ''
  const cnpjFormatted = cnpj.replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  const ie = fiscalConfig.ie || (emitenteConfig && emitenteConfig.ie) || 'ISENTO'
  const xNome = (emitenteConfig && emitenteConfig.xNome) || (order.store && order.store.name) || (order.company && order.company.name) || ''
  const xFant = (order.store && order.store.name) || xNome
  const logradouro = [enderEmit.xLgr, enderEmit.nro].filter(Boolean).join(', ')
  const bairro = enderEmit.xBairro || ''
  const municipio = [enderEmit.xMun, enderEmit.UF].filter(Boolean).join(' - ')
  const cep = (enderEmit.CEP || '').replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2')
  // Fone: tenta enderEmit.fone → emitenteConfig.fone → Store.phone (Prisma).
  // Permite ao operador ter um telefone fiscal separado no enderEmit OU
  // reutilizar o telefone geral da loja se não cadastrou o fiscal.
  const fone = enderEmit.fone
    || (emitenteConfig && emitenteConfig.fone)
    || (order && order.store && order.store.phone)
    || ''

  const sep = '-'.repeat(W)
  const dbl = '='.repeat(W)
  const center = (s) => { const sp = Math.max(0, W - s.length); return ' '.repeat(Math.floor(sp / 2)) + s }
  const ljust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : str + ' '.repeat(n - str.length) }
  const rjust = (s, n) => { const str = String(s); return str.length >= n ? str.slice(0, n) : ' '.repeat(n - str.length) + str }

  // Valor cru (sem prefixo) — usado nas colunas das tabelas.
  const num = (n) => Number(n || 0).toFixed(2).replace('.', ',')
  // Com prefixo "R$" — usado em rótulos individuais.
  const money = (n) => 'R$ ' + num(n)

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
  if (cnpjFormatted || xNome) {
    const cnpjLabel = cnpjFormatted ? `CNPJ: ${cnpjFormatted}` : ''
    if (cnpjLabel && xNome && xNome !== xFant) {
      // Combine numa única linha quando couber, senão quebra.
      const combined = `${cnpjLabel}  ${xNome}`
      if (combined.length <= W) lines.push(center(combined))
      else { lines.push(center(cnpjLabel)); lines.push(center(xNome)) }
    } else if (cnpjLabel) {
      lines.push(center(cnpjLabel))
    } else if (xNome) {
      lines.push(center(xNome))
    }
  }
  if (logradouro || bairro) lines.push(center([logradouro, bairro].filter(Boolean).join(' - ')))
  if (municipio || cep) lines.push(center([municipio, cep].filter(Boolean).join(' ')))
  const foneIe = []
  if (fone) foneIe.push(`Fone: ${fone}`)
  if (ie && ie !== 'ISENTO') foneIe.push(`I.E.: ${ie}`)
  else if (ie === 'ISENTO') foneIe.push('I.E.: ISENTO')
  if (foneIe.length) lines.push(center(foneIe.join('  ')))
  lines.push(sep)

  // ── Divisão II: Identificação do documento ──────────────────────────
  lines.push(center('DANFE NFC-e'))
  // Compact: oculta o subtítulo (3 linhas → 0). Não é exigido pelo MOC.
  if (!compact) {
    if (W >= 36) {
      lines.push(center('Documento Auxiliar da Nota Fiscal'))
      lines.push(center('de Consumidor Eletronica'))
    } else {
      lines.push(center('Doc. Auxiliar NFC-e'))
    }
  }
  lines.push(sep)
  if (tpAmb === '2') {
    lines.push(center(W >= 38 ? '** HOMOLOGACAO - SEM VALOR FISCAL **' : 'HOMOLOGACAO - SEM VALOR FISCAL'))
    lines.push(sep)
  }

  // ── Divisão III: Itens ──────────────────────────────────────────────
  // Cabeçalho compacto: "#  Cód   Descrição"; depois cada item ocupa duas
  // linhas (descrição completa + bloco quantidade/valor unitário/total
  // alinhados à direita). Em compact mode, oculta o sub-header.
  lines.push(ljust('# Cod   Descricao', W))
  if (!compact) {
    const subHeader = 'Qtd x Vl Unit   Vl Total'
    lines.push(rjust(subHeader.length <= W ? subHeader : 'Vl Unit  Vl Total', W))
  }
  lines.push(sep)
  const items = order.items || []
  let totalItens = 0
  let subtotal = 0
  items.forEach((it, idx) => {
    const itemNum = String(idx + 1).padStart(3, '0')
    const cod = '123123' // SKU padrão até o cadastro ter campo SKU próprio
    const qty = Number(it.quantity || 1)
    const unit = Number(it.price || 0)
    const total = qty * unit
    totalItens += qty
    subtotal += total

    // Linha 1: "001 123123 NOME DO ITEM" (truncado em W)
    const prefix = `${itemNum} ${cod} `
    const nameMax = W - prefix.length
    const name = String(it.name || '').slice(0, nameMax)
    lines.push(prefix + name)

    // Linha 2: "    qty UN x R$ unit ............... R$ total"
    const left = `    ${qty} UN x ${money(unit)}`
    const right = money(total)
    const pad = Math.max(1, W - left.length - right.length)
    lines.push(left + ' '.repeat(pad) + right)
  })
  lines.push(sep)

  // ── Divisão IV: Totais ──────────────────────────────────────────────
  // Aceita tanto o pricing já consolidado em order.<campo> quanto valores
  // espalhados pelo payload (vindo do POS / public menu).
  const payload = order.payload || {}
  const desconto = Number(order.couponDiscount || payload.couponDiscount || 0)
    + Number(order.discountMerchant || payload.discountMerchant || 0)
    + Number(order.paymentDiscount || payload.paymentDiscount || 0)
  const deliveryFee = Number(order.deliveryFee || payload.deliveryFee || 0)
  const acrescimo = deliveryFee + Number(payload.surcharge || 0)
  const vNF = Number(order.total != null ? order.total : (subtotal - desconto + acrescimo))

  const totalLine = (label, amount, prefix = '') => {
    const right = prefix + num(amount)
    return ljust(label, W - right.length) + right
  }
  // Versão sem formatação monetária — usada para contagem inteira ("002").
  const labelRight = (label, rightStr) => ljust(label, W - rightStr.length) + rightStr

  lines.push(labelRight('QTD. TOTAL DE ITENS', String(items.length).padStart(3, '0')))
  lines.push(totalLine('VALOR TOTAL R$', subtotal))
  if (desconto > 0) lines.push(totalLine('Descontos R$', desconto, '- '))
  if (acrescimo > 0) lines.push(totalLine('Acrescimos R$', acrescimo, '+ '))
  lines.push(totalLine('VALOR A PAGAR R$', vNF))
  if (!compact) lines.push('')

  // ── Divisão V: Forma de Pagamento ──────────────────────────────────
  // Aceita payload.payments[] (multi), payload.payment{} (legado) ou cai
  // num único "Dinheiro" pelo total da nota.
  const TPAG_LABELS = { '01': 'Dinheiro', '03': 'Cartao Credito', '04': 'Cartao Debito', '15': 'Boleto', '17': 'PIX', '99': 'Outros' }
  const PAYKEY_MAP = {
    CASH: '01', MONEY: '01', Dinheiro: '01',
    CREDIT_CARD: '03', 'Crédito': '03', Credito: '03',
    DEBIT_CARD: '04', 'Débito': '04', Debito: '04',
    PIX: '17',
    VOUCHER: '05',
    ONLINE: '99',
  }
  const payDescriptionFor = (raw) => {
    if (!raw) return 'Dinheiro'
    const direct = TPAG_LABELS[String(raw)] // já é tPag numérico
    if (direct) return direct
    const code = PAYKEY_MAP[raw]
    if (code && TPAG_LABELS[code]) return TPAG_LABELS[code]
    return String(raw)
  }
  const rawPayments = Array.isArray(payload.payments)
    ? payload.payments
    : (payload.payment ? [payload.payment] : [])
  const payments = rawPayments.length
    ? rawPayments.map((p) => ({
        label: p.label || p.methodName || payDescriptionFor(p.methodCode || p.method || p.type),
        value: Number(p.amount || p.value || 0),
      }))
    : [{ label: 'Dinheiro', value: vNF }]
  // Single payment row with no explicit amount: assume it covers the total
  // (typical for legacy payload.payment{} without amount/value).
  if (payments.length === 1 && payments[0].value === 0) payments[0].value = vNF

  // Header da seção. Em larguras estreitas (<= 32 cols), "Valor Pago"
  // sobrescreveria a label, então omitimos o sub-rótulo.
  if (W >= 36) lines.push(ljust('FORMA DE PAGAMENTO', W - 10) + rjust('Valor Pago', 10))
  else lines.push('FORMA DE PAGAMENTO')
  for (const p of payments) {
    lines.push(totalLine(p.label, p.value))
  }
  const changeFor = Number((payload.payment && (payload.payment.changeFor || payload.payment.change)) || payload.changeFor || 0)
  const troco = changeFor > 0 ? Math.max(0, changeFor - vNF) : 0
  if (troco > 0) lines.push(totalLine('Troco', troco))
  lines.push(sep)

  // ── Divisão VI: Consulta por chave de acesso ───────────────────────
  // Em compact, "Consulte pela Chave de Acesso em" some — a URL + chave
  // + QR Code abaixo já dão ao cliente como verificar a nota.
  if (!compact) lines.push(center('Consulte pela Chave de Acesso em'))
  const consultaUrl = tpAmb === '1'
    ? 'http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx'
    : 'http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx'
  if (!compact) lines.push(center(consultaUrl))
  if (chNFe) {
    const chaveFormatted = chNFe.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
    // Quebra em até duas linhas para caber em W colunas
    if (chaveFormatted.length <= W) {
      lines.push(center(chaveFormatted))
    } else {
      const half = Math.ceil(chaveFormatted.length / 2)
      // Encontra o espaço mais próximo do meio para não cortar grupo
      let cut = chaveFormatted.lastIndexOf(' ', half)
      if (cut < 0) cut = half
      lines.push(center(chaveFormatted.slice(0, cut).trim()))
      lines.push(center(chaveFormatted.slice(cut).trim()))
    }
  }
  lines.push('')

  // ── Divisão VII: QR Code ───────────────────────────────────────────
  // O agente de impressão substitui esse placeholder pelo bitmap quando o
  // template detecta o marcador [QR:...]. Em texto puro mostra a URL para
  // que o operador possa digitar manualmente em caso de falha.
  const qrUrl = chNFe ? `${consultaUrl}?p=${chNFe}` : consultaUrl
  lines.push(`[QR:${qrUrl}]`)
  if (!compact) lines.push('')

  // ── Divisão VIII: NFC-e + Protocolo ─────────────────────────────────
  lines.push(`NFC-e n. ${nNF}  Serie ${String(serie).padStart(3, '0')}`)
  lines.push(`Emissao: ${emissaoStr}`)
  if (compact) {
    lines.push(`Protocolo: ${nProt || '—'}`)
  } else {
    lines.push(`Protocolo de Autorizacao:`)
    lines.push(nProt || '—')
  }
  lines.push(sep)

  // ── Divisão IX: Consumidor ──────────────────────────────────────────
  const cpf = (order.customer && order.customer.cpf)
    || (payload.customer && payload.customer.cpf)
    || ''
  const cnpjConsumidor = (order.customer && order.customer.cnpj)
    || (payload.customer && payload.customer.cnpj)
    || ''
  const consumerName = (order.customer && order.customer.fullName)
    || order.customerName
    || (payload.customer && payload.customer.name)
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
  lines.push(sep)

  // ── Divisão X: Tributos Aproximados (IBPT — Lei 12.741) ────────────
  // Estimativa para Simples Nacional. Em compact mode, condensa em uma
  // única linha "Trib. Aprox. IBPT" para economizar papel.
  const tributosFederal = subtotal * 0.063
  const tributosEstadual = subtotal * 0.0961
  const tributosMunicipal = 0
  const tributosTotal = tributosFederal + tributosEstadual + tributosMunicipal
  if (deliveryFee > 0) {
    lines.push(`Taxa de entrega: ${money(deliveryFee)}`)
  }
  if (compact) {
    lines.push(`Trib. Aprox. IBPT: ${money(tributosTotal)}`)
  } else if (W >= 38) {
    lines.push(`Tributos Aproximados — Total ${money(tributosTotal)}`)
    lines.push(`Federal ${money(tributosFederal)}  Estadual ${money(tributosEstadual)}`)
    lines.push(`Municipal ${money(tributosMunicipal)}  Fonte: IBPT`)
  } else {
    // Em larguras estreitas, uma linha por valor.
    lines.push('Tributos Aprox. (IBPT):')
    lines.push(totalLine('Total', tributosTotal))
    lines.push(totalLine('Federal', tributosFederal))
    lines.push(totalLine('Estadual', tributosEstadual))
    lines.push(totalLine('Municipal', tributosMunicipal))
  }

  lines.push(dbl)

  return lines.join('\n')
}
