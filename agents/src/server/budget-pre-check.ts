/**
 * Budget pre-execution check + session creation.
 * Extracted for testability from ai-lib-websocket-server onMessageStart.
 *
 * The Budget Service's createSession endpoint validates credits and returns 402
 * NO_BUDGET_CAPACITY if the customer has insufficient credits. This eliminates
 * the need for a separate getBudget call before session creation.
 *
 * @throws {BudgetExceededError} When createSession returns 402 (no credits available)
 * @throws {BudgetServiceUnavailableError} When budget client is not configured or BMS is unreachable
 * @throws {BudgetServiceTimeoutError} When createSession times out
 * @throws {BudgetServiceAuthError} When S2S auth fails (401/403)
 * @throws {BudgetServiceError} For other BMS errors (4xx/5xx)
 */

import type { BudgetServiceClient } from '@airo/ai-lib/budget'
import { BudgetServiceUnavailableError, BudgetNoCapacityError } from '@airo/ai-lib/budget'
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
 * Create a BMS session, which validates budget capacity.
 * Returns null when budgetServiceEnabled is false/absent (caller should skip).
 * Throws BudgetExceededError if no credits available (402 from BMS).
 * Throws BudgetServiceUnavailableError on transient failures (fail-closed).
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

  // Create BMS session - the endpoint validates budget capacity and returns 402
  // NO_BUDGET_CAPACITY if no credits are available (fail-closed).
  let session: { sessionId: string }
  try {
    session = await budgetClient.createSession(budgetId)
  } catch (err) {
    // Convert 402 NO_BUDGET_CAPACITY to BudgetExceededError for consistent client handling.
    // Log the original error to preserve BMS response details for debugging.
    if (err instanceof BudgetNoCapacityError) {
      deps.logger.warn('budget.precheck.no_capacity', {
        budgetId,
        appId: metadata.appId,
        subscriptionId: metadata.subscriptionId,
        bmsResponse: err.responseBody,
      })
      throw BudgetExceededError.fromBudgetCheck(budgetId)
    }
    throw err
  }

  deps.logger.info('budget.session.started', {
    appId: metadata.appId,
    subscriptionId,
    budgetId,
    sessionId: session.sessionId,
  })

  return {
    budgetId,
    sessionId: session.sessionId,
  }
}
