'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { appService, type DailyUsageInfo } from '@/services/AppService'

const WARNING_THRESHOLD = 50
const CRITICAL_THRESHOLD = 75
export const TOAST_THRESHOLD = 90

export type WarningLevel = 'none' | 'caution' | 'warning' | 'exceeded'

export function formatResetTime(resetTime: string | null): string | null {
  if (!resetTime) return null
  const resetDate = new Date(resetTime)
  const now = new Date()

  const isToday = resetDate.toDateString() === now.toDateString()
  const relativeDay = isToday ? 'today' : 'tomorrow'

  const timeStr = resetDate.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })

  return `${relativeDay} at ${timeStr}`
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
    if (!query.data) return 'none'
    const { percentage } = query.data
    if (percentage >= 100) return 'exceeded'
    if (percentage >= CRITICAL_THRESHOLD) return 'warning'
    if (percentage >= WARNING_THRESHOLD) return 'caution'
    return 'none'
  }, [query.data])

  const formattedResetTime = useMemo(() => {
    return formatResetTime(query.data?.resetTime ?? null)
  }, [query.data?.resetTime])

  return {
    ...query,
    warningLevel,
    formattedResetTime,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['daily-usage', appId] })
  }
}
