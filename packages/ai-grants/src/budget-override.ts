/**
 * Budget Override Detection
 *
 * Special subscription IDs for non-standard billing that bypass grants
 * and use dedicated GoDaddy budgets. These are used for care agents,
 * test accounts, and internal task budgets.
 */

/**
 * Special subscription IDs for non-standard billing.
 * These bypass grants and use dedicated budgets.
 */
export enum BudgetOverride {
  CareAgent = 'airo-builder:care-agent',
  TestAccounts = 'airo-builder:test-accounts',
  // Task-specific budgets for assessment agent overrides
  AssessAgent = 'airo-builder:assess-agent',
  PublishTask = 'airo-builder:publish-task',
  DomainTask = 'airo-builder:domain-task',
  FixTask = 'airo-builder:fix-task',
  // Background task budgets
  SummarizationTask = 'airo-builder:summarization-task',
  DiagnoseTask = 'airo-builder:paas-diagnose-task',
}

/** BMS override types - only these trigger 100% GoDaddy attribution in BMS reporting */
export type BmsOverride = BudgetOverride.CareAgent | BudgetOverride.TestAccounts

/** All BudgetOverride values for O(1) lookup */
const BUDGET_OVERRIDE_VALUES: ReadonlySet<BudgetOverride> = new Set(Object.values(BudgetOverride))

/**
 * BMS override subscription IDs - only these should trigger 100% GoDaddy attribution
 * in Budget Management Service reporting. Other BudgetOverride values (AssessAgent,
 * PublishTask, etc.) are for the legacy grants system, not BMS.
 */
const BMS_OVERRIDE_VALUES: ReadonlySet<BmsOverride> = new Set([
  BudgetOverride.CareAgent,
  BudgetOverride.TestAccounts,
] as const)

/**
 * Check if a subscriptionId is a budget override that bypasses grants.
 * These sessions use dedicated budgets instead of customer grants.
 */
export function isBudgetOverride(subscriptionId: string | null | undefined): subscriptionId is BudgetOverride {
  return !!subscriptionId && BUDGET_OVERRIDE_VALUES.has(subscriptionId as BudgetOverride)
}

/**
 * Check if a subscriptionId should trigger 100% GoDaddy attribution in BMS reporting.
 * Only CareAgent and TestAccounts qualify - other BudgetOverride values are for the
 * legacy grants system and should NOT trigger BMS override attribution.
 */
export function isBmsOverride(subscriptionId: string | null | undefined): subscriptionId is BmsOverride {
  return !!subscriptionId && BMS_OVERRIDE_VALUES.has(subscriptionId as BmsOverride)
}

/**
 * Resolve the effective subscriptionId for BMS reporting based on session type.
 * Employee sessions -> CareAgent, test accounts -> TestAccounts, otherwise the actual subscriptionId.
 */
export function resolveBmsSubscriptionId(
  isEmployeeSession: boolean,
  useTestBudget: boolean,
  subscriptionId: string | undefined,
): string | undefined {
  if (isEmployeeSession) {
    return BudgetOverride.CareAgent
  }
  if (useTestBudget) {
    return BudgetOverride.TestAccounts
  }
  return subscriptionId
}

/**
 * Check if a session should be allowed to open even when the budget has no remaining
 * credits. When true, the BMS capacity gate is bypassed at session creation; uncovered
 * spend is captured at close via the report-side allowOverage flag.
 *
 * Currently matches BMS override sessions (CareAgent, TestAccounts). Extend this set
 * as new override cases are added — independently of isBmsOverride().
 */
export function allowSessionOverage(subscriptionId: string | null | undefined): boolean {
  return isBmsOverride(subscriptionId)
}
