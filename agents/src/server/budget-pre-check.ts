/**
 * Budget pre-execution check + session creation.
 * Extracted for testability from ai-lib-websocket-server onMessageStart.
 *
 * The Budget Service's createSession endpoint validates credits and returns 402
 * NO_BUDGET_CAPACITY if the customer has insufficient credits. This eliminates
 * the need for a separate getBudget call before session creation.
 *
 * @throws {BudgetExceededError} When createSession returns 402 (no credits available)
 * @throws {BudgetNotFoundError} When budget does not exist in BMS (404)
 * @throws {BudgetServiceUnavailableError} When budget client is not configured or BMS is unreachable
 * @throws {BudgetServiceTimeoutError} When createSession times out
 * @throws {BudgetServiceAuthError} When S2S auth fails (401/403)
 * @throws {BudgetServiceError} For other BMS errors (4xx/5xx)
 */

import type { BudgetServiceClient } from '@airo/ai-lib/budget'
import { BudgetServiceUnavailableError, BudgetNoCapacityError, BudgetNotFoundError } from '@airo/ai-lib/budget'
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
 *
 * When allowOverage is true, the 402 capacity gate is bypassed — the session opens
 * regardless of credit balance. Only pass this for sessions where 100% GoDaddy
 * attribution is already guaranteed (e.g. care-agent, test-account sessions).
 */
export async function performBudgetPreCheck(
  metadata: {
    budgetServiceEnabled?: boolean
    subscriptionId?: string
    bmsBudgetId?: string
    appId?: string
    allowOverage?: boolean
  },
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

  if (metadata.allowOverage) {
    deps.logger.info('budget.session.overage_allowed', {
      appId: metadata.appId,
      subscriptionId,
      budgetId,
      reason: 'allowOverage=true — session will open even if budget is exhausted',
    })
  }

  let session: { sessionId: string }
  try {
    session = await budgetClient.createSession(budgetId, { allowOverage: metadata.allowOverage })
  } catch (err) {
    if (err instanceof BudgetNoCapacityError) {
      // When allowOverage was true, a 402 means the budget has zero budget_items —
      // the capacity gate is always enforced for item-less budgets regardless of the flag.
      // Log as a distinct error so "bypass requested but denied" is queryable separately
      // from a normal customer out-of-credits event.
      if (metadata.allowOverage) {
        deps.logger.error('budget.precheck.overage_bypass_failed', {
          appId: metadata.appId,
          subscriptionId: metadata.subscriptionId,
          budgetId,
          reason: 'allowOverage=true but BMS returned 402 — budget likely has no budget_items',
          bmsResponse: err.responseBody,
        })
      } else {
        deps.logger.warn('budget.precheck.no_capacity', {
          budgetId,
          appId: metadata.appId,
          subscriptionId: metadata.subscriptionId,
          bmsResponse: err.responseBody,
        })
      }
      throw BudgetExceededError.fromBudgetCheck(budgetId)
    }
    // Log 404 BudgetNotFoundError before re-throwing for fail-closed behavior.
    // This indicates a configuration issue (budget deleted or never created).
    if (err instanceof BudgetNotFoundError) {
      deps.logger.error('budget.precheck.budget_not_found', {
        appId: metadata.appId,
        budgetId,
        subscriptionId: metadata.subscriptionId,
        reason: 'Budget does not exist in BMS',
        error: err.message,
        responseBody: err.responseBody,
      })
    }
    throw err
  }

  deps.logger.info('budget.session.started', {
    appId: metadata.appId,
    subscriptionId,
    budgetId,
    sessionId: session.sessionId,
    allowOverage: metadata.allowOverage ?? false,
  })

  return {
    budgetId,
    sessionId: session.sessionId,
  }
}
