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
  async createCheckout({ amount, description, externalRef, backUrls, notificationUrl, platformFee, payer, items }) {
    const preference = new Preference(this._client)

    // Build enriched items array (quality: id, title, quantity, unit_price, currency_id, category_id, description)
    const enrichedItems = items?.length
      ? items.map(item => ({
        id: item.id || externalRef,
        title: item.title || description,
        description: item.description || description,
        quantity: item.quantity || 1,
        unit_price: Number(item.unit_price || amount),
        currency_id: 'BRL',
        category_id: item.category_id || 'services',
      }))
      : [{
        id: externalRef,
        title: description,
        description,
        quantity: 1,
        unit_price: Number(amount),
        currency_id: 'BRL',
        category_id: 'services',
      }]

    const body = {
      items: enrichedItems,
      marketplace_fee: platformFee ?? this.platformFee,
      external_reference: externalRef,
      statement_descriptor: 'CoreDelivery',
      binary_mode: true,
    }

    // Payer info (quality: email, name, identification, phone, address)
    if (payer) {
      body.payer = {}
      if (payer.email) body.payer.email = payer.email
      if (payer.firstName) body.payer.name = payer.firstName
      if (payer.lastName) body.payer.surname = payer.lastName
      if (payer.firstName && !payer.lastName) {
        const parts = payer.firstName.trim().split(/\s+/)
        if (parts.length > 1) {
          body.payer.name = parts[0]
          body.payer.surname = parts.slice(1).join(' ')
        }
      }
      if (payer.identificationType && payer.identificationNumber) {
        body.payer.identification = {
          type: payer.identificationType,
          number: payer.identificationNumber,
        }
      }
      if (payer.phone) {
        const digits = payer.phone.replace(/\D/g, '')
        if (digits.length >= 10) {
          body.payer.phone = {
            area_code: digits.slice(0, 2),
            number: digits.slice(2),
          }
        }
      }
    }

    // MP rejects localhost URLs for back_urls/notification_url
    const hasValidUrls = backUrls?.success && !backUrls.success.includes('localhost')
    if (hasValidUrls) {
      body.back_urls = backUrls
      body.auto_return = 'approved'
    }
    if (notificationUrl && !notificationUrl.includes('localhost')) {
      body.notification_url = notificationUrl
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
