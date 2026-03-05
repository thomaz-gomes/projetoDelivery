import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'

/**
 * Create a Checkout Pro preference with marketplace split.
 * @param {string} sellerAccessToken - The SaaS manager's MP access token (decrypted)
 * @param {object} opts
 * @param {string} opts.externalReference - Our paymentId for traceability
 * @param {Array<{title:string, quantity:number, unit_price:number}>} opts.items
 * @param {string} opts.notificationUrl - Webhook URL
 * @param {object} opts.backUrls - { success, failure, pending }
 * @param {number} opts.marketplaceFee - Platform fee in BRL (decimal, e.g. 2.00)
 * @returns {Promise<{id:string, init_point:string}>}
 */
export async function createPreference(sellerAccessToken, opts) {
  const client = new MercadoPagoConfig({ accessToken: sellerAccessToken })
  const preference = new Preference(client)

  const body = {
    items: opts.items,
    marketplace_fee: opts.marketplaceFee,
    external_reference: opts.externalReference,
    notification_url: opts.notificationUrl,
    back_urls: opts.backUrls,
    auto_return: 'approved',
    statement_descriptor: 'CoreDelivery'
  }

  const result = await preference.create({ body })
  return { id: result.id, init_point: result.init_point }
}

/**
 * Get payment details from MP API.
 * @param {string} sellerAccessToken
 * @param {string} mpPaymentId - The payment ID from MP notification
 * @returns {Promise<object>}
 */
export async function getPayment(sellerAccessToken, mpPaymentId) {
  const client = new MercadoPagoConfig({ accessToken: sellerAccessToken })
  const payment = new Payment(client)
  return payment.get({ id: mpPaymentId })
}
