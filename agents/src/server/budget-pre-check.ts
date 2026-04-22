/**
 * Budget pre-execution check + session creation.
 * Extracted for testability from ai-lib-websocket-server onMessageStart.
 */

import type { BudgetServiceClient } from '@airo/ai-lib/budget'
import { computeRemaining, BudgetServiceUnavailableError } from '@airo/ai-lib/budget'
import { BudgetExceededError } from '@airo/ai-common'
import { BudgetOverride } from '@airo/ai-grants'

export interface BudgetPreCheckDeps {
  getClient: () => BudgetServiceClient | null
  logger: { info: (event: string, data: Record<string, unknown>) => void }
}

export interface BudgetPreCheckResult {
  budgetId: string
  sessionId: string
}

/**
 * Check budget availability and create a BMS session.
 * Returns null when budgetServiceEnabled is false/absent (caller should skip).
 * Throws BudgetExceededError or BudgetServiceUnavailableError on failure (fail-closed).
 */
export async function performBudgetPreCheck(
  metadata: { budgetServiceEnabled?: boolean; subscriptionId?: string; bmsBudgetId?: string; appId?: string },
  deps: BudgetPreCheckDeps,
): Promise<BudgetPreCheckResult | null> {
  if (metadata.budgetServiceEnabled !== true) return null

  const subscriptionId = metadata.subscriptionId
  if (!subscriptionId) {
    throw new BudgetServiceUnavailableError('Budget Service is enabled but subscriptionId is missing from context metadata')
  }

  // Skip budget check for internal override sessions (care agents, test accounts)
  if (subscriptionId === BudgetOverride.CareAgent || subscriptionId === BudgetOverride.TestAccounts) {
    return null
  }

  const budgetClient = deps.getClient()
  if (!budgetClient) {
    throw new BudgetServiceUnavailableError('Budget Service client not configured (missing BUDGET_SERVICE_URL)')
  }

  const budgetId = metadata.bmsBudgetId
  if (!budgetId) {
    throw new BudgetServiceUnavailableError('Budget Service is enabled but bmsBudgetId is missing from context metadata')
  }

  // Pre-execution credit check (fail-closed)
  // !(remaining > 0) catches NaN from malformed BMS strings (NaN <= 0 is false)
  const budget = await budgetClient.getBudget(budgetId)
  const remaining = computeRemaining(budget.creditsTotal, budget.creditsUsed)
  if (!(remaining > 0)) {
    throw BudgetExceededError.fromBudgetCheck(budgetId)
  }

  // Create BMS session for this prompt
  const session = await budgetClient.createSession(budgetId)

  deps.logger.info('budget.session.started', {
    appId: metadata.appId,
    subscriptionId,
    budgetId,
    sessionId: session.sessionId,
    remaining,
  })

  return {
    budgetId,
    sessionId: session.sessionId,
  }
}
