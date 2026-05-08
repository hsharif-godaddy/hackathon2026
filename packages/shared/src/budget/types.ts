/**
 * Budget Service API types
 *
 * Raw request/response types mirroring the Budget Management Service Go models. Shared between agent client and BFF client.
 *
 * Monetary amounts (creditsTotal, creditsUsed, creditsPending, costToCreditRatio)
 * are decimal strings with NUMERIC(20,6) precision.
 *
 * BMS is application-agnostic: budget items have no "type" field. Type semantics
 * (plan-monthly, credit-pack) live in control plane grants, not here.
 */

// ── Budget item (part of GET /api/v1/budgets/:budgetId response) ──

export interface BudgetItem {
  readonly budgetItemId: string
  readonly creditsTotal: string
  readonly creditsUsed: string
  readonly costToCreditRatio: string
  readonly startsAt: string | null
  readonly expiresAt: string | null
  readonly resetInterval: string | null
  // Next reset timestamp for recurring items (plan-monthly). Null for one-time items.
  readonly resetsAt?: string | null
  // Type label from BMS (e.g., 'plan-monthly', 'credit-pack'). Not used in the frontend.
  readonly label?: string | null
}

// ── GET /api/v1/budgets/:budgetId ──

export interface BudgetResponse {
  readonly budgetId: string
  readonly productKey: string
  readonly creditsTotal: string
  readonly creditsUsed: string
  readonly creditsPending: string
  readonly items: readonly BudgetItem[]
}

// ── POST /api/v1/budgets/:budgetId/sessions ──

export interface CreateSessionResponse {
  readonly sessionId: string
}

// ── GET /api/v1/budgets/:budgetId/sessions/:sessionId ──

export interface SessionItem {
  readonly cost: number
  readonly callRequestId: string
}

export interface SessionResponse {
  readonly sessionId?: string
  readonly costTotal: number
  readonly sessionItems: readonly SessionItem[]
  readonly reconciledAt?: string | null
}

// ── budget_update WebSocket event payload ──

export type BudgetUpdatePayload = BudgetUpdateSuccess | BudgetUpdateRefreshRequired

export interface BudgetUpdateSuccess {
  readonly refreshRequired: false
  readonly customerRemaining: number
  readonly assignment: CostAssignment
  /** Full budget items for client-side cache update (avoids BFF round-trip) */
  readonly budgetItems: readonly BudgetItem[]
  /** Budget ID for adapting items to grants */
  readonly budgetId: string
  /** Whether the session was free for the customer (GoDaddy covered all cost) */
  readonly sessionWasFree: boolean
}

export interface BudgetUpdateRefreshRequired {
  readonly refreshRequired: true
}


export interface CostAssignment {
  readonly customer: readonly CustomerDeduction[]
  /**
   * Full breakdown of cost attribution by category (label).
   * Each item shows how much was charged to customer vs GoDaddy for that category.
   * Categories are namespaced: 'airo-builder:general', 'airo-builder:tool-failure',
   * 'airo-builder:infrastructure', 'airo-builder:no-output', etc.
   */
  readonly reportItems: readonly ReportItemSummary[]
}

export interface CustomerDeduction {
  readonly budgetItemId: string
  readonly amount: number
}

/**
 * Summary of a single report item for client-side cost attribution display.
 * Simplified from the full ReportItemResponse (which includes budgetItems array).
 */
export interface ReportItemSummary {
  /** Cost charged to customer's budget */
  readonly budgetCost: number
  /** Cost covered by GoDaddy (free for customer) */
  readonly productCost: number
  /** Attribution category/label (e.g., 'airo-builder:general', 'airo-builder:tool-failure') */
  readonly category: string
}
