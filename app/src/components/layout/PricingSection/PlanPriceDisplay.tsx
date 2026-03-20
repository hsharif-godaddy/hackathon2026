'use client'

import Skeleton from '@ux/skeleton'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { type PlanOffer } from '@/types/credits'

interface PlanPriceDisplayProps {
  planOffer: PlanOffer | null
  isLoading: boolean
}

export default function PlanPriceDisplay({ planOffer, isLoading }: PlanPriceDisplayProps) {
  const t = useTranslations()

  if (isLoading) {
    return (
      <div className="my-3">
        <Skeleton size="md" width="150px" height="28px" />
        <Skeleton size="sm" width="120px" height="16px" className="mt-1" />
        <Skeleton size="sm" width="200px" height="14px" className="mt-2" />
      </div>
    )
  }

  const prices = planOffer?.price?.formatted?.listing?.perMonth
  if (!prices?.discounted) {
    return null
  }

  const { discounted } = prices

  return (
    <div className="mt-1 mb-2">
      <div className="flex items-baseline">
        <text.h3 as="title" size={2} text={t('builder_pricing_per_month', { price: discounted })} />
      </div>

      <div className="flex items-center gap-2 mt-1">
        <text.span as="paragraph" emphasis="passive" text={t('builder_pricing_pay_today')} />
      </div>
    </div>
  )
}
