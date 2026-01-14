'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { appService, type DailyUsageInfo } from '@/services/AppService'
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

function getToastShownKey(appId: string): string {
  const today = new Date().toISOString().split('T')[0]
  return `usage_toast_shown_${appId}_${today}`
}

function hasToastBeenShown(appId: string): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(getToastShownKey(appId)) === 'true'
}

function markToastShown(appId: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(getToastShownKey(appId), 'true')
}

export interface UseDailyUsageOptions {
  appId: string | null
  enabled?: boolean
}

/**
 * React Query hook for fetching daily usage
 */
export function useDailyUsage(options: UseDailyUsageOptions) {
  const { appId, enabled = true } = options
  const queryClient = useQueryClient()
  const prevAppIdRef = useRef(appId)

  // Cancel in-flight queries for the PREVIOUS appId when appId changes
  useEffect(() => {
    if (prevAppIdRef.current && prevAppIdRef.current !== appId) {
      queryClient.cancelQueries({ queryKey: ['daily-usage', prevAppIdRef.current] })
    }
    prevAppIdRef.current = appId
  }, [appId, queryClient])

  const query = useQuery({
    queryKey: ['daily-usage', appId],
    queryFn: async function fetchDailyUsage(): Promise<DailyUsageInfo> {
      if (!appId) {
        throw new Error('App ID is required')
      }
      return appService.getDailyUsage(appId)
    },
    enabled: enabled && !!appId,
    staleTime: 30_000,
    retry: 1
  })

  // listen for usage-refresh events (fired when messages complete)
  useEffect(() => {
    if (!appId) return

    const handleRefresh = () => {
      queryClient.invalidateQueries({ queryKey: ['daily-usage', appId] })
    }

    window.addEventListener('usage-refresh', handleRefresh)
    return () => window.removeEventListener('usage-refresh', handleRefresh)
  }, [appId, queryClient])

  // track previous percentage to detect 90% threshold crossing
  const prevPercentageRef = useRef<number | null>(null)

  // show toast when crossing 90% threshold (once per day)
  useEffect(() => {
    if (!appId || !query.data) return

    const { percentage } = query.data
    const prevPercentage = prevPercentageRef.current
    prevPercentageRef.current = percentage

    // skip first load
    if (prevPercentage === null) return

    // check if crossed 90% threshold
    if (prevPercentage < TOAST_THRESHOLD && percentage >= TOAST_THRESHOLD) {
      if (!hasToastBeenShown(appId)) {
        markToastShown(appId)
        window.dispatchEvent(new CustomEvent('usage-warning', {
          detail: { percentage, resetTime: query.data.resetTime }
        }))
      }
    }
  }, [appId, query.data])

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
    refresh: () => queryClient.invalidateQueries({ queryKey: ['daily-usage', appId] })
  }
}
