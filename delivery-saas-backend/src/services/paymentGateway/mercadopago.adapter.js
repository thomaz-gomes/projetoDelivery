import crypto from 'crypto'
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'

export class MercadoPagoAdapter {
  constructor(credentials, config) {
    this.accessToken = credentials.accessToken
    this.publicKey = credentials.publicKey || null
    this.platformFee = Number(config.platformFee || 2)
    this.webhookSecret = config.webhookSecret || process.env.MP_WEBHOOK_SECRET
    this._client = new MercadoPagoConfig({ accessToken: this.accessToken })
  }

  get providerName() {
    return 'MERCADOPAGO'
  }

  /**
   * Create a Checkout Pro preference.
   */
  async createCheckout({ amount, description, externalRef, backUrls, notificationUrl, platformFee }) {
    const preference = new Preference(this._client)
    const body = {
      items: [{
        title: description,
        quantity: 1,
        unit_price: Number(amount),
        currency_id: 'BRL',
      }],
      marketplace_fee: platformFee ?? this.platformFee,
      external_reference: externalRef,
      notification_url: notificationUrl,
      back_urls: backUrls,
      auto_return: 'approved',
      statement_descriptor: 'CoreDelivery',
    }
    const result = await preference.create({ body })
    return { checkoutUrl: result.init_point, preferenceId: result.id }
  }

  /**
   * Get payment details from MP API.
   */
  async getPaymentStatus(gatewayRef) {
    const payment = new Payment(this._client)
    const result = await payment.get({ id: gatewayRef })
    return {
      status: mapMpStatus(result.status),
      method: mapMpMethod(result.payment_type_id),
      raw: result,
    }
  }

  /**
   * Validate MP IPN webhook signature.
   */
  validateWebhook(req) {
    const paymentId = req.query?.['data.id'] || req.body?.data?.id || null

    if (!this.webhookSecret) {
      return { valid: true, paymentId }
    }

    const xSignature = req.headers['x-signature'] || ''
    const xRequestId = req.headers['x-request-id'] || ''
    const dataId = req.query?.['data.id'] || ''

    const parts = {}
    xSignature.split(',').forEach(part => {
      const [k, v] = part.trim().split('=')
      if (k && v) parts[k.trim()] = v.trim()
    })
    const ts = parts.ts
    const hash = parts.v1
    if (!ts || !hash) return { valid: false, paymentId: null }

    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
    const expected = crypto.createHmac('sha256', this.webhookSecret)
      .update(manifest)
      .digest('hex')

    return {
      valid: expected === hash,
      paymentId: dataId || req.body?.data?.id || null,
    }
  }
}

function mapMpStatus(mpStatus) {
  const map = {
    approved: 'PAID',
    authorized: 'PROCESSING',
    in_process: 'PROCESSING',
    in_mediation: 'PROCESSING',
    pending: 'PENDING',
    rejected: 'FAILED',
    cancelled: 'FAILED',
    refunded: 'REFUNDED',
    charged_back: 'REFUNDED',
  }
  return map[mpStatus] || 'PENDING'
}

function mapMpMethod(mpMethod) {
  const map = {
    credit_card: 'CREDIT_CARD',
    debit_card: 'CREDIT_CARD',
    bank_transfer: 'PIX',
    account_money: 'PIX',
    ticket: 'BOLETO',
  }
  return map[mpMethod] || mpMethod
}
