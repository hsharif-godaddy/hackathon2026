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
  readonly budgets: readonly BudgetSummary[]
  readonly assignment: CostAssignment
  /** Full budget items for client-side cache update (avoids BFF round-trip) */
  readonly items: readonly BudgetItem[]
  /** Budget ID for adapting items to grants */
  readonly budgetId: string
}

export interface BudgetUpdateRefreshRequired {
  readonly refreshRequired: true
}

export interface BudgetSummary {
  readonly budgetItemId: string
  readonly remaining: number
  readonly expiration: string | null
}

export interface CostAssignment {
  readonly customer: readonly CustomerDeduction[]
  readonly godaddy?: GodaddyDeduction
  readonly overflow?: { readonly amount: number }
}

export interface CustomerDeduction {
  readonly budgetItemId: string
  readonly amount: number
}

export interface GodaddyDeduction {
  readonly category: string
  readonly amount: number
}
