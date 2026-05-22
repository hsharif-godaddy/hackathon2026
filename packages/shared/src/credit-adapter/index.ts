import type { BudgetItem, BudgetResponse } from '../budget/index.js'
import { type CreditGrant, GrantFinalState, GrantType } from '../grants/index.js'

/**
 * Logger contract used to surface invalid credit strings during adaptation.
 * Each consumer (app/, debug-console/) injects its own logger; defaults to
 * console.error so the shared module has no host-specific dependency.
 */
export interface AdapterLogger {
  error: (event: string, ctx: Record<string, unknown>) => void
}

const DEFAULT_LOGGER: AdapterLogger = {
  error: (event, ctx) => {
    // eslint-disable-next-line no-console
    console.error(event, ctx)
  },
}

function toNumber(value: string, logger: AdapterLogger): number {
  const n = parseFloat(value)
  if (!Number.isFinite(n)) {
    logger.error('budget.adapter.invalid_credit_value', {
      value,
      message: 'Invalid credit string could not be parsed - defaulting to 0',
    })
    return 0
  }
  return n
}

function deriveGrantType(item: BudgetItem): GrantType {
  if (item.label === GrantType.PlanMonthly || item.label === GrantType.CreditPack) {
    return item.label
  }
  return item.resetInterval ? GrantType.PlanMonthly : GrantType.CreditPack
}

function isItemUsable(creditsRemaining: number, expiresAt: string | null): boolean {
  if (creditsRemaining <= 0) return false
  if (expiresAt === null) return true
  return new Date(expiresAt) > new Date()
}

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

function deriveUseBefore(item: BudgetItem): string | null {
  if (item.resetsAt) return item.resetsAt
  if (item.expiresAt) return item.expiresAt
  return null
}

function getEffectiveExpiration(item: BudgetItem): string | null {
  return item.resetsAt ?? item.expiresAt
}

function adaptBudgetItemToGrant(
  item: BudgetItem,
  subscriptionId: string,
  budgetId: string,
  logger: AdapterLogger
): CreditGrant {
  const creditsMax = toNumber(item.creditsTotal, logger)
  const creditsUsed = toNumber(item.creditsUsed, logger)
  const creditsSpent = Math.floor(creditsUsed)
  const creditsRemaining = creditsMax - creditsUsed
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

export function adaptBudgetToGrants(
  budget: BudgetResponse,
  subscriptionId: string,
  logger: AdapterLogger = DEFAULT_LOGGER
): CreditGrant[] {
  return adaptBudgetItemsToGrants(budget.items, budget.budgetId, subscriptionId, logger)
}

export function adaptBudgetItemsToGrants(
  items: readonly BudgetItem[],
  budgetId: string,
  subscriptionId: string,
  logger: AdapterLogger = DEFAULT_LOGGER
): CreditGrant[] {
  return items.map((item) => adaptBudgetItemToGrant(item, subscriptionId, budgetId, logger))
}
