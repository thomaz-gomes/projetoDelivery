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

  // Endereço - resolver de múltiplas fontes
  const endereco = (() => {
    // 1. String direta no topo
    if (o.address && typeof o.address === 'string' && o.address.trim() && o.address.trim() !== '-') return o.address.trim();
    if (o.addressFull) return o.addressFull;
    if (o.addressString) return o.addressString;
    // 2. Objeto estruturado (payload.delivery.deliveryAddress)
    // iFood: usa ifoodPayload para suportar envelope { order: {...} } e formato direto
    const da = (ifoodPayload.delivery && ifoodPayload.delivery.deliveryAddress) || payload.deliveryAddress || o.deliveryAddress || null;
    if (da && typeof da === 'object') {
      if (da.formattedAddress) return da.formattedAddress;
      if (da.formatted) return da.formatted;
      const parts = [];
      if (da.streetName || da.street || da.logradouro) parts.push(da.streetName || da.street || da.logradouro);
      if (da.streetNumber || da.number || da.numero) parts.push(da.streetNumber || da.number || da.numero);
      if (da.complement || da.complemento) parts.push(da.complement || da.complemento);
      if (da.neighborhood || da.bairro) parts.push(da.neighborhood || da.bairro);
      if (da.city || da.cidade) parts.push(da.city || da.cidade);
      if (parts.length) return parts.join(', ');
    }
    // 3. rawPayload.address
    const raw = payload.rawPayload && payload.rawPayload.address;
    if (raw) {
      if (typeof raw === 'string') return raw;
      if (typeof raw === 'object') {
        if (raw.formattedAddress || raw.formatted) return raw.formattedAddress || raw.formatted;
        const rp = [];
        if (raw.street || raw.logradouro) rp.push(raw.street || raw.logradouro);
        if (raw.number || raw.numero) rp.push(raw.number || raw.numero);
        if (raw.neighborhood || raw.bairro) rp.push(raw.neighborhood || raw.bairro);
        if (raw.city) rp.push(raw.city);
        if (rp.length) return rp.join(', ');
      }
    }
    // 4. Campos avulsos
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
    subtotal += price * qty;

    // iFood usa "subitems" para complementos/adicionais; outros usam options/extras
    const rawOptions = it.subitems || it.garnishItems || it.garnishes
      || it.options || it.extras || it.modifiers || it.addons || it.subItems || [];
    const itemOptions = Array.isArray(rawOptions) ? rawOptions.map(ex => {
      const inner = ex && ex.option ? ex.option : ex;
      const optQty = Number(inner.quantity ?? inner.qty ?? ex.quantity ?? ex.qty ?? 1) || 1;
      const optPrice = Number(inner.unitPrice ?? inner.price ?? inner.amount ?? ex.unitPrice ?? ex.price ?? ex.amount ?? 0) || 0;
      const totalOptQty = optQty * qty;
      subtotal += optPrice * optQty * qty;
      return {
        option_qty: String(totalOptQty),
        option_name: (inner.name || inner.title || inner.description || '').slice(0, 40),
        option_price: optPrice.toFixed(2)
      };
    }) : [];

    return {
      item_qty: String(qty),
      item_name: (it.name || it.title || it.productName || '').slice(0, 30),
      item_price: (price * qty).toFixed(2),
      item_unit_price: price.toFixed(2),
      item_options: itemOptions,
      notes: it.notes || it.observations || it.observation || ''
    };
  });

  // Totais
  const taxaEntrega = Number(o.deliveryFee ?? payload.deliveryFee ?? 0) || 0;
  const desconto = Number(o.couponDiscount ?? o.discount ?? o.discountAmount ?? 0) || 0;
  const total = Number(o.total ?? o.amount ?? o.orderAmount ?? (subtotal + taxaEntrega - desconto)) || 0;

  // Pagamentos — iFood usa { methods: [], prepaid } (envelope ou direto)
  const ifoodPayments = ifoodPayload.payments || null;
  const paymentsList = Array.isArray(o.payments) ? o.payments
    : (ifoodPayments?.methods && Array.isArray(ifoodPayments.methods)) ? ifoodPayments.methods
    : Array.isArray(ifoodPayments) ? ifoodPayments
    : (payload.payment ? [payload.payment]
    : (o.paymentMethod ? [{ method: o.paymentMethod, amount: total }]
    : []));

  const pagamentos = paymentsList.map(p => ({
    payment_method: (p.method || p.type || p.name || p.paymentMethod || 'Pagamento').toUpperCase(),
    payment_value: (Number(p.amount ?? p.value ?? p.paymentAmount ?? 0) || 0).toFixed(2)
  }));

  // Observações
  const observacoes = o.observation || o.notes || payload.observation || payload.notes || '';

  // Tipo do pedido
  const tipoPedido = (payload.orderType || o.orderType || o.type || '').toUpperCase();

  // QR Code URL (para despacho pelo motoboy)
  const qrUrl = o.qrText || o.qrUrl || (payload.qrText) || '';

  // iFood: campos específicos (ifoodPayload já desembrulhou o envelope)
  const codigoColeta = ifoodPayload.delivery?.pickupCode || '';
  const localizador = ifoodPayload.customer?.phone?.localizer || '';

  return {
    header_name: settings.headerName || 'Minha Loja',
    header_city: settings.headerCity || '',
    display_id: displayId,
    data_pedido: datePedido,
    hora_pedido: horaPedido,
    nome_cliente: nomeCliente,
    telefone_cliente: telefoneCliente,
    endereco_cliente: endereco,
    items,
    total_itens_count: String(totalItensCount),
    subtotal: subtotal.toFixed(2),
    taxa_entrega: taxaEntrega ? taxaEntrega.toFixed(2) : '',
    desconto: desconto ? desconto.toFixed(2) : '',
    total: total.toFixed(2),
    pagamentos,
    observacoes,
    tipo_pedido: tipoPedido,
    qr_url: qrUrl,
    codigo_coleta: codigoColeta,
    localizador,
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
