/**
 * Budget pre-execution check + session creation.
 * Extracted for testability from ai-lib-websocket-server onMessageStart.
 *
 * The Budget Service's createSession endpoint validates credits and returns 402
 * NO_BUDGET_CAPACITY if the customer has insufficient credits. This eliminates
 * the need for a separate getBudget call before session creation.
 *
 * Fail-open on transient errors: when BMS is unreachable or times out, returns null
 * so the customer can continue using the product. Cost is retroactively attributable
 * via litellm_metadata (subscriptionId in user field, appId and bmsBudgetId in tags) sent to GoCode.
 *
 * When allowOverage is true, the 402 capacity gate is bypassed — the session opens
 * regardless of credit balance. Only pass this for sessions where 100% GoDaddy
 * attribution is already guaranteed (e.g. care-agent, test-account sessions).
 *
 * @throws {BudgetExceededError} When createSession returns 402 (no credits available)
 * @throws {BudgetNotFoundError} When budget does not exist in BMS (404)
 * @throws {BudgetServiceAuthError} When S2S auth fails (401/403)
 * @throws {BudgetServiceError} For non-transient BMS errors (4xx/5xx excluding 402/404/timeout/unavailable)
 */

import type { BudgetServiceClient } from '@airo/ai-lib/budget'
import { BudgetServiceUnavailableError, BudgetServiceTimeoutError, BudgetNoCapacityError, BudgetNotFoundError } from '@airo/ai-lib/budget'
import { BudgetExceededError } from '@airo/ai-common'
import type { LoggerLike } from '@airo/ai-common'
import { classifyPurchaseIntent } from '../services/purchase-intent-classifier.js'

const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 200

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
 * Returns null when budgetServiceEnabled is false/absent, or on transient BMS failures (fail-open).
 * Throws BudgetExceededError if no credits available (402 from BMS).
 */
export async function performBudgetPreCheck(
  metadata: {
    budgetServiceEnabled?: boolean
    subscriptionId?: string
    bmsBudgetId?: string
    appId?: string
    allowOverage?: boolean
    purchaseIntentClassifierEnabled?: boolean
  },
  deps: BudgetPreCheckDeps,
  userMessage?: string,
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
    deps.logger.error('budget.precheck.fail_open', {
      appId: metadata.appId,
      budgetId,
      subscriptionId,
      reason: 'bms_client_not_configured',
      error: 'Budget Service client not configured (missing BUDGET_SERVICE_URL)',
    })
    return null
  }

  if (metadata.allowOverage) {
    deps.logger.info('budget.session.overage_allowed', {
      appId: metadata.appId,
      subscriptionId,
      budgetId,
      reason: 'allowOverage=true — session will open even if budget is exhausted',
    })
  }

  // Create BMS session - the endpoint validates budget capacity and returns 402
  // NO_BUDGET_CAPACITY if no credits are available (fail-closed).
  // Retries once on transient errors before failing open.
  let lastTransientError: Error | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const session = await budgetClient.createSession(budgetId, { allowOverage: metadata.allowOverage })

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
    } catch (err) {
      // Non-transient errors: throw immediately, no retry.
      if (err instanceof BudgetNoCapacityError) {
        const purchaseIntent = userMessage && metadata.purchaseIntentClassifierEnabled
          ? await classifyPurchaseIntent(userMessage, { logger: deps.logger })
          : undefined

        if (purchaseIntent === true && !metadata.allowOverage) {
          try {
            const session = await budgetClient.createSession(budgetId, { allowOverage: true })
            deps.logger.info('budget.precheck.purchase_intent_bypass', {
              appId: metadata.appId,
              subscriptionId: metadata.subscriptionId,
              budgetId,
              sessionId: session.sessionId,
              reason: 'purchase intent detected on credit=0; bypassing 402 with allowOverage',
            })
            return {
              budgetId,
              sessionId: session.sessionId,
            }
          } catch (bypassErr) {
            // Any other error (transient/auth/404/5xx)
            if (bypassErr instanceof BudgetNoCapacityError) {
              deps.logger.error('budget.precheck.purchase_intent_bypass_failed', {
                appId: metadata.appId,
                subscriptionId: metadata.subscriptionId,
                budgetId,
                reason: 'BMS still 402 with allowOverage — budget likely has no budget_items',
                error: bypassErr.message,
              })
              // Fall through to the standard 402 throw below.
            } else {
              deps.logger.error('budget.precheck.purchase_intent_bypass_failed', {
                appId: metadata.appId,
                subscriptionId: metadata.subscriptionId,
                budgetId,
                reason: 'bypass createSession failed with non-402 error',
                error: bypassErr instanceof Error ? bypassErr.message : String(bypassErr),
              })
              throw bypassErr
            }
          }
        }

        if (metadata.allowOverage) {
          deps.logger.error('budget.precheck.overage_bypass_failed', {
            appId: metadata.appId,
            subscriptionId: metadata.subscriptionId,
            budgetId,
            reason: 'allowOverage=true but BMS returned 402 — budget likely has no budget_items',
            bmsResponse: err.responseBody,
            purchaseIntent,
            purchaseIntentClassifierEnabled: metadata.purchaseIntentClassifierEnabled,
          })
        } else {
          deps.logger.warn('budget.precheck.no_capacity', {
            budgetId,
            appId: metadata.appId,
            subscriptionId: metadata.subscriptionId,
            bmsResponse: err.responseBody,
            purchaseIntent,
            purchaseIntentClassifierEnabled: metadata.purchaseIntentClassifierEnabled,
          })
        }
        throw BudgetExceededError.fromBudgetCheck(budgetId, { purchaseIntent })
      }
      if (err instanceof BudgetNotFoundError) {
        deps.logger.error('budget.precheck.budget_not_found', {
          appId: metadata.appId,
          budgetId,
          subscriptionId: metadata.subscriptionId,
          reason: 'Budget does not exist in BMS',
          error: err.message,
          responseBody: err.responseBody,
        })
        throw err
      }

      // Transient errors: retry once, then fail-open.
      if (err instanceof BudgetServiceUnavailableError || err instanceof BudgetServiceTimeoutError) {
        lastTransientError = err
        if (attempt < MAX_ATTEMPTS) {
          deps.logger.warn('budget.precheck.retry', {
            appId: metadata.appId,
            budgetId,
            subscriptionId: metadata.subscriptionId,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
            reason: err instanceof BudgetServiceTimeoutError ? 'bms_timeout' : 'bms_unreachable',
            error: err instanceof Error ? err.message : String(err),
          })
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS + Math.random() * 100))
          continue
        }
        break
      }

      // Non-transient error — propagate immediately regardless of prior transient attempt.
      throw err
    }
  }

  // All attempts exhausted with transient errors — fail-open.
  deps.logger.error('budget.precheck.fail_open', {
    appId: metadata.appId,
    budgetId,
    subscriptionId: metadata.subscriptionId,
    attempts: MAX_ATTEMPTS,
    reason: lastTransientError instanceof BudgetServiceTimeoutError ? 'bms_timeout' : 'bms_unreachable',
    error: lastTransientError?.message,
  })
  return null
}
