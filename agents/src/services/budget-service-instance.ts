/**
 * Lazy singleton for Budget Service client.
 * Returns null if BUDGET_SERVICE_URL not configured.
 * Auth: IAM S2S JWT via getS2SToken (no signing key needed).
 */

import { BudgetServiceClient } from '@airo/ai-lib/budget'
import { logger } from '../logging/index.js'

let instance: BudgetServiceClient | null | undefined

export function getBudgetServiceClient(): BudgetServiceClient | null {
  if (instance !== undefined) return instance

  const baseUrl = process.env.BUDGET_SERVICE_URL

  if (!baseUrl) {
    logger.info('budget.client.disabled', { hasUrl: false })
    instance = null
    return null
  }

  try {
    instance = new BudgetServiceClient({ baseUrl })
    logger.info('budget.client.initialized', { baseUrl })
  } catch (err) {
    logger.error('budget.client.init_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    instance = null
  }
  return instance
}
