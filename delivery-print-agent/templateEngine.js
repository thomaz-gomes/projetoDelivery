/**
 * templateEngine.js - Motor de templates leve para comandas de impressão
 *
 * Suporta:
 *   {{placeholder}}                    - substituição simples
 *   {{#each arrayKey}} ... {{/each}}   - iteração sobre arrays
 *   {{#if key}} ... {{/if}}            - blocos condicionais
 */

/**
 * Renderiza um template com placeholders contra um contexto de dados.
 * @param {string} templateStr - Template com {{...}} placeholders
 * @param {object} context - Objeto de dados
 * @returns {string} - Texto renderizado
 */
/**
 * Encontra o bloco correspondente a um {{#each key}} ou {{#if key}}
 * respeitando aninhamento. Retorna { block, endIndex } ou null.
 */
function findMatchingClose(str, startIndex, tag) {
  const openPattern = '{{#' + tag;
  const closePattern = '{{/' + tag + '}}';
  let depth = 1;
  let i = startIndex;
  while (i < str.length && depth > 0) {
    const nextOpen = str.indexOf(openPattern, i);
    const nextClose = str.indexOf(closePattern, i);
    if (nextClose === -1) return null; // no matching close
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openPattern.length;
    } else {
      depth--;
      if (depth === 0) {
        return { block: str.slice(startIndex, nextClose), endIndex: nextClose + closePattern.length };
      }
      i = nextClose + closePattern.length;
    }
  }
  return null;
}

/**
 * Processa todos os blocos {{#each key}}...{{/each}} no texto,
 * respeitando aninhamento.
 */
function processEachBlocks(text, ctx) {
  let result = '';
  let pos = 0;
  const re = /\{\{#each\s+(\w+)\}\}/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    result += text.slice(pos, match.index);
    const key = match[1];
    const blockStart = match.index + match[0].length;
    const found = findMatchingClose(text, blockStart, 'each');
    if (!found) { result += match[0]; pos = blockStart; continue; }
    const arr = ctx[key];
    if (Array.isArray(arr) && arr.length > 0) {
      for (const item of arr) {
        const merged = Object.assign({}, ctx, item);
        // Recursivamente processar each/if aninhados dentro do bloco
        let rendered = processEachBlocks(found.block, merged);
        rendered = processIfBlocks(rendered, merged);
        rendered = replacePlaceholders(rendered, merged);
        result += rendered;
      }
    }
    pos = found.endIndex;
    re.lastIndex = pos;
  }
  result += text.slice(pos);
  return result;
}

/**
 * Processa todos os blocos {{#if key}}...{{/if}} no texto.
 */
function processIfBlocks(text, ctx) {
  let result = '';
  let pos = 0;
  const re = /\{\{#if\s+(\w+)\}\}/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    result += text.slice(pos, match.index);
    const key = match[1];
    const blockStart = match.index + match[0].length;
    const found = findMatchingClose(text, blockStart, 'if');
    if (!found) { result += match[0]; pos = blockStart; continue; }
    const val = ctx[key];
    if (val && val !== '0' && val !== '0.00') {
      result += replacePlaceholders(found.block, ctx);
    }
    pos = found.endIndex;
    re.lastIndex = pos;
  }
  result += text.slice(pos);
  return result;
}

/**
 * Substitui {{placeholder}} simples.
 */
function replacePlaceholders(text, ctx) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = ctx[key];
    return val != null ? String(val) : '';
  });
}

function renderTemplate(templateStr, context) {
  if (!templateStr || !context) return templateStr || '';
  let result = processEachBlocks(templateStr, context);
  result = processIfBlocks(result, context);
  result = replacePlaceholders(result, context);
  return result;
}

/**
 * Transforma um objeto de pedido + configuração de impressora em contexto para o template.
 * @param {object} order - Objeto do pedido vindo do backend
 * @param {object} settings - { headerName, headerCity }
 * @returns {object} - Contexto flat para renderTemplate()
 */
