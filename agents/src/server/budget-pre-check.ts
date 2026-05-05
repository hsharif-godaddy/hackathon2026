/**
 * Budget pre-execution check + session creation.
 * Extracted for testability from ai-lib-websocket-server onMessageStart.
 */

import type { BudgetServiceClient } from '@airo/ai-lib/budget'
import { computeRemaining, BudgetServiceUnavailableError } from '@airo/ai-lib/budget'
import { BudgetExceededError } from '@airo/ai-common'
import type { LoggerLike } from '@airo/ai-common'

export interface BudgetPreCheckDeps {
  getClient: () => BudgetServiceClient | null
  logger: LoggerLike
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

  // bmsBudgetId is required for session creation.
  // If missing, degrade gracefully - skip BMS mode rather than fail-closed.
  //
  // Design rationale: This typically indicates a transient JWT issuer lookup failure
  // (e.g., budget-service unreachable at token issuance time). Fail-closed would cause
  // user-facing outages for a backend issue. Fail-open risks unbilled usage but
  // preserves availability.
  //
  // Monitoring: The error log below is queryable for alerting. If this fires persistently
  // for specific apps/sites, it indicates misconfiguration rather than transient failure.
  const budgetId = metadata.bmsBudgetId
  if (!budgetId) {
    deps.logger.error('budget.precheck.skipped', {
      appId: metadata.appId,
      reason: 'bmsBudgetId missing from context metadata',
      budgetServiceEnabled: true,
    })
    return null
  }

  // subscriptionId is optional - used for override detection at report time
  // Log warning if missing on BMS-enabled session to help diagnose configuration issues
  const subscriptionId = metadata.subscriptionId
  if (!subscriptionId) {
    deps.logger.warn('budget.precheck.subscriptionId_missing', {
      appId: metadata.appId,
      budgetId,
      reason: 'subscriptionId missing - session will be attributed to customer',
    })
  }

  const budgetClient = deps.getClient()
  if (!budgetClient) {
    throw new BudgetServiceUnavailableError('Budget Service client not configured (missing BUDGET_SERVICE_URL)')
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
