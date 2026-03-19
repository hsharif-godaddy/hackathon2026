/**
 * Pricing Offers Hook
 *
 * Fetches pricing offers from the Offer Graph API for displaying plan pricing.
 * Returns pricing data for Starter, Professional, and Ultimate plans.
 */

import { useQuery } from '@tanstack/react-query'

import { shipAnalyticsLog } from '@/lib/logging'
import {
  type AllPricingData,
  type PlanOffer,
  SubscriptionPlan,
} from '@/types/credits'

const QUERY_KEY = ['pricing-offers'] as const
const STALE_TIME = 10 * 60 * 1000 // 10 minutes
const GC_TIME = 30 * 60 * 1000 // 30 minutes

interface UsePricingOffersOptions {
  enabled?: boolean
}

interface UsePricingOffersResult {
  data: AllPricingData | null
  isLoading: boolean
  isError: boolean
  error: Error | null
}

async function fetchPricingOffers(): Promise<AllPricingData> {
  const response = await fetch('/api/pricing/offers')

  if (!response.ok) {
    shipAnalyticsLog('pricing_section.fetch.http_error', {
      status: response.status,
      statusText: response.statusText,
    })
    throw new Error(`Failed to fetch pricing offers: ${response.status}`)
  }

  const result = await response.json()

  if (!result.success) {
    shipAnalyticsLog('pricing_section.fetch.api_error', {
      error: result.error,
      message: result.message,
    })
    throw new Error(result.error || 'Failed to get pricing data')
  }

  const offers: PlanOffer[] = result.data?.airoYearlyMonthly?.offers || []

  // Convert array to object keyed by plan id
  return offers.reduce<AllPricingData>(
    (acc, offer) => {
      const planId = offer.id as keyof AllPricingData
      if (planId in acc) {
        acc[planId] = offer
      }
      return acc
    },
    {
      [SubscriptionPlan.Starter]: null,
      [SubscriptionPlan.Professional]: null,
      [SubscriptionPlan.Ultimate]: null,
    }
  )
}

export function usePricingOffers(
  options: UsePricingOffersOptions = {}
): UsePricingOffersResult {
  const { enabled = true } = options

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchPricingOffers,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled,
  })

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}
