/**
 * Budget Service credit status types
 *
 * Represents the BFF-enriched response derived from GET /api/credits/grants.
 * When BMS is enabled, this is the BMS BudgetResponse adapted to CreditGrant[]
 * format with pre-parsed numeric credit amounts.
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
