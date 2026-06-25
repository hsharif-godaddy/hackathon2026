import type { BudgetResponse } from '@airo/shared/budget'

/**
 * Returns the credits a deduct could actually consume, as a 6-decimal string.
 *
 * Mirrors the strict gate in POST /budgets/{budgetId}/deduct (the server's
 * `consumeCredits` → `filterConsumableItems`): the sum of remaining credits
 * (`creditsTotal - creditsUsed`) over **non-expired** items only. `creditsPending`
 * is deliberately NOT subtracted — it reflects open session charges the deduct
 * gate does not deduct against — so this is a true upper bound for what /deduct
 * will accept, suitable for a preflight check.
 */
export function availableCredits(budget: BudgetResponse): string {
  const now = Date.now()
  let available = 0
  for (const item of budget.items ?? []) {
    if (item.expiresAt) {
      const expiresMs = Date.parse(item.expiresAt)
      if (!Number.isNaN(expiresMs) && expiresMs <= now) continue // expired — not consumable
    }
    const remaining = parseFloat(item.creditsTotal) - parseFloat(item.creditsUsed)
    if (remaining > 0) available += remaining
  }
  return Math.max(0, available).toFixed(6)
}
