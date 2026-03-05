import express from 'express'
import { prisma } from '../prisma.js'

export const paymentRouter = express.Router()

/**
 * POST /payment/webhook
 * Gateway-agnostic webhook handler.
 * Body: { paymentId, status, gatewayRef?, paidAt? }
 */
paymentRouter.post('/webhook', async (req, res) => {
  const { paymentId, status, gatewayRef, paidAt } = req.body || {}
  if (!paymentId || !status) {
    return res.status(400).json({ message: 'paymentId e status são obrigatórios' })
  }

  try {
    const payment = await prisma.saasPayment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { items: true } } }
    })
    if (!payment) return res.status(404).json({ message: 'Pagamento não encontrado' })

    await prisma.saasPayment.update({
      where: { id: paymentId },
      data: {
        status: status.toUpperCase(),
        gatewayRef: gatewayRef || payment.gatewayRef,
        paidAt: status.toUpperCase() === 'PAID' ? (paidAt ? new Date(paidAt) : new Date()) : payment.paidAt
      }
    })

    // On successful payment, process invoice items
    if (status.toUpperCase() === 'PAID' && payment.invoice) {
      await prisma.saasInvoice.update({
        where: { id: payment.invoice.id },
        data: { status: 'PAID', paidAt: new Date() }
      })

      for (const item of (payment.invoice.items || [])) {
        if (item.type === 'MODULE') {
          await prisma.saasModuleSubscription.updateMany({
            where: { companyId: payment.companyId, moduleId: item.referenceId },
            data: { status: 'ACTIVE' }
          })
        } else if (item.type === 'CREDIT_PACK') {
          const pack = await prisma.aiCreditPack.findUnique({ where: { id: item.referenceId } })
          if (pack) {
            await prisma.company.update({
              where: { id: payment.companyId },
              data: { aiCreditsBalance: { increment: pack.credits } }
            })
          }
        }
      }
    }

    res.json({ ok: true })
  } catch (e) {
    console.error('[payment webhook]', e)
    res.status(500).json({ message: 'Erro no webhook de pagamento', error: e?.message })
  }
})
