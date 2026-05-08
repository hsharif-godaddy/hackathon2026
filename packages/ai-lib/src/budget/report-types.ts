/**
 * Budget Service report types (agent-only)
 *
 * These types are for the reconciliation/reporting API surface used by the
 * agent client. Frontend should only consume budget item summaries from
 * @airo/shared/budget.
 */

export interface ReportItemRequest {
  readonly budgetCost: string
  readonly productCost: string
  readonly label: string
}

export interface CreateReportRequest {
  readonly reportItems: readonly ReportItemRequest[]
  /**
   * When true, allows report creation even if budgetCost exceeds available credits.
   * The server appends an extra report item with the reserved category "allowed-overage"
   * (budgetCost=0, productCost=remainder). Original item's stored budgetCost reflects
   * only the actually allocated amount.
   *
   * Note: callers must NOT use "allowed-overage" as a label in reportItems — it is
   * reserved for the server-generated overage line and will be rejected by the API.
   */
  readonly allowOverage?: boolean
}

export interface BudgetItemDeduction {
  readonly budgetItemId: string
  readonly creditsUsed: number
}

export interface ReportItemResponse {
  readonly budgetCost: number
  readonly productCost: number
  readonly category: string
  readonly budgetItems: readonly BudgetItemDeduction[]
}

export interface ReportResponse {
  readonly reportId: string
  readonly budgetId: string
  readonly sessionId: string
  readonly productKey: string
  readonly budgetCostTotal: number
  readonly productCostTotal: number
  readonly creditsAvailable: number
  readonly reportItems: readonly ReportItemResponse[]
}