function buildContext(order, settings = {}) {
  if (!order) return {};

  const o = order;
  const payload = o.payload || {};

  // Display ID
  const displayId = o.displaySimple != null
    ? String(o.displaySimple).padStart(2, '0')
    : (o.displayId != null ? String(o.displayId).padStart(2, '0') : (o.id || '').slice(0, 6));

  // Data/hora
  const dateRaw = o.createdAt || o.date || o.created || new Date().toISOString();
  const dateObj = new Date(dateRaw);
  const datePedido = dateObj.toLocaleDateString('pt-BR');
  const horaPedido = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Cliente
  const nomeCliente = (o.customerName || o.name || 'CLIENTE').toUpperCase();
  const telefoneCliente = o.customerPhone || o.phone || (Array.isArray(o.phones) ? o.phones.join(' / ') : '') || '';

  // iFood: desempacota envelope { order: { ... } } ou usa payload direto
  const ifoodPayload = payload.order || payload;

  // Endereço - resolver de múltiplas fontes (priorizar objeto estruturado com detalhes completos)
  const endereco = (() => {
    // Helper: monta endereço completo a partir de objeto estruturado
    function buildFromObj(da) {
      if (!da || typeof da !== 'object') return null;
      const street = da.streetName || da.street || da.logradouro || '';
      const number = da.streetNumber || da.number || da.numero || '';
      const main = street && number ? `${street}, ${number}` : (da.formattedAddress || da.formatted || street || '');
      if (!main) return null;
      const parts = [];
      if (da.complement || da.complemento) parts.push(da.complement || da.complemento);
      if (da.neighborhood || da.bairro) parts.push(da.neighborhood || da.bairro);
      if (da.reference) parts.push('Ref: ' + da.reference);
      if (da.city || da.cidade) parts.push(da.city || da.cidade);
      return [main, parts.join(' - ')].filter(Boolean).join(' | ');
    }
    // 1. Objeto estruturado do payload (iFood deliveryAddress com todos os campos)
    const da = (ifoodPayload.delivery && ifoodPayload.delivery.deliveryAddress) || payload.deliveryAddress || o.deliveryAddress || null;
    const fromPayload = buildFromObj(da);
    if (fromPayload) return fromPayload;
    // 2. Customer addresses (do banco, com complemento/bairro/referência)
    if (o.customer && Array.isArray(o.customer.addresses) && o.customer.addresses.length) {
      const ca = o.customer.addresses.find(x => x.isDefault) || o.customer.addresses[0];
      const fromCustomer = buildFromObj(ca);
      if (fromCustomer) return fromCustomer;
    }
    // 3. rawPayload.address
    const raw = payload.rawPayload && payload.rawPayload.address;
    const fromRaw = buildFromObj(raw);
    if (fromRaw) return fromRaw;
    if (typeof raw === 'string' && raw) return raw;
    // 4. String simples do banco
    if (o.addressFull) return o.addressFull;
    if (o.address && typeof o.address === 'string' && o.address.trim() && o.address.trim() !== '-') return o.address.trim();
    // 5. Campos avulsos
    if (o.street || o.number) return [o.street, o.number].filter(Boolean).join(' ');
    return '-';
  })();

  // Itens - preferir items do payload (iFood rich: tem subitems/options/observations)
  // sobre items do DB (OrderItem: só tem name/qty/price sem opcionais)
  const payloadItems = ifoodPayload.items || null;
  const rawItems = (payloadItems && payloadItems.length > 0)
    ? payloadItems
    : (Array.isArray(o.items) ? o.items : []);
  let subtotal = 0;
  let totalItensCount = 0;

  const items = rawItems.map(it => {
    const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
    totalItensCount += qty;
    const price = Number(it.price ?? it.unitPrice ?? it.unit_price ?? it.amount ?? 0) || 0;

    // iFood usa "subitems" para complementos/adicionais; outros usam options/extras
    const rawOptions = it.subitems || it.garnishItems || it.garnishes
      || it.options || it.extras || it.modifiers || it.addons || it.subItems || [];
    let optsPerUnit = 0;
    const itemOptions = Array.isArray(rawOptions) ? rawOptions.map(ex => {
      const inner = ex && ex.option ? ex.option : ex;
      const optQty = Number(inner.quantity ?? inner.qty ?? ex.quantity ?? ex.qty ?? 1) || 1;
      // iFood subitems: unitPrice = per-unit, price/totalPrice = line total per parent unit
      // Try unitPrice first (true per-unit); if not available, derive from price/totalPrice
      let optUnitPrice = Number(inner.unitPrice ?? 0) || 0;
      if (!optUnitPrice) {
        const rawPrice = Number(inner.price ?? inner.amount ?? ex.price ?? ex.amount ?? 0) || 0;
        // If totalPrice also exists and equals rawPrice, it's likely the line total — derive unit
        const rawTotal = Number(inner.totalPrice ?? ex.totalPrice ?? 0) || 0;
        if (rawTotal && rawTotal === rawPrice && optQty > 1) {
          optUnitPrice = rawPrice / optQty;
        } else {
          optUnitPrice = rawPrice;
        }
      }
      optsPerUnit += optUnitPrice * optQty;
      const totalOptQty = optQty * qty;
      return {
        option_qty: String(optQty),
        option_total_qty: String(totalOptQty),
        option_name: (inner.name || inner.title || inner.description || '').slice(0, 40),
        option_price: optUnitPrice.toFixed(2),
        has_total: qty > 1 ? '1' : ''
      };
    }) : [];

    const lineTotal = (price + optsPerUnit) * qty;
    subtotal += lineTotal;

    return {
      item_qty: String(qty),
      item_name: (it.name || it.title || it.productName || '').slice(0, 30),
      item_price: lineTotal.toFixed(2),
      item_unit_price: price.toFixed(2),
      item_has_unit_hint: qty > 1 ? '1' : '',
      item_options: itemOptions,
      notes: it.notes || it.observations || it.observation || ''
    };
  });

  // Totais — preferir subTotal do iFood quando disponível (evita recalcular)
  const ifoodSubTotal = Number(ifoodPayload.total?.subTotal ?? 0) || 0;
  if (ifoodSubTotal > 0) subtotal = ifoodSubTotal;
  const taxaEntrega = Number(o.deliveryFee ?? payload.deliveryFee ?? ifoodPayload.total?.deliveryFee ?? 0) || 0;
  const additionalFees = Number(ifoodPayload.total?.additionalFees ?? 0) || 0;
  const desconto = Number(o.couponDiscount ?? o.discount ?? o.discountAmount ?? ifoodPayload.total?.benefits ?? 0) || 0;
  const total = Number(o.total ?? o.amount ?? o.orderAmount ?? (subtotal + taxaEntrega + additionalFees - desconto)) || 0;

  // Pagamentos — iFood usa { methods: [], prepaid } (envelope ou direto)
  const ifoodPayments = ifoodPayload.payments || null;
  const paymentsList = Array.isArray(o.payments) ? o.payments
    : (ifoodPayments?.methods && Array.isArray(ifoodPayments.methods)) ? ifoodPayments.methods
    : Array.isArray(ifoodPayments) ? ifoodPayments
    : (payload.payment ? [payload.payment]
    : (o.paymentMethod ? [{ method: o.paymentMethod, amount: total }]
    : []));

  const PAY_MAP = {
    'CASH': 'Dinheiro', 'CREDIT': 'Cartão de Crédito', 'DEBIT': 'Cartão de Débito',
    'CREDIT_CARD': 'Cartão de Crédito', 'DEBIT_CARD': 'Cartão de Débito',
    'MEAL_VOUCHER': 'Vale Refeição', 'FOOD_VOUCHER': 'Vale Alimentação',
    'GIFT_CARD': 'Gift Card', 'PIX': 'PIX', 'PREPAID': 'Pré-pago',
    'ONLINE': 'Pagamento Online', 'WALLET': 'Carteira Digital', 'VOUCHER': 'Voucher',
  };
  function translatePay(raw, brand) {
    if (!raw) return 'Pagamento';
    const upper = String(raw).toUpperCase().trim();
    let label = PAY_MAP[upper] || null;
    if (!label) {
      for (const [k, v] of Object.entries(PAY_MAP)) {
        if (upper.startsWith(k)) { label = v; break; }
      }
    }
    if (!label) label = raw;
    if (brand) label += ' ' + brand;
    return label;
  }

  const pagamentos = paymentsList.map(p => {
    let label = p._systemLabel || translatePay(p.method || p.type || p.name || p.paymentMethod, p.card?.brand);
    if (p.prepaid === true) label += ' (pago online)';
    else if (p.prepaid === false) label += ' (cobrar do cliente)';
    return {
      payment_method: label,
      payment_value: (Number(p.amount ?? p.value ?? p.paymentAmount ?? 0) || 0).toFixed(2)
    };
  });

  // Observações
  const observacoes = o.observation || o.notes || payload.observation || payload.notes || '';

  // Tipo do pedido
  const tipoPedido = (ifoodPayload.orderType || payload.orderType || o.orderType || o.type || '').toUpperCase();
  const isPickup = ['PICKUP', 'TAKEOUT', 'TAKE-OUT', 'PICK-UP', 'BALCAO', 'RETIRADA', 'INDOOR'].includes(tipoPedido);

  // QR Code URL (para despacho pelo motoboy)
  let qrUrl = o.qrText || o.qrUrl || payload.qrText || ifoodPayload.qrText || o.url || '';
  // Fallback: gerar URL se pedido DELIVERY sem qrUrl (usa frontendUrl passado pelo backend)
  if (!qrUrl && o.id && !isPickup) {
    const fe = o.frontendUrl || (process.env.PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (fe) {
      qrUrl = `${fe}/orders/${o.id}`;
      console.log(`[QR-DEBUG] buildContext fallback generated qr_url: ${qrUrl}`);
    }
  }

  // iFood: campos específicos (ifoodPayload já desembrulhou o envelope)
  const codigoColeta = ifoodPayload.delivery?.pickupCode || '';
  const localizador = ifoodPayload.customer?.phone?.localizer || '';
  const obsEntrega = ifoodPayload.delivery?.observations || '';

  // Horário agendado (pedido SCHEDULED do iFood)
  const horarioAgendado = (function() {
    try {
      const timing = ifoodPayload.orderTiming || payload.orderTiming || null;
      if (timing !== 'SCHEDULED') return '';
      const dt = ifoodPayload.schedule?.scheduledDateTimeStart
        || ifoodPayload.schedule?.deliveryDateTimeStart
        || ifoodPayload.scheduledDateTimeStart
        || ifoodPayload.scheduledDeliveryDateTime
        || ifoodPayload.delivery?.scheduledDateTimeStart
        || null;
      if (!dt) return '';
      const d = new Date(dt);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  })();

  // Troco (changeFor) para pagamento em dinheiro
  const troco = (function() {
    try {
      const methods = ifoodPayload.payments?.methods || payload.payments?.methods || [];
      const cash = methods.find(m => String(m.method || '').toUpperCase() === 'CASH');
      if (cash?.changeFor) return Number(cash.changeFor).toFixed(2);
      if (cash?.cash?.changeFor) return Number(cash.cash.changeFor).toFixed(2);
    } catch (e) {}
    return '';
  })();

  return {
    header_name: settings.headerName || 'Minha Loja',
    header_city: settings.headerCity || '',
    display_id: displayId,
    data_pedido: datePedido,
    hora_pedido: horaPedido,
    nome_cliente: nomeCliente,
    telefone_cliente: telefoneCliente,
    endereco_cliente: isPickup ? 'PEDIDO PARA RETIRADA' : endereco,
    items,
    total_itens_count: String(totalItensCount),
    subtotal: subtotal.toFixed(2),
    taxa_entrega: taxaEntrega ? taxaEntrega.toFixed(2) : '',
    taxa_servico: additionalFees ? additionalFees.toFixed(2) : '',
    acrescimo_val: additionalFees ? additionalFees.toFixed(2) : '',
    desconto: desconto ? desconto.toFixed(2) : '',
    total: total.toFixed(2),
    pagamentos,
    observacoes,
    tipo_pedido: tipoPedido,
    qr_url: qrUrl,
    codigo_coleta: codigoColeta,
    localizador,
    obs_entrega: obsEntrega,
    troco,
    horario_agendado: horarioAgendado,
  };
}

/**
 * Renderiza o conteúdo de um bloco individual substituindo placeholders.
 */
function renderBlockContent(contentStr, ctx) {
  if (!contentStr || !ctx) return contentStr || '';
  let result = processIfBlocks(contentStr, ctx);
  result = replacePlaceholders(result, ctx);
  return result;
}

module.exports = { renderTemplate, buildContext, renderBlockContent, replacePlaceholders };
