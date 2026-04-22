import type { BudgetItem, BudgetResponse } from '@airo/shared/budget'
import { type CreditGrant,GrantFinalState, GrantType } from '@airo/shared/grants'

/**
 * Adapt BMS budget data to CreditGrant[] format for backwards compatibility.
 *
 * This allows the client to use the same CreditGrant type regardless of
 * whether data comes from BMS or the legacy grants API.
 */

function toNumber(value: string): number {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Derive grant type from BMS budget item properties.
 * - label field (preferred): use directly when present
 * - resetInterval fallback: set → plan-monthly, null → credit-pack
 */
function deriveGrantType(item: BudgetItem): GrantType {
  if (item.label === GrantType.PlanMonthly || item.label === GrantType.CreditPack) {
    return item.label
  }
  return item.resetInterval ? GrantType.PlanMonthly : GrantType.CreditPack
}

/**
 * Check if a budget item is usable (has remaining credits and not expired)
 */
function isItemUsable(creditsRemaining: number, expiresAt: string | null): boolean {
  if (creditsRemaining <= 0) return false
  if (expiresAt === null) return true
  return new Date(expiresAt) > new Date()
}

/**
 * Derive finalState from budget item state.
 * - expired: expiresAt is in the past
 * - consumed: no credits remaining
 * - null: item is still active
 */
function deriveFinalState(
  creditsRemaining: number,
  expiresAt: string | null
): GrantFinalState | null {
  if (expiresAt && new Date(expiresAt) <= new Date()) {
    return GrantFinalState.Expired
  }
  if (creditsRemaining <= 0) {
    return GrantFinalState.Consumed
  }
  return null
}

/**
 * Derive useBefore date from budget item.
 * - For plan-monthly: use resetsAt (when credits reset/expire)
 * - For credit-pack: use expiresAt (when pack expires)
 * - null if neither is set (no expiration)
 */
function deriveUseBefore(item: BudgetItem): string | null {
  // Plan-monthly items use resetsAt (next reset = expiration of current period)
  if (item.resetsAt) {
    return item.resetsAt
  }

  // Credit-pack items use expiresAt
  if (item.expiresAt) {
    return item.expiresAt
  }

  // No expiration date
  return null
}

/**
 * Derive the effective expiration date for availability/finalState checks.
 * Uses resetsAt for plan-monthly, expiresAt for credit-pack.
 */
function getEffectiveExpiration(item: BudgetItem): string | null {
  return item.resetsAt ?? item.expiresAt
}

function adaptBudgetItemToGrant(
  item: BudgetItem,
  subscriptionId: string,
  budgetId: string
): CreditGrant {
  const creditsMax = toNumber(item.creditsTotal)
  const creditsSpent = toNumber(item.creditsUsed)
  const creditsRemaining = creditsMax - creditsSpent
  const now = new Date().toISOString()
  const effectiveExpiration = getEffectiveExpiration(item)

  return {
    id: item.budgetItemId,
    subscriptionId,
    type: deriveGrantType(item),
    llmBudgetUserId: budgetId,
    llmBudgetId: budgetId,
    creditsMax,
    creditsSpent,
    isAvailable: isItemUsable(creditsRemaining, effectiveExpiration),
    finalState: deriveFinalState(creditsRemaining, effectiveExpiration),
    useBefore: deriveUseBefore(item),
    createdAt: item.startsAt ?? now,
    updatedAt: now,
  }
}

/**
 * Adapt a full BMS budget response to CreditGrant[] format.
 *
 * @param budget - BMS budget response
 * @param subscriptionId - Subscription ID for the grants
 * @returns Array of CreditGrant objects shaped like the legacy grants API
 */
export function adaptBudgetToGrants(
  budget: BudgetResponse,
  subscriptionId: string
): CreditGrant[] {
  return budget.items.map((item) =>
    adaptBudgetItemToGrant(item, subscriptionId, budget.budgetId)
  )
}
