'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useSubscription } from '@/hooks/useSubscription'
import { appFetch } from '@/lib/gasket-config'
import { type DailyUsageInfo } from '@/services/AppService'
import { WarningLevel } from '@/types/usage'

const WARNING_THRESHOLD = 50
const CRITICAL_THRESHOLD = 75
export const TOAST_THRESHOLD = 90

export interface FormattedResetTime {
  dayKey: 'today' | 'tomorrow'
  timeString: string
}

export function formatResetTime(resetTime: string | null): FormattedResetTime | null {
  if (!resetTime) return null
  const resetDate = new Date(resetTime)
  const now = new Date()

  const isToday = resetDate.toDateString() === now.toDateString()
  const dayKey = isToday ? 'today' : 'tomorrow'

  const timeString = resetDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })

  return { dayKey, timeString }
}

function getToastShownKey(): string {
  const today = new Date().toISOString().split('T')[0]
  return `usage_toast_shown_${today}`
}

function hasToastBeenShown(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(getToastShownKey()) === 'true'
}

function markToastShown(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(getToastShownKey(), 'true')
}

export interface UseDailyUsageOptions {
  appId: string | null
  enabled?: boolean
}

/**
 * Fetch token budget from mgmt-airo via API route
 */
async function fetchTokenBudget(subscriptionId: string): Promise<DailyUsageInfo> {
  const response = await appFetch(`/api/token-budget/${encodeURIComponent(subscriptionId)}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch token budget: ${response.status}`)
  }

  return response.json()
}

/**
 * React Query hook for fetching daily usage from mgmt-airo token-budget API
 */
export function useDailyUsage(options: UseDailyUsageOptions) {
  const { appId, enabled = true } = options
  const queryClient = useQueryClient()
  const { data: subscription } = useSubscription()
  const subscriptionId = subscription?.id

  const query = useQuery({
    queryKey: ['token-budget', subscriptionId],
    queryFn: () => {
      if (!subscriptionId) {
        return Promise.reject(new Error('Subscription ID is required to fetch token budget'))
      }
      return fetchTokenBudget(subscriptionId)
    },
    enabled: enabled && !!appId && !!subscriptionId,
    staleTime: 30_000,
    retry: 1
  })

  // listen for usage-refresh events (fired when messages complete)
  useEffect(() => {
    if (!appId || !subscriptionId) return

    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['token-budget', subscriptionId] })
    }

    window.addEventListener('usage-refresh', handleRefresh)
    return () => window.removeEventListener('usage-refresh', handleRefresh)
  }, [appId, subscriptionId, queryClient])

  // track previous percentage to detect 90% threshold crossing
  const prevPercentageRef = useRef<number | null>(null)

  // show toast when crossing 90% threshold (once per day, per-customer)
  useEffect(() => {
    if (!query.data) return

    const { percentage } = query.data
    const prevPercentage = prevPercentageRef.current
    prevPercentageRef.current = percentage

    // skip first load
    if (prevPercentage === null) return

    // check if crossed 90% threshold
    if (prevPercentage < TOAST_THRESHOLD && percentage >= TOAST_THRESHOLD) {
      if (!hasToastBeenShown()) {
        markToastShown()
        window.dispatchEvent(new CustomEvent('usage-warning', {
          detail: { percentage, resetTime: query.data.resetTime }
        }))
      }
    }
  }, [query.data])

  const warningLevel = useMemo<WarningLevel>(() => {
    if (!query.data) return WarningLevel.NONE
    const { percentage } = query.data
    if (percentage >= 100) return WarningLevel.EXCEEDED
    if (percentage >= CRITICAL_THRESHOLD) return WarningLevel.WARNING
    if (percentage >= WARNING_THRESHOLD) return WarningLevel.CAUTION
    return WarningLevel.NONE
  }, [query.data])

  const formattedResetTime = useMemo(() => {
    return formatResetTime(query.data?.resetTime ?? null)
  }, [query.data?.resetTime])

  // Whether the usage warning banner should be active (>= 90% but not exceeded)
  const isWarningBannerActive = useMemo(() => {
    if (!query.data) return false
    return query.data.percentage >= TOAST_THRESHOLD && warningLevel !== WarningLevel.EXCEEDED
  }, [query.data, warningLevel])

  return {
    ...query,
    warningLevel,
    formattedResetTime,
    isWarningBannerActive,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['token-budget', subscriptionId] })
  }
}
