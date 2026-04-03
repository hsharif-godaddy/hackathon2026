export type BillingMode = 'budget-service' | 'grants'

export function getBillingMode(budgetServiceEnabled?: boolean): BillingMode {
  return budgetServiceEnabled ? 'budget-service' : 'grants'
}
