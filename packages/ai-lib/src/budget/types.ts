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
import type { ReportResponse } from './report-types.js'

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
  reportResponse: ReportResponse,
  budgetResponse: BudgetResponse
): BudgetUpdateSuccess {
  // Calculate GoDaddy deduction from productCost
  // TODO: Return all godaddy item categories instead of just the highest-cost one
  // (needed when per-call attribution produces multiple GoDaddy-covered items with different labels)
  const godaddyItems = reportResponse.reportItems.filter((ri) => ri.productCost > 0)
  const godaddyDeduction =
    godaddyItems.length > 0
      ? {
          // Use the category from the item with the highest productCost
          category: godaddyItems.reduce((prev, curr) =>
            curr.productCost > prev.productCost ? curr : prev
          ).category,
          amount: reportResponse.productCostTotal,
        }
      : undefined

  return {
    refreshRequired: false,
    customerRemaining: computeRemaining(budgetResponse.creditsTotal, budgetResponse.creditsUsed),
    budgets: budgetResponse.items.map(toBudgetSummary),
    assignment: {
      customer: reportResponse.reportItems.flatMap((ri) =>
        ri.budgetItems.map((bi) => ({
          budgetItemId: bi.budgetItemId,
          amount: bi.creditsUsed,
        }))
      ),
      ...(godaddyDeduction && { godaddy: godaddyDeduction }),
    },
  }
}

