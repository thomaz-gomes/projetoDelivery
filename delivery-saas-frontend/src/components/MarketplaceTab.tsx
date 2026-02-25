import React, { useEffect, useMemo, useState } from 'react'
import {
  Coupon,
  computeSuggestedPrice,
  mapToDTO,
  MarketplaceDTO,
  ComputeResult
} from './marketplaceTypes'

interface Props {
  cmv: number // custo de mercadoria vendida vindo da ficha técnica
  initial?: Partial<MarketplaceDTO>
  onChange?: (dto: MarketplaceDTO, calc: ComputeResult) => void
}

export default function MarketplaceTab({ cmv, initial = {}, onChange }: Props) {
  const [marketplaceFeePercent, setMarketplaceFeePercent] = useState<number>(initial.marketplaceFeePercent ?? 12)
  const [paymentFeePercent, setPaymentFeePercent] = useState<number>(initial.paymentFeePercent ?? 3.2)
  const [desiredMarginPercent, setDesiredMarginPercent] = useState<number>(initial.desiredMarginPercent ?? 20)
  const [packagingCost, setPackagingCost] = useState<number>(initial.packagingCost ?? 0)

  const [couponType, setCouponType] = useState<'fixed' | 'percent'>(initial.coupon?.type ?? 'fixed')
  const [couponValue, setCouponValue] = useState<number>(initial.coupon ? initial.coupon.value : 0)

  const [freeDelivery, setFreeDelivery] = useState<boolean>(initial.freeDelivery ?? false)
  const [deliveryCostForRestaurant, setDeliveryCostForRestaurant] = useState<number>(initial.deliveryCostForRestaurant ?? 0)

  const coupon: Coupon | null = useMemo(() => {
    if (couponValue === 0) return null
    return { type: couponType, value: couponValue }
  }, [couponType, couponValue])

  const calc = useMemo(() => {
    return computeSuggestedPrice(
      cmv,
      packagingCost,
      freeDelivery ? deliveryCostForRestaurant : 0,
      marketplaceFeePercent,
      paymentFeePercent,
      desiredMarginPercent,
      coupon
    )
  }, [cmv, packagingCost, deliveryCostForRestaurant, freeDelivery, marketplaceFeePercent, paymentFeePercent, desiredMarginPercent, coupon])

  useEffect(() => {
    if (onChange) onChange(mapToDTO({ marketplaceFeePercent, paymentFeePercent, desiredMarginPercent, coupon, freeDelivery, deliveryCostForRestaurant, packagingCost }), calc)
  }, [marketplaceFeePercent, paymentFeePercent, desiredMarginPercent, coupon, freeDelivery, deliveryCostForRestaurant, packagingCost, onChange, calc])

  return (
    <div className="p-4 bg-white rounded-md shadow-sm">
      <h3 className="text-lg font-semibold mb-3">MARKETPLACE</h3>

      <section className="mb-4">
        <div className="text-sm text-gray-600">CMV (Ficha Técnica)</div>
        <div className="text-xl font-bold">R$ {cmv.toFixed(2)}</div>
      </section>

      <section className="mb-4">
        <div className="text-sm font-medium mb-2">Configuração iFood / Marketplace</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col">
            <span className="text-xs text-gray-600">Taxa Marketplace (%)</span>
            <input type="number" step="0.01" min="0" max="100" value={marketplaceFeePercent}
              onChange={e => setMarketplaceFeePercent(Number(e.target.value))}
              className="mt-1 p-2 border rounded" />
          </label>

          <label className="flex flex-col">
            <span className="text-xs text-gray-600">Taxa Pagamento Online (%)</span>
            <input type="number" step="0.01" min="0" max="100" value={paymentFeePercent}
              onChange={e => setPaymentFeePercent(Number(e.target.value))}
              className="mt-1 p-2 border rounded" />
          </label>

          <label className="flex flex-col col-span-2">
            <span className="text-xs text-gray-600">Margem Líquida Desejada (%)</span>
            <input type="number" step="0.01" min="0" max="100" value={desiredMarginPercent}
              onChange={e => setDesiredMarginPercent(Number(e.target.value))}
              className="mt-1 p-2 border rounded" />
          </label>

          <label className="flex flex-col">
            <span className="text-xs text-gray-600">Custo Embalagem (R$)</span>
            <input type="number" step="0.01" min="0" value={packagingCost}
              onChange={e => setPackagingCost(Number(e.target.value))}
              className="mt-1 p-2 border rounded" />
          </label>
        </div>
      </section>

      <section className="mb-4">
        <div className="text-sm font-medium mb-2">Cupom / Promoção (restaurante absorve)</div>
        <div className="flex items-center gap-3">
          <select value={couponType} onChange={e => setCouponType(e.target.value as any)} className="p-2 border rounded">
            <option value="fixed">R$ (fixo)</option>
            <option value="percent">% (percentual)</option>
          </select>
          <input type="number" step="0.01" min="0" value={couponValue}
            onChange={e => setCouponValue(Number(e.target.value))}
            className="p-2 border rounded flex-1" />
        </div>
      </section>

      <section className="mb-4">
        <div className="text-sm font-medium mb-2">Logística</div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={freeDelivery} onChange={e => setFreeDelivery(e.target.checked)} className="w-4 h-4" />
            <span className="ml-1">Entrega Grátis para o Cliente?</span>
          </label>
        </div>

        {freeDelivery && (
          <div className="mt-3">
            <label className="flex flex-col">
              <span className="text-xs text-gray-600">Custo de Entrega para o Restaurante (R$)</span>
              <input type="number" step="0.01" min="0" value={deliveryCostForRestaurant}
                onChange={e => setDeliveryCostForRestaurant(Number(e.target.value))}
                className="mt-1 p-2 border rounded" />
            </label>
          </div>
        )}
      </section>

      <section className="mt-4 p-3 border rounded bg-gray-50">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm text-gray-600">Preço Sugerido</div>
            <div className="text-2xl font-bold">{calc.suggestedPrice !== null ? `R$ ${calc.suggestedPrice.toFixed(2)}` : '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Lucro Líquido Real</div>
            <div className={`text-lg font-semibold ${calc.netProfit !== null && calc.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{calc.netProfit !== null ? `R$ ${calc.netProfit.toFixed(2)}` : '—'}</div>
          </div>
        </div>

        {!calc.denominatorValid && (
          <div className="mt-3 text-sm text-red-600">A combinação de taxas/margem/cupom gera um denominador inválido (≤ 0). Ajuste as taxas ou a margem.</div>
        )}

        <div className="mt-3 text-xs text-gray-700">
          <div>Composição:</div>
          <ul className="list-disc ml-5">
            <li>CMV: R$ {cmv.toFixed(2)}</li>
            <li>Embalagem: R$ {packagingCost.toFixed(2)}</li>
            <li>Entrega (restaurante): R$ {(freeDelivery ? deliveryCostForRestaurant : 0).toFixed(2)}</li>
            <li>Taxa Marketplace (R$): R$ {calc.marketplaceFeeAmount.toFixed(2)}</li>
            <li>Taxa Pagamento (R$): R$ {calc.paymentFeeAmount.toFixed(2)}</li>
            <li>Valor Cupom (R$): R$ {calc.couponAmount.toFixed(2)}</li>
          </ul>
        </div>
      </section>
    </div>
  )
}
