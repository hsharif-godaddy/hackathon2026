/**
 * Budget Service view types for consumers
 *
 * Mapping functions from raw Budget Service API types to shapes
 * used by BFF responses and WebSocket events.
 */

import type {
  BudgetResponse,
  BudgetUpdateSuccess,
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


// ── budget_update WebSocket event ──

export function toBudgetUpdatePayload(
  reportResponse: ReportResponse,
  budgetResponse: BudgetResponse,
  sessionWasFree: boolean
): BudgetUpdateSuccess {
  // Full breakdown of all report items for detailed cost attribution display
  const reportItems = reportResponse.reportItems.map((ri) => ({
    budgetCost: ri.budgetCost,
    productCost: ri.productCost,
    category: ri.category,
  }))

  return {
    refreshRequired: false,
    customerRemaining: computeRemaining(budgetResponse.creditsTotal, budgetResponse.creditsUsed),
    assignment: {
      customer: reportResponse.reportItems.flatMap((ri) =>
        ri.budgetItems.map((bi) => ({
          budgetItemId: bi.budgetItemId,
          amount: bi.creditsUsed,
        }))
      ),
      reportItems,
    },
    budgetItems: budgetResponse.items,
    budgetId: budgetResponse.budgetId,
    sessionWasFree,
  }
}

