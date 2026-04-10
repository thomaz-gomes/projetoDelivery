/**
 * Helper de calculo de datas de parcelas.
 *
 * Tres funcoes exportadas:
 *  - calculateCreditCardInstallments
 *  - calculateBoletoInstallments
 *  - calculateInstallmentDates  (dispatcher)
 */

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Clamp a day to the last valid day of the given month/year.
 * e.g. day=31, month=1 (Feb), year=2026 → 28
 */
function clampDay(year, month, day) {
  // month is 0-based here (JS Date convention)
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(day, lastDay);
}

/**
 * Build a Date (local, midnight) for a given year/month(0-based)/day,
 * clamping the day to the month's max.
 */
function buildDate(year, month, day) {
  const d = clampDay(year, month, day);
  return new Date(year, month, d);
}

/**
 * Add `n` calendar months to a base year/month pair, returning { year, month }.
 * month is 0-based.
 */
function addMonths(year, month, n) {
  const total = month + n;
  return {
    year: year + Math.floor(total / 12),
    month: ((total % 12) + 12) % 12, // handles negative just in case
  };
}

// ─── credit card ────────────────────────────────────────────────────────────

/**
 * Calcula datas de vencimento de parcelas de cartao de credito.
 *
 * Regras:
 *  - Se dia da compra < closingDay → primeira parcela no dueDay do MESMO mes
 *  - Se dia da compra >= closingDay → primeira parcela no dueDay do MES SEGUINTE
 *  - Parcelas seguintes: +1 mes cada
 *  - Overflow de meses (dez → jan do ano seguinte) tratado automaticamente
 *  - Meses com menos dias: dueDay e ajustado (ex.: 31 em fev → 28/29)
 *
 * @param {Date}   purchaseDate     - Data da compra
 * @param {number} closingDay       - Dia de fechamento da fatura (1-31)
 * @param {number} dueDay           - Dia de vencimento da fatura (1-31)
 * @param {number} installmentCount - Numero de parcelas
 * @returns {{ installments: Array<{ number: number, dueDate: Date }> }}
 */
export function calculateCreditCardInstallments(purchaseDate, closingDay, dueDay, installmentCount) {
  const pDate = new Date(purchaseDate);
  const purchaseDay = pDate.getDate();

  let baseYear = pDate.getFullYear();
  let baseMonth = pDate.getMonth(); // 0-based

  if (purchaseDay >= closingDay) {
    // push first installment to next month
    const next = addMonths(baseYear, baseMonth, 1);
    baseYear = next.year;
    baseMonth = next.month;
  }

  const installments = [];
  for (let i = 0; i < installmentCount; i++) {
    const { year, month } = addMonths(baseYear, baseMonth, i);
    installments.push({
      number: i + 1,
      dueDate: buildDate(year, month, dueDay),
    });
  }

  return { installments };
}

// ─── boleto ─────────────────────────────────────────────────────────────────

/**
 * Calcula datas de vencimento de parcelas de boleto.
 *
 * Templates:
 *  - '30d'     → parcelas a cada 30 dias (30, 60, 90...)
 *  - '7_14_21' → parcelas a cada 7 dias (7, 14, 21, 28...)
 *  - '7_15'    → alternando 7 e 15 dias (7, 22, 29, 44...)
 *  - 'custom'  → usa array customDates como fornecido
 *
 * @param {Date}     purchaseDate     - Data da compra
 * @param {number}   installmentCount - Numero de parcelas
 * @param {string}   template         - Template de intervalo
 * @param {Date[]}   [customDates]    - Datas customizadas (quando template='custom')
 * @returns {{ installments: Array<{ number: number, dueDate: Date }> }}
 */
export function calculateBoletoInstallments(purchaseDate, installmentCount, template, customDates) {
  const pDate = new Date(purchaseDate);
  const installments = [];

  if (template === 'custom') {
    const dates = (customDates || []).slice(0, installmentCount);
    for (let i = 0; i < dates.length; i++) {
      installments.push({
        number: i + 1,
        dueDate: new Date(dates[i]),
      });
    }
    return { installments };
  }

  // Parse template into an array of day-intervals that cycle
  let intervals;
  switch (template) {
    case '30d':
      intervals = [30];
      break;
    case '7_14_21':
      intervals = [7];
      break;
    case '7_15':
      intervals = [7, 15];
      break;
    default:
      intervals = [30]; // fallback
  }

  let cursor = pDate.getTime();
  for (let i = 0; i < installmentCount; i++) {
    const gap = intervals[i % intervals.length];
    cursor += gap * 24 * 60 * 60 * 1000;
    installments.push({
      number: i + 1,
      dueDate: new Date(cursor),
    });
  }

  return { installments };
}

// ─── dispatcher ─────────────────────────────────────────────────────────────

/**
 * Dispatcher que roteia o calculo de parcelas conforme o metodo de pagamento.
 *
 * @param {string} method           - CREDIT_CARD | BOLETO | PIX | DINHEIRO | TRANSFERENCIA
 * @param {Date}   purchaseDate     - Data da compra
 * @param {number} installmentCount - Numero de parcelas
 * @param {Object} [opts]           - Opcoes extras
 * @param {number} [opts.closingDay]  - Dia de fechamento (cartao)
 * @param {number} [opts.dueDay]      - Dia de vencimento (cartao)
 * @param {string} [opts.template]    - Template de intervalo (boleto)
 * @param {Date[]} [opts.customDates] - Datas customizadas (boleto custom)
 * @returns {{ installments: Array<{ number: number, dueDate: Date }> }}
 */
export function calculateInstallmentDates(method, purchaseDate, installmentCount, opts = {}) {
  switch (method) {
    case 'CREDIT_CARD':
      return calculateCreditCardInstallments(
        purchaseDate,
        opts.closingDay,
        opts.dueDay,
        installmentCount,
      );

    case 'BOLETO':
      return calculateBoletoInstallments(
        purchaseDate,
        installmentCount,
        opts.template,
        opts.customDates,
      );

    case 'PIX':
    case 'DINHEIRO':
    case 'TRANSFERENCIA':
    default:
      return {
        installments: [
          { number: 1, dueDate: new Date(purchaseDate) },
        ],
      };
  }
}
