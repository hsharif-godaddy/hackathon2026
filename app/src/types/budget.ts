/**
 * Budget Service credit status types
 *
 * Represents the BFF-enriched response from GET /api/credits/status.
 * This is the BMS BudgetResponse joined with mgmt-airo grants to add
 * type labels and pre-parsed numeric credit amounts.
 *
 * Local to the app package (not shared) because it includes BFF enrichment
 * fields (numeric conversions, grant type join) that don't exist in raw BMS types.
 */

export interface CreditStatusItem {
  readonly budgetItemId: string
  readonly creditsTotal: string
  readonly creditsUsed: string
  readonly costToCreditRatio: string
  readonly startsAt: string | null
  readonly expiresAt: string | null
  readonly resetInterval: string | null
  readonly creditsTotalNumeric: number
  readonly creditsUsedNumeric: number
  readonly type: string | null
}

export interface CreditStatusResponse {
  readonly budgetId: string
  readonly productKey: string
  readonly creditsTotal: string
  readonly creditsUsed: string
  readonly creditsPending: string
  readonly creditsTotalNumeric: number
  readonly creditsUsedNumeric: number
  readonly creditsPendingNumeric: number
  readonly items: CreditStatusItem[]
}

export const BUDGET_STATUS_QUERY_KEY = 'budget-status'
