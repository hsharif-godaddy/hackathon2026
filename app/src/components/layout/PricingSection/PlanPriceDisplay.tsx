'use client'

import Skeleton from '@ux/skeleton'
import text from '@ux/text'
import TextLockup from '@ux/text-lockup'

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

  const perMonthPrices = planOffer?.price?.formatted?.listing?.perMonth
  const perTermPrices = planOffer?.price?.formatted?.listing?.perTerm
  if (!perMonthPrices?.discounted) {
    return null
  }

  const { discounted, renewal: monthlyRenewal } = perMonthPrices
  const discountPercentage = planOffer?.discountPercentage ?? null
  const annualRenewalPrice = perTermPrices?.renewal
  const hasDiscount = discountPercentage !== null && discountPercentage > 0

  const eyebrowContent = hasDiscount && monthlyRenewal ? (
    <div className="flex items-center gap-2 xl:gap-1.5 2xl:gap-2 flex-wrap">
      <text.span className="line-through whitespace-nowrap" text={t('builder_pricing_per_month', { price: monthlyRenewal })} />
      <text.span
        className="bg-ai-light text-intents-ux-boxHighContrast-foregroundColor px-1.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
        text={t('builder_pricing_percent_off', { percent: discountPercentage })}
      />
    </div>
  ) : null

  return (
    <div className="mt-1 mb-2">
      <TextLockup
        eyebrow={eyebrowContent}
        title={<span className="whitespace-nowrap">{t('builder_pricing_per_month', { price: discounted })}</span>}
        size="xl"
      >
        {annualRenewalPrice && (
          <text.span as="caption" size={-1} emphasis="passive" text={t('builder_pricing_first_year_term', { renewalPrice: annualRenewalPrice })} />
        )}
      </TextLockup>
    </div>
  )
}
