/**
 * Budget Service view types for consumers
 *
 * Mapping functions from raw Budget Service API types to shapes
 * used by BFF responses and WebSocket events.
 */

import type {
  BudgetResponse,
  BudgetItem,
  BudgetUpdateSuccess,
  BudgetSummary,
} from '@airo/shared/budget'

// ── Decimal helpers ──

/**
 * Compute remaining credits from decimal string fields.
 * Only finalized spend (creditsUsed) is subtracted; pending is not surfaced.
 * Rounds to 6 decimal places to avoid float drift on NUMERIC(20,6) values.
 */
export function computeRemaining(total: string, used: string): number {
  const result = parseFloat(total) - parseFloat(used)
  return Math.round(result * 1e6) / 1e6
}

// ── BFF credit status response ──

export interface CreditStatusResponse {
  remaining: number
  budgets: BudgetSummary[]
}

export function toBudgetSummary(item: BudgetItem): BudgetSummary {
  return {
    budgetItemId: item.budgetItemId,
    remaining: computeRemaining(item.creditsTotal, item.creditsUsed),
    expiration: item.expiresAt,
  }
}

export function toCreditStatusResponse(raw: BudgetResponse): CreditStatusResponse {
  return {
    remaining: computeRemaining(raw.creditsTotal, raw.creditsUsed),
    budgets: raw.items.map(toBudgetSummary),
  }
}

// ── budget_update WebSocket event ──

export function toBudgetUpdatePayload(
  budgetResponse: BudgetResponse
): BudgetUpdateSuccess {
  return {
    refreshRequired: false,
    customerRemaining: computeRemaining(budgetResponse.creditsTotal, budgetResponse.creditsUsed),
    budgets: budgetResponse.items.map(toBudgetSummary),
  }
}

