'use client'

import { useEffect } from 'react'

import { useCreditGrants } from '@/hooks/useCreditGrants'
import { useSubscription } from '@/hooks/useSubscription'
import { getTotalCreditsFromGrants } from '@/utils/credits'
import { logImpressionEvent } from '@/utils/instrumentation'

const THRESHOLDS = [75, 50, 20, 10, 5] as const

// Module-level: survives navigate away/back within the same tab.
// Keyed by subscription ID so different subscriptions don't share state.
const firedThresholdsBySubscription = new Map<string, Set<number>>()

function storageKey(subscriptionId: string): string {
  return `airo_credit_thresholds_${subscriptionId}`
}

function loadPersistedThresholds(subscriptionId: string): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey(subscriptionId))
    return raw ? new Set<number>(JSON.parse(raw) as number[]) : new Set()
  } catch {
    return new Set()
  }
}

function persistThreshold(subscriptionId: string, threshold: number): void {
  try {
    const key = storageKey(subscriptionId)
    const existing = loadPersistedThresholds(subscriptionId)
    existing.add(threshold)
    localStorage.setItem(key, JSON.stringify([...existing]))
  } catch {
    // localStorage unavailable (private browsing, storage full, etc.)
  }
}

function hasPersistedThresholds(subscriptionId: string): boolean {
  try {
    return localStorage.getItem(storageKey(subscriptionId)) !== null
  } catch {
    return false
  }
}

function clearPersistedThresholds(subscriptionId: string): void {
  try {
    localStorage.removeItem(storageKey(subscriptionId))
  } catch {
    // ignore
  }
}

/**
 * Fires logImpressionEvent when remaining credits cross below 75/50/20/10/5%.
 * If multiple thresholds cross in one update, all crossed thresholds fire (most severe last).
 * `isFirstOccurrence: true` the very first time a threshold is crossed per subscription.
 */
export function useCreditThresholdEvents(): void {
  const { data: subscription } = useSubscription()
  const { data: grants, isLoading } = useCreditGrants({
    subscriptionId: subscription?.id,
  })

  useEffect(function checkCreditThresholds() {
    if (isLoading || !grants || !subscription?.id) return

    const { totalCreditsSpent, totalCreditsMax } = getTotalCreditsFromGrants(grants)
    if (totalCreditsMax <= 0) return

    const remainingPercent = (Math.max(0, totalCreditsMax - totalCreditsSpent) / totalCreditsMax) * 100

    if (!firedThresholdsBySubscription.has(subscription.id)) {
      firedThresholdsBySubscription.set(subscription.id, new Set())
    }
    const firedThresholds = firedThresholdsBySubscription.get(subscription.id)!

    // Credits replenished (upgrade / credit pack / monthly reset) — reset tracking.
    // Clear only when there is something to clear: in-memory fires or stale localStorage
    // from a session where the user was away when credits replenished.
    if (remainingPercent >= THRESHOLDS[0]) {
      if (firedThresholds.size > 0 || hasPersistedThresholds(subscription.id)) {
        clearPersistedThresholds(subscription.id)
        firedThresholds.clear()
      }
      return
    }

    const newlyCrossed = THRESHOLDS.filter(
      (threshold) => remainingPercent < threshold && !firedThresholds.has(threshold)
    )

    if (newlyCrossed.length === 0) return

    const persistedThresholds = loadPersistedThresholds(subscription.id)

    newlyCrossed.forEach((threshold) => {
      firedThresholds.add(threshold)
      const isFirstOccurrence = !persistedThresholds.has(threshold)
      persistThreshold(subscription.id, threshold)
      logImpressionEvent(`credits.threshold.below${threshold}`, { isFirstOccurrence })()
    })
  }, [grants, isLoading, subscription?.id])
}
