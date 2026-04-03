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
}

export interface CreateReportResponse {
  readonly reportId: string
  readonly budgetId: string
  readonly sessionId: string
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
